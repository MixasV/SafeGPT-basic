/**
 * ChainGPT service types.
 *
 * DESIGN RULE: no function in this layer ever throws.
 * Every entry point returns a `ChainGPTResult`, because every caller is a UI
 * surface that has to keep working when there is no API key, when the key is
 * invalid, when the credits are gone, or when the network is down. A throw here
 * would surface as a broken screen rather than a degraded one.
 */

/** Where the answer came from. The UI shows this so nothing is passed off as real. */
export type DataSource = "api" | "mock";

export interface ChainGPTResult<T> {
  data: T;
  source: DataSource;
  /** Credits this operation costs. Shown before the user triggers it. */
  credits: number;
  /**
   * Set only when the API was attempted and failed. The user still receives an
   * answer, but the UI says it is simulated and why — a silent fallback would
   * let a simulated analysis look like a real one.
   */
  warning?: string;
}

/**
 * Every ChatGPT-style product returns free-form markdown in `data.bot`.
 *
 * There is no structured endpoint. An earlier version of the specification
 * assumed `{ riskLevel, findings[] }` and a card-based UI; parsing markdown into
 * that shape on the client would break silently the moment ChainGPT changes a
 * heading. So the text is rendered as written.
 */
export interface MarkdownResult {
  markdown: string;
}

export type ChatResult = MarkdownResult;
export type AuditResult = MarkdownResult;

export interface GenerateResult {
  /** Solidity source, extracted from the model's markdown fence if present. */
  code: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  source: DataSource;
}

/** The product to invoke. ChainGPT multiplexes all three on one endpoint. */
export type ChainGPTModel = "general_assistant" | "smart_contract_auditor" | "smart_contract_generator";

/** Cost per request, keyed by model. Verified against ChainGPT's published pricing. */
export const MODEL_COST: Record<ChainGPTModel, number> = {
  general_assistant: 0.5,
  smart_contract_auditor: 1,
  smart_contract_generator: 1,
};

export const CGPT_USD_PER_CREDIT = 0.01;

export function formatCredits(amount: number): string {
  return `${amount} CGPTc (~$${(amount * CGPT_USD_PER_CREDIT).toFixed(3)})`;
}

/** Shown whenever a response did not come from the API. */
export const SIMULATED_NOTICE = "AI responses are simulated. Add VITE_CHAINGPT_API_KEY to .env for real analysis.";

export const NO_KEY_MESSAGE =
  "This feature needs a ChainGPT API key. Add VITE_CHAINGPT_API_KEY to .env, or subscribe to a platform plan.";