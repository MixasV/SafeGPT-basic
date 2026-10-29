import { formatEther } from "viem";

import { explorerAddressUrl } from "../../config/tokens";
import { beginnerSummary, proSummary, type ProtectionStatus } from "../../dashboard/status";

interface ProtectionStatusProps {
  status: ProtectionStatus;
  isPro: boolean;
  chainId: number;
  vaultAddress: `0x${string}` | undefined;
  executorAddress: `0x${string}` | undefined;
  executorBalance: bigint;
  isLoading: boolean;
}

/**
 * The headline. One number a user can act on, above everything else.
 *
 * Beginner mode shows the state and a sentence, nothing more. Pro mode adds the
 * breakdown, because someone running a vault wants to see which token is
 * stranded and how much gas the executor has left.
 */

const LEVEL_STYLES = {
  active: {
    dot: "bg-accent-green",
    text: "text-accent-green",
    border: "border-accent-green/40",
    background: "bg-accent-green/10",
  },
  attention: {
    dot: "bg-accent-yellow",
    text: "text-accent-yellow",
    border: "border-accent-yellow/40",
    background: "bg-accent-yellow/10",
  },
  compromised: {
    dot: "bg-accent-red",
    text: "text-accent-red",
    border: "border-accent-red/50",
    background: "bg-accent-red/10",
  },
} as const;

export function ProtectionStatusPanel({
  status,
  isPro,
  chainId,
  vaultAddress,
  executorAddress,
  executorBalance,
  isLoading,
}: ProtectionStatusProps) {
  const style = LEVEL_STYLES[status.level];

  return (
    <section
      aria-label="Protection status"
      data-testid="protection-status"
      data-level={status.level}
      className={`rounded-2xl border ${style.border} ${style.background} p-6`}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`h-4 w-4 rounded-full ${style.dot} ${isLoading ? "animate-pulse" : ""}`} />
        <h1 className={`text-2xl font-semibold ${style.text}`}>{status.headline}</h1>
      </div>

      <p className="mt-2 text-sm text-text-secondary">
        {isPro ? proSummary(status) : beginnerSummary(status)}
      </p>

      {isPro && (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3" data-testid="status-breakdown">
          <div className="rounded-lg border border-border bg-bg-tertiary p-3">
            <dt className="text-xs uppercase tracking-wide text-text-secondary">Core assets protected</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary">
              {status.counts.protected} / {status.counts.core}
            </dd>
          </div>

          <div className="rounded-lg border border-border bg-bg-tertiary p-3">
            <dt className="text-xs uppercase tracking-wide text-text-secondary">Executor balance</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary" data-testid="executor-balance">
              {Number(formatEther(executorBalance)).toFixed(4)} ETH
            </dd>
            {executorAddress !== undefined && (
              <dd className="mt-1 truncate font-mono text-xs text-text-secondary" title={executorAddress}>
                {executorAddress}
              </dd>
            )}
          </div>

          <div className="rounded-lg border border-border bg-bg-tertiary p-3">
            <dt className="text-xs uppercase tracking-wide text-text-secondary">Vault</dt>
            <dd className="mt-1 text-sm">
              {vaultAddress === undefined ? (
                <span className="text-text-secondary">Not deployed</span>
              ) : (
                <a
                  className="text-accent underline underline-offset-2"
                  href={explorerAddressUrl(chainId, vaultAddress)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View on explorer
                </a>
              )}
            </dd>
          </div>
        </dl>
      )}

      {status.reasons.length > 0 && isPro && (
        <ul className="mt-4 space-y-1 text-xs text-text-secondary" data-testid="status-reasons">
          {status.reasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}