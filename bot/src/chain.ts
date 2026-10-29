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
  guardian: id("guardian()").slice(0, 10),
  balanceOf: id("balanceOf(address)").slice(0, 10),
  allowance: id("allowance(address,address)").slice(0, 10),
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

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}