import { createHmac } from "node:crypto";

import type { Alert, AlertAction, AlertKind, RescueReport, RuleId, Severity } from "./types.js";

/**
 * Alert delivery.
 *
 * An alerting failure must never become a protection failure. If a channel is
 * down, the bot still has to keep watching and still has to keep rescuing, so
 * every delivery path swallows its errors after reporting them — the console
 * is the durable record and every other channel is a convenience.
 */

/** The sink the monitor writes to. */
export interface AlertSink {
  deliver(alert: Alert): Promise<void>;
}

/**
 * Builds an alert.
 *
 * Kept separate from delivery so the monitor can emit alerts for conditions it
 * detects itself (reconnect failures, executor exhaustion) without duplicating
 * the payload shape. `| undefined` on the optional fields keeps the call sites
 * honest under `exactOptionalPropertyTypes`: forwarding an absent field through
 * must not widen the signature.
 */
export function buildAlert(params: {
  wallet: string;
  kind: AlertKind;
  rule: RuleId | "NONE";
  severity: Severity;
  reason: string;
  action: AlertAction;
  txHash?: string | undefined;
  error?: string | undefined;
  rescue?: RescueReport | undefined;
  now?: number | undefined;
}): Alert {
  const alert: Alert = {
    timestamp: params.now ?? Date.now(),
    wallet: params.wallet,
    kind: params.kind,
    rule: params.rule,
    severity: params.severity,
    reason: params.reason,
    action: params.action,
  };
  if (params.txHash !== undefined) alert.txHash = params.txHash;
  if (params.error !== undefined) alert.error = params.error;
  if (params.rescue !== undefined) alert.rescue = params.rescue;
  return alert;
}

/**
 * The platform alerter: every alert goes to the backend.
 *
 * WHY NOT TELEGRAM FROM HERE
 * --------------------------
 * The managed bot runs on our infrastructure, on a schedule, for many users.
 * Telegram would mean one shared bot token for every customer's alerts —
 * every customer would see every other customer's wallet addresses, and our
 * token would be one compromised webhook away from a data breach.
 *
 * So the bot posts to the backend, and the backend decides how to reach the
 * user. The user gets their own Telegram chat, their own webhook, their own
 * email. The isolation happens at the service, not in the bot.
 *
 * The delivery is authenticated with an HMAC over the raw body, so the
 * backend can tell that a delivery came from us and was not altered on the
 * way. The event id makes a retry idempotent: the same alert delivered twice
 * is stored once.
 */
export interface BackendAlerterOptions {
  /** The backend's base URL. */
  baseUrl: string;
  /** The bot's API key. Sent as a bearer token. */
  apiKey: string;
  /** Shared secret for the HMAC. */
  secret: string;
  /** The wallet the alert belongs to, so the backend can file it. */
  walletId?: string;
  /** Where a failure is reported. */
  onError?: (message: string) => void;
}

export class BackendAlerter implements AlertSink {
  constructor(private readonly options: BackendAlerterOptions) {}

  async deliver(alert: Alert): Promise<void> {
    const body = JSON.stringify({
      kind: alert.kind,
      rule: alert.rule,
      severity: alert.severity,
      action: alert.action,
      reason: alert.reason,
      ...(alert.txHash === undefined ? {} : { txHash: alert.txHash }),
      ...(alert.error === undefined ? {} : { error: alert.error }),
      ...(alert.rescue === undefined ? {} : { rescue: alert.rescue }),
      ...(this.options.walletId === undefined ? {} : { walletId: this.options.walletId }),
      timestamp: alert.timestamp,
    });

    const timestamp = String(Date.now());
    const signature = createHmac("sha256", this.options.secret).update(`${timestamp}.${body}`).digest("hex");
    const eventId = `evt-${alert.timestamp}-${alert.rule}-${alert.txHash ?? "no-tx"}`;

    try {
      const response = await fetch(`${this.options.baseUrl}/api/webhook/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
          "x-safegpt-signature": signature,
          "x-safegpt-timestamp": timestamp,
          "x-safegpt-event-id": eventId,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`The backend answered ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      // A failed delivery is logged and the monitor carries on. The bot that
      // stops watching because a webhook was down has turned a delivery
      // problem into an unprotected wallet.
      this.options.onError?.(`alert delivery failed: ${(error as Error).message}`);
    }
  }
}

/** Writes alerts to the console. The durable record, and always present. */
export class ConsoleAlerter implements AlertSink {
  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async deliver(alert: Alert): Promise<void> {
    const parts = [
      `[${new Date(alert.timestamp).toISOString()}]`,
      alert.severity,
      alert.action,
      alert.rule,
      `wallet=${alert.wallet}`,
      alert.txHash === undefined ? "" : `tx=${alert.txHash}`,
      `— ${alert.reason}`,
    ];
    this.write(parts.filter((part) => part !== "").join(" "));
  }
}

/** Delivers to several sinks. One failing does not stop the others. */
export class CompositeAlerter implements AlertSink {
  constructor(
    private readonly sinks: AlertSink[],
    private readonly onError: (message: string) => void = () => {},
  ) {}

  async deliver(alert: Alert): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.deliver(alert);
      } catch (error) {
        this.onError(`alert delivery failed: ${(error as Error).message}`);
      }
    }
  }
}

/**
 * Posts a JSON payload to a Slack-compatible / generic webhook.
 *
 * This is the self-hosted counterpart to `BackendAlerter`: a single operator
 * points it at their own Slack / Discord / Mattermost incoming webhook and
 * gets a human-readable line per alert, with no backend in between.
 */
export class WebhookAlerter implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 5_000,
    private readonly onError: (message: string) => void = () => {},
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
    } catch (error) {
      this.onError(`webhook alert delivery failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Telegram alerter: sends alerts directly to the user's Telegram chat.
 *
 * The bot holds the Telegram bot token in its environment. The chat id is
 * supplied by the caller (the self-hosted config carries one chat id; the
 * platform resolves it per wallet). When no chat id is available the alert is
 * silently skipped — a missing channel must never stop a rescue.
 */
export interface TelegramAlerterOptions {
  /** The Telegram bot token. */
  token: string;
  /** Returns the chat id for a given wallet id, or undefined if not linked. */
  getChatId: (walletId: string) => string | undefined;
  /** Where a failure is reported. */
  onError?: (message: string) => void;
}

export class TelegramAlerter implements AlertSink {
  constructor(private readonly options: TelegramAlerterOptions) {}

  async deliver(alert: Alert): Promise<void> {
    const token = this.options.token;
    if (token.trim() === "") return;

    const chatId = this.options.getChatId(alert.wallet);
    if (!chatId) {
      // No linked chat for this wallet; silently skip.
      return;
    }

    const text = formatTelegram(alert);

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
      });

      if (!response.ok) {
        throw new Error(`Telegram API returned ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      this.options.onError?.(`Telegram alert delivery failed: ${(error as Error).message}`);
    }
  }
}

function formatSlack(alert: Alert): string {
  const hash = alert.txHash ? ` (tx ${alert.txHash})` : "";
  return `*${alert.severity}* ${alert.action} — ${alert.rule} on \`${alert.wallet}\`${hash}\n${alert.reason}${
    alert.error ? `\nerror: ${alert.error}` : ""
  }`;
}

function formatTelegram(alert: Alert): string {
  const lines = [
    "🚨 *SafeGPT Rescue Alert*",
    `*Wallet:* ${alert.wallet}`,
    `*Rule:* ${alert.rule}`,
    `*Severity:* ${alert.severity}`,
    `*Action:* ${alert.action}`,
    `*Reason:* ${alert.reason}`,
  ];
  if (alert.txHash) lines.push(`*Tx:* \`${alert.txHash}\``);
  if (alert.error) lines.push(`*Error:* \`${alert.error}\``);
  lines.push(`*Time:* ${new Date(alert.timestamp).toISOString()}`);
  return lines.join("\n");
}