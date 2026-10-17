import { useState } from "react";
import { formatUnits, isAddress, maxUint256, type Address } from "viem";

import { DEMO_MODE } from "../../config/demo";
import { getWethAddress } from "../../config/contracts";
import { chainName } from "../../config/tokens";
import { useMode } from "../../hooks/useMode";
import { buildApproveCalldata, useTokenScan, validateManualToken } from "../../hooks/useTokenScan";
import { useOnboardingStore } from "../../state/onboarding";
import { StatusBadge, TrustBadge } from "../common/StatusBadge";
import { WarningBanner } from "../common/WarningBanner";
import { PrimaryButton, SecondaryButton, StepFrame } from "./StepFrame";

interface StepSelectAssetsProps {
  onContinue: () => void;
  onBack: () => void;
  account: Address | undefined;
  chainId: number;
  nativeBalanceWei: bigint;
  /** Optional: Pro mode shows the raw approve calldata once the vault exists. */
  vaultAddress?: Address;
  onWrapEth: (amount: bigint) => Promise<void>;
  wrapping: boolean;
}

const UNVERIFIED_WARNING =
  "Watch-set tokens are rescued in a SEPARATE transaction after your verified assets. " +
  "A malicious token contract cannot steal from your safe address, but it can waste gas. " +
  "Never interact with unverified tokens after they arrive.";

/**
 * Step 4 — Select assets. ERC-20 balances come from the three-level scan of
 * UPD-4; native ETH is listed separately because the vault cannot move it.
 *
 * Every token is classified against the curated per-network list from
 * specification section 6: a listed token goes to the Core set, everything else
 * to the Watch set (fee-free rescue, quarantine routing).
 */
export function StepSelectAssets({
  onContinue,
  onBack,
  account,
  chainId,
  nativeBalanceWei,
  vaultAddress,
  onWrapEth,
  wrapping,
}: StepSelectAssetsProps) {
  const mode = useMode();
  const isPro = mode === "pro";
  const assets = useOnboardingStore((state) => state.assets);
  const toggleAsset = useOnboardingStore((state) => state.toggleAsset);
  const setAssetVerified = useOnboardingStore((state) => state.setAssetVerified);
  const setAssetThreshold = useOnboardingStore((state) => state.setAssetThreshold);
  const addManualAsset = useOnboardingStore((state) => state.addManualAsset);

  const { scan, applyToStore, loading, source, error } = useTokenScan();
  const [manualAddress, setManualAddress] = useState("");
  const [manualWarnings, setManualWarnings] = useState<string[]>([]);
  const [manualError, setManualError] = useState("");
  const [manualVerified, setManualVerified] = useState<boolean | null>(null);

  const wethAddress = getWethAddress(chainId);
  const nativeFormatted = formatUnits(nativeBalanceWei, 18);
  const selected = assets.filter((asset) => asset.selected);
  const coreCount = selected.filter((asset) => asset.verified).length;
  const watchCount = selected.length - coreCount;

  const runScan = async () => {
    const result = await scan(account, chainId);
    applyToStore(result, chainId);
  };

  const addManual = async () => {
    setManualError("");
    setManualWarnings([]);
    setManualVerified(null);

    if (!isAddress(manualAddress.trim())) {
      setManualError("Not a valid EVM address.");
      return;
    }

    const outcome = await validateManualToken(manualAddress.trim(), chainId);
    if (!outcome.ok || !outcome.token) {
      setManualError(outcome.warnings[0] ?? "The token could not be validated.");
      return;
    }

    addManualAsset({
      address: outcome.token.address,
      symbol: outcome.token.symbol,
      decimals: outcome.token.decimals,
      // Pre-registered tokens usually have no balance yet — approve works anyway.
      balance: "0",
      selected: true,
      verified: outcome.verified,
    });
    setManualVerified(outcome.verified);
    setManualWarnings(outcome.warnings);
    setManualAddress("");
  };

  return (
    <StepFrame
      title="Select assets to protect"
      subtitle="Only the tokens you approve here can be rescued. You can change this later."
      error={error || manualError}
      footer={
        <>
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <PrimaryButton onClick={onContinue} disabled={selected.length === 0}>
            Continue
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={() => void runScan()} disabled={loading || (!account && !DEMO_MODE)}>
          {loading ? "Scanning…" : assets.length === 0 ? "Scan wallet" : "Rescan"}
        </PrimaryButton>
        {isPro && <StatusBadge tone="neutral" label={`Source: ${source}`} />}
      </div>

      {assets.length === 0 && !loading && (
        <p className="text-sm text-text-secondary">
          No scan has run yet. {isPro ? "Pro mode also allows adding a token address manually." : ""}
        </p>
      )}

      {assets.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-text-secondary">
              {coreCount} in Core · {watchCount} in Watch
            </span>
            <StatusBadge tone={coreCount > 0 ? "active" : "alert"} label={`CORE ${coreCount}`} />
            <StatusBadge tone={watchCount > 0 ? "alert" : "neutral"} label={`WATCH ${watchCount}`} />
          </div>

          <ul className="space-y-2">
            {assets.map((asset) => (
              <li
                key={asset.address}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-tertiary px-4 py-3"
              >
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={asset.selected}
                    onChange={() => toggleAsset(asset.address)}
                    className="h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">{asset.symbol}</span>
                    <span className="block font-mono text-xs text-text-secondary">{asset.address}</span>
                  </span>
                </label>

                <span className="flex items-center gap-3 text-sm text-text-primary">
                  {formatUnits(BigInt(asset.balance), asset.decimals)}
                  <TrustBadge verified={asset.verified} />
                  <StatusBadge tone={asset.verified ? "active" : "alert"} label={asset.verified ? "CORE" : "WATCH"} />
                </span>

                {isPro && (
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={asset.verified}
                      onChange={(event) => setAssetVerified(asset.address, event.target.checked)}
                    />
                    Force Core
                  </label>
                )}

                {isPro && (
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="threshold"
                    defaultValue={asset.threshold ?? ""}
                    onBlur={(event) => setAssetThreshold(asset.address, event.target.value)}
                    className="w-28 rounded-md border border-border bg-bg-primary px-2 py-1 font-mono text-xs text-text-primary"
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/10 p-4">
        <p className="text-sm font-semibold text-accent-yellow">
          ⚠️ Native ETH cannot be protected directly. We recommend wrapping it to WETH.
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Balance: {nativeFormatted} ETH on {chainName(chainId)}
          {wethAddress ? ` · WETH ${wethAddress}` : " · WETH is not available on this network"}
        </p>
        {wethAddress && Number(nativeBalanceWei) > 0n && (
          <PrimaryButton onClick={() => void onWrapEth(nativeBalanceWei)} disabled={wrapping} className="mt-3">
            {wrapping ? "Wrapping…" : "Wrap ETH → WETH"}
          </PrimaryButton>
        )}
      </div>

      {isPro && (
        <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary p-4">
          <p className="text-sm font-medium text-text-primary">+ Add token manually</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={manualAddress}
              onChange={(event) => setManualAddress(event.target.value)}
              spellCheck={false}
              placeholder="0x…"
              aria-label="Token contract address"
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent"
            />
            <SecondaryButton onClick={() => void addManual()}>Validate &amp; add</SecondaryButton>
          </div>
          {manualVerified !== null && (
            <div className="flex items-center gap-2 text-xs">
              <TrustBadge verified={manualVerified} />
              <StatusBadge tone={manualVerified ? "active" : "alert"} label={manualVerified ? "CORE" : "WATCH"} />
            </div>
          )}
          {manualWarnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
              {manualWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {vaultAddress &&
            assets
              .filter((asset) => asset.selected)
              .map((asset) => (
                <p key={asset.address} className="truncate font-mono text-xs text-text-secondary">
                  approve({asset.address}) → {buildApproveCalldata(vaultAddress, maxUint256)}
                </p>
              ))}
        </div>
      )}

      <WarningBanner tone="warning">{UNVERIFIED_WARNING}</WarningBanner>
    </StepFrame>
  );
}