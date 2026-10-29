/**
 * Curated verified-token list, used by the bot to resolve raw thresholds and to
 * label watch-set tokens in alerts.
 *
 * WHY THIS IS A COPY AND NOT AN IMPORT
 * ------------------------------------
 * `web/src/config/verified-tokens.ts` holds the same data for the UI. The bot
 * deliberately does NOT import from it: the two are independently deployable
 * packages, and coupling a standalone Node process to a browser bundle means a
 * refactor in the web app can break the bot at runtime.
 *
 * When this list changes, update the web copy as well. A mismatch is not a
 * security hole — the bot only uses it for labelling and for optional
 * thresholds — but the UI and the bot should agree.
 */
export interface VerifiedTokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

export type VerifiedTokenList = Record<string, VerifiedTokenInfo>;

function list(entries: Array<[string, VerifiedTokenInfo]>): VerifiedTokenList {
  return Object.fromEntries(entries);
}

export const VERIFIED_TOKENS: Record<number, VerifiedTokenList> = {
  // Ethereum Mainnet
  1: list([
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

  // Base
  8453: list([
    ["0x4200000000000000000000000000000000000006", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
    ["0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", { symbol: "DAI", name: "Dai", decimals: 18 }],
    ["0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", { symbol: "USDbC", name: "USD Base Coin", decimals: 6 }],
    ["0x940181a94A35A4569E4529A3CDfB74e38FD98631", { symbol: "AERO", name: "Aerodrome", decimals: 18 }],
  ]),

  // Arbitrum One
  42161: list([
    ["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
    ["0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", { symbol: "USDT", name: "Tether USD", decimals: 6 }],
    ["0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", { symbol: "DAI", name: "Dai", decimals: 18 }],
    ["0x912CE59144191C1204E64559FE8253a0e49E6548", { symbol: "ARB", name: "Arbitrum", decimals: 18 }],
    ["0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", { symbol: "WBTC", name: "Wrapped BTC", decimals: 8 }],
  ]),

  // Sepolia
  11155111: list([
    ["0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", { symbol: "WETH", name: "Wrapped Ether", decimals: 18 }],
    ["0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", { symbol: "USDC", name: "USD Coin", decimals: 6 }],
  ]),
};

/** Case-insensitive lookup across the whole list for a given network. */
export function getVerifiedToken(address: string, chainId: number): VerifiedTokenInfo | undefined {
  const tokens = VERIFIED_TOKENS[chainId];
  if (!tokens) return undefined;
  const needle = address.toLowerCase();
  for (const [candidate, info] of Object.entries(tokens)) {
    if (candidate.toLowerCase() === needle) return info;
  }
  return undefined;
}