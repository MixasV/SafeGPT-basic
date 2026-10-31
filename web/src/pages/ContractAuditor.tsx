import { useState } from "react";

import rescueVaultSource from "../../../contracts/src/RescueVault.sol?raw";
import { chaingpt } from "../services/chaingpt/client";
import { MarkdownRenderer } from "../components/dashboard/MarkdownRenderer";

export function ContractAuditor() {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [fetchAddress, setFetchAddress] = useState("");
  const [fetchChainId, setFetchChainId] = useState(11155111);
  const [auditVaultLoading, setAuditVaultLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);

  async function fetchSource() {
    if (!fetchAddress.trim()) return;
    setFetchLoading(true);
    try {
      const res = await fetch(`https://sourcify.dev/server/files/${fetchChainId}/${fetchAddress.trim()}`);
      if (!res.ok) throw new Error(`Sourcify: ${res.status}`);
      const files = (await res.json()) as { name: string; content: string }[];
      const sol = files.find((f) => f.name.endsWith(".sol"));
      if (sol) setSource(sol.content);
      else setWarning("No .sol source found on Sourcify.");
    } catch (e) {
      setWarning(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchLoading(false);
    }
  }

  async function auditVault() {
    setAuditVaultLoading(true);
    setWarning(null);
    const r = await chaingpt.audit(rescueVaultSource);
    setResult(r.data.markdown);
    setWarning(r.warning ?? null);
    setAuditVaultLoading(false);
  }

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
      <div className="rounded-xl border border-border bg-surface p-3">
        <button
          onClick={auditVault}
          disabled={auditVaultLoading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {auditVaultLoading ? "Auditing..." : "🔍 Audit SafeGPT RescueVault Contract"}
        </button>
      </div>
      <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
        <p className="text-xs text-text-secondary">Fetch verified source by address (Sourcify)</p>
        <div className="flex gap-2">
          <input
            value={fetchAddress}
            onChange={(e) => setFetchAddress(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            placeholder="0x..."
          />
          <select
            value={fetchChainId}
            onChange={(e) => setFetchChainId(Number(e.target.value))}
            className="rounded-lg border border-border bg-bg px-2 py-2 text-sm text-text-primary"
          >
            <option value={1}>Mainnet</option>
            <option value={11155111}>Sepolia</option>
          </select>
          <button
            onClick={fetchSource}
            disabled={fetchLoading}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {fetchLoading ? "Fetching..." : "Fetch"}
          </button>
        </div>
      </div>
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
