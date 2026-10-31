import { useEffect, useState } from "react";

import { usePublicClient } from "wagmi";
import { isAddress, type Address } from "viem";

import { chaingpt } from "../../services/chaingpt/client";
import { MarkdownRenderer } from "../dashboard/MarkdownRenderer";
import { useOnboardingStore } from "../../state/onboarding";
import { ProtectionScore, calculateProtectionScore } from "./ProtectionScore";
import { PrimaryButton } from "./StepFrame";
import { buildPreDeployReviewPrompt } from "../../features/onboarding/buildPreDeployReviewPrompt";

export function PreDeployReview({ onContinue }: { onContinue?: () => void }) {
  const assets = useOnboardingStore((s) => s.assets);
  const chainId = useOnboardingStore((s) => s.chainId);
  const safeAddress = useOnboardingStore((s) => s.safeAddress);
  const publicClient = usePublicClient({ chainId });
  const [safeBalance, setSafeBalance] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<string | null>(null);

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
    hasAI: chaingpt.isAvailable(),
    tokensApproved: assets.filter((a: any) => a.selected).length,
    hasWETH: assets.some((a: any) => a.symbol === "WETH" && a.selected),
    executorFunded: false,
    telegramConfigured: false,
    contractAudited: auditResult !== null,
    preApprovedZeroBalance: assets.filter((a: any) => a.selected && a.balance === "0").length,
    customTokensVerified: assets.some((a: any) => !a.verified && a.selected),
  });

  async function runReview() {
    setLoading(true);
    const fullPrompt = buildPreDeployReviewPrompt(safeBalance);
    const r = await chaingpt.reviewSecurity(fullPrompt);
    setResult(r.data.markdown);
    setLoading(false);
  }

  async function runAudit() {
    setAuditLoading(true);
    const source = await import("../../../../contracts/src/RescueVault.sol?raw").then((m) => m.default);
    const r = await chaingpt.audit(source);
    setAuditResult(r.data.markdown);
    setAuditLoading(false);
  }

  return (
    <div className="space-y-4">
      <ProtectionScore score={score} />
      <p className="text-xs text-text-secondary">Safe balance: {safeBalance} ETH</p>
      <PrimaryButton onClick={runReview} disabled={loading}>
        {loading ? "🤖 Analyzing configuration..." : "Проверить текущую конфигурацию контракта"}
      </PrimaryButton>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span className="animate-spin">⏳</span> AI is analyzing your configuration...
        </div>
      )}
      {!chaingpt.isAvailable() && (
        <div className="rounded-xl border border-border bg-surface p-3 text-xs text-text-secondary">
          💡 AI Security Review is available. Add a ChainGPT API key to get AI analysis before deploying.
        </div>
      )}
      {result && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
          <MarkdownRenderer markdown={result} />
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-primary">--- Contract Audit ---</p>
        <PrimaryButton onClick={runAudit} disabled={auditLoading}>
          {auditLoading ? "Auditing..." : "🔍 Audit RescueVault contract"}
        </PrimaryButton>
        {auditResult && (
          <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
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
