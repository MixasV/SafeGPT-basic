import { useMemo, useState } from "react";

import { type Address } from "viem";

import { useOnboardingStore } from "../../state/onboarding";
import { DEFAULT_FEE_RECEIVER } from "../../config/contracts";
import {
  addressFromPrivateKey,
  formatEth,
  getEthBalance,
  resolveRpcUrl,
  sendTelegramTest,
  testAlchemyKey,
} from "../../lib/integrations";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepSetupKeysProps {
  onContinue: () => void;
  onBack: () => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "error"; detail: string };

const ALCHEMY_KEY_STORAGE = "safegpt_alchemy_key";
const TG_TOKEN_STORAGE = "safegpt_tg_bot_token";
const TG_CHAT_STORAGE = "safegpt_tg_chat_id";
const FEE_BPS_STORAGE = "safegpt_rescue_fee_bps";
const EXECUTOR_KEY_STORAGE = "EXECUTOR_KEY";

/**
 * Replaces the old "Understanding check" (quiz) and "ChainGPT AI" steps.
 *
 * Collects everything the protection needs before any wallet connection:
 *   - Alchemy API key (required for balance scanning) with a live test
 *   - Executor bot wallet (generate or paste a key, derive address, check gas)
 *   - Telegram alerts (optional) with a test message
 *   - Rescue fee + fee receiver
 *
 * All values persist to localStorage under stable keys and to the onboarding
 * store so later steps and the Settings page read the same source of truth.
 */
export function StepSetupKeys({ onContinue, onBack }: StepSetupKeysProps) {
  const chainId = useOnboardingStore((s) => s.chainId);
  const setAlchemyKey = useOnboardingStore((s) => s.setAlchemyKey);
  const setFeeBps = useOnboardingStore((s) => s.setFeeBps);
  const setFeeReceiver = useOnboardingStore((s) => s.setFeeReceiver);

  const [alchemyKey, setLocalAlchemyKey] = useState(
    () => localStorage.getItem(ALCHEMY_KEY_STORAGE) ?? useOnboardingStore.getState().alchemyKey ?? "",
  );
  const [executorKey, setExecutorKey] = useState(() => localStorage.getItem(EXECUTOR_KEY_STORAGE) ?? "");
  const [tgToken, setTgToken] = useState(() => localStorage.getItem(TG_TOKEN_STORAGE) ?? "");
  const [tgChat, setTgChat] = useState(() => localStorage.getItem(TG_CHAT_STORAGE) ?? "");
  const [feePct, setFeePct] = useState(() => {
    const raw = localStorage.getItem(FEE_BPS_STORAGE);
    // Default 3% (300 bps). Number(null) is 0, so check key existence first.
    // The fee goes to the SafeGPT developer as a thank-you reward when a
    // rescue succeeds. Users can set it to 0.
    const stored = raw !== null && raw !== "" ? Number(raw) : NaN;
    const bps = Number.isFinite(stored) && stored >= 0 ? stored : useOnboardingStore.getState().feeBps || 300;
    return bps / 100;
  });

  const [alchemyTest, setAlchemyTest] = useState<TestState>({ kind: "idle" });
  const [tgTest, setTgTest] = useState<TestState>({ kind: "idle" });
  const [executorBalance, setExecutorBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const executorAddress = useMemo<Address | null>(() => addressFromPrivateKey(executorKey), [executorKey]);

  const alchemyMissing = alchemyKey.trim() === "";
  const executorMissing = executorKey.trim() === "";
  const executorInvalid = executorKey.trim() !== "" && executorAddress === null;
  const canContinue = !alchemyMissing && !executorMissing && !executorInvalid;

  function persistAll() {
    if (alchemyKey.trim() !== "") {
      localStorage.setItem(ALCHEMY_KEY_STORAGE, alchemyKey.trim());
      setAlchemyKey(alchemyKey.trim());
    } else {
      localStorage.removeItem(ALCHEMY_KEY_STORAGE);
      setAlchemyKey("");
    }

    const feeBps = Math.round(feePct * 100);
    localStorage.setItem(FEE_BPS_STORAGE, String(feeBps));
    setFeeBps(feeBps);

    // Fee receiver is hardcoded to the SafeGPT developer address.
    setFeeReceiver(DEFAULT_FEE_RECEIVER);

    if (executorKey.trim() !== "") localStorage.setItem(EXECUTOR_KEY_STORAGE, executorKey.trim());
    if (tgToken.trim() !== "") localStorage.setItem(TG_TOKEN_STORAGE, tgToken.trim());
    if (tgChat.trim() !== "") localStorage.setItem(TG_CHAT_STORAGE, tgChat.trim());

    if (executorAddress) {
      useOnboardingStore.getState().setExecutor(executorAddress);
    }
  }

  async function runAlchemyTest() {
    if (alchemyKey.trim() === "") return;
    setAlchemyTest({ kind: "testing" });
    const result = await testAlchemyKey(alchemyKey, chainId);
    if (result.ok) {
      const block = result.block ? parseInt(result.block, 16) : null;
      setAlchemyTest({ kind: "ok", detail: `Connected · block ${block ?? "?"}` });
    } else {
      setAlchemyTest({ kind: "error", detail: result.error ?? "Connection failed" });
    }
  }

  function generateExecutor() {
    // 32 random bytes as a hex private key, via the platform crypto.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    setExecutorKey(key);
    setExecutorBalance(null);
    // Persist immediately — a page refresh before "Continue" must not lose a
    // funded executor wallet and strand its gas money.
    localStorage.setItem(EXECUTOR_KEY_STORAGE, key);
  }

  async function checkExecutorBalance() {
    if (!executorAddress) return;
    const rpcUrl = resolveRpcUrl(chainId, alchemyKey);
    if (!rpcUrl) return;
    setBalanceLoading(true);
    const balance = await getEthBalance(executorAddress, rpcUrl, chainId);
    setBalanceLoading(false);
    setExecutorBalance(balance === null ? null : formatEth(balance));
  }

  async function runTelegramTest() {
    if (tgToken.trim() === "" || tgChat.trim() === "") return;
    setTgTest({ kind: "testing" });
    const result = await sendTelegramTest(tgToken, tgChat);
    setTgTest(result.ok ? { kind: "ok", detail: "Test message sent" } : { kind: "error", detail: result.error ?? "Failed" });
  }

  return (
    <StepFrame
      title="Setup Keys & Services"
      subtitle="Configure the API keys and services your protection needs."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton
            onClick={() => {
              if (!canContinue) {
                setShowErrors(true);
                return;
              }
              persistAll();
              onContinue();
            }}
          >
            Continue
          </PrimaryButton>
        </>
      }
    >
      {/* 1. Alchemy API Key */}
      <section
        className={`rounded-xl border p-4 space-y-3 ${
          showErrors && alchemyMissing
            ? "border-accent-red bg-accent-red/5"
            : "border-border bg-bg-tertiary"
        }`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Alchemy API Key</h3>
          <StatusPill state={alchemyTest} idleLabel="Not configured" />
        </div>
        <p className="text-xs text-text-secondary">
          Required for balance scanning. Get a free key at{" "}
          <a href="https://dashboard.alchemy.com" target="_blank" rel="noreferrer" className="text-accent underline">
            dashboard.alchemy.com
          </a>
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={alchemyKey}
            onChange={(e) => {
              setLocalAlchemyKey(e.target.value);
              setAlchemyTest({ kind: "idle" });
            }}
            placeholder="Alchemy API key"
            className={`flex-1 rounded-lg border bg-bg-primary px-3 py-2 text-sm text-text-primary ${
              showErrors && alchemyMissing ? "border-accent-red" : "border-border"
            }`}
          />
          <SecondaryButton onClick={() => void runAlchemyTest()} disabled={alchemyTest.kind === "testing" || alchemyKey.trim() === ""}>
            {alchemyTest.kind === "testing" ? "Testing…" : "Test"}
          </SecondaryButton>
        </div>
        {showErrors && alchemyMissing && (
          <p className="text-xs text-accent-red">Enter an Alchemy API key to continue.</p>
        )}
      </section>

      {/* 2. Executor Bot */}
      <section
        className={`rounded-xl border p-4 space-y-3 ${
          showErrors && (executorMissing || executorInvalid)
            ? "border-accent-red bg-accent-red/5"
            : "border-border bg-bg-tertiary"
        }`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Executor Bot</h3>
          {executorAddress && <StatusPill state={{ kind: "ok", detail: executorAddress }} idleLabel="" />}
        </div>
        <p className="text-xs text-text-secondary">
          The hot wallet that pays gas and triggers rescue. Generate a new one or paste an existing key.
        </p>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={generateExecutor}>Generate Executor Wallet</SecondaryButton>
          {executorAddress && (
            <SecondaryButton onClick={() => void checkExecutorBalance()} disabled={balanceLoading}>
              {balanceLoading ? "Checking…" : "Check Balance"}
            </SecondaryButton>
          )}
        </div>
        <input
          type="password"
          value={executorKey}
          onChange={(e) => {
            setExecutorKey(e.target.value);
            setExecutorBalance(null);
          }}
          onBlur={() => {
            // Persist on blur so a refresh mid-step does not lose a pasted key.
            if (executorKey.trim() !== "") localStorage.setItem(EXECUTOR_KEY_STORAGE, executorKey.trim());
          }}
          placeholder="EXECUTOR_KEY (0x…)"
          className={`w-full rounded-lg border bg-bg-primary px-3 py-2 font-mono text-sm text-text-primary ${
            showErrors && (executorMissing || executorInvalid) ? "border-accent-red" : "border-border"
          }`}
        />
        {showErrors && executorMissing && (
          <p className="text-xs text-accent-red">Enter or generate an executor private key to continue.</p>
        )}
        {showErrors && executorInvalid && (
          <p className="text-xs text-accent-red">
            Invalid private key. A valid key is a 0x-prefixed 32-byte hex string (64 hex characters).
          </p>
        )}
        {executorAddress && !showErrors && (
          <div className="space-y-1">
            <p className="text-xs text-text-secondary">
              Address: <span className="font-mono text-text-primary">{executorAddress}</span>
            </p>
            {executorBalance !== null && (
              <ExecutorBalanceLine balance={executorBalance} address={executorAddress} />
            )}
          </div>
        )}
      </section>

      {/* 3. Telegram Alerts */}
      <section className="rounded-xl border border-border bg-bg-tertiary p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Telegram Alerts (optional)</h3>
          <StatusPill state={tgTest} idleLabel="Not configured" />
        </div>
        <p className="text-xs text-text-secondary">
          Get rescue and alert notifications. Create a bot with{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent underline">
            @BotFather
          </a>
          , then send <code className="rounded bg-bg-secondary px-1">/start</code> to your bot and enter the token
          and chat ID below. You can also skip this and configure it later in Settings.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="password"
            value={tgToken}
            onChange={(e) => {
              setTgToken(e.target.value);
              setTgTest({ kind: "idle" });
            }}
            placeholder="Bot token"
            className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
          />
          <input
            value={tgChat}
            onChange={(e) => {
              setTgChat(e.target.value);
              setTgTest({ kind: "idle" });
            }}
            placeholder="Chat ID"
            className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <SecondaryButton
          onClick={() => void runTelegramTest()}
          disabled={tgTest.kind === "testing" || tgToken.trim() === "" || tgChat.trim() === ""}
        >
          {tgTest.kind === "testing" ? "Sending…" : "Send Test Message"}
        </SecondaryButton>
      </section>

      {/* 4. Rescue Fee */}
      <section className="rounded-xl border border-border bg-bg-tertiary p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Rescue Fee</h3>
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
        <p className="text-xs text-text-secondary">
          This fee is charged on each successful rescue and goes to the SafeGPT developer as a thank-you reward.
          Set to 0 to disable.
        </p>
      </section>
    </StepFrame>
  );
}

function ExecutorBalanceLine({ balance, address }: { balance: string; address: Address }) {
  const funded = Number(balance) >= 0.001;
  if (funded) {
    return <p className="text-xs text-accent-green">✅ Executor funded (balance: {balance} ETH)</p>;
  }
  return (
    <p className="text-xs text-accent-yellow">
      ⚠️ Executor needs at least 0.001 ETH for gas. Send ETH to: <span className="font-mono">{address}</span>
    </p>
  );
}

function StatusPill({ state, idleLabel }: { state: TestState; idleLabel: string }) {
  if (state.kind === "testing") return <span className="text-xs text-text-secondary">Testing…</span>;
  if (state.kind === "ok") return <span className="text-xs text-accent-green">✅ {state.detail}</span>;
  if (state.kind === "error") return <span className="text-xs text-accent-red">❌ {state.detail}</span>;
  if (idleLabel === "") return null;
  return <span className="text-xs text-text-secondary">⚪ {idleLabel}</span>;
}