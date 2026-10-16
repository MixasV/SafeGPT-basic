import type { Address } from "viem";

import { explorerAddressUrl } from "../../config/tokens";
import type { SelectedAsset } from "../../state/onboarding";
import { StatusBadge } from "../common/StatusBadge";
import { PrimaryButton, StepFrame } from "./StepFrame";

interface StepProtectionActiveProps {
  onFinish: () => void;
  chainId: number;
  account: Address;
  vaultAddress: Address;
  safeAddress: string;
  assets: SelectedAsset[];
}

/** Step 6 — Confirmation screen. */
export function StepProtectionActive({
  onFinish,
  chainId,
  account,
  vaultAddress,
  safeAddress,
  assets,
}: StepProtectionActiveProps) {
  const protectedAssets = assets.filter((asset) => asset.selected);

  return (
    <StepFrame
      title="Protection active"
      subtitle="Your wallet is now monitored for suspicious outgoing transactions."
      footer={<PrimaryButton onClick={onFinish}>Go to Dashboard</PrimaryButton>}
    >
      <div className="flex items-center gap-3 rounded-lg border border-accent-green/40 bg-accent-green/10 p-4">
        <StatusBadge tone="active" label="ACTIVE" />
        <div>
          <p className="text-sm font-semibold text-accent-green">Monitoring started</p>
          <p className="text-sm text-text-secondary">
            If suspicious activity is detected, your funds are moved to the safe address before the attack
            transaction executes.
          </p>
        </div>
      </div>

      <dl className="grid gap-2 rounded-lg border border-border bg-bg-tertiary p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Protected wallet</dt>
          <dd className="break-all font-mono text-text-primary">{account}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Safe address</dt>
          <dd className="break-all font-mono text-text-primary">{safeAddress}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Protection contract</dt>
          <dd className="break-all font-mono text-text-primary">
            <a
              className="text-accent"
              href={explorerAddressUrl(chainId, vaultAddress)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {vaultAddress} ↗
            </a>
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Protected assets</dt>
          <dd className="text-text-primary">{protectedAssets.length}</dd>
        </div>
      </dl>

      <ul className="flex flex-wrap gap-2">
        {protectedAssets.map((asset) => (
          <li
            key={asset.address}
            className="rounded-full border border-border bg-bg-tertiary px-3 py-1 text-xs text-text-primary"
          >
            {asset.symbol}
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}