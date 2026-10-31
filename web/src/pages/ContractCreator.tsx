import { useState } from "react";

import { PrimaryButton } from "../components/onboarding/StepFrame";
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
      <PrimaryButton onClick={run} disabled={loading || description.trim() === ""}>
        {loading ? "Generating..." : "Generate contract"}
      </PrimaryButton>
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
