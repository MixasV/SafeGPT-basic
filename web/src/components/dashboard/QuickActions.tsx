import { explorerAddressUrl } from "../../config/tokens";
import type { ProtectionStatus } from "../../dashboard/status";

interface QuickActionsProps {
  status: ProtectionStatus;
  chainId: number;
  vaultAddress: `0x${string}` | undefined;
  isPro: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  emergencyGuideUrl: string;
}

function Button(props: {
  children: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  testId?: string;
  tone?: "primary" | "secondary";
}) {
  const tone =
    props.tone === "secondary"
      ? "border-border bg-bg-tertiary text-text-primary hover:bg-bg-secondary"
      : "border-accent bg-accent/10 text-accent hover:bg-accent/20";
  const className = `rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`;

  if (props.href !== undefined) {
    return (
      <a className={className} href={props.href} target="_blank" rel="noreferrer noopener" data-testid={props.testId}>
        {props.children}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={props.onClick} disabled={props.disabled} data-testid={props.testId}>
      {props.children}
    </button>
  );
}

/**
 * Actions the user can take right now.
 *
 * What is deliberately absent: a "Revoke allowance" control. Revoking makes the
 * asset unrescuable until the owner re-approves — the precise step an attacker
 * takes to blind the vault — and placing that next to "Re-approve" in a
 * protection product invites a mistake with no visible cause. Anyone who needs
 * to de-authorise does it outside this UI, on purpose.
 */
export function QuickActions({
  status,
  chainId,
  vaultAddress,
  isPro,
  isRefreshing,
  onRefresh,
  emergencyGuideUrl,
}: QuickActionsProps) {
  const needsAttention = status.counts.needsReapprove > 0;

  return (
    <section
      aria-label="Quick actions"
      data-testid="quick-actions"
      className="rounded-2xl border border-border bg-bg-secondary p-5"
    >
      <h2 className="text-sm font-semibold text-text-primary">What you can do</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onRefresh} disabled={isRefreshing} testId="action-refresh">
          {isRefreshing ? "Checking…" : "Check protection now"}
        </Button>

        <Button href={emergencyGuideUrl} testId="action-emergency">
          What to do if you are attacked
        </Button>

        {isPro && vaultAddress !== undefined && (
          <Button
            href={explorerAddressUrl(chainId, vaultAddress)}
            testId="action-explorer"
            tone="secondary"
          >
            View vault on explorer
          </Button>
        )}
      </div>

      {needsAttention && (
        <p className="mt-3 text-sm text-accent-yellow" data-testid="reapprove-hint">
          {status.counts.needsReapprove === 1
            ? "One asset needs your approval before it can be protected again."
            : `${status.counts.needsReapprove} assets need your approval before they can be protected again.`}
          {isPro
            ? " Use “Re-approve” in the asset table."
            : " Switch to Pro mode to re-approve from this page."}
        </p>
      )}
    </section>
  );
}