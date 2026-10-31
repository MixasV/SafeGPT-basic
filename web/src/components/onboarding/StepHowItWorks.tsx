export function StepHowItWorks({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">How it works</h2>
      <p className="text-sm text-text-secondary">
        SafeGPT rescues your funds to a safe address when a drainer attacks. You need 4 addresses: protected wallet, safe wallet, executor wallet, fee receiver. Costs: gas only, no subscription.
      </p>
      <button onClick={onContinue} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
        Continue
      </button>
    </div>
  );
}
