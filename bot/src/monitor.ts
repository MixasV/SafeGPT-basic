import { buildAlert, type AlertSink } from "./alerts.js";
import type { RpcReader } from "./chain.js";
import type { RescueOutcome } from "./executor.js";
import { evaluate } from "./rules.js";
import type { Scanner } from "./scanner.js";
import {
  createRuleState,
  type Alert,
  type ObservedTransaction,
  type RescueReason,
  type RuleState,
  type Verdict,
  type WalletConfig,
} from "./types.js";

/**
 * The mempool and block loop.
 *
 * Two independent watchdogs:
 *   - `pending` fires the rules (R1–R7) before a transaction is mined, which is
 *     the only window in which a rescue can beat a drainer.
 *   - `block` runs the scanner (R8–R9), which catches whatever the mempool feed
 *     missed — a dropped subscription, an RPC hiccup — by comparing confirmed
 *     state instead.
 *
 * Deliberately sequential per event: a rescue must be broadcast before the next
 * transaction is considered, because acting on a stale view of a drained
 * wallet is how gas gets wasted.
 */

/**
 * A transaction as ethers v6 returns it. Structural rather than
 * `TransactionResponse` so tests can supply a plain object.
 */
export interface RawTransaction {
  hash: string;
  from: string;
  to: string | null;
  data: string;
  value: bigint;
  type?: number | null | undefined;
  // `| undefined` keeps callers that forward an optional field from widening
  // this type under exactOptionalPropertyTypes.
  authorizationList?: readonly unknown[] | null | undefined;
  blockNumber?: number | null | undefined;
  /** EIP-1559 fee fields, present on type-2 transactions. */
  maxFeePerGas?: bigint | null | undefined;
  maxPriorityFeePerGas?: bigint | null | undefined;
  /** Legacy gas price, present on type-0 transactions. */
  gasPrice?: bigint | null | undefined;
}

export const DEFAULT_RECONNECT_DELAY_MS = 3_000;
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/**
 * How long a connection may stay silent before it is treated as dead. Chains
 * emit a block every ~12s, so even a testnet with a quiet mempool produces
 * `block` events regularly; a connection that truly stops delivering them is
 * gone. Five minutes tolerates brief RPC hiccups without declaring the socket
 * dead prematurely.
 */
export const HEARTBEAT_MS = 300_000;

/** Anything that can carry out a rescue. `Executor` satisfies this structurally. */
export interface Rescuer {
  rescue(wallet: WalletConfig, reason: RescueReason, tokens?: string[]): Promise<RescueOutcome>;
}

/**
 * The provider the monitor talks to.
 *
 * The `pending` event carries the **full transaction object**, not just a hash:
 * Alchemy's `alchemy_pendingTransactions` subscription (with `hashesOnly: false`)
 * pushes the same shape `eth_getTransactionByHash` would return, so the monitor
 * never needs to make a per-hash RPC call. A plain `newPendingTransactions`
 * feed (ethers `WebSocketProvider`) pushes only hashes and requires a follow-up
 * `getTransaction` per hash — that is 20 CU × every pending tx on the chain,
 * which is what burned through the Alchemy quota.
 *
 * For backward compatibility, if `getTransaction` is called with a hash, the
 * provider resolves it — the monitor tries the full-object path first and
 * falls back to `getTransaction` only for providers that push hashes.
 */
export interface MonitorProvider extends RpcReader {
  on(event: "pending", listener: (tx: RawTransaction) => void): unknown;
  on(event: "block", listener: (blockNumber: bigint) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  /** Kept for backward compatibility; the monitor calls this only for hash-only feeds. */
  getTransaction(hash: string): Promise<RawTransaction | null>;
  destroy(): void;
}

export interface MonitorOptions {
  /** A fresh provider per attempt — a dead WebSocket cannot be revived in place. */
  createProvider: () => MonitorProvider;
  wallets: WalletConfig[];
  executor: Rescuer;
  scanner: Scanner;
  alerter: AlertSink;
  log?: (message: string) => void;
  now?: () => number;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class ReconnectExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    cause: unknown,
  ) {
    super(`WebSocket connection failed ${attempts} time(s) in a row: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "ReconnectExhaustedError";
  }
}

/**
 * Converts an ethers transaction into the shape the rules engine consumes.
 *
 * Returns null for contract creations: `to` is null and the calldata is
 * constructor bytecode, not a call, so none of the rules can say anything
 * meaningful about it.
 */
export function normalizeTransaction(raw: RawTransaction): ObservedTransaction | null {
  if (raw.to === null || raw.to === undefined) return null;

  return {
    hash: raw.hash,
    from: raw.from,
    to: raw.to,
    data: raw.data ?? "0x",
    value: raw.value ?? 0n,
    type: raw.type ?? null,
    authorizationList: raw.authorizationList ?? undefined,
    blockNumber: raw.blockNumber ?? null,
  };
}

export class Monitor {
  /** One rule state per wallet: R5 counts transfers, R7 tracks a grace window. */
  private readonly states = new Map<string, RuleState>();
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectAttempts: number;

  constructor(private readonly options: MonitorOptions) {
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  /**
   * Runs until `signal` aborts, reconnecting as needed.
   *
   * @throws {ReconnectExhaustedError} after `maxReconnectAttempts` consecutive
   *         failures. A rescue bot that cannot see the mempool is worse than one
   *         that says so loudly, so this propagates and takes the process down
   *         rather than looping forever.
   */
  async run(signal: AbortSignal): Promise<void> {
    let attempts = 0;

    while (!signal.aborted) {
      const provider = this.options.createProvider();
      try {
        await this.session(provider, signal);
        attempts = 0;
      } catch (error) {
        if (signal.aborted) break;

        attempts += 1;
        this.log(`Connection lost: ${(error as Error).message}`);

        if (attempts >= this.maxReconnectAttempts) {
          await this.alertSystem(`WebSocket reconnect failed ${attempts} times. The bot is no longer watching.`);
          throw new ReconnectExhaustedError(attempts, error);
        }

        this.log(`Reconnecting in ${this.reconnectDelayMs}ms (attempt ${attempts}/${this.maxReconnectAttempts})…`);
        await this.sleep(this.reconnectDelayMs);
      } finally {
        provider.destroy();
      }
    }
  }

  /** One connected lifetime: subscribe, then wait for a transport failure or an abort. */
  private session(provider: MonitorProvider, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let heartbeat: NodeJS.Timeout | undefined;

      const resetHeartbeat = (): void => {
        if (heartbeat !== undefined) clearTimeout(heartbeat);
        // The socket can die without an `error` event on some transports, so a
        // liveness probe backstops the provider's own error reporting. Reset on
        // every event: a quiet mempool (testnet) must not be mistaken for a dead
        // socket, but true silence past the timeout still triggers reconnect.
        heartbeat = setTimeout(() => {
          cleanup();
          reject(new Error("WebSocket produced no events and the connection is presumed dead."));
        }, HEARTBEAT_MS);
        heartbeat.unref();
      };

      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
        if (heartbeat !== undefined) clearTimeout(heartbeat);
      };

      const onAbort = (): void => {
        cleanup();
        resolve();
      };

      resetHeartbeat();

      provider.on("pending", (tx) => {
        resetHeartbeat();
        void this.handlePending(provider, tx);
      });
      provider.on("block", (blockNumber) => {
        resetHeartbeat();
        void this.handleBlock(blockNumber);
      });
      provider.on("error", (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      signal.addEventListener("abort", onAbort, { once: true });
      this.log("Watching the mempool and new blocks.");
    });
  }

  /**
   * Runs the rules engine against a pending transaction.
   *
   * The full transaction is pushed by the provider (Alchemy's
   * `alchemy_pendingTransactions` with `hashesOnly: false`), so there is no
   * `eth_getTransactionByHash` call here. For providers that push only hashes
   * (standard `newPendingTransactions`), the caller must resolve the full
   * object before passing it here — the monitor handles both shapes: if the
   * listener receives a string, it is treated as a hash and resolved via
   * `getTransaction`.
   */
  private async handlePending(provider: MonitorProvider, rawOrHash: RawTransaction | string): Promise<void> {
    let raw: RawTransaction | null;

    if (typeof rawOrHash === "string") {
      // Hash-only feed (standard ethers WebSocketProvider).
      // The provider wrapper is expected to resolve the hash before calling us;
      // if it arrives here as a string, fetch it.
      try {
        raw = await provider.getTransaction(rawOrHash);
      } catch (error) {
        this.log(`Could not fetch pending ${rawOrHash}: ${(error as Error).message}`);
        return;
      }
      if (raw === null) return;
    } else {
      raw = rawOrHash;
    }

    const tx = normalizeTransaction(raw);
    if (tx === null) return;

    for (const wallet of this.options.wallets) {
      const verdict = evaluate(tx, wallet, this.stateFor(wallet), this.now());
      if (verdict.action === "IGNORE") continue;

      if (verdict.action !== "RESCUE") {
        await this.safeAlert(
          buildAlert({
            wallet: wallet.label,
            kind: "alert",
            rule: verdict.rule,
            severity: verdict.severity,
            reason: verdict.reason,
            action: verdict.action,
            txHash: tx.hash,
            now: this.now(),
          }),
        );
        continue;
      }

      // The attacker's priority fee (or legacy gas price) is forwarded so the
      // executor can bid higher and land its rescue BEFORE the attack in the
      // same block. Without this the rescue uses the network's default fee,
      // which on a quiet chain is far below the attacker's bid.
      const attackerPriorityFee = raw.maxPriorityFeePerGas ?? raw.gasPrice ?? undefined;
      const outcome = await this.dispatch(wallet, {
        rule: verdict.rule,
        reason: verdict.reason,
        severity: verdict.severity,
        txHash: tx.hash,
        attackerPriorityFee,
      });

      // Sent AFTER the rescue, not before: the alert has to name the rescue
      // transaction and the amounts that actually moved. Alerting first would
      // put the ATTACK hash on the event and leave the rescue unrecorded.
      await this.safeAlert(this.rescueAlert(wallet, verdict, tx.hash, outcome));
    }
  }

  /**
   * Builds the alert for a rescue attempt.
   *
   * On success `txHash` is the RESCUE transaction and `rescue` carries the
   * per-token amounts the vault reported. On failure there is no rescue
   * transaction at all, so the alert carries no hash — a link to the attack
   * would read as if the rescue had happened.
   */
  private rescueAlert(
    wallet: WalletConfig,
    verdict: Verdict,
    attackTxHash: string | undefined,
    outcome: RescueOutcome,
  ): Alert {
    const base = {
      wallet: wallet.label,
      rule: verdict.rule,
      severity: verdict.severity,
      reason: verdict.reason,
      // Only ever called for a RESCUE verdict; `IGNORE` never reaches an alert.
      action: "RESCUE" as const,
      now: this.now(),
    };

    if (outcome.status === "SENT" && outcome.txHashes.length > 0) {
      const txHash = outcome.txHashes[0]!;
      return buildAlert({
        ...base,
        kind: "rescue",
        txHash,
        rescue: {
          txHash,
          ...(attackTxHash === undefined ? {} : { attackerTxHash: attackTxHash }),
          rescued: outcome.rescued,
        },
      });
    }

    const reason = outcome.status === "SKIPPED" || outcome.status === "VARIANT_B_UNSUPPORTED" ? outcome.reason : undefined;

    return buildAlert({
      ...base,
      kind: "alert",
      ...(reason === undefined ? {} : { error: reason }),
    });
  }

  /** Runs the post-block scanner across every wallet. */
  private async handleBlock(blockNumber: bigint): Promise<void> {
    for (const wallet of this.options.wallets) {
      try {
        for (const finding of await this.options.scanner.scan(wallet, blockNumber)) {
          const verdict: Verdict = {
            action: finding.action,
            rule: finding.rule,
            reason: finding.reason,
            severity: finding.severity,
          };

          if (verdict.action === "RESCUE" && finding.tokens.length > 0) {
            const outcome = await this.dispatch(
              wallet,
              { rule: finding.rule, reason: finding.reason, severity: finding.severity },
              finding.tokens,
            );
            await this.safeAlert(this.rescueAlert(wallet, verdict, undefined, outcome));
            continue;
          }

          await this.safeAlert(
            buildAlert({
              wallet: wallet.label,
              kind: "alert",
              rule: finding.rule,
              severity: finding.severity,
              reason: finding.reason,
              action: finding.action,
              now: this.now(),
            }),
          );
        }
      } catch (error) {
        // One wallet failing to read must not stop the others being checked.
        this.log(`Scanner failed for ${wallet.label} at block ${blockNumber}: ${(error as Error).message}`);
      }
    }
  }

  /** Runs the executor and reports whatever happened, success or failure. */
  private async dispatch(wallet: WalletConfig, reason: RescueReason, tokens?: string[]): Promise<RescueOutcome> {
    try {
      const outcome = await this.options.executor.rescue(wallet, reason, tokens);
      this.report(wallet, outcome);
      // Tell the scanner which tokens this bot moved, so the allowance they
      // consumed is not read back as a revocation on the next block.
      if (outcome.status === "SENT") {
        this.options.scanner.noteSelfRescue(wallet, outcome.tokens);
      }
      return outcome;
    } catch (error) {
      const message = (error as Error).message;
      this.log(`Rescue failed for ${wallet.label}: ${message}`);
      return { status: "SKIPPED", reason: message };
    }
  }

  private report(wallet: WalletConfig, outcome: RescueOutcome): void {
    switch (outcome.status) {
      case "SENT":
        this.log(`[${wallet.label}] rescue broadcast: ${outcome.txHashes.join(", ")}`);
        break;
      case "DRY_RUN":
        this.log(`[${wallet.label}] dry run, nothing sent: ${outcome.planned.join(" | ")}`);
        break;
      case "VARIANT_B_UNSUPPORTED":
      case "SKIPPED":
        this.log(`[${wallet.label}] rescue not sent — ${outcome.reason}`);
        break;
    }
  }

  /** An alerting failure must never abort the watch loop. */
  private async safeAlert(alert: Parameters<AlertSink["deliver"]>[0]): Promise<void> {
    try {
      await this.options.alerter.deliver(alert);
    } catch (error) {
      this.log(`Alert delivery failed: ${(error as Error).message}`);
    }
  }

  private async alertSystem(reason: string): Promise<void> {
    await this.safeAlert(
      buildAlert({
        wallet: "system",
        kind: "alert",
        rule: "NONE",
        severity: "CRITICAL",
        reason,
        action: "ALERT",
        now: this.now(),
      }),
    );
  }

  private stateFor(wallet: WalletConfig): RuleState {
    const existing = this.states.get(wallet.safeAddress);
    if (existing !== undefined) return existing;
    const created = createRuleState();
    this.states.set(wallet.safeAddress, created);
    return created;
  }
}