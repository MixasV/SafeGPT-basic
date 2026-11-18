import { AbiCoder, Interface, id } from "ethers";

import { buildAlert } from "./alerts.js";
import {
  getTransactionCount,
  readAddress,
  readUint,
  waitForReceipt,
  SELECTORS,
  type RpcReader,
  type TransactionReceipt,
} from "./chain.js";
import type { Alert, RescueReason, RescuedToken, WalletConfig } from "./types.js";

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
  /** Maximum gas price in gwei the bot is willing to pay. 0 = no limit. */
  maxGasPriceGwei?: bigint;
  /**
   * Optional Flashbots relay URL for private bundle submission. Opt-in: when
   * absent, rescues always go through the public mempool. When set, the
   * executor first tries the private relay and falls back to the mempool if
   * the submission fails.
   */
  flashbotsRelay?: string;
  now?: () => number;
  log?: (message: string) => void;
  /**
   * Structured alert delivery (Telegram / webhook / backend). Defaults to the
   * log channel so a standalone executor still surfaces stranded tokens and
   * failed rescues.
   */
  alert?: (alert: Alert) => void | Promise<void>;
  /** How long to wait for a rescue receipt before reporting it unconfirmed. */
  confirmTimeoutMs?: number;
  /** Poll interval while waiting for a rescue receipt. */
  confirmPollMs?: number;
}

export type RescueOutcome =
  | { status: "SENT"; txHashes: string[]; tokens: string[]; rescued: RescuedToken[] }
  | { status: "DRY_RUN"; planned: string[] }
  | { status: "SKIPPED"; reason: string }
  | { status: "VARIANT_B_UNSUPPORTED"; reason: string };

const coder = AbiCoder.defaultAbiCoder();
const SELECTOR_RESCUE = id("rescue(address[],bool[])").slice(0, 10);

/** `Rescued(address indexed token, uint256 amount, address indexed destination)`. */
export const RESCUED_TOPIC = id("Rescued(address,uint256,address)");

/** The vault events that tell us what a confirmed rescue actually moved. */
const VAULT_EVENTS = new Interface([
  "event Rescued(address indexed token, uint256 amount, address indexed destination)",
  "event RescueSkipped(address indexed token, bytes32 reason)",
  "event RescueFailed(address indexed token, uint256 amount)",
]);

/** How long to wait for a rescue receipt to be mined before giving up on its `Rescued` events. */
const RECEIPT_ATTEMPTS = 20;
const RECEIPT_DELAY_MS = 500;

interface RawLog {
  address: string;
  topics: string[];
  data: string;
}

interface RawReceipt {
  logs: RawLog[];
}

export interface RawRescued {
  token: string;
  amount: bigint;
  destination: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads the `Rescued` events a vault emitted while executing `txHash`.
 *
 * WHY THE RECEIPT AND NOT A GUESS
 * ------------------------------
 * The bot knows what it ASKED for — a token list, a fee flag — but not what
 * the vault actually moved. Balances change for other reasons (someone else
 * moved funds, a fee was taken, a chunk was skipped because its allowance was
 * gone). The `Rescued` event is the vault's own statement of what it did, so it
 * is the only source that can report "0.00095 WETH rescued, 0.00005 WETH fee"
 * without guessing from the attacker's transaction.
 *
 * Returns an empty list when the receipt never lands: a rescue that was
 * broadcast but not mined is still reported as SENT, just without amounts.
 */
export async function readRescuedEvents(
  provider: RpcReader,
  txHash: string,
  vault: string,
): Promise<RawRescued[]> {
  let receipt: RawReceipt | null = null;

  for (let attempt = 0; attempt < RECEIPT_ATTEMPTS && receipt === null; attempt++) {
    const raw = (await provider.send("eth_getTransactionReceipt", [txHash])) as RawReceipt | null;
    receipt = raw;
    if (receipt === null && attempt < RECEIPT_ATTEMPTS - 1) await sleep(RECEIPT_DELAY_MS);
  }

  if (receipt === null) return [];

  const vaultLower = vault.toLowerCase();
  const out: RawRescued[] = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vaultLower) continue;
    if (log.topics[0]?.toLowerCase() !== RESCUED_TOPIC) continue;

    const tokenTopic = log.topics[1];
    const destinationTopic = log.topics[2];
    if (tokenTopic === undefined || destinationTopic === undefined) continue;

    out.push({
      token: `0x${tokenTopic.slice(-40)}`.toLowerCase(),
      amount: BigInt(`0x${log.data.slice(2, 66)}`),
      destination: `0x${destinationTopic.slice(-40)}`.toLowerCase(),
    });
  }

  return out;
}

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
  /** One in-flight rescue per vault, so a burst of triggers cannot double-spend gas. */
  private readonly pendingRescues = new Set<string>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly alert: (alert: Alert) => void | Promise<void>;

  constructor(
    private readonly signer: ExecutorSigner,
    private readonly provider: RpcReader,
    private readonly options: ExecutorOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
    this.alert = options.alert ?? ((alert) => this.log(alert.reason));
  }

  /**
   * Runs a full rescue for one wallet: core tokens first (fee charged), then
   * the watch list (no fee, watch-set routing), each in its own transaction.
   *
   * @param overrideTokens When set, rescue exactly these addresses as core
   *        tokens instead of the configured lists. The post-block scanner uses
   *        this: it already identified which asset moved, so re-rescuing the
   *        whole wallet would spend gas on tokens that are demonstrably fine.
   */
  async rescue(wallet: WalletConfig, reason: RescueReason, overrideTokens?: string[]): Promise<RescueOutcome> {
    if (this.pendingRescues.has(wallet.vaultAddress.toLowerCase())) {
      const message = `[${wallet.label}] rescue already in flight for ${wallet.vaultAddress}; skipping duplicate.`;
      this.log(message);
      return { status: "SKIPPED", reason: message };
    }

    const gate = await this.preflight(wallet, reason);
    if (gate !== null) return gate;

    this.pendingRescues.add(wallet.vaultAddress.toLowerCase());

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
    if (stranded.length > 0) {
      const message = strandedMessage(wallet, stranded);
      await this.alert(
        buildAlert({
          wallet: wallet.label,
          kind: "alert",
          rule: "R8_ALLOWANCE_DROPPED",
          severity: "CRITICAL",
          reason: message,
          action: "ALERT",
          txHash: reason.txHash,
          now: this.now(),
        }),
      );
    }

    if (core.movable.length === 0 && watch.movable.length === 0) {
      // Everything requested is unpullable. Broadcasting here would emit a
      // rescue transaction that provably moves nothing — burning gas and
      // logging "rescue sent" while the operator's funds stay put.
      this.pendingRescues.delete(wallet.vaultAddress.toLowerCase());
      return { status: "SKIPPED", reason: strandedMessage(wallet, stranded) };
    }

    // Config order is priority order: core tokens the operator listed first are
    // the ones they most care about, so they take the first transaction slots.
    // Watch tokens follow in their own transaction so that a gas bomb in the
    // core batch cannot block the watch-set path.
    const plans: Array<{ tokens: string[]; chargeFee: boolean }> = [];
    for (const chunk of chunkTokens(core.movable)) plans.push({ tokens: chunk, chargeFee: true });
    for (const chunk of chunkTokens(watch.movable)) plans.push({ tokens: chunk, chargeFee: false });

    if (plans.length === 0) {
      this.pendingRescues.delete(wallet.vaultAddress.toLowerCase());
      return { status: "SKIPPED", reason: "No tokens configured for this wallet." };
    }

    const descriptions = plans.map((plan) =>
      `${plan.tokens.length} token(s) ${plan.chargeFee ? "with fee" : "without fee"} [${plan.tokens.join(", ")}]`,
    );

    if (this.options.dryRun) {
      for (const description of descriptions) {
        this.log(`[DRY-RUN] ${wallet.label} would send: ${description}`);
      }
      this.pendingRescues.delete(wallet.vaultAddress.toLowerCase());
      return { status: "DRY_RUN", planned: descriptions };
    }

    const sender = await this.signer.getAddress();
    const txHashes: string[] = [];

    // Read the nonce ONCE, then advance it locally per chunk. Re-reading
    // "pending" between chunks races the node: the first transaction may not be
    // reflected yet, so two chunks can be handed the same nonce and the second
    // is silently dropped.
    const baseNonce = await getTransactionCount(this.provider, sender, "pending");

    for (const [index, plan] of plans.entries()) {
      const nonce = baseNonce + index;

      const data = encodeRescue(plan.tokens, plan.tokens.map(() => plan.chargeFee));
      const estimated = await this.signer.estimateGas({ to: wallet.vaultAddress, data, from: sender });
      const gasLimit = (estimated * BigInt(100 + GAS_BUFFER_PCT)) / 100n;

      const fees = await this.signer.getFeeData();
      const tx = {
        to: wallet.vaultAddress,
        data,
        nonce,
        gasLimit,
        ...this.applyFeeBuffer(fees, reason.attackerPriorityFee),
      };

      const sent = await this.sendRescueTransaction(tx);
      txHashes.push(sent.hash);
      this.log(
        `[${wallet.label}] rescue tx ${sent.hash} sent (nonce ${nonce}, gas ${gasLimit}, ` +
          `${plan.chargeFee ? "fee charged" : "no fee"}): ${descriptions[index]}`,
      );
    }

    // Confirm what actually landed before reporting success. Best-effort: a
    // node that cannot serve receipts leaves the rescue "broadcast, unconfirmed"
    // rather than failing it — the transactions are already on their way.
    await this.confirmRescues(wallet, reason, txHashes);

    this.pendingRescues.delete(wallet.vaultAddress.toLowerCase());
    this.mark(window(this.windows, wallet), reason);

    // The tokens are reported so the scanner can tell a consumed allowance
    // apart from a revoked one. A successful rescue spends the allowance down
    // to zero, and without this the scanner reads that as an attack.
    const tokens = plans.flatMap((plan) => plan.tokens);
    const rescued = await this.reportRescued(wallet, txHashes, plans);

    return { status: "SENT", txHashes, tokens, rescued };
  }

  /**
   * Reads back what the vault actually moved, per token.
   *
   * The vault reports the NET amount it delivered to the safe; the fee is the
   * difference between that and the gross it pulled. The gross is reconstructed
   * from the vault's own `feeBps` — the same rate the contract applied — so the
   * fee shown is the one that was charged, not a number derived from whatever
   * the attacker had tried to send.
   */
  private async reportRescued(
    wallet: WalletConfig,
    txHashes: string[],
    plans: Array<{ tokens: string[]; chargeFee: boolean }>,
  ): Promise<RescuedToken[]> {
    const chargeFeeByToken = new Map<string, boolean>();
    for (const plan of plans) {
      for (const token of plan.tokens) chargeFeeByToken.set(token.toLowerCase(), plan.chargeFee);
    }

    const config = new Map<string, { symbol: string; decimals: number }>();
    for (const token of [...wallet.coreTokens, ...wallet.watchTokens]) {
      config.set(token.address.toLowerCase(), { symbol: token.symbol, decimals: token.decimals });
    }

    let feeBps = 0;
    try {
      feeBps = Number(await readUint(this.provider, wallet.vaultAddress, SELECTORS.feeBps));
    } catch (error) {
      // Without the rate the fee cannot be reconstructed; amounts still can.
      this.log(`[${wallet.label}] could not read feeBps: ${(error as Error).message}`);
    }

    const out: RescuedToken[] = [];

    for (const txHash of txHashes) {
      const events = await readRescuedEvents(this.provider, txHash, wallet.vaultAddress);

      for (const event of events) {
        const meta = config.get(event.token);
        const charged = chargeFeeByToken.get(event.token) === true && feeBps > 0 && feeBps < 10_000;

        // net = gross * (1 - feeBps/10000), so gross = net / (1 - feeBps/10000).
        const gross = charged ? (event.amount * 10_000n) / BigInt(10_000 - feeBps) : event.amount;
        const fee = gross - event.amount;

        out.push({
          token: event.token,
          symbol: meta?.symbol ?? event.token,
          decimals: meta?.decimals ?? 18,
          amount: event.amount.toString(),
          fee: fee.toString(),
          destination: event.destination,
        });
      }
    }

    if (out.length === 0) {
      this.log(`[${wallet.label}] rescue mined but no Rescued events were read back.`);
    }

    return out;
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
   * Submits a rescue transaction via a Flashbots private relay when one is
   * configured. Flashbots bundles are sent directly to block builders,
   * bypassing the public mempool. This prevents front-running (sandwich
   * attacks) on rescue transactions, which is critical because an attacker can
   * front-run a rescue to front-run the safe address change.
   *
   * Opt-in: when no relay is configured this returns null and the caller falls
   * back to the public mempool.
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
              tx: `0x${tx.data.slice(2)}`,
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
   * Broadcasts a rescue transaction: through the Flashbots private relay when
   * one is configured, otherwise through the signer to the public mempool.
   *
   * The transaction is prepared by `rescue()`, which already applies the nonce,
   * the gas limit and the fee buffer, and is forwarded as-is.
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
      this.log("[rescue] Flashbots submission failed, falling back to the public mempool");
    }

    const sent = await this.signer.sendTransaction(tx);
    return { hash: sent.hash };
  }

  /**
   * Confirms each broadcast rescue and reports what actually happened on chain.
   *
   * A broadcast is not a rescue: the transaction can revert, or the vault can
   * emit `RescueFailed` for a token whose `transferFrom` failed while the batch
   * still "succeeds". Without reading the receipt the bot would log "rescue
   * sent" while the operator's funds never moved. Confirmation is best-effort —
   * an unavailable receipt is reported as unconfirmed, never as a failure.
   */
  private async confirmRescues(wallet: WalletConfig, reason: RescueReason, txHashes: string[]): Promise<void> {
    for (const hash of txHashes) {
      const receipt = await waitForReceipt(this.provider, hash, {
        ...(this.options.confirmTimeoutMs !== undefined ? { timeoutMs: this.options.confirmTimeoutMs } : {}),
        ...(this.options.confirmPollMs !== undefined ? { pollMs: this.options.confirmPollMs } : {}),
      });

      if (receipt === null) {
        this.log(`[${wallet.label}] rescue ${hash} broadcast but not confirmed (receipt unavailable).`);
        continue;
      }

      if (receipt.status !== 1) {
        const message = `Rescue transaction ${hash} for ${wallet.label} REVERTED on-chain — funds were not moved.`;
        this.log(message);
        await this.alert(
          buildAlert({
            wallet: wallet.label,
            kind: "rescue",
            rule: reason.rule,
            severity: "CRITICAL",
            reason: message,
            action: "RESCUE",
            txHash: hash,
            now: this.now(),
          }),
        );
        continue;
      }

      const { rescued, failed, skipped } = this.parseRescueLogs(wallet, receipt);
      this.log(
        `[${wallet.label}] rescue ${hash} confirmed in block ${receipt.blockNumber}: ` +
          `${rescued.length} token(s) moved, ${failed.length} failed, ${skipped.length} skipped.`,
      );

      if (failed.length > 0) {
        const message =
          `Rescue ${hash} confirmed but the vault could not move ${failed.length} token(s): ` +
          `${failed.join(", ")}. It emitted RescueFailed — check the token contract and allowance.`;
        this.log(message);
        await this.alert(
          buildAlert({
            wallet: wallet.label,
            kind: "rescue",
            rule: reason.rule,
            severity: "CRITICAL",
            reason: message,
            action: "RESCUE",
            txHash: hash,
            now: this.now(),
          }),
        );
      }
    }
  }

  /** Decodes the vault's Rescued / RescueFailed / RescueSkipped events from a receipt. */
  private parseRescueLogs(
    wallet: WalletConfig,
    receipt: TransactionReceipt,
  ): { rescued: string[]; failed: string[]; skipped: string[] } {
    const rescued: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== wallet.vaultAddress.toLowerCase()) continue;
      let parsed;
      try {
        parsed = VAULT_EVENTS.parseLog({ topics: log.topics, data: log.data });
      } catch {
        continue;
      }
      if (parsed === null) continue;
      const token = String(parsed.args[0]);
      if (parsed.name === "Rescued") rescued.push(token);
      else if (parsed.name === "RescueFailed") failed.push(token);
      else if (parsed.name === "RescueSkipped") skipped.push(token);
    }

    return { rescued, failed, skipped };
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

    if (this.options.maxGasPriceGwei && this.options.maxGasPriceGwei > 0n) {
      const fees = await this.signer.getFeeData();
      const currentGwei = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
      const limitWei = this.options.maxGasPriceGwei * 1_000_000_000n;
      if (currentGwei > limitWei) {
        const message =
          `Refusing to rescue ${wallet.label}: gas price ${currentGwei} wei exceeds limit ${limitWei} wei. Rule ${reason.rule} fired.`;
        this.log(message);
        return { status: "SKIPPED", reason: message };
      }
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

  /**
   * Bumps whichever fee fields the node supports; EIP-1559 and legacy differ.
   *
   * For mempool-triggered rescues the attacker's priority fee is passed in: the
   * rescue must outbid the attack so it is ordered BEFORE it in the same block.
   * The priority fee is set to 2× the attacker's (or the normal fee, whichever
   * is higher), and maxFeePerGas is raised to cover it. Without this, a quiet
   * chain's default fee (e.g. 41 wei on Sepolia) loses the race against an
   * attacker bidding 1.5 gwei, and the rescue lands too late to move the funds.
   */
  private applyFeeBuffer(
    fees: {
      gasPrice: bigint | null;
      maxFeePerGas: bigint | null;
      maxPriorityFeePerGas: bigint | null;
    },
    attackerPriorityFee?: bigint,
  ): { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } {
    const bump = (value: bigint): bigint => (value * BigInt(100 + FEE_BUFFER_PCT)) / 100n;

    if (fees.maxFeePerGas !== null) {
      const baseMaxFee = bump(fees.maxFeePerGas);
      const basePriority = fees.maxPriorityFeePerGas !== null ? bump(fees.maxPriorityFeePerGas) : null;

      // The rescue's priority fee must exceed the attacker's so the block builder
      // places it first. 2× the attacker's bid guarantees that even with a small
      // builder margin. Fall back to the normal priority fee when there is no
      // attacker bid (post-block rescues).
      const competitive =
        attackerPriorityFee !== undefined && attackerPriorityFee > 0n ? attackerPriorityFee * 2n : null;

      const priority =
        competitive !== null && (basePriority === null || competitive > basePriority) ? competitive : basePriority;

      // maxFeePerGas must be >= maxPriorityFeePerGas or the tx is invalid.
      const maxFee = priority !== null && priority > baseMaxFee ? priority : baseMaxFee;

      return {
        maxFeePerGas: maxFee,
        ...(priority !== null ? { maxPriorityFeePerGas: priority } : {}),
      };
    }
    if (fees.gasPrice !== null) {
      const base = bump(fees.gasPrice);
      if (attackerPriorityFee !== undefined && attackerPriorityFee > base) {
        return { gasPrice: attackerPriorityFee * 2n };
      }
      return { gasPrice: base };
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
    `the vault or move the funds manually. This is a known Rescue Vault limitation — see README.`
  );
}

function window(map: Map<string, RateWindow>, wallet: WalletConfig): RateWindow {
  const existing = map.get(wallet.safeAddress);
  if (existing !== undefined) return existing;
  const created: RateWindow = { lastCoreAt: null, lastWatchAt: null, watchTimestamps: [] };
  map.set(wallet.safeAddress, created);
  return created;
}