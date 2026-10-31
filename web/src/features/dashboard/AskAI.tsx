import { useState } from "react";

import { chaingpt } from "../../services/chaingpt/client";
import { MarkdownRenderer } from "../../components/dashboard/MarkdownRenderer";

const EXAMPLE_QUESTIONS = [
  "Is my USDC fully protected?",
  "What happens if the bot goes offline?",
  "Should I add WBTC to my protection?",
  "How does the rescue race work?",
  "What is ERC-2612 permit and am I safe?",
  "Can the bot protect native ETH?",
  "What if an attacker uses a private mempool?",
];

export function AskAI() {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!input.trim() || !chaingpt.isAvailable()) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setInput("");
    setLoading(true);
    try {
      const response = await chaingpt.ask(userMsg);
      setMessages((prev) => [...prev, { role: "assistant", text: response.data.markdown }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${err instanceof Error ? err.message : "Failed"}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">💬 AI Security Assistant</h3>
      <p className="text-xs text-text-secondary">Powered by ChainGPT AI</p>
      {!chaingpt.isAvailable() && (
        <p className="text-xs text-text-secondary">
          Requires ChainGPT API key. Add in Settings → ChainGPT AI Integration. Get yours at app.chaingpt.org/apidashboard
        </p>
      )}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {messages.slice(-10).map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-text-primary" : "text-text-secondary"}`}>
            {m.role === "user" ? "You: " : "🤖: "}
            {m.role === "assistant" ? <MarkdownRenderer markdown={m.text} /> : m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!chaingpt.isAvailable()}
          className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary disabled:opacity-50"
          placeholder="Ask a question..."
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSend();
          }}
        />
        <button
          onClick={handleSend}
          disabled={!chaingpt.isAvailable() || loading}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => setInput(q)}
              disabled={!chaingpt.isAvailable()}
              className="rounded-full border border-border px-2 py-1 text-xs text-text-secondary disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-text-secondary">~0.5 credits per question</p>
    </div>
  );
}
