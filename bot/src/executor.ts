import { AbiCoder, id } from "ethers";

import { getTransactionCount, readAddress, readUint, SELECTORS, type RpcReader } from "./chain.js";
import type { RescueReason, WalletConfig } from "./types.js";

/**
 * Rescue execution.
 *
 * The executor's entire power is one function:
 *
 *     rescue(address[] tokens, bool[] chargeFee)
 *
 * It cannot choose a destination — `RescueVault` sends funds to its own stored
 * `safeAddress` — and it cannot rescue the native asset. Those constraints are
 * the security model, so nothing here tries to work around them.
 */

/** `RescueVault.MAX_TOKENS_PER_TX`. Must match the contract or `rescue()` reverts. */
export const MAX_TOKENS_PER_TX = 30;

/** Multiplier applied to the gas estimate, and to the suggested fee, to survive a volatile base fee. */
export const GAS_BUFFER_PCT = 20;
export const FEE_BUFFER_PCT = 30;

export const CORE_COOLDOWN_MS = 60 * 60 * 1000;
export const WATCH_COOLDOWN_MS = 15 * 60 * 1000;
export const WATCH_MAX_PER_HOUR = 3;
const WATCH_WINDOW_MS = 60 * 60 * 1000;

/** Everything the executor needs from a signer, and nothing more. */
export interface SentTransaction {
  hash: string;
}

/** Everything the executor needs from a signer, and nothing more. */
export interface ExecutorSigner {
  getAddress(): Promise<string>;
  getBalance(address: string): Promise<bigint>;
  getFeeData(): Promise<{
    gasPrice: bigint | null;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
  }>;
  estimateGas(tx: { to: string; data: string; value?: bigint; from?: string }): Promise<bigint>;
  sendTransaction(tx: {
    to: string;
    data: string;
    nonce: number;
    gasLimit: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasPrice?: bigint;
  }): Promise<SentTransaction>;
}

export interface ExecutorOptions {
  dryRun: boolean;
  /** Executors below this balance cannot reliably pay for gas. */
  minExecutorEth: bigint;
  now?: () => number;
  log?: (message: string) => void;
  /** Optional Flashbots relay URL for private bundle submission. */
  flashbotsRelay?: string;
}

export type RescueOutcome =
  | { status: "SENT"; txHashes: string[]; tokens: string[] }
  | { status: "DRY_RUN"; planned: string[] }
  | { status: "SKIPPED"; reason: string }
  | { status: "VARIANT_B_UNSUPPORTED"; reason: string };

const coder = AbiCoder.defaultAbiCoder();
const SELECTOR_RESCUE = id("rescue(address[],bool[])").slice(0, 10);

/** `rescue(address[],bool[])` calldata. */
export function encodeRescue(tokens: string[], chargeFee: boolean[]): string {
  if (tokens.length !== chargeFee.length) {
    throw new Error(`rescue() needs one chargeFee flag per token, got ${tokens.length} and ${chargeFee.length}.`);
  }
  return `${SELECTOR_RESCUE}${coder.encode(["address[]", "bool[]"], [tokens, chargeFee]).slice(2)}`;
}

/** Splits a token list into vault-sized chunks, preserving config priority order. */
export function chunkTokens(tokens: string[], size: number = MAX_TOKENS_PER_TX): string[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += size) {
    chunks.push(tokens.slice(i, i + size));
  }
  return chunks;
}

/** Per-wallet rate limiting, so a burst of alerts cannot drain the executor's gas money. */
interface RateWindow {
  lastCoreAt: number | null;
  lastWatchAt: number | null;
  watchTimestamps: number[];
}

export class Executor {
  private readonly windows = new Map<string, RateWindow>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(
    private readonly signer: ExecutorSigner,
    private readonly provider: RpcReader,
    private readonly options: ExecutorOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
  }

  /**
   * Runs a full rescue for one wallet: core tokens first (fee charged), then
   * the watch list (no fee, quarantined), each in its own transaction.
   *
   * @param overrideTokens When set, rescue exactly these addresses as core
   *        tokens instead of the configured lists. The post-block scanner uses
   *        this: it already identified which asset moved, so re-rescuing the
   *        whole wallet would spend gas on tokens that are demonstrably fine.
   */
  async rescue(wallet: WalletConfig, reason: RescueReason, overrideTokens?: string[]): Promise<RescueOutcome> {
    if (wallet.variant === "B") {
      const message =
        `[${wallet.label}] GuardianModule (variant B) rescue is not yet implemented — ` +
        `no transaction was sent. Rule ${reason.rule} fired.`;
      this.log(message);
      return { status: "VARIANT_B_UNSUPPORTED", reason: message };
    }

    const gate = await this.preflight(wallet, reason);
    if (gate !== null) return gate;

    // Partition the requested tokens by whether the vault can actually pull
    // them. See `partitionByAllowance` for why this is not an optimisation.
    // Both lists are gated: a watch-list token whose allowance was revoked is
    // exactly as stranded as a core one.
    const coreRequested = overrideTokens ?? wallet.coreTokens.map((token) => token.address);
    const watchRequested =
      overrideTokens === undefined ? wallet.watchTokens.map((token) => token.address) : [];

    const core = await this.partitionByAllowance(wallet, coreRequested);
    const watch = await this.partitionByAllowance(wallet, watchRequested);

    const stranded = [...core.stranded, ...watch.stranded];
    if (stranded.length > 0) this.log(strandedMessage(wallet, stranded));

    if (core.movable.length === 0 && watch.movable.length === 0) {
      // Everything requested is unpullable. Broadcasting here would emit a
      // rescue transaction that provably moves nothing — burning gas and
      // logging "rescue sent" while the operator's funds stay put.
      return { status: "SKIPPED", reason: strandedMessage(wallet, stranded) };
    }

    // Config order is priority order: core tokens the operator listed first are
    // the ones they most care about, so they take the first transaction slots.
    // Watch tokens follow in their own transaction so that a gas bomb in the
    // core batch cannot block the quarantine path.
    const plans: Array<{ tokens: string[]; chargeFee: boolean }> = [];
    for (const chunk of chunkTokens(core.movable)) plans.push({ tokens: chunk, chargeFee: true });
    for (const chunk of chunkTokens(watch.movable)) plans.push({ tokens: chunk, chargeFee: false });

    if (plans.length === 0) {
      return { status: "SKIPPED", reason: "No tokens configured for this wallet." };
    }

    const descriptions = plans.map((plan) =>
      `${plan.tokens.length} token(s) ${plan.chargeFee ? "with fee" : "without fee"} [${plan.tokens.join(", ")}]`,
    );

    if (this.options.dryRun) {
      for (const description of descriptions) {
        this.log(`[DRY-RUN] ${wallet.label} would send: ${description}`);
      }
      return { status: "DRY_RUN", planned: descriptions };
    }

    const sender = await this.signer.getAddress();
    const txHashes: string[] = [];

    for (const [index, plan] of plans.entries()) {
      // One nonce per wallet, read from "pending" and advanced locally. Sharing
      // the counter across chunks is what stops the second transaction from
      // colliding with the first.
      const nonce = await getTransactionCount(this.provider, sender, "pending") + index;

      const data = encodeRescue(plan.tokens, plan.tokens.map(() => plan.chargeFee));
      const estimated = await this.signer.estimateGas({ to: wallet.vaultAddress, data, from: sender });
      const gasLimit = (estimated * BigInt(100 + GAS_BUFFER_PCT)) / 100n;

      const fees = await this.signer.getFeeData();
      const tx = {
        to: wallet.vaultAddress,
        data,
        nonce,
        gasLimit,
        ...this.applyFeeBuffer(fees),
      };

      const sent = await this.sendRescueTransaction(tx);
      txHashes.push(sent.hash);
      this.log(
        `[${wallet.label}] rescue tx ${sent.hash} sent (nonce ${nonce}, gas ${gasLimit}, ` +
          `${plan.chargeFee ? "fee charged" : "no fee"}): ${descriptions[index]}`,
      );
    }

    this.mark(window(this.windows, wallet), reason);
    // The tokens are reported so the scanner can tell a consumed allowance
    // apart from a revoked one. A successful rescue spends the allowance down
    // to zero, and without this the scanner reads that as an attack.
    return { status: "SENT", txHashes, tokens: plans.flatMap((plan) => plan.tokens) };
  }

  /**
   * Splits tokens into those the vault can pull and those whose allowance was
   * revoked.
   *
   * WHY THIS EXISTS
   * ---------------
   * `rescue()` moves funds with `transferFrom(owner, destination, amount)`, so
   * a revoked allowance makes the rescue a guaranteed no-op: every pull fails,
   * `_rescueOne` emits `RescueFailed`, and the batch still "succeeds". Sending
   * it would burn gas and — far worse — write "rescue sent" to the operator's
   * log while their funds sit exactly where they were.
   *
   * This is reachable in practice: an attacker who revokes the vault's approval
   * and transfers in the same block trips R7 (alert) and then R9 (rescue) with
   * an allowance of zero. Without this check the bot would report a rescue it
   * could not perform.
   *
   * Partial allowance loss still rescues what it can, so the partition is not
   * all-or-nothing.
   */
  private async partitionByAllowance(
    wallet: WalletConfig,
    tokens: string[],
  ): Promise<{ movable: string[]; stranded: string[] }> {
    if (tokens.length === 0) return { movable: [], stranded: [] };

    const allowances = await Promise.all(
      tokens.map((token) => readUint(this.provider, token, `${SELECTORS.allowance}${pad(wallet.protectedWallet)}${pad(wallet.vaultAddress)}`)),
    );

    const movable: string[] = [];
    const stranded: string[] = [];
    tokens.forEach((token, index) => {
      ((allowances[index] ?? 0n) > 0n ? movable : stranded).push(token);
    });

    return { movable, stranded };
  }

  /**
   * Submits a rescue transaction via Flashbots private relay when configured.
   * Flashbots bundles are sent directly to block builders, bypassing the public
   * mempool. This prevents front-running (sandwich attacks) on rescue
   * transactions, which is critical because an attacker can front-run a rescue
   * transaction to front-run the safe address change.
   *
   * @param tx - The unsigned transaction to send via Flashbots
   * @returns The transaction hash if successfully submitted, or null if failed
   */
  private async sendFlashbotsRescue(tx: {
    to: string;
    data: string;
    gasLimit: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }): Promise<{ hash: string } | null> {
    if (!this.options.flashbotsRelay) {
      return null;
    }

    try {
      const blockHex = (await this.provider.send("eth_blockNumber", [])) as string;
      const response = await fetch(this.options.flashbotsRelay, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_sendBundle",
          params: [
            {
              tx: `0x${tx.data.slice(2)}`, // Remove 0x prefix from data for Flashbots
              block: blockHex,
              maxFeePerGas: tx.maxFeePerGas?.toString(16) || "0x0",
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(16) || "0x0",
              accessList: [],
            },
            `0x${tx.data.slice(2)}`,
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Flashbots relay returned ${response.status}: ${await response.text()}`);
      }

      const result = (await response.json()) as { result?: string; error?: { message: string } };
      if (result.error) {
        throw new Error(`Flashbots relay error: ${result.error.message}`);
      }
      if (typeof result.result !== "string") {
        throw new Error("Flashbots relay returned no transaction hash");
      }

      return { hash: result.result };
    } catch (error) {
      this.log(`Flashbots submission failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Sends a rescue transaction via Flashbots when configured, otherwise falls back
   * to the public mempool via the signer. This is the main entry point for
   * broadcasting rescue transactions.
   *
   * The transaction is prepared by `rescue()`, which already applies the nonce,
   * the gas limit and the fee buffer, and is forwarded to the signer as-is.
   */
  async sendRescueTransaction(tx: {
    to: string;
    data: string;
    nonce: number;
    gasLimit: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasPrice?: bigint;
  }): Promise<{ hash: string }> {
    if (this.options.flashbotsRelay) {
      const result = await this.sendFlashbotsRescue(tx);
      if (result) return result;
      this.log("[rescue] Flashbots submission failed, falling back to public mempool");
    }

    const sent = await this.signer.sendTransaction(tx);
    return { hash: sent.hash };
  }

  /** Everything that must hold before a single transaction is built. */
  private async preflight(wallet: WalletConfig, reason: RescueReason): Promise<RescueOutcome | null> {
    const sender = await this.signer.getAddress();

    // The vault authorises exactly one executor. If the signer is not that
    // address, `rescue()` reverts with `onlyExecutor` and we would have burned
    // gas discovering that.
    const vaultExecutor = await readAddress(this.provider, wallet.vaultAddress, SELECTORS.executor);
    if (vaultExecutor.toLowerCase() !== sender.toLowerCase()) {
      const message =
        `Refusing to rescue ${wallet.label}: the signer ${sender} is not the vault's executor ` +
        `(${vaultExecutor}). Rule ${reason.rule} fired.`;
      this.log(message);
      return { status: "SKIPPED", reason: message };
    }

    const balance = await this.signer.getBalance(sender);
    if (balance < this.options.minExecutorEth) {
      const message =
        `Refusing to rescue ${wallet.label}: executor holds ${balance} wei, below the ` +
        `${this.options.minExecutorEth} wei floor. Rule ${reason.rule} fired.`;
      this.log(message);
      return { status: "SKIPPED", reason: message };
    }

    const rate = this.checkRate(wallet);
    if (rate !== null) return { status: "SKIPPED", reason: rate };

    return null;
  }

  /** Returns a human-readable skip reason, or null when the rescue may proceed. */
  private checkRate(wallet: WalletConfig): string | null {
    const state = window(this.windows, wallet);
    const t = this.now();

    if (state.lastCoreAt !== null && t - state.lastCoreAt < CORE_COOLDOWN_MS) {
      const minutes = Math.ceil((CORE_COOLDOWN_MS - (t - state.lastCoreAt)) / 60_000);
      return `Core rescue for ${wallet.label} is on cooldown for another ${minutes} minute(s).`;
    }

    if (state.watchTimestamps.length > 0) {
      state.watchTimestamps = state.watchTimestamps.filter((stamp) => t - stamp < WATCH_WINDOW_MS);
      if (state.watchTimestamps.length >= WATCH_MAX_PER_HOUR) {
        return `Watch rescue for ${wallet.label} has already run ${WATCH_MAX_PER_HOUR} time(s) in the last hour.`;
      }
    }

    if (state.lastWatchAt !== null && t - state.lastWatchAt < WATCH_COOLDOWN_MS) {
      const minutes = Math.ceil((WATCH_COOLDOWN_MS - (t - state.lastWatchAt)) / 60_000);
      return `Watch rescue for ${wallet.label} is on cooldown for another ${minutes} minute(s).`;
    }

    return null;
  }

  private mark(state: RateWindow, reason: RescueReason): void {
    const t = this.now();
    if (reason.rule === "R9_BALANCE_DROPPED") {
      state.watchTimestamps.push(t);
      state.lastWatchAt = t;
    } else {
      state.lastCoreAt = t;
    }
  }

  /** Bumps whichever fee fields the node supports; EIP-1559 and legacy differ. */
  private applyFeeBuffer(fees: {
    gasPrice: bigint | null;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
  }): { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } {
    const bump = (value: bigint): bigint => (value * BigInt(100 + FEE_BUFFER_PCT)) / 100n;

    if (fees.maxFeePerGas !== null) {
      return {
        maxFeePerGas: bump(fees.maxFeePerGas),
        ...(fees.maxPriorityFeePerGas !== null ? { maxPriorityFeePerGas: bump(fees.maxPriorityFeePerGas) } : {}),
      };
    }
    if (fees.gasPrice !== null) {
      return { gasPrice: bump(fees.gasPrice) };
    }
    // A node that reports no fee at all (some devnets) — let the signer decide.
    return {};
  }
}

/** ABI-pads an address to a 32-byte word. */
function pad(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** The operator-facing text for tokens the vault can no longer move. */
export function strandedMessage(wallet: WalletConfig, stranded: string[]): string {
  return (
    `CRITICAL: allowance for ${stranded.join(", ")} on vault ${wallet.vaultAddress} is zero. ` +
    `RescueVault pulls funds with transferFrom(), so it CANNOT move these tokens until the owner ` +
    `re-approves. No rescue transaction was sent for them. Immediate action required: re-approve ` +
    `the vault or move the funds manually. This is a known Variant A limitation — see README.`
  );
}

function window(map: Map<string, RateWindow>, wallet: WalletConfig): RateWindow {
  const existing = map.get(wallet.safeAddress);
  if (existing !== undefined) return existing;
  const created: RateWindow = { lastCoreAt: null, lastWatchAt: null, watchTimestamps: [] };
  map.set(wallet.safeAddress, created);
  return created;
}