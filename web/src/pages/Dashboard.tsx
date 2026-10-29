import { useState } from "react";
import { useWriteContract } from "wagmi";
import { trackEvent } from "../utils/analytics";

import { AlertFeed } from "../components/dashboard/AlertFeed";
import { ProtectionStatusPanel } from "../components/dashboard/ProtectionStatus";
import { QuickActions } from "../components/dashboard/QuickActions";
import { RescueHistory } from "../components/dashboard/RescueHistory";
import { TokenList } from "../components/dashboard/TokenList";
import { WalletCard } from "../components/dashboard/WalletCard";
import { WarningBanner } from "../components/common/WarningBanner";
import { DEMO_MODE } from "../config/demo";
import { erc20Abi } from "../config/contracts";
import type { TokenStatusInfo } from "../dashboard/status";
import { useMode } from "../hooks/useMode";
import { useRescueEvents } from "../hooks/useRescueEvents";
import { toProtectionStatus, useVaultStatus } from "../hooks/useVaultStatus";
import { MOCK_ALERTS } from "../mocks/dashboard-mocks";

const EMERGENCY_GUIDE_URL = "https://github.com/safegpt/safegpt-core#emergency";

const MAX_UINT256 = 2n ** 256n - 1n;

export function Dashboard() {
  const isPro = useMode() === "pro";
  const vault = useVaultStatus();
  const history = useRescueEvents();
  const status = toProtectionStatus(vault);

  const { writeContractAsync } = useWriteContract();
  const [approving, setApproving] = useState<`0x${string}` | null>(null);
  const [approveError, setApproveError] = useState<string | undefined>(undefined);

  /**
   * Grants the vault an unlimited pull allowance for one token.
   *
   * Two things this deliberately does NOT offer, in Pro mode or otherwise:
   *   - revoking an allowance, which would leave the asset unrescuable
   *   - approving a token the user did not register during setup
   */
async function handleReapprove(entry: TokenStatusInfo): Promise<void> {
    if (!vault.vaultAddress) return;
    trackEvent("reapprove_requested", {
      chainId: vault.chainId,
      // Symbol only — never the address. An analytics payload that identifies a
      // wallet would turn this endpoint into a tracker for a security product.
      kind: entry.token.kind,
      ruleId: "R8_ALLOWANCE_DROPPED",
    });
    setApproving(entry.token.address);
    setApproveError(undefined);
    try {
      await writeContractAsync({
        address: entry.token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [vault.vaultAddress, MAX_UINT256],
      });
      vault.refresh();
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : String(error));
    } finally {
      setApproving(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 space-y-5">
      {vault.isDemo && (
        <div
          data-testid="demo-banner"
          className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
        >
          <span className="font-semibold">Demo Mode</span> — showing sample data. No real wallet is connected and
          nothing is broadcast.
        </div>
      )}

      {vault.error !== undefined && (
        <WarningBanner tone="danger" title="Could not read the chain">
          {vault.error}
        </WarningBanner>
      )}

      {approveError !== undefined && (
        <WarningBanner tone="warning" title="Approval failed">
          {approveError}
        </WarningBanner>
      )}

      <ProtectionStatusPanel
        status={status}
        isPro={isPro}
        chainId={vault.chainId}
        vaultAddress={vault.vaultAddress}
        executorAddress={vault.executorAddress}
        executorBalance={vault.executorBalance}
        isLoading={vault.isLoading}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <TokenList
          tokens={status.tokens}
          balances={vault.balances}
          isPro={isPro}
          isLoading={vault.isLoading}
          onReapprove={(entry) => void handleReapprove(entry)}
          isApproving={approving}
        />

        <div className="space-y-5">
          <WalletCard
            protectedWallet={vault.protectedWallet}
            safeAddress={vault.safeAddress}
            vaultAddress={vault.vaultAddress}
            chainId={vault.chainId}
            variant="A"
            status={status}
            isPro={isPro}
          />

          <QuickActions
            status={status}
            chainId={vault.chainId}
            vaultAddress={vault.vaultAddress}
            isPro={isPro}
            isRefreshing={vault.isLoading}
            onRefresh={vault.refresh}
            emergencyGuideUrl={EMERGENCY_GUIDE_URL}
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <AlertFeed
          alerts={DEMO_MODE ? MOCK_ALERTS : []}
          isDemo={DEMO_MODE}
          isPro={isPro}
          hasBotConfigured={vault.vaultAddress !== undefined}
        />

<RescueHistory history={history} chainId={vault.chainId} isPro={isPro} />
      </div>

      {/* Floating assistant. Present without an API key too — the canned prompts
          work, and a free-form question returns a labelled simulated answer. */}
    </div>
  );
}