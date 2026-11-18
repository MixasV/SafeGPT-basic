import { useMemo, useState } from "react";

import { MarkdownRenderer } from "./ai/MarkdownRenderer";
import { SimulatedNotice } from "./ai/SimulatedNotice";
import { chaingpt } from "../services/chaingpt/client";
import { saveAuditVerdict } from "../lib/auditVerdict";
import { buildDeploymentAuditInput } from "../lib/deploymentAudit";
import { trackEvent } from "../utils/analytics";
import type { SelectedAsset } from "../state/onboarding";
import { PrimaryButton, SecondaryButton, StepFrame } from "./onboarding/StepFrame";

/**
 * AI Security Review — standalone step BEFORE deploy.
 *
 * Chat-style UI: the user clicks "Analyze my configuration", one user message
 * appears in the chat, and the ChainGPT auditor answers. The user never sees
 * the system prompt and cannot type a free-form follow-up — the only input is
 * the deployment manifest built from the actual configuration.
 *
 * Resend rules:
 *  - Only one analysis per config. After a successful answer the button is
 *    disabled until the config changes (assets/safe/whitelist/fee).
 *  - If the answer came back as an error/simulated-with-warning, the user may
 *    resend ("Try again").
 *  - Skip is always available — review never blocks deploy.
 */

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  simulated?: boolean;
  warning?: string;
}

interface AiSecurityReviewProps {
  chainId: number;
  assets: SelectedAsset[];
  safeAddress: string;
  owner: string;
  executor: string;
  feeReceiver: string;
  feeBps: number;
  whitelist: string[];
  predictedVaultAddress?: string | null;
  factoryAddress?: string;
  withdrawDelay?: number;
  salt?: string;
  contractType?: "RescueVault" | "GuardianModule";
  onContinue: () => void;
  onBack: () => void;
}

export function AiSecurityReview({
  chainId,
  assets,
  safeAddress,
  owner,
  executor,
  feeReceiver,
  feeBps,
  whitelist,
  predictedVaultAddress = null,
  factoryAddress = "",
  withdrawDelay = 0,
  salt,
  contractType = "RescueVault",
  onContinue,
  onBack,
}: AiSecurityReviewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAnalyzedHash, setLastAnalyzedHash] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState(false);

  const manifest = useMemo(
    () =>
      buildDeploymentAuditInput({
        owner,
        safeAddress,
        executor,
        feeReceiver,
        feeBps,
        withdrawDelay,
        chainId,
        assets,
        whitelist,
        factoryAddress: factoryAddress || undefined,
        predictedVaultAddress,
        salt,
        contractType,
      }),
    [assets, chainId, contractType, executor, factoryAddress, feeBps, feeReceiver, owner, predictedVaultAddress, safeAddress, salt, whitelist, withdrawDelay],
  );

  const configHash = useMemo(() => manifest, [manifest]);
  const configChanged = lastAnalyzedHash !== null && lastAnalyzedHash !== configHash;
  const alreadyAnalyzed = lastAnalyzedHash !== null && !configChanged && !lastFailed;
  const canAnalyze = !loading && (!alreadyAnalyzed || lastFailed || configChanged);

  async function analyze(): Promise<void> {
    if (!canAnalyze) return;
    setLoading(true);
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: "user", text: "Analyze my configuration" };
    setMessages((prev) => [...prev, userMessage]);
    try {
      trackEvent("ai_config_review_requested", { kind: "review" });
      const response = await chaingpt.reviewConfiguration(manifest);
      const failed = response.source === "mock" && Boolean(response.warning);
      setLastFailed(failed);
      setLastAnalyzedHash(configHash);
      saveAuditVerdict(response.data.markdown, configHash, response.source === "mock");
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: response.data.markdown,
          simulated: response.source === "mock",
          ...(response.warning === undefined ? {} : { warning: response.warning }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepFrame
      title="AI Security Review"
      subtitle="Before you deploy, ChainGPT reviews YOUR exact deployment (your addresses, tokens and whitelist) and gives warnings and a verdict. Optional — you can skip."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onContinue} testId="ai-review-continue">Continue to deploy</PrimaryButton>
        </>
      }
    >
      <p className="text-xs text-accent-yellow">
        💡 Each analysis costs 2-5 ChainGPT credits. Balance: app.chaingpt.org
      </p>
      <div className="rounded-2xl border border-border bg-bg-secondary overflow-hidden">
        <header className="border-b border-border px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">ChainGPT Contract Auditor</p>
            <p className="text-xs text-text-secondary">{chaingpt.isAvailable() ? "Live API" : "Mock mode"} · 1 analysis per config</p>
          </div>
        </header>

        <div className="space-y-3 px-5 py-4 max-h-[420px] overflow-y-auto" data-testid="ai-review-chat">
          {messages.length === 0 && (
            <p className="text-sm text-text-secondary">
              Press “Analyze my configuration” and the auditor will review the vault you are about to deploy —
              your owner/safe addresses, executor/fee, selected tokens and whitelist.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg border p-4 text-sm ${
                message.role === "user"
                  ? "border-accent/30 bg-accent/10 text-text-primary"
                  : "border-border bg-bg-tertiary text-text-primary"
              }`}
            >
              {message.role === "assistant" && message.simulated && <SimulatedNotice warning={message.warning} />}
              {message.role === "assistant" ? <MarkdownRenderer markdown={message.text} /> : <span>{message.text}</span>}
            </div>
          ))}
          {loading && <p className="text-xs text-text-secondary">Auditing…</p>}
        </div>

        <div className="border-t border-border px-5 py-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={!canAnalyze}
            data-testid="ai-review-run"
            className="rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Analyzing…" : lastFailed ? "↻ Try again" : configChanged ? "↻ Re-analyze (config changed)" : "🤖 Analyze my configuration"}
          </button>
          {alreadyAnalyzed && (
            <span className="text-xs text-accent-green self-center">✓ Already analyzed — config unchanged. Change tokens/safe address to re-analyze.</span>
          )}
          {lastFailed && (
            <span className="text-xs text-accent-red self-center">Last answer failed — you can resend.</span>
          )}
        </div>
      </div>
    </StepFrame>
  );
}