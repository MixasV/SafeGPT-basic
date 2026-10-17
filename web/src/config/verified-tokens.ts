import type { Address } from "viem";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";

/**
 * Statically curated verified-token lists (specification section 6).
 *
 * WHY THIS IS A STATIC FILE AND NOT A RUNTIME API CALL
 * ----------------------------------------------------
 * A remote token list would be both a point of failure (the whole onboarding
 * breaks when the API is down or rate-limited) and an attack surface: anyone who
 * can answer the request controls which addresses the UI treats as verified.
 * This list ships with the app and is updated deliberately with each release.
 *
 * WHY KEYS ARE CHAIN IDs
 * ----------------------
 * The same token has DIFFERENT addresses on every network. Looking up USDC on
 * Arbitrum while the user is on Ethereum must not silently resolve — a manual
 * entry from the wrong network is caught by the missing-code check and reported
 * as "no contract on this network" rather than being accepted.
 */

export interface VerifiedTokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

export type VerifiedTokenList = Record<Address, VerifiedTokenInfo>;

function list(entries: Array<[Address, VerifiedTokenInfo]>): VerifiedTokenList {
  return Object.fromEntries(entries) as VerifiedTokenList;
}

export const VERIFIED_TOKENS: Record<number, VerifiedTokenList> = {
  // ---------------------------------------------------------------- Ethereum
  [mainnet.id]: list([
    ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
    ["0xdAC17F958D2ee523a2206206994597C13D831ec7", { symbol: "USDT", name: "Tether USD", decimals: 6 }],
    ["0x6B175474E89094C44Da98b954EedeAC495271d0F", { symbol: "DAI", name: "Dai", decimals: 18 }],
    ["0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", { symbol: "WBTC", name: "Wrapped BTC", decimals: 8 }],
    ["0x514910771AF9Ca656af840dff83E8264EcF986CA", { symbol: "LINK", name: "Chainlink", decimals: 18 }],
    ["0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", { symbol: "UNI", name: "Uniswap", decimals: 18 }],
    ["0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", { symbol: "AAVE", name: "Aave", decimals: 18 }],
    ["0xC18360217D8F7Ab5e7c516566761ea12Ce7F9D72", { symbol: "ENS", name: "Ethereum Name Service", decimals: 18 }],
    ["0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", { symbol: "LDO", name: "Lido DAO", decimals: 18 }],
  ]),

  // --------------------------------------------------------------------- Base
  [base.id]: list([
    ["0x4200000000000000000000000000000000000006", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
    ["0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", { symbol: "DAI", name: "Dai", decimals: 18 }],
    ["0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", { symbol: "USDbC", name: "USD Base Coin", decimals: 6 }],
    ["0x940181a94A35A4569E4529A3CDfB74e38FD98631", { symbol: "AERO", name: "Aerodrome", decimals: 18 }],
  ]),

  // ----------------------------------------------------------------- Arbitrum
  [arbitrum.id]: list([
    ["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
    ["0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", { symbol: "USDT", name: "Tether USD", decimals: 6 }],
    ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", { symbol: "DAI", name: "Dai", decimals: 18 }],
    ["0x912CE59144191C1204E64559FE8253a0e49E6548", { symbol: "ARB", name: "Arbitrum", decimals: 18 }],
    ["0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", { symbol: "WBTC", name: "Wrapped BTC", decimals: 8 }],
  ]),

  // ------------------------------------------------------------------ Sepolia
  [sepolia.id]: list([
    ["0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
  ]),
};

/** True when the address is in the curated list for THAT network. */
export function isVerifiedToken(address: string, chainId: number): boolean {
  return VERIFIED_TOKENS[chainId]?.[address as Address] !== undefined;
}

/** Metadata for a curated token, or undefined when it is not on the list. */
export function getVerifiedToken(address: string, chainId: number): VerifiedTokenInfo | undefined {
  return VERIFIED_TOKENS[chainId]?.[address as Address];
}

/**
 * Networks where a given address is a known token on a DIFFERENT chain.
 * Used to tell the user "this is the Arbitrum USDC, not the Ethereum one"
 * instead of silently failing on a missing contract.
 */
export function findTokenOnOtherChains(address: string, currentChainId: number): Array<{ chainId: number; symbol: string }> {
  const matches: Array<{ chainId: number; symbol: string }> = [];
  for (const [chainId, tokens] of Object.entries(VERIFIED_TOKENS)) {
    const numeric = Number(chainId);
    if (numeric === currentChainId) continue;
    const info = tokens[address as Address];
    if (info) matches.push({ chainId: numeric, symbol: info.symbol });
  }
  return matches;
}