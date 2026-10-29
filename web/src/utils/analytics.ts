/**
 * Analytics events.
 *
 * WHY THIS EXISTS EVEN THOUGH IT ONLY LOGS
 * -----------------------------------------
 * Grant reporting needs a MAU count, an AI-request count and a rescue count.
 * Those numbers can only be gathered if the calls are in the code from the
 * start — retrofitting instrumentation after launch means the first cohort is
 * invisible, and the first cohort is the one that decides whether the numbers
 * ever reach the reporting threshold.
 *
 * So every event is declared now and logged in Demo Mode. `VITE_ANALYTICS_URL`
 * is the seam: point it at a real collector later and nothing else changes.
 *
 * WHAT MUST NEVER BE SENT
 * -----------------------
 * No addresses, no transaction hashes, no token balances, no amounts. An
 * analytics payload that identifies a user's wallet turns a metrics endpoint
 * into a tracking database for a security product — the worst possible outcome
 * for the people who trust us with a cold-storage key.
 */

/** Events, kept as a literal union so a typo cannot ship a dead metric. */
export type AnalyticsEvent =
  | "onboarding_started"
  | "drainer_check_passed"
  | "drainer_check_failed"
  | "onboarding_completed"
  | "ai_assistant_request"
  | "ai_explanation_requested"
  | "ai_config_review_requested"
  | "rescue_triggered"
  | "rescue_success"
  | "rescue_failed"
  | "contract_audited"
  | "contract_generated"
  | "reapprove_requested"
  | "pro_step_opened";

/**
 * Fields that are safe to send. Counts and enums only.
 * Kept narrow so a careless caller cannot pass an address through it.
 */
export interface AnalyticsData {
  chainId?: number;
  network?: string;
  tokensCount?: number;
  coreCount?: number;
  watchCount?: number;
  kind?: "core" | "watch" | "alert" | "review" | "audit" | "generate";
  source?: "api" | "mock";
  ruleId?: string;
  severity?: string;
  errorKind?: string;
  step?: string;
  stepCount?: number;
}

const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined;
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === "true";

let sink: ((event: AnalyticsEvent, data?: AnalyticsData) => void) | null = null;

/** Test seam: lets a unit test capture calls without mocking `fetch`. */
export function setAnalyticsSink(next: ((event: AnalyticsEvent, data?: AnalyticsData) => void) | null): void {
  sink = next;
}

/**
 * Records an event.
 *
 * Never throws and never blocks the caller: a metrics endpoint being down must
 * not break onboarding or delay a rescue path.
 */
export function trackEvent(event: AnalyticsEvent, data?: AnalyticsData): void {
  try {
    if (sink !== null) {
      sink(event, data);
    }

    if (IS_DEMO || ENDPOINT === undefined || ENDPOINT === "") {
      console.log("[Analytics]", event, data ?? {});
      return;
    }

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data: data ?? {}, ts: Date.now() }),
      keepalive: true,
    }).catch(() => {
      // Fire and forget. A failed metric is not worth a retry queue.
    });
  } catch {
    // Analytics must never propagate.
  }
}

/** Event names, exported so tests and dashboards cannot drift from this list. */
export const ANALYTICS_EVENTS: readonly AnalyticsEvent[] = [
  "onboarding_started",
  "drainer_check_passed",
  "drainer_check_failed",
  "onboarding_completed",
  "ai_assistant_request",
  "ai_explanation_requested",
  "ai_config_review_requested",
  "rescue_triggered",
  "rescue_success",
  "rescue_failed",
  "contract_audited",
  "contract_generated",
  "reapprove_requested",
  "pro_step_opened",
];