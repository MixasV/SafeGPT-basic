import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain } from "wagmi";

import { DEMO_MODE } from "../../config/demo";
import { SUPPORTED_CHAINS } from "../../config/contracts";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";
import { useOnboardingStore } from "../../state/onboarding";

interface StepConnectWalletProps {
  onContinue: () => void;
  connected: boolean;
}

/**
 * Step 1 — Connect the wallet that will become cold storage.
 * The drainer check (step 2) is mandatory in both modes and cannot be skipped.
 */
export function StepConnectWallet({ onContinue, connected }: StepConnectWalletProps) {
  const chainId = useOnboardingStore((state) => state.chainId);
  const setChainId = useOnboardingStore((state) => state.setChainId);
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  const accountConnected = DEMO_MODE || (isConnected && connected);
  const wrongNetwork = !DEMO_MODE && isConnected && chain?.id !== chainId;

  return (
    <StepFrame
      title="Connect the wallet you want to protect"
      subtitle="SafeGPT watches the mempool for transactions leaving this wallet and front-runs them."
      footer={
        <>
          <SecondaryButton onClick={onContinue} disabled>
            Back
          </SecondaryButton>
          <PrimaryButton onClick={onContinue} disabled={!accountConnected}>
            I understand, connect wallet
          </PrimaryButton>
        </>
      }
    >
      <WarningBanner tone="danger" title="⚠️ This wallet will become COLD STORAGE ONLY.">
        <p>
          Do NOT use it for trading, swaps, or dApp interaction after protection is enabled. Use a separate wallet
          for active trading, and keep the safe address on a different device with a different seed phrase.
        </p>
      </WarningBanner>

      {DEMO_MODE ? (
        <div className="rounded-lg border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">
          Demo mode is active. The wizard runs with a placeholder wallet and never broadcasts a transaction.
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <ConnectButton />
          {isConnected && <span className="text-sm text-text-secondary">{chain?.name}</span>}
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-text-primary">Network</p>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_CHAINS.map((candidate) => {
            const active = candidate.id === chainId;
            return (
              <button
                key={candidate.id}
                type="button"
                disabled={DEMO_MODE || isPending}
                onClick={() => {
                  setChainId(candidate.id);
                  if (!DEMO_MODE && isConnected && chain?.id !== candidate.id) {
                    void switchChain({ chainId: candidate.id });
                  }
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                  active
                    ? "border-accent bg-accent/10 text-text-primary"
                    : "border-border bg-bg-tertiary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                {candidate.name}
              </button>
            );
          })}
        </div>
      </div>

      {wrongNetwork && (
        <WarningBanner tone="warning">
          Your wallet is connected to {chain?.name}, but the wizard is set up for a different network. Switch the
          network above before continuing.
        </WarningBanner>
      )}
    </StepFrame>
  );
}