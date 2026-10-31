import { TelegramAlerter } from "../telegram.js";

export class Notifier {
  private readonly tg: TelegramAlerter;

  constructor(config: { telegram?: { enabled?: boolean; botToken?: string; chatId?: string } }) {
    this.tg = new TelegramAlerter({
      botToken: config.telegram?.botToken,
      chatId: config.telegram?.chatId,
    });
  }

  async send(key: string, data: Record<string, string>): Promise<void> {
    const text = formatTemplate(key, data);
    if (!text) return;
    console.log(text.replace(/<[^>]*>/g, ""));
    if (this.tg.isConfigured()) {
      // TelegramAlerter.send expects an Alert; build minimal
      await this.tg.send({
        severity: "INFO",
        rule: key,
        wallet: data.protectedWallet ?? "system",
        reason: text,
        action: "ALERT",
      } as any);
    }
  }
}

function formatTemplate(key: string, data: Record<string, string>): string {
  switch (key) {
    case "BOT_STARTED":
      return `✅ SafeGPT Bot Started\nWallet: ${data.protectedWallet}\nTokens: ${data.tokenCount}\nBalance: ${data.executorBalance} ETH`;
    case "BOT_STOPPED":
      return `⚠️ Bot Stopped\n${data.reason}\n❌ Wallet UNPROTECTED`;
    default:
      return `[${key}] ${JSON.stringify(data)}`;
  }
}
