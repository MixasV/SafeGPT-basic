import { useState } from "react";

import { chaingpt } from "../../services/chaingpt/client";
import { buildSecurityConfigData } from "../../features/dashboard/buildSecurityConfigData";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function AiSecurityReview(_props: Record<string, never>) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setWarning(null);
    const configData = buildSecurityConfigData();
    const r = await chaingpt.reviewConfiguration(configData);
    setResult(r.data.markdown);
    setWarning(r.warning ?? null);
    setLoading(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">AI Security Review</h3>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Run review"}
        </button>
      </div>
      {!chaingpt.isAvailable() && (
        <p className="mt-2 text-xs text-text-secondary">
          Add VITE_CHAINGPT_API_KEY to .env for real AI analysis. Simulated output otherwise.
        </p>
      )}
      {warning && <p className="mt-2 text-xs text-amber-500">{warning}</p>}
      {result && (
        <div className="mt-3 text-sm text-text-primary">
          <MarkdownRenderer markdown={result} />
        </div>
      )}
    </div>
  );
}
