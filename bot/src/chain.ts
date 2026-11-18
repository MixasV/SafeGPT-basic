import { id } from "ethers";

/**
 * Minimal read-only JSON-RPC surface.
 *
 * Deliberately narrower than an ethers `Provider`: the bot only ever needs
 * `eth_call`, `eth_getTransactionCount` and friends, and depending on the
 * narrow shape means every consumer is trivially testable with a plain object
 * instead of a forked chain.
 */
export interface RpcReader {
  send(method: string, params: unknown[]): Promise<unknown>;
}

export const SELECTORS = {
  owner: id("owner()").slice(0, 10),
  executor: id("executor()").slice(0, 10),
  safeAddress: id("safeAddress()").slice(0, 10),
  balanceOf: id("balanceOf(address)").slice(0, 10),
  allowance: id("allowance(address,address)").slice(0, 10),
  /** The vault's service fee in basis points. */
  feeBps: id("feeBps()").slice(0, 10),
} as const;

/**
 * Reads an address-returning view function over raw `eth_call`.
 *
 * An address is ABI-encoded as a left-padded 32-byte word, so the value is the
 * last 20 bytes of the return data.
 */
export async function readAddress(provider: RpcReader, contract: string, selector: string): Promise<string> {
  return `0x${(await readWord(provider, contract, selector)).slice(-40)}`;
}

/** Reads a single `uint256`-shaped view function. */
export async function readUint(provider: RpcReader, contract: string, selector: string): Promise<bigint> {
  const hex = await readWord(provider, contract, selector);
  return BigInt(`0x${hex}`);
}

async function readWord(provider: RpcReader, contract: string, selector: string): Promise<string> {
  // `eth_call` takes exactly two parameters: the call object and the block tag.
  // A third one is rejected outright by strict nodes — anvil answers "Invalid
  // request", and ethers surfaces that as the misleading "missing revert data".
  const result = (await provider.send("eth_call", [{ to: contract, data: selector }, "latest"])) as string;
  const hex = result.startsWith("0x") ? result.slice(2) : result;
  if (hex.length === 0) {
    // An empty return means the call produced no data at all: there is no
    // contract at that address, or it reverted without a reason. The most
    // common cause by far is a placeholder address left in the config.
    throw new Error(
      `eth_call to ${contract} returned no data. There is no contract at that address ` +
        `(or it reverted). Check that the address is a deployed contract and not a placeholder.`,
    );
  }
  if (hex.length < 64) {
    throw new Error(`eth_call to ${contract} returned ${result}, which is too short to decode.`);
  }
  return hex;
}

/** `eth_getTransactionCount` with an explicit block tag. */
export async function getTransactionCount(
  provider: RpcReader,
  address: string,
  block: "latest" | "pending",
): Promise<number> {
  const raw = (await provider.send("eth_getTransactionCount", [address, block])) as string;
  return Number.parseInt(raw, 16);
}

/** Decodes `eth_chainId`. */
export async function getChainId(provider: RpcReader): Promise<number> {
  const raw = (await provider.send("eth_chainId", [])) as string;
  return Number.parseInt(raw, 16);
}

/** The subset of a transaction receipt the executor reads to confirm a rescue. */
export interface TransactionReceipt {
  /** 1 = success, 0 = reverted. */
  status: number;
  blockNumber: number;
  logs: Array<{ address: string; topics: string[]; data: string }>;
}

/**
 * Polls `eth_getTransactionReceipt` until the transaction is mined or the
 * deadline passes.
 *
 * Confirmation is best-effort: the rescue has already been broadcast by the
 * time this runs, so a node that cannot serve receipts (or a timeout) returns
 * null rather than throwing. The caller reports "broadcast, not yet confirmed"
 * instead of treating an unconfirmed rescue as a failed one.
 */
export async function waitForReceipt(
  provider: RpcReader,
  hash: string,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TransactionReceipt | null> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 3_000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    let raw: unknown;
    try {
      raw = await provider.send("eth_getTransactionReceipt", [hash]);
    } catch {
      return null;
    }
    if (raw !== null && raw !== undefined) {
      const receipt = raw as { status?: string | number; blockNumber?: string | number; logs?: unknown[] };
      return {
        status: Number(receipt.status ?? 0),
        blockNumber: Number(receipt.blockNumber ?? 0),
        logs: (receipt.logs ?? []).map((entry) => {
          const log = entry as { address?: string; topics?: string[]; data?: string };
          return { address: log.address ?? "", topics: log.topics ?? [], data: log.data ?? "0x" };
        }),
      };
    }
    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
  }
}

/** Reads the token state the scanner needs. */
export interface TokenReader {
  balanceOf(owner: string, token: string): Promise<bigint>;
  allowance(owner: string, spender: string, token: string): Promise<bigint>;
}

/** Binds a `TokenReader` to a live RPC endpoint. */
export function createTokenReader(provider: RpcReader): TokenReader {
  return {
    async balanceOf(owner: string, token: string): Promise<bigint> {
      return readUint(provider, token, `${SELECTORS.balanceOf}${padAddress(owner)}`);
    },
    async allowance(owner: string, spender: string, token: string): Promise<bigint> {
      return readUint(provider, token, `${SELECTORS.allowance}${padAddress(owner)}${padAddress(spender)}`);
    },
  };
}

/** Creates an RpcReader that tries multiple HTTP endpoints in order. */
export function createMultiRpcReader(urls: string[]): RpcReader {
  const endpoints = urls.filter((u) => u.trim() !== "");
  if (endpoints.length === 0) throw new Error("No RPC endpoints provided");
  return {
    async send(method: string, params: unknown[]): Promise<unknown> {
      let lastError: unknown;
      for (const url of endpoints) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as { result?: unknown; error?: { message?: string } };
          if (data.error) throw new Error(data.error.message ?? "RPC error");
          return data.result;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("All RPC endpoints failed");
    },
  };
}
function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}