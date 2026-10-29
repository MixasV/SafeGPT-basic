import type { Alert } from "./types.js";

/**
 * Telegram Bot API notifier.
 *
 * Telegram is the PRIMARY alert channel, not an extra. A rescue that fires at
 * 3am is worth nothing if the operator finds out the next morning, and most
 * people do not keep a browser tab open all night. Webhooks cover the rest.
 *
 *   POST https://api.telegram.org/bot<token>/sendMessage
 *
 * Never throws. A Telegram outage must not stop a rescue, and must not stop the
 * other channels either — every delivery path in the bot degrades to a log line
 * instead of propagating, because the console is the durable record.
 */

const API_BASE = "https://api.telegram.org";

export interface TelegramOptions {
  /** Bot token from @BotFather. Absent means the channel is not configured. */
  botToken?: string | undefined;
  chatId?: string | undefined;
  timeoutMs?: number;
}

export class TelegramAlerter {
  private readonly botToken: string | undefined;
  private readonly chatId: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: TelegramOptions) {
    this.botToken = options.botToken?.trim() || undefined;
    this.chatId = options.chatId?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  /** True when both a token and a chat id are configured. */
  isConfigured(): boolean {
    return this.botToken !== undefined && this.chatId !== undefined;
  }

  /**
   * Sends an alert.
   *
   * @returns true when Telegram accepted it. false means skipped or failed, and
   *          the caller decides what else to try — never the other way round.
   */
  async send(alert: Alert): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${API_BASE}/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: formatAlert(alert),
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`[telegram] ${response.status} ${response.statusText} ${body.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`[telegram] ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Escape for Telegram's legacy Markdown parser.
 *
 * Telegram has no HTML entity for a bare underscore, so wrapping in HTML and
 * escaping is more predictable than Markdown here — an unescaped underscore in
 * a token symbol would otherwise be parsed as emphasis and silently mangle the
 * message.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SEVERITY_EMOJI: Record<Alert["severity"], string> = {
  CRITICAL: "🚨",
  HIGH: "⚠️",
  MEDIUM: "ℹ️",
};

/** One message per alert: short enough to read on a lock screen. */
export function formatAlert(alert: Alert): string {
  const icon = SEVERITY_EMOJI[alert.severity];
  const lines = [
    `${icon} <b>${escapeHtml(alert.severity)}</b> · ${escapeHtml(alert.rule)}`,
    `Wallet: <code>${escapeHtml(alert.wallet)}</code>`,
  ];

  if (alert.txHash !== undefined) lines.push(`Tx: <code>${escapeHtml(alert.txHash)}</code>`);
  lines.push("", escapeHtml(alert.reason));

  if (alert.action === "RESCUE") lines.push("", `Action: ${escapeHtml(alert.action)}`);
  if (alert.error !== undefined) lines.push(`Error: ${escapeHtml(alert.error)}`);

  return lines.join("\n");
}

/**
 * The variant used for the Markdown fallback the bot ships.
 * Kept next to `formatAlert` so the two cannot drift.
 */
export const TELEGRAM_SETUP_HINT =
  "Telegram alerts need a bot token and a chat id in the config: " +
  "telegramBotToken: ENV:TELEGRAM_BOT_TOKEN, telegramChatId: ENV:TELEGRAM_CHAT_ID";