import { explorerAddressUrl, chainName } from "../../config/tokens";
import type { ProtectionStatus } from "../../dashboard/status";

interface WalletCardProps {
  protectedWallet: `0x${string}` | undefined;
  safeAddress: `0x${string}` | undefined;
  vaultAddress: `0x${string}` | undefined;
  chainId: number;
  variant: "A" | "B";
  status: ProtectionStatus;
  isPro: boolean;
}

function shortAddress(address: `0x${string}` | undefined): string {
  return address === undefined ? "—" : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Identity of the protected setup.
 *
 * The MVP has one wallet, but it is a card rather than a bare string so that
 * multi-wallet support is a later refactor instead of a redesign.
 */
export function WalletCard({
  protectedWallet,
  safeAddress,
  vaultAddress,
  chainId,
  variant,
  status,
  isPro,
}: WalletCardProps) {
  return (
    <section
      aria-label="Protected wallet"
      data-testid="wallet-card"
      className="rounded-2xl border border-border bg-bg-secondary p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-secondary">Protected wallet</p>
          <p className="mt-1 font-mono text-lg text-text-primary" title={protectedWallet}>
            {shortAddress(protectedWallet)}
          </p>
        </div>
        <span className="rounded-full border border-border bg-bg-tertiary px-3 py-1 text-xs text-text-secondary">
          Variant {variant} · {chainName(chainId)}
        </span>
      </div>

      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">Safe address</dt>
          <dd className="font-mono text-text-primary" title={safeAddress}>
            {shortAddress(safeAddress)}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">Vault</dt>
          <dd className="text-right">
            {vaultAddress === undefined ? (
              <span className="text-text-secondary">Not deployed</span>
            ) : (
              <a
                className="text-accent underline underline-offset-2"
                href={explorerAddressUrl(chainId, vaultAddress)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {shortAddress(vaultAddress)} ↗
              </a>
            )}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">Assets</dt>
          <dd className="text-text-primary" data-testid="asset-counts">
            <span className="text-accent-green">Core: {status.counts.core}</span>
            <span className="mx-2 text-text-secondary">·</span>
            <span className="text-accent-yellow">Watch: {status.counts.watch}</span>
          </dd>
        </div>

        {isPro && status.counts.needsReapprove > 0 && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-text-secondary">Needs re-approval</dt>
            <dd className="font-semibold text-accent-yellow">{status.counts.needsReapprove}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}