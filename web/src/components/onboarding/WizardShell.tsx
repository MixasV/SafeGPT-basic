import type { ReactNode } from "react";

import { StatusBadge } from "../common/StatusBadge";

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  content: ReactNode;
/** A step is reachable once everything before it has been completed. */
complete: boolean;
  /**
   * An optional step is reachable as soon as the wizard reaches the end of the
   * required flow, whether or not it has been filled in.
   *
   * Without this, the Pro configuration steps were unreachable: they are only
   * "complete" once you configure them, and you cannot configure them until you
   * can open them. The empty whitelist could never get its first entry.
   */
optional?: boolean;
  /** Optional flag rendered next to the step title. */
  status?: "active" | "alert" | "rescued" | "compromised" | "neutral";
}

interface WizardShellProps {
  steps: WizardStep[];
  activeIndex: number;
  onNavigate: (index: number) => void;
  children: ReactNode;
}

/**
 * Progress rail for the onboarding wizard. Steps that are not reachable yet are
 * rendered disabled rather than hidden, so the user can see the whole flow.
 */
export function WizardShell({ steps, activeIndex, onNavigate, children }: WizardShellProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const reachable = index <= activeIndex || step.complete || step.optional === true;

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onNavigate(index)}
                aria-current={isActive ? "step" : undefined}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "border-accent bg-accent/10"
                    : reachable
                      ? "border-border bg-bg-secondary hover:bg-bg-tertiary"
                      : "cursor-not-allowed border-border bg-bg-secondary opacity-50"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {index + 1}. {step.title}
                  </span>
                  {step.status && <StatusBadge tone={step.status} />}
                  {!step.status && step.complete && <span className="text-accent-green">✓</span>}
                </span>
                <span className="mt-0.5 block text-xs text-text-secondary">{step.description}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="min-w-0">{children}</div>
    </div>
  );
}