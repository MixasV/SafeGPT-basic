import { useState } from "react";

import { chaingpt } from "../services/chaingpt/client";

export function Settings() {
  const [key, setKey] = useState(localStorage.getItem("chaingpt_api_key") ?? "");
  const [status, setStatus] = useState("");

  function save() {
    if (!key.trim()) {
      localStorage.removeItem("chaingpt_api_key");
      setStatus("Removed.");
      return;
    }
    localStorage.setItem("chaingpt_api_key", key.trim());
    setStatus("Saved. Reload to apply.");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-4">
      <h1 className="text-xl font-semibold text-text-primary">Settings</h1>

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">ChainGPT AI Integration</h2>
        <p className="text-xs text-text-secondary">
          API Key: stored in browser localStorage. Get yours at{" "}
          <a href="https://app.chaingpt.org/apidashboard" target="_blank" rel="noreferrer" className="text-accent underline">
            app.chaingpt.org/apidashboard
          </a>
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
          placeholder="API key"
        />
        <div className="flex items-center gap-3">
          <button onClick={save} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">
            Save
          </button>
          <span className="text-xs text-text-secondary">
            Status: {chaingpt.isAvailable() ? "✅ Connected" : "❌ Not configured"}
          </span>
        </div>
        {status && <p className="text-xs text-text-secondary">{status}</p>}
        <p className="text-xs text-text-secondary">
          AI features enabled: Security Review (Dashboard), Contract Auditor, Contract Creator (Experimental).
        </p>
        <p className="text-xs text-text-secondary">
          Powered by ChainGPT AI — https://chaingpt.org
        </p>
      </section>
    </div>
  );
}
