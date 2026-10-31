export function startTelegramListener(
  token: string,
  chatId: string,
  getStatus: () => Promise<{ protectedWallet: string; vaultAddress: string; executorBalance: string; executorAddress: string; tokenCount: number; tokens: { symbol: string; balance: string; hasAllowance: boolean }[]; uptime: string }>,
): void {
  let offset = 0;
  const poll = async () => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=1`);
      const data = (await res.json()) as { ok: boolean; result: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
      if (!data.ok) return;
      for (const u of data.result) {
        offset = u.update_id + 1;
        if (String(u.message?.chat?.id) !== chatId) continue;
        const text = u.message?.text;
        if (!text?.startsWith("/")) continue;
        const reply = await handleCommand(text, await getStatus());
        await sendMessage(token, chatId, reply);
      }
    } catch {
      // ignore
    }
  };
  setInterval(poll, 3000);
}

async function handleCommand(text: string, status: any): Promise<string> {
  switch (text.split(" ")[0]) {
    case "/status":
      return `🛡️ SafeGPT Status\nWallet: ${status.protectedWallet}\nVault: ${status.vaultAddress ? "✅" : "❌"}\nBot wallet: ${status.executorBalance} ETH\nTokens: ${status.tokenCount} protected`;
    case "/balance":
      return `Bot wallet: ${status.executorBalance} ETH\nAddress: ${status.executorAddress}`;
    case "/tokens":
      return (status.tokens ?? []).map((t: any) => `${t.hasAllowance ? "✅" : "❌"} ${t.symbol}: ${t.balance}`).join("\n") || "No tokens configured";
    case "/help":
      return "/status — protection status\n/balance — bot wallet ETH\n/tokens — protected tokens\n/help — this message";
    default:
      return "Unknown command. /help for list.";
  }
}

async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}
