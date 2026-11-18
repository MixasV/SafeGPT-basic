import { createPublicClient, formatEther, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, avalanche, avalancheFuji, base, mainnet, sepolia } from "viem/chains";

/**
 * Integration helpers shared by the onboarding "Setup Keys" step and the
 * Settings page: Alchemy connectivity, executor key → address derivation,
 * on-chain balance reads and Telegram test messages.
 *
 * All functions are browser-safe (viem + fetch) and never throw to the caller —
 * they resolve to a boolean / string result the UI renders as a status.
 */

/** Alchemy network slug per chain id. */
const ALCHEMY_NETWORKS: Record<number, string> = {
  [mainnet.id]: "eth-mainnet",
  [sepolia.id]: "eth-sepolia",
  [base.id]: "base-mainnet",
  [arbitrum.id]: "arb-mainnet",
  [avalanche.id]: "avax-mainnet",
  [avalancheFuji.id]: "avax-fuji",
};

/** Public RPC endpoints that permit browser CORS, used when no Alchemy key is set. */
const DEFAULT_RPC_URLS: Record<number, string> = {
  [mainnet.id]: "https://ethereum.publicnode.com",
  [sepolia.id]: "https://ethereum-sepolia.publicnode.com",
  [base.id]: "https://mainnet.base.org",
  [arbitrum.id]: "https://arb1.arbitrum.io/rpc",
  [avalanche.id]: "https://avalanche-c-chain.publicnode.com",
  [avalancheFuji.id]: "https://avalanche-fuji-c-chain.publicnode.com",
};

/** Viem chain object per chain id, for balance reads on the correct network. */
const CHAIN_BY_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [avalanche.id]: avalanche,
  [avalancheFuji.id]: avalancheFuji,
};

/** Returns the viem Chain object for a chainId, or undefined. */
export function chainById(chainId: number): Chain | undefined {
  return CHAIN_BY_ID[chainId];
}

/** Alchemy JSON-RPC URL for a chain, or undefined when the chain is unsupported. */
export function alchemyRpcUrl(chainId: number, apiKey: string): string | undefined {
  const network = ALCHEMY_NETWORKS[chainId];
  const key = apiKey.trim();
  if (!network || key === "") return undefined;
  return `https://${network}.g.alchemy.com/v2/${key}`;
}

/** Alchemy WebSocket URL for a chain (for the bot's rpcWss), or undefined. */
export function alchemyWssUrl(chainId: number, apiKey: string): string | undefined {
  const network = ALCHEMY_NETWORKS[chainId];
  const key = apiKey.trim();
  if (!network || key === "") return undefined;
  return `wss://${network}.g.alchemy.com/v2/${key}`;
}

/** Public WSS endpoints that work without a key, used when no Alchemy key is set. */
const DEFAULT_WSS_URLS: Record<number, string> = {
  [mainnet.id]: "wss://ethereum.publicnode.com",
  [sepolia.id]: "wss://ethereum-sepolia.publicnode.com",
  [base.id]: "wss://mainnet.base.org",
  [arbitrum.id]: "wss://arb1.arbitrum.io/feed",
  [avalanche.id]: "wss://avalanche-c-chain.publicnode.com",
  [avalancheFuji.id]: "wss://avalanche-fuji-c-chain.publicnode.com",
};

/** The WSS URL the bot should use: Alchemy when a key is present, else a public endpoint. */
export function resolveWssUrl(chainId: number, alchemyKey: string): string | undefined {
  return alchemyWssUrl(chainId, alchemyKey) ?? DEFAULT_WSS_URLS[chainId];
}

/** The RPC URL the bot/UI should use: Alchemy when a key is present, else a public endpoint. */
export function resolveRpcUrl(chainId: number, alchemyKey: string): string | undefined {
  const override = import.meta.env[`VITE_RPC_URL_${chainId}`] as string | undefined;
  if (override) return override;
  return alchemyRpcUrl(chainId, alchemyKey) ?? DEFAULT_RPC_URLS[chainId];
}

/** Calls eth_blockNumber against an Alchemy endpoint to verify the key works. */
export async function testAlchemyKey(apiKey: string, chainId: number): Promise<{ ok: boolean; block?: string; error?: string }> {
  const url = alchemyRpcUrl(chainId, apiKey);
  if (!url) return { ok: false, error: "Unsupported network for Alchemy." };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const json = (await response.json()) as { result?: string; error?: { message?: string } };
    if (json.error) return { ok: false, error: json.error.message ?? "RPC error" };
    if (typeof json.result !== "string") return { ok: false, error: "Empty response" };
    return { ok: true, block: json.result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Derives the executor address from a hex private key. Returns null when invalid. */
export function addressFromPrivateKey(key: string): Address | null {
  const trimmed = key.trim();
  if (trimmed === "") return null;
  try {
    const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    const account = privateKeyToAccount(withPrefix as `0x${string}`);
    return account.address;
  } catch {
    return null;
  }
}

/**
 * Reads the native ETH balance of an address on the given chain.
 *
 * Uses the correct viem chain object (not a hardcoded mainnet) so the balance
 * is read on the network the user is actually configuring — Sepolia, Base,
 * Arbitrum, etc. The rpcUrl determines the endpoint; the chain object ensures
 * chain-specific behaviour is correct.
 */
export async function getEthBalance(address: Address, rpcUrl: string, chainId?: number): Promise<bigint | null> {
  const chain = (chainId !== undefined ? CHAIN_BY_ID[chainId] : undefined) ?? mainnet;
  try {
    const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 8_000 }) });
    return await client.getBalance({ address });
  } catch {
    return null;
  }
}

/** Formats a wei balance as a human-readable ETH string. */
export function formatEth(wei: bigint): string {
  return formatEther(wei);
}

/** Sends a Telegram test message. Returns ok + error text. */
export async function sendTelegramTest(botToken: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
  const token = botToken.trim();
  const chat = chatId.trim();
  if (token === "" || chat === "") return { ok: false, error: "Bot token and chat ID are required." };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: "✅ SafeGPT test message — your Telegram alerts are configured." }),
    });
    const json = (await response.json()) as { ok?: boolean; description?: string };
    if (!response.ok || json.ok === false) return { ok: false, error: json.description ?? `HTTP ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}