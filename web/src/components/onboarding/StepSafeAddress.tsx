import { useCallback, useEffect, useMemo, useState } from "react";
import { useSignMessage } from "wagmi";
import { isAddress, type Address } from "viem";

import { DEMO_MODE } from "../../config/demo";
import { DEMO_ADDRESSES } from "../../config/tokens";
import { useMode } from "../../hooks/useMode";
import { useOnboardingStore } from "../../state/onboarding";
import { StatusBadge } from "../common/StatusBadge";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepSafeAddressProps {
  onContinue: () => void;
  onBack: () => void;
  protectedWallet: Address | undefined;
  /** Safe address to connect for the signature step. */
  safeWalletClient: { signMessage: (args: { message: string }) => Promise<string> } | undefined;
}

type Validation = { ok: true } | { ok: false; reason: string };

function validateSafeAddress(value: string, protectedWallet: Address | undefined): Validation {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: "Enter the address where your funds will be rescued to." };
  if (!isAddress(trimmed)) {
    return { ok: false, reason: "Not a valid EVM address. Check for typos or a wrong network." };
  }
  if (protectedWallet && trimmed.toLowerCase() === protectedWallet.toLowerCase()) {
    return { ok: false, reason: "The safe address must be different from the protected wallet." };
  }
  return { ok: true };
}

/**
 * Message signed by the SAFE wallet to bind it to the platform account
 * (specification section 8). No transaction, no gas.
 *
 * Why the safe wallet and not the protected wallet: the protected wallet is the
 * one whose compromise we are defending against. If signing it granted account
 * access, an attacker holding that key could disable the protection settings and
 * then drain the wallet. The safe wallet lives on a separate seed and device, so
 * it is the least compromisable key available.
 */
function buildLinkMessage(safeAddress: string, chainId: number, domain: string): string {
  return [
    "SafeGPT wants to link this safe address to your account.",
    "",
    `Safe address: ${safeAddress}`,
    `Network: ${domain} (chainId ${chainId})`,
    "",
    "This signature proves control of the safe wallet only. It moves no funds,",
    "grants no transaction authority, and never unlocks your protected wallet.",
    "Weakening protection requires the safe key plus a 24h delay.",
  ].join("\n");
}

type LinkState = "idle" | "signing" | "linked" | "error";

/** Step 3 — Set the address rescued funds are sent to, and link it. */
export function StepSafeAddress({ onContinue, onBack, protectedWallet, safeWalletClient }: StepSafeAddressProps) {
  const mode = useMode();
  const isPro = mode === "pro";
  const stored = useOnboardingStore((state) => state.safeAddress);
  const setSafeAddress = useOnboardingStore((state) => state.setSafeAddress);
  const linked = useOnboardingStore((state) => state.safeAddressLinked);
  const setLinked = useOnboardingStore((state) => state.setSafeAddressLinked);
  const chainId = useOnboardingStore((state) => state.chainId);
  const [useDemoSafe, setUseDemoSafe] = useState(DEMO_MODE);
  const [linkState, setLinkState] = useState<LinkState>(linked ? "linked" : "idle");
  const [linkError, setLinkError] = useState("");
  const [linkedAddress, setLinkedAddress] = useState(linked ? stored : "");

  // Demo Mode pre-fills the field so the wizard can be recorded without typing.
  useEffect(() => {
    if (useDemoSafe && stored === "") setSafeAddress(DEMO_ADDRESSES.safe);
  }, [setSafeAddress, stored, useDemoSafe]);

  const safeWallet = DEMO_MODE ? DEMO_ADDRESSES.safe : stored;

  const { signMessageAsync } = useSignMessage();

  const validation = useMemo(
    () => validateSafeAddress(stored, protectedWallet),
    [stored, protectedWallet],
  );

  const link = useCallback(async () => {
    setLinkError("");
    setLinkState("signing");

    if (DEMO_MODE) {
      // No wallet is available in Demo Mode, so the signature is simulated.
      await new Promise((resolve) => setTimeout(resolve, 500));
      setLinked(true);
      setLinkedAddress(stored.trim());
      setLinkState("linked");
      return;
    }

    try {
      const target = safeWalletClient ?? { signMessage: signMessageAsync };
      await target.signMessage({ message: buildLinkMessage(safeWallet, chainId, window.location.host) });
      setLinked(true);
      setLinkedAddress(stored.trim());
      setLinkState("linked");
    } catch (cause) {
      setLinkState("error");
      setLinkError(cause instanceof Error && cause.message ? cause.message : "The signature was rejected.");
    }
  }, [chainId, safeWallet, safeWalletClient, setLinked, signMessageAsync, stored]);

  // The signature only counts for the address that was signed, so editing the
// field drops the link and forces a fresh one.
const linkedCurrent = linkState === "linked" && linkedAddress.toLowerCase() === stored.trim().toLowerCase();
const continueDisabled = !validation.ok || (isPro && !linkedCurrent);

  return (
    <StepFrame
      title="Set your safe address"
      subtitle="This is where your funds are moved when a rescue is triggered."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onContinue} disabled={continueDisabled}>
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
            onChange={(event) => setUseDemoSafe(event.target.checked)}
          />
          Use the demo safe address
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-text-primary">Safe address</span>
        <input
          value={stored}
          onChange={(event) => {
            setSafeAddress(event.target.value);
            setLinkState("idle");
            setLinked(false);
            setLinkedAddress("");
          }}
          spellCheck={false}
          placeholder="0x…"
          data-testid="safe-address-input"
          className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
        />
      </label>

      {stored !== "" && !validation.ok && <p className="text-sm text-accent-red">{validation.reason}</p>}
      {validation.ok && <p className="text-sm text-accent-green">✓ Valid address</p>}

      {/* The signature is required in Pro mode and available in Beginner mode. */}
      <div className="space-y-3 rounded-lg border border-border bg-bg-tertiary p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Link this safe address</p>
            <p className="text-xs text-text-secondary">
              {isPro ? "Required in Pro mode." : "Optional — recommended."} One message signature, no transaction, no
              gas.
            </p>
          </div>
          {linkedCurrent && <StatusBadge tone="active" label="LINKED" />}
          {linkState === "signing" && <StatusBadge tone="alert" label="SIGNING" />}
        </div>

        <WarningBanner tone="info">
          Platform login uses the SAFE wallet signature, never the protected wallet. Weakening any protection setting
          requires the safe key plus a 24-hour delay — a stolen protected-wallet key cannot disable your own
          protection.
        </WarningBanner>

        {linkError && <p className="text-sm text-accent-red">{linkError}</p>}

        <div className="flex flex-wrap gap-2">
          {DEMO_MODE ? (
            <PrimaryButton onClick={() => void link()} disabled={linkedCurrent || linkState === "signing"}>
              {linkedCurrent ? "Signature captured" : "Simulate signature"}
            </PrimaryButton>
          ) : (
            <PrimaryButton
              onClick={() => void link()}
              disabled={!validation.ok || linkedCurrent || linkState === "signing"}
            >
              {linkState === "signing" ? "Waiting for signature…" : "Sign with the safe wallet"}
            </PrimaryButton>
          )}
        </div>
      </div>

      {isPro && (
        <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">
          <p className="font-medium text-text-primary">Pro options</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>You may point the safe address at an existing Safe multisig.</li>
            <li>
              Changing the safe address later takes effect only after a 72-hour timelock plus a confirmation
              transaction — a stolen owner key cannot redirect a rescue instantly.
            </li>
          </ul>
        </div>
      )}
    </StepFrame>
  );
}