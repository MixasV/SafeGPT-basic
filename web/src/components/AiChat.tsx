import { useState } from "react";

import { MarkdownRenderer } from "./ai/MarkdownRenderer";
import { SimulatedNotice } from "./ai/SimulatedNotice";
import { chaingpt } from "../services/chaingpt/client";
import { trackEvent } from "../utils/analytics";
import { type ChatResult } from "../services/chaingpt/types";

/**
 * Floating AI assistant.
 *
 * Available without an API key: the panel opens and the canned prompts work,
 * and a free-form question returns a simulated answer that says so. The
 * alternative — hiding the widget until a key exists — would make the grant
 * demo show an empty page.
 *
 * The assistant is constrained by prompt, not by UI. That is a weaker guarantee
 * than it looks, so the copy itself refuses to imply protection: there is no
 * version of this widget that describes SafeGPT as guaranteed.
 */

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  simulated: boolean;
  warning?: string;
}

const SUGGESTIONS = [
  "How does a rescue work?",
  "What does an allowance do?",
  "What do your alerts mean?",
] as const;

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed === "" || busy) return;

    const userMessage: Message = {
      id: `u-${messages.length}`,
      role: "user",
      text: trimmed,
      simulated: false,
    };
    setMessages((previous) => [...previous, userMessage]);
    setInput("");
    setBusy(true);

    try {
      trackEvent("ai_assistant_request", { kind: "alert" });
      const result = await chaingpt.ask(trimmed);
      trackEvent("ai_assistant_request", { kind: "alert", source: result.source });
      setMessages((previous) => [
        ...previous,
        {
          id: `a-${previous.length}`,
          role: "assistant",
          text: result.data.markdown,
          simulated: result.source === "mock",
          ...(result.warning === undefined ? {} : { warning: result.warning }),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-20" data-testid="ai-chat">
      <div className="flex items-center gap-2">
        {!open && <span className="rounded-full border border-border bg-bg-secondary px-3 py-1 text-xs font-medium text-text-primary shadow-lg">Ask AI 🤖</span>}
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-label={open ? "Close AI assistant" : "Open AI assistant"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-accent bg-bg-secondary text-xl shadow-lg transition-colors hover:bg-bg-tertiary"
        >
          {open ? "✕" : "🤖"}
        </button>
      </div>

      {open && (
        <div className="absolute bottom-16 right-0 flex h-[26rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl">
          <header className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-text-primary">SafeGPT AI Assistant</p>
            <p className="text-xs text-text-secondary">Powered by ChainGPT AI</p>
            <p className="mt-1 text-xs text-accent-yellow">
              💡 Each request costs 2-5 ChainGPT credits. Make sure your balance is topped up at app.chaingpt.org
            </p>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="ai-chat-messages">
            {messages.length === 0 && (
              <div className="text-sm text-text-secondary">
                <p className="mb-2">Ask me about:</p>
                <ul className="space-y-1">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => void send(suggestion)}
                        className="text-left text-accent underline underline-offset-2"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-text-secondary">
                  I explain how protection works. I do not give financial advice, and SafeGPT cannot protect
                  against every kind of attack.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg border p-3 text-sm ${
                  message.role === "user"
                    ? "border-accent/30 bg-accent/10 text-text-primary"
                    : "border-border bg-bg-tertiary text-text-primary"
                }`}
              >
                {message.simulated && <SimulatedNotice warning={message.warning} />}
                {message.role === "assistant" ? (
                  <MarkdownRenderer markdown={message.text} />
                ) : (
                  <span>{message.text}</span>
                )}
              </div>
            ))}

            {busy && <p className="text-xs text-text-secondary">Thinking…</p>}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type a question…"
              aria-label="Ask the AI assistant"
              data-testid="ai-chat-input"
              className="flex-1 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy}
              aria-label="Send"
              className="rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm text-accent disabled:opacity-50"
            >
              →
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export type { ChatResult };