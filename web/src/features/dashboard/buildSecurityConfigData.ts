import { useOnboardingStore } from "../../state/onboarding";
import type { SelectedAsset } from "../../state/onboarding";

export function buildSecurityConfigData(): string {
  const state = useOnboardingStore.getState();
  const protectedTokens: SelectedAsset[] = state.assets.filter((t: SelectedAsset) => t.selected);

  return JSON.stringify(
    {
      chainId: state.chainId,
      vault: state.vaultAddress || "NOT DEPLOYED",
      safe: state.safeAddress || "NOT SET",
      tokens: protectedTokens.map((t: SelectedAsset) => ({
        symbol: t.symbol,
        address: t.address,
        approved: t.verified,
        balance: t.balance,
      })),
    },
    null,
    2,
  );
}
