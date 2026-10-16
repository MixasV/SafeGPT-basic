import type { ReactNode } from "react";

type BannerTone = "warning" | "danger" | "info";

const TONE_CLASSES: Record<BannerTone, string> = {
  warning: "border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow",
  danger: "border-accent-red/50 bg-accent-red/10 text-accent-red",
  info: "border-accent/40 bg-accent/10 text-text-primary",
};

interface WarningBannerProps {
  tone?: BannerTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Full-width banner for the critical warnings required by the specification. */
export function WarningBanner({ tone = "warning", title, children, className = "" }: WarningBannerProps) {
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${TONE_CLASSES[tone]} ${className}`}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}