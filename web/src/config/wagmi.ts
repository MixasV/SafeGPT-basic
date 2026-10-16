import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";

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
 * Sprint 1 ships Ethereum mainnet + Base. Additional networks are added per
 * release as the self-hosted bot gains multi-chain support.
 */
export const wagmiConfig = createConfig({
  chains: [mainnet, base],
  connectors,
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
  },
  ssr: false,
});