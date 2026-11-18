import { useEffect, useState } from "react";

import { isAddress, type Address } from "viem";

import { useOnboardingStore } from "../../state/onboarding";
import { formatEth, getEthBalance, resolveRpcUrl } from "../../lib/integrations";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

const ALCHEMY_KEY_STORAGE = "safegpt_alchemy_key";

/** Minimum executor balance required to pay for rescue gas. */
const MIN_EXECUTOR_ETH = 0.001;

/**
 * Shows the executor bot address derived from the key entered in "Setup Keys"
 * and verifies it is funded on the CURRENT network.
 *
 * This step is READ-ONLY for the address: the executor key was already
 * collected (or generated) in StepSetupKeys, and the address is derived from
 * it there. Asking the user to paste the address again would be redundant.
 *
 * BLOCKING: the user cannot continue until the executor has at least
 * 0.001 ETH on the chain being configured. A rescue that cannot pay for gas
 * is worse than no rescue — it would fail at the worst possible moment.
 */
export function StepExecutorAddress({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const account = useOnboardingStore((s) => s.walletAddress);
  const safeAddress = useOnboardingStore((s) => s.safeAddress);
  const executor = useOnboardingStore((s) => s.executor);
  const chainId = useOnboardingStore((s) => s.chainId);

  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState(false);

  const hasExecutor = executor !== undefined && executor !== "" && isAddress(executor);

  useEffect(() => {
    if (!hasExecutor) return;
    const alchemyKey = localStorage.getItem(ALCHEMY_KEY_STORAGE) ?? "";
    const rpcUrl = resolveRpcUrl(chainId, alchemyKey);
    if (!rpcUrl) {
      setBalanceError(true);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    setBalanceError(false);
    getEthBalance(executor as Address, rpcUrl, chainId).then((wei) => {
      if (cancelled) return;
      setBalanceLoading(false);
      if (wei === null) {
        setBalanceError(true);
        setBalance(null);
      } else {
        setBalance(formatEth(wei));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasExecutor, executor, chainId]);

  const conflictsWithAccount = hasExecutor && executor.toLowerCase() === account.toLowerCase();
  const conflictsWithSafe = hasExecutor && executor.toLowerCase() === safeAddress.toLowerCase();
  const invalid = conflictsWithAccount || conflictsWithSafe;

  const funded = balance !== null && Number(balance) >= MIN_EXECUTOR_ETH;
  const canContinue = hasExecutor && !invalid && funded && !balanceLoading;

  return (
    <StepFrame
      title="Executor (bot) wallet"
      subtitle="The hot wallet that pays gas and triggers rescue. Derived from your executor key."
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onContinue} disabled={!canContinue}>
            Continue
          </PrimaryButton>
        </>
      }
    >
      {!hasExecutor ? (
        <div className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 p-4 text-sm text-text-secondary">
          <p className="font-medium text-text-primary">No executor key configured</p>
          <p className="mt-1">
            Go back to <strong>Setup Keys &amp; Services</strong> and either generate an executor wallet or paste an
            existing <code className="rounded bg-bg-secondary px-1">EXECUTOR_KEY</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-bg-tertiary p-4">
            <p className="text-xs text-text-secondary">Executor address (derived from your key)</p>
            <p className="mt-1 break-all font-mono text-sm text-text-primary">{executor}</p>
          </div>

          {balanceLoading && <p className="text-xs text-text-secondary">Checking balance on chain {chainId}…</p>}

          {balanceError && (
            <div className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 p-3 text-sm text-accent-yellow">
              <p>Could not read the executor balance.</p>
              <p className="mt-1 text-xs">
                Check your Alchemy key and RPC endpoint in Setup Keys, then try again.
              </p>
            </div>
          )}

          {balance !== null && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                funded
                  ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
                  : "border-accent-red/40 bg-accent-red/10 text-accent-red"
              }`}
            >
              {funded ? (
                <p>✅ Executor funded — balance: {balance} ETH on chain {chainId}</p>
              ) : (
                <div>
                  <p>
                    ❌ Executor balance too low: {balance} ETH (need at least {MIN_EXECUTOR_ETH} ETH)
                  </p>
                  <p className="mt-1 text-xs">
                    Send ETH to <span className="font-mono">{executor}</span> on the network you are configuring
                    (chain {chainId}), then wait for the balance to update.
                  </p>
                </div>
              )}
            </div>
          )}

          {conflictsWithAccount && (
            <p className="text-xs text-accent-red">Executor must differ from the protected wallet.</p>
          )}
          {conflictsWithSafe && (
            <p className="text-xs text-accent-red">Executor must differ from the safe address.</p>
          )}

          <p className="text-xs text-text-secondary">
            The private key for this address is stored locally and will be included in the downloaded{" "}
            <code className="rounded bg-bg-secondary px-1">config.yaml</code>. Keep it private.
          </p>
        </div>
      )}
    </StepFrame>
  );
}