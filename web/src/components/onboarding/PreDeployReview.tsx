import { useEffect, useState } from "react";

import { chaingpt } from "../../services/chaingpt/client";
import rescueVaultSource from "../../../../contracts/src/RescueVault.sol?raw";
import { MarkdownRenderer } from "../dashboard/MarkdownRenderer";
import { ProtectionScore, calculateProtectionScore } from "./ProtectionScore";
import { useOnboardingStore } from "../../state/onboarding";

export function PreDeployReview({ onContinue }: { onContinue?: () => void }) {
  const assets = useOnboardingStore((s) => s.assets);
  const safeAddress = useOnboardingStore((s) => s.safeAddress);
  const chainId = useOnboardingStore((s) => s.chainId);
  const vaultAddress = useOnboardingStore((s) => s.vaultAddress);
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const [aiDone, setAiDone] = useState(false);

  const score = calculateProtectionScore({
    hasAI: chaingpt.isAvailable(),
    tokensApproved: assets.filter((a) => a.selected).length,
    hasWETH: assets.some((a) => a.symbol === "WETH" && a.selected),
    executorFunded: false,
    telegramConfigured: false,
    contractAudited: auditResult !== null,
    preApprovedZeroBalance: assets.filter((a) => a.selected && a.balance === "0").length,
    customTokensVerified: assets.some((a) => a.verified === false && a.selected),
  });

  async function runReview() {
    setLoading(true);
    
    const configJson = JSON.stringify({ chainId, safeAddress, vaultAddress, assets });
    const r = await chaingpt.reviewConfiguration(configJson);
    setResult(r.data.markdown);
    
    setAiDone(true);
    setLoading(false);
  }

  async function runAudit() {
    setAuditLoading(true);
    
    const r = await chaingpt.audit(rescueVaultSource);
    setAuditResult(r.data.markdown);
    
    setAuditLoading(false);
  }

  useEffect(() => {
    if (chaingpt.isAvailable() && !aiDone) {
      void runReview();
    }
  }, [chaingpt.isAvailable(), aiDone]);

  return (
    <div className="space-y-4">
      <ProtectionScore score={score} />
      {!chaingpt.isAvailable() && (
        <div className="rounded-xl border border-border bg-surface p-3 text-xs text-text-secondary">
          💡 AI Security Review is available. Add a ChainGPT API key to get AI analysis of your configuration before deploying. Your Protection Score could increase from {score}% to ~85%. [Add API Key]
        </div>
      )}
      {loading && <p className="text-sm text-text-secondary">🤖 AI is analyzing your configuration...</p>}
      {result && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
          <MarkdownRenderer markdown={result} />
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-primary">── Contract Audit ──</p>
        <button
          onClick={runAudit}
          disabled={auditLoading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {auditLoading ? "Auditing..." : "🔍 Audit RescueVault contract"}
        </button>
        {auditResult && (
          <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
            <MarkdownRenderer markdown={auditResult} />
          </div>
        )}
      </div>
      <button
        onClick={() => onContinue?.()}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
      >
        {aiDone ? "Deploy Vault ✅" : "Deploy Vault"}
      </button>
    </div>
  );
}

