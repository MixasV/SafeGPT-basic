import type { Address } from "viem";
import { arbitrum, base, mainnet, sepolia } from "wagmi/chains";

import { WETH_ADDRESSES } from "./contracts";

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

/**
 * Level-3 token source (UPD-4): the bundled list scanned when no indexer API is
 * configured. It covers the wrapped native coin and the highest-liquidity
 * assets per supported network. Pro mode can always add addresses manually.
 */
export const DEFAULT_TOKENS: Record<number, readonly TokenInfo[]> = {
  [mainnet.id]: [
    { address: WETH_ADDRESSES[mainnet.id]!, symbol: "WETH", decimals: 18 },
    { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
    { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
    { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", decimals: 8 },
    { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18 },
    { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", decimals: 18 },
    { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", decimals: 18 },
    { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", symbol: "AAVE", decimals: 18 },
    { address: "0xC18360217D8F7Ab5e7c516566761ea12Ce7F9D72", symbol: "ENS", decimals: 18 },
    { address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", symbol: "LDO", decimals: 18 },
  ],
  [base.id]: [
    { address: WETH_ADDRESSES[base.id]!, symbol: "WETH", decimals: 18 },
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH (native wrap)", decimals: 18 },
    { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI", decimals: 18 },
    { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", symbol: "USDbC", decimals: 6 },
    { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", decimals: 18 },
  ],
  [arbitrum.id]: [
    { address: WETH_ADDRESSES[arbitrum.id]!, symbol: "WETH", decimals: 18 },
    { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 },
    { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6 },
    { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", symbol: "DAI", decimals: 18 },
    { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", symbol: "ARB", decimals: 18 },
    { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", symbol: "WBTC", decimals: 8 },
  ],
  [sepolia.id]: [
    { address: WETH_ADDRESSES[sepolia.id]!, symbol: "WETH", decimals: 18 },
    { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", symbol: "USDC", decimals: 6 },
  ],
};

/** Mock holdings used by Demo Mode so the whole wizard runs without a wallet. */
export const DEMO_TOKENS: readonly TokenInfo[] = [
  { address: "0x00000000000000000000000000000000000000A1", symbol: "USDC", decimals: 6 },
  { address: "0x00000000000000000000000000000000000000A2", symbol: "WETH", decimals: 18 },
  { address: "0x00000000000000000000000000000000000000A3", symbol: "UNI", decimals: 18 },
  { address: "0x00000000000000000000000000000000000000A4", symbol: "LINK", decimals: 18 },
];

export const DEMO_BALANCES: Record<string, string> = {
  "0x00000000000000000000000000000000000000a1": "5000000000", // 5,000 USDC
  "0x00000000000000000000000000000000000000a2": "2500000000000000000", // 2.5 WETH
  "0x00000000000000000000000000000000000000a3": "150000000000000000000", // 150 UNI
  "0x00000000000000000000000000000000000000a4": "30000000000000000000", // 30 LINK
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