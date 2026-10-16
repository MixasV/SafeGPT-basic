import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";

import { App } from "./App";
import { wagmiConfig } from "./config/wagmi";

const queryClient = new QueryClient();

const container = document.getElementById("root");
if (!container) {
  throw new Error('SafeGPT: mount point #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);