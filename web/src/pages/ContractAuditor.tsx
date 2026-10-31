import { useState } from "react";

import { chaingpt } from "../services/chaingpt/client";
import { MarkdownRenderer } from "../components/dashboard/MarkdownRenderer";

export function ContractAuditor() {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setWarning(null);
    const r = await chaingpt.audit(source);
    setResult(r.data.markdown);
    setWarning(r.warning ?? null);
    setLoading(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 space-y-4">
      <h1 className="text-xl font-semibold text-text-primary">Contract Auditor</h1>
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        rows={12}
        className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs text-text-primary"
        placeholder="Paste Solidity source code here..."
      />
      <button
        onClick={run}
        disabled={loading || source.trim() === ""}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Auditing..." : "Audit contract"}
      </button>
      {!chaingpt.isAvailable() && (
        <p className="text-xs text-text-secondary">
          Add VITE_CHAINGPT_API_KEY to .env for real AI audit. Simulated output otherwise.
        </p>
      )}
      {warning && <p className="text-xs text-amber-500">{warning}</p>}
      {result && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-primary">
          <MarkdownRenderer markdown={result} />
        </div>
      )}
    </div>
  );
}
