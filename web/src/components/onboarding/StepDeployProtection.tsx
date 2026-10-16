import type { Address } from "viem";

import { DEMO_MODE } from "../../config/demo";
import { useMode } from "../../hooks/useMode";
import { useOnboardingStore } from "../../state/onboarding";
import { explorerAddressUrl, explorerTxUrl } from "../../config/tokens";
import { StatusBadge } from "../common/StatusBadge";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepDeployProtectionProps {
  onContinue: () => void;
  onBack: () => void;
  account: Address;
  chainId: number;
  phase: "idle" | "deploying-factory" | "creating-vault" | "confirming" | "done" | "error";
  error: string;
  factoryTxHash: `0x${string}` | null;
  vaultTxHash: `0x${string}` | null;
  predictedVaultAddress: Address | null;
  deploy: () => void;
  params: { executor: Address; feeReceiver: Address; feeBps: number };
  onParamsChange: (patch: Partial<{ executor: Address; feeReceiver: Address; feeBps: number }>) => void;
}

const PHASE_LABELS: Record<StepDeployProtectionProps["phase"], string> = {
  idle: "Ready",
  "deploying-factory": "Deploying the RescueVault factory…",
  "creating-vault": "Creating your protection contract…",
  confirming: "Waiting for confirmation…",
  done: "Protection contract deployed",
  error: "Deployment failed",
};

/**
 * Step 4.5 — Deploy Protection (added by UPD-3).
 *
 * Beginner gets a single button. Pro additionally sees the factory address, the
 * CREATE2 salt, the constructor arguments and the predicted vault address.
 */
export function StepDeployProtection({
  onContinue,
  onBack,
  account,
  chainId,
  phase,
  error,
  factoryTxHash,
  vaultTxHash,
  predictedVaultAddress,
  deploy,
  params,
  onParamsChange,
}: StepDeployProtectionProps) {
  const mode = useMode();
  const isPro = mode === "pro";
  const vaultAddress = useOnboardingStore((state) => state.vaultAddress);
  const safeAddress = useOnboardingStore((state) => state.safeAddress);
  const factoryAddress = useOnboardingStore((state) => state.factoryAddress);

  const busy = phase === "deploying-factory" || phase === "creating-vault" || phase === "confirming";
  const deployed = Boolean(vaultAddress) || phase === "done";

  return (
    <StepFrame
      title="Deploy your protection contract"
      subtitle="One-time setup. You pay a small gas fee; on Ethereum roughly $5–15, on L2 under $0.50."
      error={error}
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={busy}>
            Back
          </SecondaryButton>
          {deployed ? (
            <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
          ) : (
            <PrimaryButton onClick={deploy} disabled={busy || !safeAddress}>
              {DEMO_MODE ? "🚀 Deploy Protection" : "🚀 Deploy Protection"}
            </PrimaryButton>
          )}
        </>
      }
    >
      <div className="rounded-lg border border-border bg-bg-tertiary p-4 text-sm">
        <p className="font-medium text-text-primary">Your protection contract</p>
        <dl className="mt-2 grid gap-1 text-text-secondary">
          <div className="flex justify-between gap-4">
            <dt>Owner</dt>
            <dd className="font-mono text-text-primary">{account}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Safe address</dt>
            <dd className="font-mono text-text-primary">{safeAddress}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Fee</dt>
            <dd className="text-text-primary">{(params.feeBps / 100).toFixed(2)}%</dd>
          </div>
        </dl>
      </div>

      {(busy || phase === "done") && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-tertiary p-4 text-sm">
          <StatusBadge
            tone={phase === "done" ? "active" : "neutral"}
            label={PHASE_LABELS[phase] === "Protection contract deployed" ? "DEPLOYED" : "PENDING"}
          />
          <span className="text-text-secondary">{PHASE_LABELS[phase]}</span>
        </div>
      )}

      {factoryTxHash && (
        <p className="text-xs text-text-secondary">
          Factory TX:{" "}
          <a className="font-mono text-accent" href={explorerTxUrl(chainId, factoryTxHash)} target="_blank" rel="noreferrer noopener">
            {factoryTxHash.slice(0, 18)}… [View on explorer ↗]
          </a>
        </p>
      )}

      {vaultTxHash && (
        <p className="text-xs text-text-secondary">
          Vault TX:{" "}
          <a className="font-mono text-accent" href={explorerTxUrl(chainId, vaultTxHash)} target="_blank" rel="noreferrer noopener">
            {vaultTxHash.slice(0, 18)}… [View on explorer ↗]
          </a>
        </p>
      )}

      {deployed && vaultAddress && (
        <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 p-4">
          <p className="text-sm font-semibold text-accent-green">✅ Protection contract deployed!</p>
          <p className="mt-1 break-all font-mono text-sm text-text-primary">{vaultAddress}</p>
          <a
            className="text-xs text-accent"
            href={explorerAddressUrl(chainId, vaultAddress)}
            target="_blank"
            rel="noreferrer noopener"
          >
            View on explorer ↗
          </a>
        </div>
      )}

      {isPro && (
        <div className="space-y-3 rounded-lg border border-border bg-bg-tertiary p-4 text-sm">
          <p className="font-medium text-text-primary">Pro options</p>

          <label className="block">
            <span className="mb-1 block text-xs text-text-secondary">Factory</span>
            <span className="block break-all font-mono text-text-primary">
              {factoryAddress || "Deployed automatically on first run"}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-text-secondary">Executor (bot address)</span>
            <input
              value={params.executor}
              onChange={(event) => onParamsChange({ executor: event.target.value as Address })}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-text-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-text-secondary">Fee receiver</span>
            <input
              value={params.feeReceiver}
              onChange={(event) => onParamsChange({ feeReceiver: event.target.value as Address })}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-text-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-text-secondary">Fee (bps, max 1000)</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={params.feeBps}
              onChange={(event) => onParamsChange({ feeBps: Number(event.target.value) })}
              className="w-32 rounded-md border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-text-primary"
            />
          </label>

          <p className="text-xs text-text-secondary">
            Predicted address (CREATE2):{" "}
            <span className="break-all font-mono text-text-primary">
              {predictedVaultAddress ?? "available after the factory is known"}
            </span>
          </p>

          <details>
            <summary className="cursor-pointer text-xs text-text-secondary">Show constructor arguments (ABI)</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-bg-primary p-3 font-mono text-xs text-text-secondary">
              {`createVault(
  owner        = ${account},
  safeAddress  = ${safeAddress},
  executor     = ${params.executor},
  feeReceiver  = ${params.feeReceiver},
  feeBps       = ${params.feeBps},
  salt         = derived from owner + safeAddress
)`}
            </pre>
          </details>
        </div>
      )}

      <WarningBanner tone="info">
        Once the contract exists, each protected token still needs an approval transaction in step 5. Until a token is
        approved, the vault cannot move it.
      </WarningBanner>
    </StepFrame>
  );
}