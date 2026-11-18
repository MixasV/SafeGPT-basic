import { useMemo, useState } from "react";

import { type Address } from "viem";

import { chaingpt } from "../services/chaingpt/client";
import {
  addressFromPrivateKey,
  formatEth,
  getEthBalance,
  resolveRpcUrl,
  sendTelegramTest,
  testAlchemyKey,
} from "../lib/integrations";
import { useOnboardingStore } from "../state/onboarding";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "error"; detail: string };

const KEYS = {
  chaingpt: "chaingpt_api_key",
  alchemy: "safegpt_alchemy_key",
  wcProjectId: "safegpt_wc_project_id",
  tgToken: "safegpt_tg_bot_token",
  tgChat: "safegpt_tg_chat_id",
  feeBps: "safegpt_rescue_fee_bps",
  executorKey: "EXECUTOR_KEY",
} as const;

export function Settings() {
  const chainId = useOnboardingStore((s) => s.chainId);

  const [chaingptKey, setChaingptKey] = useState(() => localStorage.getItem(KEYS.chaingpt) ?? "");
  const [alchemyKey, setAlchemyKey] = useState(() => localStorage.getItem(KEYS.alchemy) ?? "");
  const [wcProjectId, setWcProjectId] = useState(() => localStorage.getItem(KEYS.wcProjectId) ?? "");
  const [tgToken, setTgToken] = useState(() => localStorage.getItem(KEYS.tgToken) ?? "");
  const [tgChat, setTgChat] = useState(() => localStorage.getItem(KEYS.tgChat) ?? "");
  const [feePct, setFeePct] = useState(() => {
    const raw = localStorage.getItem(KEYS.feeBps);
    // Default 3% (300 bps). Number(null) is 0, so we must distinguish "not
    // saved yet" (null) from "user set 0%" — otherwise the default never applies.
    const stored = raw !== null && raw !== "" ? Number(raw) : NaN;
    return (Number.isFinite(stored) && stored >= 0 ? stored : 300) / 100;
  });
  const [executorKey] = useState(() => localStorage.getItem(KEYS.executorKey) ?? "");

  const [alchemyTest, setAlchemyTest] = useState<TestState>({ kind: "idle" });
  const [tgTest, setTgTest] = useState<TestState>({ kind: "idle" });
  const [saveNote, setSaveNote] = useState("");

  const executorAddress = useMemo<Address | null>(() => addressFromPrivateKey(executorKey), [executorKey]);

  const [health, setHealth] = useState<
    { name: string; state: TestState }[] | null
  >(null);
  const [healthLoading, setHealthLoading] = useState(false);

  function persist() {
    if (chaingptKey.trim() !== "") localStorage.setItem(KEYS.chaingpt, chaingptKey.trim());
    else localStorage.removeItem(KEYS.chaingpt);

    if (alchemyKey.trim() !== "") localStorage.setItem(KEYS.alchemy, alchemyKey.trim());
    else localStorage.removeItem(KEYS.alchemy);

    localStorage.setItem(KEYS.wcProjectId, wcProjectId.trim());

    if (tgToken.trim() !== "") localStorage.setItem(KEYS.tgToken, tgToken.trim());
    else localStorage.removeItem(KEYS.tgToken);
    if (tgChat.trim() !== "") localStorage.setItem(KEYS.tgChat, tgChat.trim());
    else localStorage.removeItem(KEYS.tgChat);

    localStorage.setItem(KEYS.feeBps, String(Math.round(feePct * 100)));

    if (executorKey.trim() !== "") localStorage.setItem(KEYS.executorKey, executorKey.trim());
    else localStorage.removeItem(KEYS.executorKey);

    setSaveNote("Saved. Reload to apply API key changes.");
  }

  async function runAlchemyTest() {
    setAlchemyTest({ kind: "testing" });
    const result = await testAlchemyKey(alchemyKey, chainId);
    if (result.ok) {
      const block = result.block ? parseInt(result.block, 16) : null;
      setAlchemyTest({ kind: "ok", detail: `Connected · block ${block ?? "?"}` });
    } else {
      setAlchemyTest({ kind: "error", detail: result.error ?? "Connection failed" });
    }
  }

  async function runTelegramTest() {
    setTgTest({ kind: "testing" });
    const result = await sendTelegramTest(tgToken, tgChat);
    setTgTest(result.ok ? { kind: "ok", detail: "Test message sent" } : { kind: "error", detail: result.error ?? "Failed" });
  }

  async function runHealthCheck() {
    setHealthLoading(true);
    const results: { name: string; state: TestState }[] = [];

    // Alchemy
    if (alchemyKey.trim() !== "") {
      const r = await testAlchemyKey(alchemyKey, chainId);
      results.push({ name: "Alchemy API", state: r.ok ? { kind: "ok", detail: "eth_blockNumber ok" } : { kind: "error", detail: r.error ?? "failed" } });
    } else {
      results.push({ name: "Alchemy API", state: { kind: "error", detail: "No key configured" } });
    }

    // RPC endpoint
    const rpcUrl = resolveRpcUrl(chainId, alchemyKey);
    if (rpcUrl) {
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const json = (await response.json()) as { result?: string };
        results.push({ name: "RPC endpoint", state: json.result ? { kind: "ok", detail: "reachable" } : { kind: "error", detail: "no result" } });
      } catch (error) {
        results.push({ name: "RPC endpoint", state: { kind: "error", detail: error instanceof Error ? error.message : "failed" } });
      }
    } else {
      results.push({ name: "RPC endpoint", state: { kind: "error", detail: "No endpoint" } });
    }

    // Executor balance
    if (executorAddress && rpcUrl) {
      const balance = await getEthBalance(executorAddress, rpcUrl);
      results.push({
        name: "Executor balance",
        state: balance === null
          ? { kind: "error", detail: `${executorAddress} · read failed` }
          : { kind: "ok", detail: `${executorAddress} · ${formatEth(balance)} ETH` },
      });
    } else {
      results.push({ name: "Executor balance", state: { kind: "error", detail: executorAddress ? "No RPC" : "No executor key" } });
    }

    // Telegram
    if (tgToken.trim() !== "" && tgChat.trim() !== "") {
      const r = await sendTelegramTest(tgToken, tgChat);
      results.push({ name: "Telegram", state: r.ok ? { kind: "ok", detail: "message sent" } : { kind: "error", detail: r.error ?? "failed" } });
    } else {
      results.push({ name: "Telegram", state: { kind: "error", detail: "Not configured" } });
    }

    setHealth(results);
    setHealthLoading(false);
  }

  return (
    <div className="mx-auto w-full max-2xl px-4 py-8 space-y-4">
      <h1 className="text-xl font-semibold text-text-primary">Settings</h1>

      {/* 1. ChainGPT AI Integration */}
      <SettingsCard title="ChainGPT AI Integration">
        <p className="text-xs text-text-secondary">
          API key stored in browser localStorage. Get yours at{" "}
          <a href="https://app.chaingpt.org/apidashboard" target="_blank" rel="noreferrer" className="text-accent underline">
            app.chaingpt.org/apidashboard
          </a>
        </p>
        <input
          type="password"
          value={chaingptKey}
          onChange={(e) => setChaingptKey(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
          placeholder="ChainGPT API key"
        />
        <p className="text-xs text-text-secondary">
          💡 Each request costs 2-5 credits. Top up at app.chaingpt.org
        </p>
        <StatusLine ok={chaingpt.isAvailable() || chaingptKey.trim() !== ""} okLabel="Configured" failLabel="Not configured" />
      </SettingsCard>

      {/* 2. Alchemy Integration */}
      <SettingsCard title="Alchemy Integration">
        <p className="text-xs text-text-secondary">
          Server-side key for the bot. Get a free key at{" "}
          <a href="https://dashboard.alchemy.com" target="_blank" rel="noreferrer" className="text-accent underline">
            dashboard.alchemy.com
          </a>
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={alchemyKey}
            onChange={(e) => {
              setAlchemyKey(e.target.value);
              setAlchemyTest({ kind: "idle" });
            }}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            placeholder="Alchemy API key"
          />
          <button
            type="button"
            onClick={() => void runAlchemyTest()}
            disabled={alchemyTest.kind === "testing" || alchemyKey.trim() === ""}
            className="rounded-lg border border-border bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary disabled:opacity-50"
          >
            {alchemyTest.kind === "testing" ? "Testing…" : "Test"}
          </button>
        </div>
        <StateLine state={alchemyTest} idleLabel="Not configured" />
        <p className="text-xs text-text-secondary">
          When set, this key is written to <code className="rounded bg-bg-tertiary px-1">VITE_ALCHEMY_API_KEY</code> for the
          token scan. Keep it private — do not commit it.
        </p>
      </SettingsCard>

      {/* 3. WalletConnect */}
      <SettingsCard title="WalletConnect">
        <p className="text-xs text-text-secondary">
          Project ID for the WalletConnect connector. Get one at{" "}
          <a href="https://cloud.walletconnect.com" target="_blank" rel="noreferrer" className="text-accent underline">
            cloud.walletconnect.com
          </a>
        </p>
        <input
          value={wcProjectId}
          onChange={(e) => setWcProjectId(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
          placeholder="WalletConnect Project ID"
        />
      </SettingsCard>

      {/* 4. Telegram Alerts */}
      <SettingsCard title="Telegram Alerts">
        <p className="text-xs text-text-secondary">
          Create a bot with{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent underline">
            @BotFather
          </a>{" "}
          and paste its token and your chat ID.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="password"
            value={tgToken}
            onChange={(e) => {
              setTgToken(e.target.value);
              setTgTest({ kind: "idle" });
            }}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            placeholder="Bot token"
          />
          <input
            value={tgChat}
            onChange={(e) => {
              setTgChat(e.target.value);
              setTgTest({ kind: "idle" });
            }}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            placeholder="Chat ID"
          />
        </div>
        <button
          type="button"
          onClick={() => void runTelegramTest()}
          disabled={tgTest.kind === "testing" || tgToken.trim() === "" || tgChat.trim() === ""}
          className="rounded-lg border border-border bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary disabled:opacity-50"
        >
          {tgTest.kind === "testing" ? "Sending…" : "Test"}
        </button>
        <StateLine state={tgTest} idleLabel="Not configured" />
      </SettingsCard>

      {/* 5. Rescue Fee */}
      <SettingsCard title="Rescue Fee">
        <p className="text-xs text-text-secondary">
          This fee is charged on each successful rescue and goes to the SafeGPT developer as a thank-you reward.
          Set to 0 to disable.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={feePct}
            onChange={(e) => setFeePct(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-16 text-right text-sm text-text-primary">{feePct}%</span>
        </div>
      </SettingsCard>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={persist}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Save Settings
        </button>
        {saveNote && <span className="text-xs text-text-secondary">{saveNote}</span>}
      </div>

      {/* 6. Service Health Check */}
      <SettingsCard title="Service Health Check">
        <button
          type="button"
          onClick={() => void runHealthCheck()}
          disabled={healthLoading}
          className="rounded-lg border border-border bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary disabled:opacity-50"
        >
          {healthLoading ? "Checking…" : "Check Connections"}
        </button>
        {executorAddress && (
          <p className="text-xs text-text-secondary">
            Executor: <span className="font-mono">{executorAddress}</span>
          </p>
        )}
        {health && (
          <ul className="space-y-1">
            {health.map((row) => (
              <li key={row.name} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-text-secondary">{row.name}</span>
                <HealthMark state={row.state} />
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <p className="text-xs text-text-secondary">
        Powered by ChainGPT AI — https://chaingpt.org
      </p>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function StatusLine({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  return (
    <p className={`text-xs ${ok ? "text-accent-green" : "text-text-secondary"}`}>
      Status: {ok ? `✅ ${okLabel}` : `⚪ ${failLabel}`}
    </p>
  );
}

function StateLine({ state, idleLabel }: { state: TestState; idleLabel: string }) {
  if (state.kind === "testing") return <p className="text-xs text-text-secondary">Testing…</p>;
  if (state.kind === "ok") return <p className="text-xs text-accent-green">✅ {state.detail}</p>;
  if (state.kind === "error") return <p className="text-xs text-accent-red">❌ {state.detail}</p>;
  return <p className="text-xs text-text-secondary">⚪ {idleLabel}</p>;
}

function HealthMark({ state }: { state: TestState }) {
  if (state.kind === "ok") return <span className="text-accent-green">✅ {state.detail}</span>;
  if (state.kind === "error") return <span className="text-accent-red">❌ {state.detail}</span>;
  return <span className="text-text-secondary">⚪ {state.kind === "testing" ? "checking…" : "idle"}</span>;
}