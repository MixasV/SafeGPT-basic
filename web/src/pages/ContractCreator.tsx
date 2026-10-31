import { useState } from "react";

import { chaingpt } from "../services/chaingpt/client";

export function ContractCreator() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setWarning(null);
    const r = await chaingpt.generate(description);
    setCode(r.data.code);
    setWarning(r.warning ?? null);
    setLoading(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 space-y-4">
      <h1 className="text-xl font-semibold text-text-primary">Contract Creator (experimental)</h1>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={6}
        className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-text-primary"
        placeholder="Describe the contract you want to generate..."
      />
      <button
        onClick={run}
        disabled={loading || description.trim() === ""}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate contract"}
      </button>
      {!chaingpt.isAvailable() && (
        <p className="text-xs text-text-secondary">
          Add VITE_CHAINGPT_API_KEY to .env for real generation. Simulated output otherwise.
        </p>
      )}
      {warning && <p className="text-xs text-amber-500">{warning}</p>}
      {code && (
        <pre className="rounded-xl border border-border bg-surface p-4 text-xs text-text-primary overflow-auto">
          {code}
        </pre>
      )}
    </div>
  );
}
