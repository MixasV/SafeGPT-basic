import { useEffect, useState, type ReactNode } from "react";
import { trackEvent } from "../../utils/analytics";
import type { Address } from "viem";
import { isAddress } from "viem";

import { useOnboardingStore } from "../../state/onboarding";
import { StatusBadge } from "../common/StatusBadge";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

/**
 * Pro-mode configuration steps, run after protection is already active.
 *
 * These existed in the sidebar with their names but rendered nothing. A user
 * who switched to Pro mode, saw three steps listed, clicked through them, and
 * landed on blank screens — which reads as a broken build, not as unfinished
 * scope.
 *
 * What they collect here is operator LOCAL configuration: it shapes what the
 * bot watches, and it is written to the bot config the user deploys
 * themselves. It does not touch the chain, and it deliberately does not offer
 * anything that weakens protection without a delay — loosening a rule is the
 * kind of change that needs the safe wallet's signature in the platform, which
 * is backend scope.
 */

interface ProStepProps {
  onFinish: () => void;
  onBack: () => void;
}

// ── Whitelist ───────────────────────────────────────────────────────────────

/**
 * The whitelist the bot treats as trusted.
 *
 * WARNING: this list is the difference between "the wallet only ever talks to
 * exchanges I chose" and "any contract the wallet has ever approved can drain
 * it". Every entry is a permanent hole in the protection, which is why the bot
 * logs it and why the dashboard shows how many entries exist.
 */
export function StepWhitelist({ onFinish, onBack }: ProStepProps) {
  const whitelist = useOnboardingStore((state) => state.whitelist);
  const [entry, setEntry] = useState("");

  useEffect(() => {
    trackEvent("pro_step_opened", { step: "whitelist" });
  }, []);

  const trimmed = entry.trim();
  const valid = isAddress(trimmed);
  const already = valid && whitelist.some((item) => item.toLowerCase() === trimmed.toLowerCase());

  function add(): void {
    if (!valid || already) return;
    useOnboardingStore.setState((state) => ({ whitelist: [...state.whitelist, trimmed] }));
    setEntry("");
  }

  return (
    <StepFrame
      title="Trusted addresses"
      subtitle="The bot does not trigger a rescue for transactions to these addresses."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onFinish}>Finish</PrimaryButton>
        </>
      }
    >
      <Warning title="Every entry is a hole in your protection">
        An address you whitelist can move your funds at any time, and the bot will
        not stop it. Add exchanges and contracts you have personally verified.
      </Warning>

      <div className="flex gap-2">
        <input
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          placeholder="0x…"
          aria-label="Whitelisted address"
          data-testid="whitelist-input"
          className="flex-1 rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
        />
        <SecondaryButton onClick={add} disabled={!valid || already}>
          {already ? "Already added" : "Add"}
        </SecondaryButton>
      </div>

      {trimmed !== "" && !valid && (
        <p className="text-xs text-accent-yellow" data-testid="whitelist-invalid">
          Not a valid address.
        </p>
      )}

      <ul className="space-y-2" data-testid="whitelist-list">
        {whitelist.length === 0 && (
          <li className="text-sm text-text-secondary" data-testid="whitelist-empty">
            No trusted addresses yet. Without any, the bot will treat every
            contract interaction as suspicious — which is safer, but noisier.
          </li>
        )}
        {whitelist.map((item) => (
          <li
            key={item}
            className="flex items-center justify-between rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-primary"
          >
            {item}
            <button
              type="button"
              onClick={() =>
                useOnboardingStore.setState((state) => ({
                  whitelist: state.whitelist.filter((candidate) => candidate !== item),
                }))
              }
              className="text-accent-red underline underline-offset-2"
              aria-label={`Remove ${item}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}

// ── Rules ───────────────────────────────────────────────────────────────────

/** Rule settings, mirrored into the bot config file. */
export function StepRules({ onFinish, onBack }: ProStepProps) {
  const rules = useOnboardingStore((state) => state.rules);
  const vaultAddress = useOnboardingStore((state) => state.vaultAddress);

  const setRule = <K extends keyof typeof rules>(key: K, value: (typeof rules)[K]): void => {
    useOnboardingStore.setState((state) => ({ rules: { ...state.rules, [key]: value } }));
  };

  return (
    <StepFrame
      title="Rescue trigger thresholds"
      subtitle="How sensitive the bot is to unusual activity from your wallet."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onFinish}>Finish</PrimaryButton>
        </>
      }
    >
      <ToggleRow
        label="Rescue on an approval to an unknown address"
        description="The standard drainer opening move. Turning this off disables the most common protection."
        checked={rules.rescueOnApproveToUnknown}
        onChange={(value) => setRule("rescueOnApproveToUnknown", value)}
        testId="rule-approve"
      />

      <ToggleRow
        label="Rescue on a transfer to a non-whitelisted address"
        description="Fires when an outgoing transfer goes somewhere you have not approved."
        checked={rules.rescueOnTransferToNonWhitelist}
        onChange={(value) => setRule("rescueOnTransferToNonWhitelist", value)}
        testId="rule-transfer"
      />

      <ToggleRow
        label="Rescue on a contract call to an unknown address"
        description="Catches DEX swaps and arbitrary contract interaction. The noisiest rule."
        checked={rules.rescueOnContractCallToNonWhitelist}
        onChange={(value) => setRule("rescueOnContractCallToNonWhitelist", value)}
        testId="rule-call"
      />

      <ToggleRow
        label="Rescue on an EIP-7702 delegation"
        description="A delegation hands a contract full authority over the wallet."
        checked={rules.rescueOnEIP7702Delegation}
        onChange={(value) => setRule("rescueOnEIP7702Delegation", value)}
        testId="rule-delegation"
      />

      <div className="rounded-lg border border-border bg-bg-tertiary p-4">
        <p className="text-sm font-medium text-text-primary">Mass transfers</p>
        <p className="mt-1 text-xs text-text-secondary">
          Rescue after more than {rules.massTransfersMax} outgoing transactions within{" "}
          {rules.massTransfersWindowMin} minutes.
        </p>
        <div className="mt-3 flex gap-4">
          <NumberField
            label="Max transfers"
            value={rules.massTransfersMax}
            onChange={(value) => setRule("massTransfersMax", value)}
            testId="rule-mass-count"
          />
          <NumberField
            label="Window (minutes)"
            value={rules.massTransfersWindowMin}
            onChange={(value) => setRule("massTransfersWindowMin", value)}
            testId="rule-mass-window"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg-tertiary p-4">
        <p className="text-sm font-medium text-text-primary">Allowance revoked</p>
        <p className="mt-1 text-xs text-text-secondary">
          On revoke, raise an alert and watch for {rules.revokeGracePeriodMin} minutes. This never
          rescues on its own — a rescue would need an allowance that no longer exists.
        </p>
        <div className="mt-3 max-w-[12rem]">
          <NumberField
            label="Grace period (minutes)"
            value={rules.revokeGracePeriodMin}
            onChange={(value) => setRule("revokeGracePeriodMin", value)}
            testId="rule-grace"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-bg-tertiary p-4 text-xs text-text-secondary">
        <p className="font-medium text-text-primary">Applies to</p>
        <p className="mt-1 break-all font-mono">{vaultAddress === "" ? "no vault deployed" : vaultAddress}</p>
        <p className="mt-2">
          These settings are written to the bot configuration. The bot reads them at startup; changes
          apply on the next run.
        </p>
      </div>
    </StepFrame>
  );
}

// ── Alerts ──────────────────────────────────────────────────────────────────

/** Alert channel setup. Values are saved to the bot config, not sent anywhere. */
export function StepAlerts({ onFinish, onBack }: ProStepProps) {
  const alerts = useOnboardingStore((state) => state.alertsConfig);

  const setAlerts = (patch: Partial<typeof alerts>): void => {
    useOnboardingStore.setState((state) => ({ alertsConfig: { ...state.alertsConfig, ...patch } }));
  };

  return (
    <StepFrame
      title="Alert channels"
      subtitle="How the bot tells you it acted. Telegram is the primary channel."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onFinish}>Finish</PrimaryButton>
        </>
      }
    >
      <section className="rounded-lg border border-border bg-bg-tertiary p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Telegram</p>
            <p className="mt-1 text-xs text-text-secondary">
              The channel that reaches you at 3am. Create a bot with @BotFather, send it a message,
              then read your chat id from <span className="font-mono">api.telegram.org/bot…/getUpdates</span>.
            </p>
          </div>
          <StatusBadge
            tone={alerts.telegramBotToken === "" ? "neutral" : "active"}
            label={alerts.telegramBotToken === "" ? "NOT SET" : "SET"}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            label="Bot token"
            value={alerts.telegramBotToken}
            placeholder="12345:ABC…"
            onChange={(value) => setAlerts({ telegramBotToken: value })}
            testId="alerts-tg-token"
          />
          <TextField
            label="Chat id"
            value={alerts.telegramChatId}
            placeholder="-1001234567890"
            onChange={(value) => setAlerts({ telegramChatId: value })}
            testId="alerts-tg-chat"
          />
        </div>

        <p className="mt-2 text-xs text-text-secondary" data-testid="alerts-tg-hint">
          Tokens are never stored in a shared place — they go into your own bot configuration file.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-bg-tertiary p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Webhook</p>
            <p className="mt-1 text-xs text-text-secondary">Optional secondary channel.</p>
          </div>
          <StatusBadge
            tone={alerts.webhookUrl === "" ? "neutral" : "active"}
            label={alerts.webhookUrl === "" ? "NOT SET" : "SET"}
          />
        </div>

        <div className="mt-3">
          <TextField
            label="Webhook URL"
            value={alerts.webhookUrl}
            placeholder="https://hooks.example/safegpt"
            onChange={(value) => setAlerts({ webhookUrl: value })}
            testId="alerts-webhook"
          />
        </div>
      </section>

      <p className="text-xs text-text-secondary">
        The bot always logs to its console as well, so alerts are never lost when both channels are
        unreachable.
      </p>
    </StepFrame>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 p-4 text-sm">
      <p className="font-medium text-accent-yellow">{title}</p>
      <p className="mt-1 text-text-secondary">{children}</p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-bg-tertiary p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
        className="mt-1 accent-accent"
      />
      <span>
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        <span className="mt-1 block text-xs text-text-secondary">{description}</span>
      </span>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <label className="block text-xs text-text-secondary">
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (!Number.isNaN(next) && next >= 1) onChange(next);
        }}
        data-testid={testId}
        className="mt-1 w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="block text-xs text-text-secondary">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className="mt-1 w-full rounded-md border border-border bg-bg-secondary px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
      />
    </label>
  );
}

/** Re-exported so the step list stays in one place. */
export const PRO_STEP_COMPONENTS = {
  whitelist: StepWhitelist,
  rules: StepRules,
  alerts: StepAlerts,
} as const;

export type { Address };