const TG_API = "https://api.telegram.org/bot";

export async function setupTelegram(): Promise<void> {
  const token = await prompt("Paste your bot token:");
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token.trim())) {
    console.error("Invalid token format");
    process.exit(1);
  }
  const meRes = await fetch(`${TG_API}${token.trim()}/getMe`);
  const me = (await meRes.json()) as { ok: boolean; result?: { username: string } };
  if (!me.ok || !me.result) {
    console.error("Invalid token");
    process.exit(1);
  }
  const botUsername = me.result.username;
  console.log(`Bot verified: @${botUsername}`);
  console.log(`Open https://t.me/${botUsername} and send /start`);

  const chatId = await waitForStart(token.trim());
  console.log(`Chat ID: ${chatId}`);

  await fetch(`${TG_API}${token.trim()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: "SafeGPT: Notifications connected!" }),
  });

  console.log("Telegram configured. Add to config.yaml manually:");
  console.log(`notifications:\n  telegram:\n    enabled: true\n    botToken: "${token.trim()}"\n    chatId: "${chatId}"`);
}

async function waitForStart(token: string): Promise<string> {
  let offset = 0;
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`${TG_API}${token}/getUpdates?offset=${offset}&timeout=1`);
    const data = (await res.json()) as { ok: boolean; result: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
    if (data.ok) {
      for (const u of data.result) {
        offset = u.update_id + 1;
        if (u.message?.text === "/start") {
          await fetch(`${TG_API}${token}/getUpdates?offset=${offset}`);
          return String(u.message.chat.id);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("Timeout waiting for /start");
  process.exit(1);
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + " ", (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}
