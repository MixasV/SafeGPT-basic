import { explorerTxUrl } from "../../config/tokens";
import type { RescueBatch, RescueHistoryState, RescueOutcome } from "../../hooks/useRescueEvents";

interface RescueHistoryProps {
  history: RescueHistoryState;
  chainId: number;
  isPro: boolean;
}

const OUTCOME_STYLES: Record<RescueOutcome, { label: string; className: string }> = {
  success: { label: "Success", className: "border-accent-green/40 bg-accent-green/10 text-accent-green" },
  failed: { label: "Failed", className: "border-accent-red/40 bg-accent-red/10 text-accent-red" },
  skipped: { label: "Skipped", className: "border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow" },
};

function whenLabel(timestamp: number | null): string {
  if (timestamp === null) return "time unavailable";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/**
 * Rescue history, reconstructed from vault events.
 *
 * Shows success, failure and skip. A history that only ever says "Success" is
 * how a silent `transferFrom` failure stays invisible — and after an allowance
 * revoke, failures are exactly what the operator needs to see.
 *
 * No "Trigger" row in real mode: the vault never learns which rule fired. Demo
 * Mode shows one so the layout is demonstrable, and it is clearly the only
 * place that data comes from.
 */
export function RescueHistory({ history, chainId, isPro }: RescueHistoryProps) {
  const { batches, isLoading, error, isDemo } = history;

  return (
    <section
      aria-label="Rescue history"
      data-testid="rescue-history"
      className="rounded-2xl border border-border bg-bg-secondary p-5"
    >
      <h2 className="text-sm font-semibold text-text-primary">Rescue history</h2>

      {error !== undefined && (
        <p className="mt-2 text-sm text-accent-red">Could not read rescue events: {error}</p>
      )}

      {!error && isLoading && <p className="mt-2 text-sm text-text-secondary">Loading…</p>}

      {!error && !isLoading && batches.length === 0 && (
        <p className="mt-2 text-sm text-text-secondary" data-testid="rescue-history-empty">
          No rescues recorded. This fills automatically if the bot moves funds.
        </p>
      )}

      {!error && batches.length > 0 && (
        <ul className="mt-3 space-y-3">
          {batches.map((batch) => (
            <RescueBatchCard key={batch.id} batch={batch} chainId={chainId} isPro={isPro} isDemo={isDemo} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RescueBatchCard({
  batch,
  chainId,
  isPro,
  isDemo,
}: {
  batch: RescueBatch;
  chainId: number;
  isPro: boolean;
  isDemo: boolean;
}) {
  const outcome = OUTCOME_STYLES[batch.outcome];

  return (
    <li data-testid="rescue-batch" className="rounded-lg border border-border bg-bg-tertiary p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">Rescue</span>

        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">{whenLabel(batch.timestamp)}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${outcome.className}`}
            data-testid="rescue-outcome"
          >
            {outcome.label}
          </span>
        </div>
      </div>

      {/* Demo-only. The vault does not know the rule, so this can never be
          reconstructed from chain data — see the hook's comment. */}
      {isDemo && batch.trigger !== undefined && (
        <p className="mt-2 text-sm text-text-secondary" data-testid="rescue-trigger">
          Trigger: {batch.trigger}
        </p>
      )}

      <ul className="mt-2 flex flex-wrap gap-2" data-testid="rescue-tokens">
        {batch.events.map((event) => (
          <li
            key={event.id}
            className={`rounded-md border px-2 py-1 text-xs ${
              event.outcome === "success"
                ? "border-border bg-bg-secondary text-text-primary"
                : "border-accent-red/40 bg-accent-red/10 text-accent-red"
            }`}
          >
            {event.symbol} {event.amount}
            {event.skipReason !== undefined && <span className="block text-[10px]">{event.skipReason}</span>}
          </li>
        ))}
      </ul>

      {batch.destination !== undefined && (
        <p className="mt-2 text-xs text-text-secondary">
          Destination <span className="font-mono">{batch.destination}</span>
        </p>
      )}

      <p className="mt-2 text-xs">
        <span className="text-text-secondary">TX </span>
        <a
          className="text-accent underline underline-offset-2"
          href={explorerTxUrl(chainId, batch.txHash)}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="rescue-tx"
        >
          {isPro ? batch.txHash : `${batch.txHash.slice(0, 12)}…`} ↗
        </a>
        {isPro && <span className="ml-2 text-text-secondary">block {batch.blockNumber.toString()}</span>}
      </p>
    </li>
  );
}