import { useState } from "react";

import { chaingpt } from "../../services/chaingpt/client";
import { MarkdownRenderer } from "../dashboard/MarkdownRenderer";
import { useOnboardingStore } from "../../state/onboarding";

interface Props {
  onContinue?: () => void;
}

export function PreDeployReview({ onContinue }: Props) {
  const assets = useOnboardingStore((s) => s.assets);
  const safeAddress = useOnboardingStore((s) => s.safeAddress);
  const chainId = useOnboardingStore((s) => s.chainId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setWarning(null);
    const configJson = JSON.stringify({ chainId, safeAddress, assets });
    const r = await chaingpt.reviewConfiguration(configJson);
    setResult(r.data.markdown);
    setWarning(r.warning ?? null);
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Analyzing..." : "Run AI review"}
      </button>
      {!chaingpt.isAvailable() && (
        <p className="text-xs text-text-secondary">Add VITE_CHAINGPT_API_KEY for real AI. Simulated otherwise.</p>
      )}
      {warning && <p className="text-xs text-amber-500">{warning}</p>}
      {result && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
          <MarkdownRenderer markdown={result} />
        </div>
      )}
      <button
        onClick={() => onContinue?.()}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
      >
        Continue to deploy
      </button>
    </div>
  );
}
