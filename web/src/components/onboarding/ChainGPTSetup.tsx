import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "./StepFrame";

import { chaingpt } from "../../services/chaingpt/client";

export function ChainGPTSetup({ onContinue }: { onContinue?: () => void }) {
  const hasKey = !!localStorage.getItem("chaingpt_api_key");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");

  if (hasKey) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Step 3: AI Security Advisor (optional)</h3>
        <p className="text-xs text-text-secondary">✅ Connected — ChainGPT AI is configured.</p>
        <PrimaryButton onClick={() => onContinue?.()}>Continue</PrimaryButton>
      </div>
    );
  }

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
    <div className="rounded-2xl border border-border bg-surface p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">Step 3: AI Security Advisor (optional)</h3>
      <p className="text-xs text-text-secondary">
        SafeGPT works without AI, but with ChainGPT your protection setup gets significantly stronger.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs text-text-secondary">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-3 py-2 text-left">Without AI</th>
              <th className="px-3 py-2 text-left">With AI</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border"><td className="px-3 py-2">○ Manual token selection (might miss tokens)</td><td className="px-3 py-2">✅ AI checks coverage gaps</td></tr>
            <tr className="border-b border-border"><td className="px-3 py-2">○ No config validation (deploy and hope)</td><td className="px-3 py-2">✅ AI validates safe address, network, thresholds</td></tr>
            <tr className="border-b border-border"><td className="px-3 py-2">○ No contract audit (trust the code)</td><td className="px-3 py-2">✅ AI audits your vault contract</td></tr>
            <tr className="border-b border-border"><td className="px-3 py-2">○ Alerts = raw data</td><td className="px-3 py-2">✅ AI explains alerts in plain language</td></tr>
            <tr className="border-b border-border"><td className="px-3 py-2">○ Self-guided setup</td><td className="px-3 py-2">✅ AI advisor through every step</td></tr>
            <tr><td className="px-3 py-2">Protection Score: ~60%</td><td className="px-3 py-2">Protection Score: ~85%</td></tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-secondary">
        How to get your free API key: 1. Go to{" "}
        <a href="https://app.chaingpt.org" target="_blank" rel="noreferrer" className="text-accent underline">
          app.chaingpt.org
        </a>{" "}
        2. Connect wallet or create account 3. API Dashboard → Create API Key 4. Copy key and paste below
      </p>
      <p className="text-xs text-text-secondary">
        Cost: ~$0.005 per AI check (~$0.03-0.05 total for setup). Powered by{" "}
        <a href="https://chaingpt.org" target="_blank" rel="noreferrer" className="text-accent underline">
          ChainGPT AI — https://chaingpt.org
        </a>
      </p>

      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
        placeholder="API key"
      />
      <div className="flex gap-2">
        <PrimaryButton onClick={save}>Continue with AI</PrimaryButton>
        <SecondaryButton onClick={skip}>Continue without AI</SecondaryButton>
      </div>
      {status && <p className="text-xs text-text-secondary">{status}</p>}
      {!chaingpt.isAvailable() && (
        <p className="text-xs text-text-secondary">
          Status: ❌ Not configured. Add key to enable AI features.
        </p>
      )}
    </div>
  );
}

