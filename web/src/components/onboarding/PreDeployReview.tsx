import { useEffect, useState } from "react";

import { usePublicClient } from "wagmi";
import { isAddress, type Address } from "viem";

import { chaingpt } from "../../services/chaingpt/client";
import { MarkdownRenderer } from "../dashboard/MarkdownRenderer";
import { useOnboardingStore } from "../../state/onboarding";
import { ProtectionScore, calculateProtectionScore } from "./ProtectionScore";
import { PrimaryButton } from "./StepFrame";
import { buildPreDeployReviewPrompt } from "../../features/onboarding/buildPreDeployReviewPrompt";

const SIMULATED_NOTICE = "Simulated response — no live ChainGPT analysis was performed.";

export function PreDeployReview({ onContinue }: { onContinue?: () => void }) {
  const assets = useOnboardingStore((s) => s.assets);
  const chainId = useOnboardingStore((s) => s.chainId);
  const safeAddress = useOnboardingStore((s) => s.safeAddress);
  const publicClient = usePublicClient({ chainId });
  const [safeBalance, setSafeBalance] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultWarning, setResultWarning] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const [auditWarning, setAuditWarning] = useState<string | null>(null);
  const [auditReal, setAuditReal] = useState(false);

  const aiAvailable = chaingpt.isAvailable();

  useEffect(() => {
    if (!publicClient || !isAddress(safeAddress)) return;
    let cancelled = false;
    (async () => {
      try {
        const bal = await publicClient.getBalance({ address: safeAddress as Address });
        if (!cancelled) setSafeBalance((Number(bal) / 1e18).toFixed(4));
      } catch {
        if (!cancelled) setSafeBalance("0");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, safeAddress]);

  const score = calculateProtectionScore({
    hasAI: aiAvailable,
    tokensApproved: assets.filter((a: any) => a.selected).length,
    hasWETH: assets.some((a: any) => a.symbol === "WETH" && a.selected),
    executorFunded: false,
    telegramConfigured: false,
    contractAudited: auditReal,
    preApprovedZeroBalance: assets.filter((a: any) => a.selected && a.balance === "0").length,
    customTokensVerified: assets.some((a: any) => !a.verified && a.selected),
  });

  async function runReview() {
    if (!aiAvailable) return;
    setLoading(true);
    setResultWarning(null);
    const fullPrompt = buildPreDeployReviewPrompt(safeBalance);
    const r = await chaingpt.reviewSecurity(fullPrompt);
    setResult(r.data.markdown);
    setResultWarning(r.source === "mock" ? (r.warning ?? SIMULATED_NOTICE) : null);
    setLoading(false);
  }

  async function runAudit() {
    if (!aiAvailable) return;
    setAuditLoading(true);
    setAuditWarning(null);
    const source = await import("../../../../contracts/src/RescueVault.sol?raw").then((m) => m.default);
    const r = await chaingpt.audit(source);
    setAuditResult(r.data.markdown);
    setAuditReal(r.source === "api");
    setAuditWarning(r.source === "mock" ? (r.warning ?? SIMULATED_NOTICE) : null);
    setAuditLoading(false);
  }

  return (
    <div className="space-y-4">
      <ProtectionScore score={score} />
      <p className="text-xs text-text-secondary">Safe balance: {safeBalance} ETH</p>
      {!aiAvailable && (
        <div
          data-testid="predeploy-no-key"
          className="rounded-xl border border-accent-yellow/40 bg-accent-yellow/10 p-3 text-xs text-text-secondary"
        >
          Not checked. The AI configuration review and contract audit require a ChainGPT API key
          (Settings). Without a key no analysis is performed — nothing is simulated or presented as a
          real review. Add a key to check your configuration before deploying.
        </div>
      )}
      <PrimaryButton onClick={runReview} disabled={loading || !aiAvailable}>
        {loading ? "🤖 Analyzing configuration..." : "Check current contract configuration"}
      </PrimaryButton>
      <p className="text-xs text-text-secondary">
        AI analyzes your configuration (tokens, safe address, thresholds) and gives security
        recommendations. Requires a ChainGPT API key.
      </p>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span className="animate-spin">⏳</span> AI is analyzing your configuration...
        </div>
      )}
      {result && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
          {resultWarning && (
            <p
              data-testid="review-simulated"
              className="mb-2 rounded border border-accent-yellow/40 bg-accent-yellow/10 px-2 py-1 text-xs text-accent-yellow"
            >
              {resultWarning}
            </p>
          )}
          <MarkdownRenderer markdown={result} />
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-primary">--- Contract Audit ---</p>
        <PrimaryButton onClick={runAudit} disabled={auditLoading || !aiAvailable}>
          {auditLoading ? "Auditing..." : "🔍 Audit RescueVault contract"}
        </PrimaryButton>
        <p className="text-xs text-text-secondary">
          AI audits the Solidity source code of the RescueVault contract for vulnerabilities.
          Requires a ChainGPT API key.
        </p>
        {auditResult && (
          <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
            {auditWarning && (
              <p
                data-testid="audit-simulated"
                className="mb-2 rounded border border-accent-yellow/40 bg-accent-yellow/10 px-2 py-1 text-xs text-accent-yellow"
              >
                {auditWarning}
              </p>
            )}
            <MarkdownRenderer markdown={auditResult} />
          </div>
        )}
      </div>
      <PrimaryButton onClick={() => onContinue?.()}>
        {result ? "Deploy Vault ✅" : "Deploy Vault"}
      </PrimaryButton>
    </div>
  );
}
