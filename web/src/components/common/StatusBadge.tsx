type BadgeTone = "active" | "alert" | "rescued" | "compromised" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  active: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  alert: "border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow",
  rescued: "border-accent/40 bg-accent/10 text-accent",
  compromised: "border-accent-red/40 bg-accent-red/10 text-accent-red",
  neutral: "border-border bg-bg-tertiary text-text-secondary",
};

const TONE_LABELS: Record<BadgeTone, string> = {
  active: "ACTIVE",
  alert: "ALERT",
  rescued: "RESCUED",
  compromised: "COMPROMISED",
  neutral: "PENDING",
};

interface StatusBadgeProps {
  tone: BadgeTone;
  label?: string;
}

/** Compact status pill used across the onboarding and dashboard. */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {label ?? TONE_LABELS[tone]}
    </span>
  );
}

interface TrustBadgeProps {
  verified: boolean;
}

/**
 * UPD-2 token classification.
 * Verified tokens are rescued first, with the service fee. Unverified tokens go
 * through a separate, fee-free rescue to the quarantine address.
 */
export function TrustBadge({ verified }: TrustBadgeProps) {
  return verified ? (
    <span className="text-xs font-medium text-accent-green">🟢 Verified</span>
  ) : (
    <span className="text-xs font-medium text-accent-yellow">🟡 Unverified</span>
  );
}