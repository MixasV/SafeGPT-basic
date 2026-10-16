import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";

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

/** RPC endpoints per chain, overridable through VITE_RPC_URL_<chainId>. */
function transportFor(chainId: number) {
  const override = import.meta.env[`VITE_RPC_URL_${chainId}`] as string | undefined;
  return http(override);
}

export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors,
  transports: Object.fromEntries(
    SUPPORTED_CHAINS.map((chain) => [chain.id, transportFor(chain.id)]),
  ) as Record<number, ReturnType<typeof http>>,
  ssr: false,
});