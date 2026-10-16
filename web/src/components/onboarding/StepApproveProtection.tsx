import type { Address } from "viem";

import { DEMO_MODE } from "../../config/demo";
import { explorerTxUrl } from "../../config/tokens";
import type { ApprovalProgress } from "../../hooks/useApprovalFlow";
import type { SelectedAsset } from "../../state/onboarding";
import { StatusBadge } from "../common/StatusBadge";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepApproveProtectionProps {
  onContinue: () => void;
  onBack: () => void;
  chainId: number;
  vaultAddress: Address;
  assets: SelectedAsset[];
  progress: ApprovalProgress[];
  running: boolean;
  finished: boolean;
  run: () => void;
}

const STATE_STYLES: Record<ApprovalProgress["state"], { tone: "active" | "alert" | "neutral"; label: string }> = {
  pending: { tone: "neutral", label: "WAITING" },
  approving: { tone: "alert", label: "APPROVING" },
  approved: { tone: "active", label: "APPROVED" },
  skipped: { tone: "neutral", label: "SKIPPED" },
  error: { tone: "alert", label: "FAILED" },
};

/**
 * Step 5 — Approve protection. The vault can only move what the owner approved,
 * so every selected asset gets its own approval transaction, sent in sequence.
 */
export function StepApproveProtection({
  onContinue,
  onBack,
  chainId,
  vaultAddress,
  assets,
  progress,
  running,
  finished,
  run,
}: StepApproveProtectionProps) {
  // Rows come from the selected assets, not from the progress list, so the queue
  // is visible before the first approval is sent.
  const targets = assets.filter((asset) => asset.selected);
  const rows: ApprovalProgress[] = targets.map((asset) => {
    const existing = progress.find((entry) => entry.address === asset.address);
    return existing ?? { address: asset.address, symbol: asset.symbol, state: "pending" };
  });

  const approved = rows.filter((entry) => entry.state === "approved").length;
  const total = rows.length;
  const failed = rows.filter((entry) => entry.state === "error");

  return (
    <StepFrame
      title="Approve protection"
      subtitle="SafeGPT needs permission to move your tokens to your safe address in an emergency."
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={running}>
            Back
          </SecondaryButton>
          {finished ? (
            <PrimaryButton onClick={onContinue} disabled={failed.length > 0}>
              Finish
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={run} disabled={running || total === 0}>
              {DEMO_MODE ? "Approve all" : running ? "Approving…" : "Approve All"}
            </PrimaryButton>
          )}
        </>
      }
    >
      <div className="rounded-lg border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">
        Vault: <span className="break-all font-mono text-text-primary">{vaultAddress}</span>
      </div>

      {total > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-text-secondary">
              Approving {Math.min(approved + (running ? 1 : 0), total)} of {total}
            </span>
            <span className="text-text-primary">{Math.round((approved / total) * 100)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${total === 0 ? 0 : (approved / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {total > 0 && (
        <ul className="space-y-2">
          {rows.map((entry) => (
            <li
              key={entry.address}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-tertiary px-4 py-3 text-sm"
            >
              <span>
                <span className="block font-medium text-text-primary">{entry.symbol}</span>
                <span className="block font-mono text-xs text-text-secondary">{entry.address}</span>
                {entry.error && <span className="block text-xs text-accent-red">{entry.error}</span>}
              </span>
              <span className="flex items-center gap-2">
                {entry.txHash && (
                  <a
                    className="font-mono text-xs text-accent"
                    href={explorerTxUrl(chainId, entry.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    tx ↗
                  </a>
                )}
                <StatusBadge tone={STATE_STYLES[entry.state].tone} label={STATE_STYLES[entry.state].label} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <WarningBanner tone="danger">
          {failed.length} approval(s) failed. A token without an approval cannot be rescued — retry the step before
          finishing.
        </WarningBanner>
      )}

      {finished && failed.length === 0 && (
        <WarningBanner tone="info">
          Approvals are unlimited so future balances of these tokens are protected automatically. Revoke them from
          Settings whenever you want to stop protecting an asset.
        </WarningBanner>
      )}
    </StepFrame>
  );
}