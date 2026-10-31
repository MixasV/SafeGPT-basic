import { useEffect, useState } from "react";

import { chaingpt } from "../../services/chaingpt/client";
import { MarkdownRenderer } from "../../components/dashboard/MarkdownRenderer";

const STORAGE_KEY = "safegpt_askai_history";

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
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !chaingpt.isAvailable()) return;
    const userMsg = input.trim();
    const newMessages = [...messages, { role: "user" as const, text: userMsg }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const response = await chaingpt.ask(userMsg, newMessages);
      setMessages((prev) => [...prev, { role: "assistant", text: response.data.markdown }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${err instanceof Error ? err.message : "Failed"}` }]);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <div className="flex h-[480px] flex-col rounded-2xl border border-border bg-bg-secondary">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">AI Security Assistant</h3>
            <p className="text-xs text-text-secondary">Powered by ChainGPT AI</p>
          </div>
        </div>
        <button onClick={clearHistory} className="text-xs text-text-secondary hover:text-text-primary">
          Clear
        </button>
      </div>

      {!chaingpt.isAvailable() && (
        <p className="px-4 py-2 text-xs text-text-secondary">
          Requires ChainGPT API key. Add in Settings → ChainGPT AI Integration.
        </p>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                disabled={!chaingpt.isAvailable()}
                className="rounded-full border border-border bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-md bg-accent text-bg-primary"
                  : "rounded-bl-md bg-bg-tertiary text-text-primary"
              }`}
            >
              {m.role === "assistant" ? <MarkdownRenderer markdown={m.text} /> : m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-bg-tertiary px-4 py-2.5 text-sm text-text-secondary">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!chaingpt.isAvailable()}
            className="flex-1 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text-primary placeholder-text-secondary disabled:opacity-50"
            placeholder="Ask a question..."
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSend();
            }}
          />
          <button
            onClick={handleSend}
            disabled={!chaingpt.isAvailable() || loading}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg-primary disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <p className="mt-1 text-xs text-text-secondary">~0.5 credits per question</p>
      </div>
    </div>
  );
}
