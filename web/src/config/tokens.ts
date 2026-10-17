import type { Address } from "viem";
import { arbitrum, base, mainnet, sepolia } from "wagmi/chains";

import { WETH_ADDRESSES } from "./contracts";
import { VERIFIED_TOKENS } from "./verified-tokens";

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

/**
 * Level-3 token source (UPD-4): the addresses scanned when no indexer API is
 * configured. Derived from the curated verified list in `verified-tokens.ts`
 * rather than duplicated here, so there is a single place to update.
 */
export const DEFAULT_TOKENS: Record<number, readonly TokenInfo[]> = Object.fromEntries(
  Object.entries(VERIFIED_TOKENS).map(([chainId, tokens]) => [
    Number(chainId),
    Object.entries(tokens).map(([address, info]) => ({ address: address as Address, ...info })),
  ]),
);

/**
 * Mock holdings used by Demo Mode so the whole wizard runs without a wallet.
 *
 * Three tokens carry a REAL curated address (USDC, WETH, DAI on Ethereum) so the
 * verified/Core classification is exercised for real, and one token uses a
 * placeholder address so the unverified/Watch path is shown too.
 */
export const DEMO_TOKENS: readonly (TokenInfo & { verified: boolean })[] = [
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, verified: true },
  { address: WETH_ADDRESSES[mainnet.id]!, symbol: "WETH", decimals: 18, verified: true },
  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18, verified: true },
  { address: "0x0000000000000000000000000000000000000BAD", symbol: "MYSTERY", decimals: 18, verified: false },
];

export const DEMO_BALANCES: Record<string, string> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "5000000000", // 5,000 USDC
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "2500000000000000000", // 2.5 WETH
  "0x6b175474e89094c44da98b954eedeac495271d0f": "1200000000000000000000", // 1,200 DAI
  "0x0000000000000000000000000000000000000bad": "42000000000000000000000", // 42,000 MYSTERY
};

/** Placeholder addresses handed out by Demo Mode, so the UI stays clickable. */
export const DEMO_ADDRESSES = {
  wallet: "0x00000000000000000000000000000000000000D1",
  safe: "0x00000000000000000000000000000000000000D2",
  factory: "0x00000000000000000000000000000000000000F0",
  vault: "0x00000000000000000000000000000000000000F1",
  tx: "0x00000000000000000000000000000000000000TX",
} as const;

/** Explorer base URLs for the "View on explorer" links. */
export const EXPLORER_URLS: Record<number, string> = {
  [mainnet.id]: "https://etherscan.io",
  [sepolia.id]: "https://sepolia.etherscan.io",
  [base.id]: "https://basescan.org",
  [arbitrum.id]: "https://arbiscan.io",
};

export function explorerTxUrl(chainId: number, hash: string): string {
  const base = EXPLORER_URLS[chainId] ?? EXPLORER_URLS[mainnet.id]!;
  return `${base}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const base = EXPLORER_URLS[chainId] ?? EXPLORER_URLS[mainnet.id]!;
  return `${base}/address/${address}`;
}

/** Human-readable network name for user-facing copy. */
export function chainName(chainId: number): string {
  const names: Record<number, string> = {
    [mainnet.id]: "Ethereum Mainnet",
    [sepolia.id]: "Sepolia",
    [base.id]: "Base",
    [arbitrum.id]: "Arbitrum One",
  };
  return names[chainId] ?? `chain ${chainId}`;
}