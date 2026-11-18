import { formatCredits, SIMULATED_NOTICE } from "../../services/chaingpt/types";

/**
 * The banner shown above every ChainGPT response that did not come from the API.
 *
 * It is not optional decoration. A simulated analysis presented as a real one is
 * the single worst failure mode of a "falls back to a mock" design: the user
 * makes a security decision on invented output. Anything that cannot say where
 * its answer came from should not be allowed to answer.
 */
export function SimulatedNotice({ warning }: { warning?: string | undefined }) {
  return (
    <div
      role="status"
      data-testid="simulated-notice"
      className="mb-3 rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 px-3 py-2 text-xs text-accent-yellow"
    >
      {warning ?? SIMULATED_NOTICE}
    </div>
  );
}

interface CreditCostProps {
  credits: number;
  action: string;
  className?: string;
}

/** Shows what a call costs before the user triggers it. */
export function CreditCost({ credits, action, className = "" }: CreditCostProps) {
  return (
    <p className={`text-xs text-text-secondary ${className}`} data-testid="credit-cost">
      {action} · {formatCredits(credits)}
    </p>
  );
}