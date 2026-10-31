import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrum, base, mainnet, sepolia } from "wagmi/chains";

import { SUPPORTED_CHAINS } from "./contracts";

/**
 * WalletConnect requires a project id from https://cloud.walletconnect.com.
 * Without it we only offer the browser-injected wallets, so the app stays
 * usable with zero configuration (MetaMask, Rabby, Brave, ...).
 */
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

const projectId = walletConnectProjectId ?? "safegpt-open-source";

const walletList = walletConnectProjectId
  ? [metaMaskWallet, rabbyWallet, walletConnectWallet, injectedWallet]
  : [metaMaskWallet, rabbyWallet, injectedWallet];

const connectors = connectorsForWallets([{ groupName: "Supported wallets", wallets: walletList }], {
  appName: "SafeGPT",
  projectId,
});

/**
 * Public RPC endpoints that permit browser CORS. These are free, require no
 * API key, and work from a browser page — unlike most free endpoints which
 * block cross-origin requests. When VITE_RPC_URL_<chainId> is set it takes
 * precedence, so a self-hosted instance can point at its own node.
 */
const DEFAULT_RPC_URLS: Record<number, string> = {
  [mainnet.id]: "https://ethereum.publicnode.com",
  [sepolia.id]: "https://ethereum-sepolia.publicnode.com",
  [base.id]: "https://mainnet.base.org",
  [arbitrum.id]: "https://arb1.arbitrum.io/rpc",
};

/** RPC endpoints per chain, overridable through VITE_RPC_URL_<chainId>. */
function rpcUrl(chainId: number): string {
  const override = import.meta.env[`VITE_RPC_URL_${chainId}`] as string | undefined;
  if (override) return override;
  const fallback = DEFAULT_RPC_URLS[chainId];
  if (!fallback) {
    throw new Error(`No RPC endpoint configured for chain ${chainId}. Set VITE_RPC_URL_${chainId}.`);
  }
  return fallback;
}

/** RPC endpoints per chain, overridable through VITE_RPC_URL_<chainId>. */
function transportFor(chainId: number) {
  return http(rpcUrl(chainId), { timeout: 8_000 });
}

export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors,
  transports: Object.fromEntries(
    SUPPORTED_CHAINS.map((chain) => [chain.id, transportFor(chain.id)]),
  ) as Record<number, ReturnType<typeof http>>,
  ssr: false,
});