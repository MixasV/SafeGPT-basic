import { useState } from "react";

import { isAddress, type Address } from "viem";

import { useOnboardingStore } from "../../state/onboarding";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

export function StepExecutorAddress({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const account = useOnboardingStore((s) => s.walletAddress);
  const safeAddress = useOnboardingStore((s) => s.safeAddress);
  const executor = useOnboardingStore((s) => s.executor ?? "0x0000000000000000000000000000000000000000");
  const setExecutor = useOnboardingStore((s) => s.setExecutor ?? (() => {}));
  const [value, setValue] = useState(executor);

  const invalid =
    value !== "0x0000000000000000000000000000000000000000" &&
    (value.toLowerCase() === account.toLowerCase() || value.toLowerCase() === safeAddress.toLowerCase());

  return (
    <StepFrame
      title="Executor (bot) address"
      subtitle="The wallet that pays gas and triggers rescue. Created via CLI."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onContinue} disabled={value === "0x0000000000000000000000000000000000000000" || invalid}>
            Continue
          </PrimaryButton>
        </>
      }
    >
      <p className="text-sm text-text-secondary">
        Run <code className="rounded bg-bg-secondary px-1">npx safegpt-bot init</code> to create an executor wallet, then
        paste its address here. Or run <code className="rounded bg-bg-secondary px-1">safegpt-bot-init.bat</code>.
      </p>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText("npx safegpt-bot init")}
        className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
      >
        Copy command
      </button>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setExecutor(e.target.value as Address);
        }}
        placeholder="0x..."
        className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-sm text-text-primary"
      />
      {value !== "0x0000000000000000000000000000000000000000" && invalid && (
        <p className="text-xs text-accent-red">Executor must differ from protected wallet and safe address.</p>
      )}
      {value !== "0x0000000000000000000000000000000000000000" && !invalid && isAddress(value) && (
        <p className="text-xs text-accent-green">✓ Valid executor address</p>
      )}
    </StepFrame>
  );
}
