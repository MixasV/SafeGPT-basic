import type { ReactNode } from "react";

import { WarningBanner } from "../common/WarningBanner";

interface StepProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  error?: string;
}

/** Shared frame for every wizard step: heading, body, error slot and footer actions. */
export function StepFrame({ title, subtitle, children, footer, error }: StepProps) {
  return (
    <section className="rounded-2xl border border-border bg-bg-secondary p-6">
      <header className="mb-5">
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
      </header>

      {error ? (
        <WarningBanner tone="danger" className="mb-4">
          {error}
        </WarningBanner>
      ) : null}

      <div className="space-y-4">{children}</div>

      {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
    </section>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  /** Exposed so a step can assert on its own submit control. */
  testId?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      data-testid={testId}
      disabled={disabled}
      className={`rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-border bg-bg-tertiary px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}