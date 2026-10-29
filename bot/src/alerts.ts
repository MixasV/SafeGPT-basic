import type { Alert, AlertAction, RuleId, Severity } from "./types.js";

/**
 * Alert delivery.
 *
 * An alerting failure must never become a protection failure. If the webhook is
 * down, the bot still has to keep watching and still has to keep rescuing, so
 * every delivery path swallows its errors after writing to the console — the
 * console is the durable record and the webhook is a convenience.
 */

export interface AlertSink {
  deliver(alert: Alert): Promise<void>;
}

/** Structured console output. One line per alert, readable at 3am. */
export class ConsoleAlerter implements AlertSink {
  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async deliver(alert: Alert): Promise<void> {
    const hash = alert.txHash ? ` tx=${alert.txHash}` : "";
    const error = alert.error ? ` error="${alert.error}"` : "";
    this.write(
      `[${new Date(alert.timestamp).toISOString()}] ${alert.severity} ${alert.action} ` +
        `${alert.rule} wallet=${alert.wallet}${hash} — ${alert.reason}${error}`,
    );
  }
}

/** Posts a JSON payload to a Slack-compatible / generic webhook. */
export class WebhookAlerter implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 5_000,
  ) {}

  async deliver(alert: Alert): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: formatSlack(alert) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`webhook responded ${response.status} ${response.statusText}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Fans out to several sinks, and never lets one sink break the others. */
export class CompositeAlerter implements AlertSink {
  constructor(private readonly sinks: AlertSink[], private readonly onError?: (error: unknown) => void) {}

  async deliver(alert: Alert): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.deliver(alert);
        } catch (error) {
          this.onError?.(error);
        }
      }),
    );
  }
}

/**
 * Builds an alert. Kept separate from delivery so the monitor can emit alerts
 * for conditions it detects itself (reconnect failures, executor exhaustion)
 * without duplicating the payload shape.
 */
export function buildAlert(params: {
  wallet: string;
  rule: RuleId | "NONE";
  severity: Severity;
  reason: string;
  action: AlertAction;
  // `| undefined` keeps the call sites honest under exactOptionalPropertyTypes:
  // forwarding an optional field through must not widen the signature.
  txHash?: string | undefined;
  error?: string | undefined;
  now?: number | undefined;
}): Alert {
  const alert: Alert = {
    timestamp: params.now ?? Date.now(),
    wallet: params.wallet,
    rule: params.rule,
    severity: params.severity,
    reason: params.reason,
    action: params.action,
  };
  if (params.txHash !== undefined) alert.txHash = params.txHash;
  if (params.error !== undefined) alert.error = params.error;
  return alert;
}

function formatSlack(alert: Alert): string {
  const hash = alert.txHash ? ` (tx ${alert.txHash})` : "";
  return `*${alert.severity}* ${alert.action} — ${alert.rule} on \`${alert.wallet}\`${hash}\n${alert.reason}${
    alert.error ? `\nerror: ${alert.error}` : ""
  }`;
}