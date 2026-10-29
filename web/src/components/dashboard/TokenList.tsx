import type { TokenStatusInfo } from "../../dashboard/status";

interface TokenListProps {
  tokens: TokenStatusInfo[];
  balances: Record<string, string>;
  isPro: boolean;
  isLoading: boolean;
  onReapprove: (token: TokenStatusInfo) => void;
  isApproving: `0x${string}` | null;
}

/**
 * Per-asset protection state.
 *
 * Beginner mode hides the raw allowance: "Approved" carries no meaning for
 * someone who has never seen one, and the same fact is conveyed by the Status
 * column in plain words. Pro mode shows the number, because an operator
 * reconciling against a block explorer needs to match values.
 *
 * NOTE: there is deliberately no "revoke" control anywhere in this product.
 * Revoking the vault's allowance makes the asset unrescuable until the owner
 * re-approves — it is the exact step an attacker takes to disable protection,
 * and offering it as a button next to "re-approve" would be a UX trap. Users
 * who need to de-authorise do it deliberately, outside this UI.
 */

const STATUS_STYLES: Record<string, string> = {
  protected: "text-accent-green",
  monitoring: "text-accent-yellow",
  reapprove: "text-accent-red",
  "not-deployed": "text-text-secondary",
};

const KIND_STYLES = {
  core: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  watch: "border-accent-yellow/40 bg-accent-yellow/10 text-accent-yellow",
} as const;

export function TokenList({
  tokens,
  balances,
  isPro,
  isLoading,
  onReapprove,
  isApproving,
}: TokenListProps) {
  if (!isLoading && tokens.length === 0) {
    return (
      <section
        aria-label="Protected assets"
        data-testid="token-list"
        className="rounded-2xl border border-border bg-bg-secondary p-5"
      >
        <h2 className="text-sm font-semibold text-text-primary">Protected assets</h2>
        <p className="mt-2 text-sm text-text-secondary">
          No assets registered yet. Complete the setup wizard to choose what to protect.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Protected assets"
      data-testid="token-list"
      className="rounded-2xl border border-border bg-bg-secondary p-5"
    >
      <h2 className="text-sm font-semibold text-text-primary">Protected assets</h2>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-text-secondary">
              <th scope="col" className="py-2 pr-3 font-medium">Token</th>
              <th scope="col" className="py-2 pr-3 font-medium">Type</th>
              <th scope="col" className="py-2 pr-3 font-medium">Balance</th>
              {isPro && <th scope="col" className="py-2 pr-3 font-medium">Allowance</th>}
              <th scope="col" className="py-2 pr-3 font-medium">Status</th>
              {isPro && <th scope="col" className="py-2 font-medium">Action</th>}
            </tr>
          </thead>

          <tbody data-testid="token-rows">
            {tokens.map((entry) => (
              <tr key={entry.token.address} className="border-b border-border/50 last:border-0">
                <td className="py-3 pr-3 font-medium text-text-primary">{entry.token.symbol}</td>

                <td className="py-3 pr-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${KIND_STYLES[entry.token.kind]}`}
                    data-testid={`kind-${entry.token.symbol}`}
                  >
                    {entry.token.kind === "core" ? "Core" : "Watch"}
                  </span>
                </td>

                <td className="py-3 pr-3 font-mono text-text-primary" data-testid={`balance-${entry.token.symbol}`}>
                  {balances[entry.token.symbol] ?? "—"}
                </td>

                {isPro && (
                  <td className="py-3 pr-3 font-mono text-xs text-text-secondary" data-testid={`allowance-${entry.token.symbol}`}>
                    {formatAllowance(entry)}
                  </td>
                )}

                <td className={`py-3 pr-3 ${STATUS_STYLES[entry.status] ?? ""}`} data-testid={`status-${entry.token.symbol}`}>
                  {isPro ? entry.label : entry.beginnerLabel}
                </td>

                {isPro && (
                  <td className="py-3">
                    {entry.status === "reapprove" ? (
                      <button
                        type="button"
                        onClick={() => onReapprove(entry)}
                        disabled={isApproving === entry.token.address}
                        data-testid={`reapprove-${entry.token.symbol}`}
                        className="rounded-md border border-accent bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                      >
                        {isApproving === entry.token.address ? "Approving…" : "Re-approve"}
                      </button>
                    ) : (
                      <span className="text-xs text-text-secondary">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * `uint256.max` is the idiomatic "infinite" approval and is what the wizard
 * grants. Rendering 115792089237316195423570985008687907853269984665640564039457… in a
 * table helps nobody, so it is labelled.
 */
function formatAllowance(entry: TokenStatusInfo): string {
  const MAX = 2n ** 256n - 1n;
  if (entry.token.allowance === 0n) return "0";
  if (entry.token.allowance >= MAX) return "Max (infinite)";
  return entry.token.allowance.toString();
}

export { formatAllowance };