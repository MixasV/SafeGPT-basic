import { mockAudit, mockChat, MOCK_ALERT_EXPLANATION, MOCK_GENERATED_CONTRACT, MOCK_ONBOARDING_REVIEW } from "./mock.js";
import {
  MODEL_COST,
  type AuditResult,
  type ChainGPTModel,
  type ChainGPTResult,
  type ChatResult,
  type GenerateResult,
} from "./types.js";

/**
 * ChainGPT client — raw REST.
 *
 * WHY NOT THE OFFICIAL SDK
 * ------------------------
 * `@chaingpt/smartcontractgenerator` bundles a vendored solc compiler that
 * imports `path`, `fs` and `assert`. Vite externalises those for the browser and
 * the stub module throws at import time, taking the entire SPA down — a build of
 * the interface rendered nothing because of a Node-only compiler dependency. The
 * failure is silent in production: no build error, just a blank page. The other
 * two SDK packages may be clean, but one unusable dependency is enough to
 * justify calling the documented endpoint directly.
 *
 * All three products live on `POST /chat/stream` and differ only by `model`.
 * CORS was verified against the live API: the origin is reflected and
 * `Authorization` is allowed, so a browser call works.
 *
 * THREE TRANSPORTS
 * ----------------
 * A `VITE_*` value is inlined into the bundle, so the deployment decides who
 * owns the key:
 *
 *   proxy  — VITE_CHAINGPT_PROXY_URL is set. The platform key lives in a
 *            Worker secret, never in the bundle. This is the hosted deployment.
 *   direct — VITE_CHAINGPT_API_KEY is set. A self-hoster's own key, in their own
 *            `.env`, on their own machine. No proxy involved.
 *   mock   — neither. Everything returns clearly-labelled simulated output.
 *
 * `resolveTransport` picks between them and is unit-tested, because the choice
 * between "spends a real key" and "returns a mock" is exactly the kind of
 * decision that should not be re-derived on every call.
 *
 * DEGRADATION CONTRACT
 * -------------------
 * Nothing here rejects. A missing key, an invalid key, exhausted credits, HTTP
 * 403 or a dropped connection all produce a usable answer with
 * `source: "mock"`, plus a `warning` where there was something to fail. The UI
 * shows that warning, because a simulated analysis presented as a real one is
 * the worst outcome this design could have.
 */

const CHAINGPT_URL = "https://api.chaingpt.org/chat/stream";

const ENV = {
  proxyUrl: (import.meta.env.VITE_CHAINGPT_PROXY_URL as string | undefined)?.trim(),
  apiKey: (import.meta.env.VITE_CHAINGPT_API_KEY as string | undefined)?.trim() || (typeof localStorage !== "undefined" ? localStorage.getItem("chaingpt_api_key")?.trim() : undefined),
};

export type Transport = "proxy" | "direct" | "mock";

export interface ResolvedTransport {
  kind: Transport;
  /** Endpoint to POST to. Absent in `mock`. */
  url?: string;
  /** Bearer token to attach. Present only in `direct`. */
  apiKey?: string;
}

/**
 * Decides how to reach ChainGPT.
 *
 * Proxy wins over a direct key: if a deployment bothers to configure a proxy,
 * the bundle key is a leftover and routing around the proxy would spend a key
 * the operator expected to stay private.
 */
export function resolveTransport(env: { proxyUrl?: string | undefined; apiKey?: string | undefined }): ResolvedTransport {
  const proxy = env.proxyUrl?.trim();
  if (proxy !== undefined && proxy !== "") {
    return { kind: "proxy", url: proxy.replace(/\/$/, "") };
  }

  const key = env.apiKey?.trim();
  if (key !== undefined && key !== "") {
    return { kind: "direct", url: CHAINGPT_URL, apiKey: key };
  }

  return { kind: "mock" };
}

const TRANSPORT = resolveTransport(ENV);

/** System prompt for the assistant widget. The constraints are the product's, not the model's. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the SafeGPT AI Assistant, powered by ChainGPT.
You help users understand their wallet protection setup.

Rules you never break:
- You NEVER provide financial advice.
- You NEVER claim SafeGPT guarantees protection, and you never describe it as insurance.
- You explain alerts, rescue events and configuration options.
- Keep answers to two or three sentences.

If a question needs real-time market data or an audit of source code, say which tool the user should open instead of guessing.`;

/**
 * Pulls the answer out of a `/chat/stream` response body.
 *
 * The endpoint streams, but the buffered and streamed shapes differ, and a
 * response is not worth failing over: try a JSON envelope first, then a Server
 * Sent Events body, then treat whatever arrived as plain text. Returns null only
 * when there is genuinely nothing usable.
 */
export function parseResponseBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === "") return null;

  try {
    const parsed = JSON.parse(trimmed) as { data?: { bot?: string }; bot?: string };
    const answer = parsed.data?.bot ?? parsed.bot;
    if (typeof answer === "string" && answer.trim() !== "") return answer;
  } catch {
    // Not JSON. Fall through to the SSE and raw-text shapes.
  }

  // Server-Sent Events: `data: {...}` lines, one per chunk.
  if (trimmed.includes("data:")) {
    const chunks = trimmed
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line !== "" && line !== "[DONE]");

    const merged = chunks
      .map((chunk) => {
        try {
          const parsed = JSON.parse(chunk) as { bot?: string; data?: { bot?: string } };
          return parsed.data?.bot ?? parsed.bot ?? "";
        } catch {
          return "";
        }
      })
      .join("");

    if (merged.trim() !== "") return merged;
  }

  return trimmed;
}

/**
 * Pulls Solidity out of the model's markdown fence.
 *
 * Fence extraction, not semantic parsing: the model wraps code in ```solidity
 * and the UI needs the raw source to display or re-send it. With no fence the
 * text is returned unchanged.
 */
export function extractCode(markdown: string): string {
  const fence = markdown.match(/```(?:solidity|vyper)?\s*\r?\n([\s\S]*?)```/i);
  return fence === null ? markdown.trim() : (fence[1] ?? "").trim();
}

export class ChainGPTClient {
  private readonly transport: ResolvedTransport;

  constructor(transport: ResolvedTransport = TRANSPORT) {
    this.transport = transport;
  }

  /** True when real ChainGPT responses will be returned. */
  isAvailable(): boolean {
    return this.transport.kind !== "mock";
  }

  /** How this instance reaches ChainGPT. Surfaced in the UI copy. */
  getTransport(): Transport {
    return this.transport.kind;
  }

  /** One request. Never rejects; a failure becomes a mock-backed result. */
  private async request<T>(
    model: ChainGPTModel,
    question: string,
    fallback: T,
    transform: (markdown: string) => T,
  ): Promise<ChainGPTResult<T>> {
    const credits = MODEL_COST[model];

    if (this.transport.kind === "mock" || this.transport.url === undefined) {
      return { data: fallback, source: "mock", credits };
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Direct mode carries the user's own key. Proxy mode deliberately does
      // not: the Worker holds the platform key and adds the header itself.
      if (this.transport.apiKey !== undefined) {
        headers.Authorization = `Bearer ${this.transport.apiKey}`;
      }

      const response = await fetch(this.transport.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, question, chatHistory: "off" }),
      });

      if (!response.ok) {
        throw new Error(describeHttpError(response.status));
      }

      const markdown = parseResponseBody(await response.text());
      if (markdown === null) {
        throw new Error("empty response");
      }

      return { data: transform(markdown), source: "api", credits };
    } catch (error) {
      return {
        data: fallback,
        source: "mock",
        credits,
        warning: `ChainGPT request failed (${error instanceof Error ? error.message : String(error)}). Showing a simulated response.`,
      };
    }
  }

  // ── Chatbot ────────────────────────────────────────────────────────────

  /** Configuration review shown on the final wizard screen. */
  async reviewConfiguration(configJson: string): Promise<ChainGPTResult<ChatResult>> {
    const question =
      `Analyze this SafeGPT wallet protection configuration and give security recommendations:\n\n` +
      `${configJson}\n\n` +
      `Respond in 3-5 bullet points. Cover: gaps in token coverage, rescue threshold ` +
      `recommendations, whitelist completeness, and general security posture. Do not give financial advice.`;

    return this.request(
      "general_assistant",
      question,
      { markdown: MOCK_ONBOARDING_REVIEW },
      (markdown) => ({ markdown }),
    );
  }

  /** Free-form assistant question. */
  async ask(question: string): Promise<ChainGPTResult<ChatResult>> {
    const fallback = mockChat(question);
    return this.request(
      "general_assistant",
      `${ASSISTANT_SYSTEM_PROMPT}\n\nUser question: ${question}`,
      fallback,
      (markdown) => ({ markdown }),
    );
  }

  /** Plain-language explanation of one alert. */
  async explainAlert(alert: {
    rule: string;
    description: string;
    severity: string;
    action: string;
  }): Promise<ChainGPTResult<ChatResult>> {
    const question =
      `Explain this SafeGPT security alert in simple terms.\n\n` +
      `Rule: ${alert.rule}\nDescription: ${alert.description}\nSeverity: ${alert.severity}\nAction taken: ${alert.action}\n\n` +
      `Explain in 2-3 sentences what happened, why it matters, and what the user should do next. ` +
      `No financial advice, and never claim SafeGPT guarantees protection.`;

    return this.request(
      "general_assistant",
      question,
      { markdown: MOCK_ALERT_EXPLANATION },
      (markdown) => ({ markdown }),
    );
  }

  // ── Auditor ────────────────────────────────────────────────────────────

  /**
   * Audits Solidity SOURCE.
   *
   * There is deliberately no `auditAddress()`. The auditor accepts source code,
   * not a contract address, and an unverified contract has no verified source to
   * send — which is exactly why it is unverified. An "enter the token address"
   * flow would post the address as a question and render the answer as if it
   * were an audit of that contract.
   */
  async audit(source: string): Promise<ChainGPTResult<AuditResult>> {
    return this.request(
      "smart_contract_auditor",
      `Audit this Solidity contract:\n\n${source}`,
      mockAudit(source),
      (markdown) => ({ markdown }),
    );
  }

  // ── Generator ──────────────────────────────────────────────────────────

  async generate(description: string): Promise<ChainGPTResult<GenerateResult>> {
    return this.request(
      "smart_contract_generator",
      description,
      MOCK_GENERATED_CONTRACT,
      (markdown) => ({ code: extractCode(markdown) }),
    );
  }
}

/** Explains an HTTP status without inventing a cause we cannot verify. */
function describeHttpError(status: number): string {
  if (status === 401 || status === 403) return "HTTP " + status + " — the API key is missing, invalid, or out of credits";
  if (status === 402) return "HTTP 402 — out of credits; top up at https://app.chaingpt.org/addcredits";
  if (status === 429) return "HTTP 429 — rate limited (200 requests/minute)";
  return `HTTP ${status}`;
}

/** Shared instance. */
export const chaingpt = new ChainGPTClient();