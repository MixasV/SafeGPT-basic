import { useCallback, useState } from "react";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
  type Chain,
  type PublicClient,
} from "viem";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";

import { DEMO_MODE } from "../config/demo";
import { erc20Abi, rescueVaultAbi } from "../config/contracts";
import type { TokenInfo } from "../config/tokens";
import { useOnboardingStore } from "../state/onboarding";

export type ScanSource = "alchemy" | "explorer" | "bundled" | "demo" | "failed";

export interface ScannedToken extends TokenInfo {
  balance: bigint;
}

export interface ScanResult {
  source: ScanSource;
  tokens: ScannedToken[];
}

const ALCHEMY_NETWORKS: Record<number, string> = {
  1: "eth-mainnet",
  11155111: "eth-sepolia",
  8453: "base-mainnet",
  42161: "arb-mainnet",
};

const EXPLORER_APIS: Record<number, string> = {
  1: "https://api.etherscan.io/api",
  11155111: "https://api-sepolia.etherscan.io/api",
  8453: "https://api.basescan.org/api",
  42161: "https://api.arbiscan.io/api",
};

const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const EXPLORER_API_KEY = import.meta.env.VITE_EXPLORER_API_KEY as string | undefined;

const CHAIN_BY_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
};

/** Standalone client so the hook works outside the wagmi React context. */
function publicClientFor(chainId: number): PublicClient {
  const chain = CHAIN_BY_ID[chainId] ?? mainnet;
  return createPublicClient({ chain, transport: http() });
}

/** Level 1 — indexer API (Alchemy). Fast and complete when a key is configured. */
async function scanViaIndexer(owner: Address, chainId: number): Promise<ScanResult | null> {
  const network = ALCHEMY_NETWORKS[chainId];
  if (!network || !ALCHEMY_API_KEY) return null;

  const balancesResponse = await fetch(
    `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}/getTokenBalances`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([owner, "erc20"]),
    },
  );
  if (!balancesResponse.ok) return null;

  const balances = (await balancesResponse.json()) as {
    tokenBalances?: { contractAddress: string; tokenBalance: string | null }[];
  };
  const addresses = (balances.tokenBalances ?? [])
    .filter((entry) => entry.tokenBalance !== null && BigInt(entry.tokenBalance) > 0n)
    .map((entry) => entry.contractAddress);

  if (addresses.length === 0) return { source: "alchemy", tokens: [] };

  const metadataResponse = await fetch(
    `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}/getTokenMetadata`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(addresses),
    },
  );
  if (!metadataResponse.ok) return null;

  const metadata = (await metadataResponse.json()) as Record<
    string,
    { name?: string; symbol?: string; decimals?: number }
  >;
  const rawBalances = new Map(
    (balances.tokenBalances ?? []).map((entry) => [entry.contractAddress.toLowerCase(), entry.tokenBalance ?? "0"]),
  );

  const tokens: ScannedToken[] = [];
  for (const address of addresses) {
    const info = metadata[address.toLowerCase()] ?? {};
    tokens.push({
      address: address as Address,
      symbol: info.symbol ?? "UNKNOWN",
      decimals: info.decimals ?? 18,
      balance: BigInt(rawBalances.get(address.toLowerCase()) ?? "0"),
    });
  }
  return { source: "alchemy", tokens };
}

/** Level 2 — block explorer transfer history, unique contracts + on-chain balances. */
async function scanViaPublicAPI(owner: Address, chainId: number, client: PublicClient): Promise<ScanResult | null> {
  const endpoint = EXPLORER_APIS[chainId];
  if (!endpoint || !EXPLORER_API_KEY) return null;

  const url = new URL(endpoint);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "tokentx");
  url.searchParams.set("address", owner);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("apikey", EXPLORER_API_KEY);

  const response = await fetch(url);
  if (!response.ok) return null;

  const payload = (await response.json()) as { result?: { contractAddress?: string }[] };
  const seen = new Map<string, TokenInfo>();
  for (const entry of payload.result ?? []) {
    const contract = entry.contractAddress;
    if (!contract || seen.has(contract.toLowerCase())) continue;
    const info = await readTokenMetadata(client, contract as Address);
    seen.set(contract.toLowerCase(), info);
  }

  const tokens: ScannedToken[] = [];
  for (const [key, info] of seen) {
    const balance = await client.readContract({
      address: info.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
    if (balance > 0n) tokens.push({ ...info, balance });
    void key;
  }
  return { source: "explorer", tokens };
}

/** Level 3 — bundled list, filtered by on-chain balances. */
async function scanFromDefaultList(
  owner: Address,
  chainId: number,
  client: PublicClient,
): Promise<ScanResult> {
  const { DEFAULT_TOKENS } = await import("../config/tokens");
  const candidates = DEFAULT_TOKENS[chainId] ?? [];
  const tokens: ScannedToken[] = [];

  for (const info of candidates) {
    try {
      const balance = await client.readContract({
        address: info.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      });
      if (balance > 0n) tokens.push({ ...info, balance });
    } catch {
      // A token that cannot be read is simply not shown; it may still be protectable manually.
    }
  }
  return { source: "bundled", tokens };
}

async function readTokenMetadata(client: PublicClient, address: Address): Promise<TokenInfo> {
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => undefined),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(() => undefined),
  ]);
  return {
    address,
    symbol: typeof symbol === "string" && symbol.length > 0 ? symbol : "UNKNOWN",
    decimals: typeof decimals === "number" ? decimals : 18,
  };
}

/**
 * ERC-20 balance scan with the three-level fallback chain from UPD-4.
 *
 * Demo Mode short-circuits to the bundled mock holdings so the wizard can be
 * recorded end to end without a wallet or any API keys.
 */
export function useTokenScan() {
  const setAssets = useOnboardingStore((state) => state.setAssets);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<ScanSource>("bundled");
  const [error, setError] = useState("");

  const scan = useCallback(
    async (owner: Address | undefined, chainId: number): Promise<ScanResult> => {
      if (DEMO_MODE) {
        const { DEMO_BALANCES, DEMO_TOKENS } = await import("../config/tokens");
        const tokens: ScannedToken[] = DEMO_TOKENS.map((info) => ({
          ...info,
          balance: BigInt(DEMO_BALANCES[info.address.toLowerCase()] ?? "0"),
        })).filter((token) => token.balance > 0n);
        setSource("demo");
        return { source: "demo", tokens };
      }

      if (!owner) {
        setError("Connect a wallet before scanning.");
        return { source: "failed", tokens: [] };
      }

      setLoading(true);
      setError("");

      try {
        const indexed = await scanViaIndexer(owner, chainId).catch(() => null);
        if (indexed) {
          setSource("alchemy");
          return indexed;
        }

        const client = publicClientFor(chainId);
        const explored = await scanViaPublicAPI(owner, chainId, client).catch(() => null);
        if (explored) {
          setSource("explorer");
          return explored;
        }

        const bundled = await scanFromDefaultList(owner, chainId, client);
        setSource("bundled");
        return bundled;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Token scan failed.";
        setError(message);
        setSource("failed");
        return { source: "failed", tokens: [] };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const applyToStore = useCallback(
    (result: ScanResult) => {
      setAssets(
        result.tokens.map((token) => ({
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          balance: token.balance.toString(),
          selected: true,
          verified: source !== "bundled" || !isUnverifiedAddress(token.address),
        })),
      );
    },
    [setAssets, source],
  );

  return { scan, applyToStore, loading, source, error, setError };
}

/**
 * Addresses below `0x1000` are the Demo Mode placeholders and never a real
 * deployment, so they are treated as unverified watch-set entries.
 */
function isUnverifiedAddress(address: string): boolean {
  return /^0x0{36}[0-9a-f]{4}$/i.test(address) || Number.parseInt(address.slice(2), 16) < 0x10000;
}

/** Validates a manually entered token address per the UPD-2 checklist. */
export async function validateManualToken(
  address: string,
  chainId: number,
): Promise<{ ok: boolean; token?: TokenInfo; warnings: string[] }> {
  const warnings: string[] = [];

  if (!isAddress(address)) {
    return { ok: false, warnings: ["Not a valid EVM address."] };
  }

  const client = publicClientFor(chainId);
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    return { ok: false, warnings: ["No contract found at this address."] };
  }

  const info = await readTokenMetadata(client, address);
  if (info.symbol === "UNKNOWN") {
    warnings.push("The token does not expose symbol() or decimals() — it may be non-standard.");
  }
  warnings.push("Unverified contracts are rescued without a fee and routed to the quarantine address.");

  return { ok: true, token: info, warnings };
}

/** Calldata for a single ERC-20 approve, shown in Pro mode. */
export function buildApproveCalldata(spender: Address, amount: bigint): string {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

/** Reads the current vault allowance for a token. */
export async function readAllowance(
  client: PublicClient,
  owner: Address,
  token: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}

/** Confirms the vault is reachable and returns its owner — used before approving. */
export async function readVaultOwner(client: PublicClient, vault: Address): Promise<Address> {
  const owner = await client.readContract({
    address: vault,
    abi: rescueVaultAbi,
    functionName: "owner",
  });
  return owner as Address;
}