import type { RpcReader } from "./chain.js";
import type { MonitorProvider, RawTransaction } from "./monitor.js";

/**
 * WebSocket provider that subscribes to Alchemy's `alchemy_pendingTransactions`
 * with an address filter, instead of the standard `newPendingTransactions`
 * feed.
 *
 * WHY THIS EXISTS
 * ---------------
 * A plain `newPendingTransactions` subscription pushes the hash of **every**
 * pending transaction on the chain. The monitor then has to call
 * `eth_getTransactionByHash` for each one (20 CU) just to discover whether it
 * involves a protected wallet — 99.9 % of them do not. On Sepolia that is
 * ~9 000 wasted calls per hour.
 *
 * `alchemy_pendingTransactions` runs the address filter **on Alchemy's side**
 * and pushes only transactions where `from` matches a protected wallet. With
 * `hashesOnly: false` it pushes the **full transaction object** (the same shape
 * `eth_getTransactionByHash` returns), so the monitor never makes a per-hash
 * RPC call at all.
 *
 * COST
 * ----
 * - `eth_subscribe` = 10 CU, one-time per subscription.
 * - Each pushed transaction = 0 CU (WebSocket push, not an HTTP request).
 * - `eth_getTransactionByHash` calls eliminated entirely.
 *
 * The provider also subscribes to `newHeads` for block events (the scanner
 * needs them), sharing the same WebSocket connection.
 *
 * RECONNECTION
 * ------------
 * The monitor creates a fresh provider per attempt and destroys it on failure,
 * so this class does not implement its own reconnect loop. On `error` or
 * `close` it invokes the error listener, which makes the monitor's `session`
 * reject and start a new attempt.
 */
export class AlchemyMonitorProvider implements MonitorProvider {
  private ws: WebSocket | null = null;
  private pendingListener: ((tx: RawTransaction) => void) | null = null;
  private blockListener: ((blockNumber: bigint) => void) | null = null;
  private errorListener: ((error: unknown) => void) | null = null;
  private destroyed = false;

  constructor(
    private readonly wsUrl: string,
    /** HTTP provider for `send` (RpcReader) and `getTransaction` (backward compat). */
    private readonly http: RpcReader,
    /** Only pending transactions FROM this address are pushed. */
    private readonly fromAddress: string,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (error) {
      this.errorListener?.(error);
      return;
    }

    this.ws.addEventListener("open", () => {
      this.subscribe("alchemy_pendingTransactions", {
        fromAddress: [this.fromAddress],
        hashesOnly: false,
      });
      this.subscribe("newHeads");
    });

    this.ws.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });

    this.ws.addEventListener("error", (event) => {
      // The WebSocket error event does not always carry an Error object.
      const error = (event as unknown as { error?: unknown }).error ?? new Error("WebSocket error");
      this.errorListener?.(error);
    });

    this.ws.addEventListener("close", () => {
      if (!this.destroyed) {
        this.errorListener?.(new Error("WebSocket closed"));
      }
    });
  }

  private subscribe(method: string, params?: unknown): void {
    this.ws?.send(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_subscribe", params: [method, ...(params === undefined ? [] : [params])] }));
  }

  private onMessage(data: unknown): void {
    let msg: {
      method?: string;
      params?: { result?: unknown };
      id?: number;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(String(data)) as typeof msg;
    } catch {
      return;
    }

    // A JSON-RPC error on our `eth_subscribe` (id 0) means Alchemy rejected the
    // subscription (wrong params, unsupported method, plan limit). Surface it
    // immediately instead of waiting out the liveness heartbeat.
    if (msg.id === 0 && msg.error) {
      this.errorListener?.(new Error(`eth_subscribe rejected: ${msg.error.message ?? "unknown error"}`));
      return;
    }

    // Only subscription notifications carry `method: "eth_subscription"`.
    // The id-0 success response (subscription-id confirmation) is a no-op —
    // notifications are self-describing.
    if (msg.method !== "eth_subscription") return;
    const result = msg.params?.result;
    if (result === null || result === undefined || typeof result !== "object") return;

    const r = result as Record<string, unknown>;

    // A pending transaction has `from`, `hash` and `value`.
    // A block header (newHeads) has `number` and `parentHash`, not `from`.
    if ("from" in r && "hash" in r) {
      this.pendingListener?.(this.parseTransaction(r));
      return;
    }
    if ("number" in r && "parentHash" in r) {
      const number = BigInt(r.number as string);
      this.blockListener?.(number);
    }
  }

  /** Converts a raw JSON-RPC transaction object into the bot's `RawTransaction`. */
  private parseTransaction(raw: Record<string, unknown>): RawTransaction {
    return {
      hash: raw.hash as string,
      from: raw.from as string,
      to: raw.to == null ? null : (raw.to as string),
      data: (raw.input ?? raw.data ?? "0x") as string,
      value: BigInt((raw.value as string) ?? "0x0"),
      type: raw.type !== undefined ? parseInt(raw.type as string, 16) : null,
      blockNumber: null,
      maxFeePerGas: raw.maxFeePerGas !== undefined ? BigInt(raw.maxFeePerGas as string) : null,
      maxPriorityFeePerGas:
        raw.maxPriorityFeePerGas !== undefined ? BigInt(raw.maxPriorityFeePerGas as string) : null,
      gasPrice: raw.gasPrice !== undefined ? BigInt(raw.gasPrice as string) : null,
    };
  }

  on(event: "pending", listener: (tx: RawTransaction) => void): this;
  on(event: "block", listener: (blockNumber: bigint) => void): this;
  on(event: "error", listener: (error: unknown) => void): this;
  on(
    event: "pending" | "block" | "error",
    listener: ((tx: RawTransaction) => void) | ((blockNumber: bigint) => void) | ((error: unknown) => void),
  ): this {
    if (event === "pending") this.pendingListener = listener as (tx: RawTransaction) => void;
    else if (event === "block") this.blockListener = listener as (blockNumber: bigint) => void;
    else this.errorListener = listener as (error: unknown) => void;
    return this;
  }

  /** RpcReader: delegate to the HTTP provider (eth_call, eth_getTransactionCount, …). */
  async send(method: string, params: unknown[]): Promise<unknown> {
    return this.http.send(method, params);
  }

  /**
   * Backward-compatible single-transaction fetch. The monitor no longer calls
   * this for pending txs (they arrive as full objects), but the scanner and
   * tests may still need it.
   */
  async getTransaction(hash: string): Promise<RawTransaction | null> {
    const result = (await this.http.send("eth_getTransactionByHash", [hash])) as Record<string, unknown> | null;
    if (result === null) return null;
    return this.parseTransaction(result);
  }

  destroy(): void {
    this.destroyed = true;
    this.ws?.close();
    this.ws = null;
    this.pendingListener = null;
    this.blockListener = null;
    this.errorListener = null;
  }
}