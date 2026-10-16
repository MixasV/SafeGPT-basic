import { useAccount, usePublicClient } from "wagmi";
import { formatEther, type Address } from "viem";

import { DEMO_MODE } from "../../config/demo";
import { DEMO_ADDRESSES } from "../../config/tokens";
import { useDrainerCheck } from "../../hooks/useDrainerCheck";
import { useOnboardingStore } from "../../state/onboarding";
import { StatusBadge } from "../common/StatusBadge";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepDrainerCheckProps {
  onContinue: () => void;
  onBack: () => void;
}

/**
 * Step 2 — Drainer check. Mandatory in both Beginner and Pro mode.
 * Records the native balance, waits for a ~$1 ETH deposit, waits two blocks and
 * verifies the deposit survived.
 */
export function StepDrainerCheck({ onContinue, onBack }: StepDrainerCheckProps) {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const account = (DEMO_MODE ? DEMO_ADDRESSES.wallet : address) as Address | undefined;
  const status = useOnboardingStore((state) => state.drainerStatus);
  const detail = useOnboardingStore((state) => state.drainerDetail);

  const check = useDrainerCheck(publicClient, account);

  const checking = check.phase === "recording" || check.phase === "checking";

  return (
    <StepFrame
      title="Safety check"
      subtitle="Detects an active ETH sweeper before you move any real funds into this wallet."
      error={check.error}
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          {status === "awaiting-deposit" && (
            <PrimaryButton onClick={() => void check.runCheck()} disabled={checking}>
              {checking ? "Checking…" : "I've sent ETH — Check Now"}
            </PrimaryButton>
          )}
          {status === "clean" && <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>}
          {status === "compromised" && (
            <SecondaryButton onClick={() => check.reset()}>Run the check again</SecondaryButton>
          )}
          {status === "idle" && (
            <PrimaryButton onClick={() => void check.recordBalance()} disabled={!account}>
              {DEMO_MODE ? "Start the check" : "Record balance"}
            </PrimaryButton>
          )}
        </>
      }
    >
      {status === "awaiting-deposit" && (
        <div className="rounded-lg border border-border bg-bg-tertiary p-4">
          <p className="text-sm text-text-primary">
            Send exactly <span className="font-semibold">$1 worth of ETH</span> to your wallet:
          </p>
          <p className="mt-3 break-all rounded-md bg-bg-primary px-3 py-2 font-mono text-sm text-accent">
            {account}
          </p>
          <p className="mt-3 text-xs text-text-secondary">
            Current balance: {account ? formatEther(check.balanceBefore) : "—"} ETH
          </p>
          <p className="mt-2 text-xs text-text-secondary">{detail}</p>
        </div>
      )}

      {check.phase === "checking" && (
        <div className="rounded-lg border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">
          Waiting for two blocks to confirm the deposit…
        </div>
      )}

      {status === "clean" && (
        <div className="flex items-start gap-3 rounded-lg border border-accent-green/40 bg-accent-green/10 p-4">
          <StatusBadge tone="active" label="CLEAN" />
          <div>
            <p className="text-sm font-semibold text-accent-green">Your wallet is clean. Proceeding…</p>
            <p className="mt-1 text-sm text-text-secondary">{detail}</p>
          </div>
        </div>
      )}

      {status === "compromised" && (
        <WarningBanner tone="danger" title="❌ DANGER: Your wallet appears compromised.">
          <p>
            A drainer is actively sweeping funds. DO NOT deposit more funds. Create a new wallet immediately.
          </p>
        </WarningBanner>
      )}

      {DEMO_MODE && status !== "clean" && status !== "compromised" && (
        <div className="rounded-lg border border-border bg-bg-tertiary p-4">
          <p className="mb-2 text-sm text-text-secondary">
            Demo mode: choose the outcome to demonstrate. Both states are recorded for the grant video.
          </p>
          <div className="flex gap-2">
            <SecondaryButton onClick={() => check.simulate("clean")}>Simulate Clean</SecondaryButton>
            <SecondaryButton onClick={() => check.simulate("compromised")}>Simulate Compromised</SecondaryButton>
          </div>
        </div>
      )}

      <WarningBanner tone="warning">
        This check detects active ETH sweepers. It does NOT detect token-specific drainers, dormant compromises, or
        malicious approvals. Always use a fresh wallet for best security.
      </WarningBanner>
    </StepFrame>
  );
}