import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";

import { DEMO_MODE } from "../../config/demo";
import { DEMO_ADDRESSES } from "../../config/tokens";
import { useMode } from "../../hooks/useMode";
import { useOnboardingStore } from "../../state/onboarding";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepSafeAddressProps {
  onContinue: () => void;
  onBack: () => void;
  protectedWallet: Address | undefined;
}

type Validation = { ok: true } | { ok: false; reason: string };

function validateSafeAddress(value: string, protectedWallet: Address | undefined, useDemoSafe: boolean): Validation {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: "Enter the address where your funds will be rescued to." };
  if (!isAddress(trimmed)) {
    return { ok: false, reason: "Not a valid EVM address. Check for typos or a wrong network." };
  }
  if (protectedWallet && trimmed.toLowerCase() === protectedWallet.toLowerCase()) {
    return { ok: false, reason: "The safe address must be different from the protected wallet." };
  }
  if (useDemoSafe && trimmed.toLowerCase() === DEMO_ADDRESSES.safe.toLowerCase()) return { ok: true };
  return { ok: true };
}

/** Step 3 — Set the address rescued funds are sent to. */
export function StepSafeAddress({ onContinue, onBack, protectedWallet }: StepSafeAddressProps) {
  const mode = useMode();
  const isPro = mode === "pro";
  const stored = useOnboardingStore((state) => state.safeAddress);
  const setSafeAddress = useOnboardingStore((state) => state.setSafeAddress);
  const linked = useOnboardingStore((state) => state.safeAddressLinked);
  const setLinked = useOnboardingStore((state) => state.setSafeAddressLinked);
  const [useDemoSafe, setUseDemoSafe] = useState(DEMO_MODE);

  // Demo Mode pre-fills the field so the wizard can be recorded without typing.
  useEffect(() => {
    if (useDemoSafe && stored === "") setSafeAddress(DEMO_ADDRESSES.safe);
  }, [setSafeAddress, stored, useDemoSafe]);

  const validation = useMemo(
    () => validateSafeAddress(stored, protectedWallet, useDemoSafe),
    [stored, protectedWallet, useDemoSafe],
  );

  return (
    <StepFrame
      title="Set your safe address"
      subtitle="This is where your funds are moved when a rescue is triggered."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onContinue} disabled={!validation.ok}>
            Continue
          </PrimaryButton>
        </>
      }
    >
      <WarningBanner tone="warning">
        Use a DIFFERENT wallet on a DIFFERENT device/seed phrase. Never use the same seed as your protected wallet.
      </WarningBanner>

      {DEMO_MODE && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={useDemoSafe}
            onChange={(event) => {
              setUseDemoSafe(event.target.checked);
              if (event.target.checked) setSafeAddress(DEMO_ADDRESSES.safe);
            }}
          />
          Use the demo safe address
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-text-primary">Safe address</span>
        <input
          value={stored}
          onChange={(event) => setSafeAddress(event.target.value)}
          spellCheck={false}
          placeholder="0x…"
          className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
        />
      </label>

      {stored !== "" && !validation.ok && <p className="text-sm text-accent-red">{validation.reason}</p>}
      {validation.ok && <p className="text-sm text-accent-green">✓ Valid address</p>}

      {isPro && (
        <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">
          <p className="font-medium text-text-primary">Pro options</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>ENS name resolution and address verification are planned for a later release.</li>
            <li>You may point the safe address at an existing Safe multisig.</li>
            <li>
              Changing the safe address later takes effect only after a 72-hour timelock plus a confirmation
              transaction — a stolen owner key cannot redirect a rescue instantly.
            </li>
          </ul>
        </div>
      )}

      {isPro && (
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={linked}
            onChange={(event) => setLinked(event.target.checked)}
            className="mt-1"
          />
          <span>
            Link this safe address to the platform account with a message signature (no transaction, no gas).
            Implemented with the platform authentication in Sprint 7 — safe-wallet login, never the protected wallet.
          </span>
        </label>
      )}
    </StepFrame>
  );
}