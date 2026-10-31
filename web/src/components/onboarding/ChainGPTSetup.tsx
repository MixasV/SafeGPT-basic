import { useState } from "react";

export function ChainGPTSetup({ onContinue }: { onContinue?: () => void }) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");

  function save() {
    if (!key.trim()) return;
    localStorage.setItem("chaingpt_api_key", key.trim());
    setStatus("Saved.");
    onContinue?.();
    setTimeout(() => window.location.reload(), 300);
  }

  function skip() {
    localStorage.removeItem("chaingpt_api_key");
    setStatus("Skipped.");
    onContinue?.();
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">ChainGPT AI (optional)</h3>
      <p className="text-xs text-text-secondary">
        Works without AI. With a key you get config review, contract audit, and contract generation.
      </p>
      <p className="text-xs text-text-secondary">
        Security improvement: enabling AI review adds +15% to your Protection Score and helps catch misconfigurations before deployment.
      </p>
      <p className="text-xs text-text-secondary">
        Powered by ChainGPT AI — https://chaingpt.org
      </p>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
        placeholder="API key"
      />
      <div className="flex gap-2">
        <button onClick={save} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">
          Continue with AI
        </button>
        <button onClick={skip} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary">
          Continue without AI
        </button>
      </div>
      {status && <p className="text-xs text-text-secondary">{status}</p>}
    </div>
  );
}
