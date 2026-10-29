import type { AlertAction, AlertSeverity, DemoAlert } from "../../mocks/dashboard-mocks";

interface AlertFeedProps {
  alerts: DemoAlert[];
  isDemo: boolean;
  isPro: boolean;
  /** Present in real mode too, even though the list is always empty there. */
  hasBotConfigured: boolean;
}

const SEVERITY_STYLES: Record<AlertSeverity, { dot: string; badge: string }> = {
  critical: { dot: "bg-accent-red", badge: "border-accent-red/40 bg-accent-red/10 text-accent-red" },
  high: { dot: "bg-accent-yellow", badge: "border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow" },
  info: { dot: "bg-accent-green", badge: "border-accent-green/40 bg-accent-green/10 text-accent-green" },
};

const ACTION_LABELS: Record<AlertAction, string> = {
  rescue: "Rescue sent",
  alert: "Alert only",
  none: "No action needed",
};

function relativeTime(minutesAgo: number): string {
  if (minutesAgo < 1) return "just now";
  if (minutesAgo < 60) return `${Math.round(minutesAgo)} min ago`;
  const hours = Math.round(minutesAgo / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Incident feed.
 *
 * In Demo Mode this shows fixtures. In normal operation it is ALWAYS empty, and
 * it says so plainly rather than showing a fake "all quiet" — the bot emits
 * alerts from its own process and there is no channel from it to this page yet.
 * An empty feed that looks like "nothing happened" would be a lie; an empty feed
 * that explains why is honest.
 *
 * Rule IDs are Pro-only. "R1_APPROVE_UNKNOWN" tells an operator nothing about
 * what happened; the plain sentence does.
 */
export function AlertFeed({ alerts, isDemo, isPro, hasBotConfigured }: AlertFeedProps) {
  return (
    <section
      aria-label="Recent activity"
      data-testid="alert-feed"
      className="rounded-2xl border border-border bg-bg-secondary p-5"
    >
      <h2 className="text-sm font-semibold text-text-primary">Recent activity</h2>

      {!isDemo && (
        <p className="mt-2 text-sm text-text-secondary" data-testid="alert-feed-empty">
          Alerts appear here once the bot is connected. The bot runs as a separate process and reports
          directly to you — see the README for setup.
          {!hasBotConfigured && " No protection contract is configured yet."}
        </p>
      )}

      {isDemo && alerts.length === 0 && (
        <p className="mt-2 text-sm text-text-secondary">No activity recorded.</p>
      )}

      {isDemo && alerts.length > 0 && (
        <ul className="mt-3 space-y-3">
          {alerts.map((alert) => {
            const style = SEVERITY_STYLES[alert.severity];
            return (
              <li
                key={alert.id}
                data-testid="alert-item"
                className="flex items-start gap-3 rounded-lg border border-border bg-bg-tertiary p-3"
              >
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
                      {alert.severity}
                    </span>
                    <span className="text-xs text-text-secondary">{relativeTime(alert.minutesAgo)}</span>
                    {isPro && (
                      <code className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-secondary" data-testid="alert-rule-id">
                        {alert.ruleId}
                      </code>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-text-primary">{alert.description}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">{ACTION_LABELS[alert.action]}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}