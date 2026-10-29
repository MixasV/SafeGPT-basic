import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Onboarding state (specification section 4.3.2, updated by UPD-3 with the
 * deploy step). Persisted to localStorage so a refresh mid-onboarding does not
 * lose the deployed vault address — losing it would orphan the approvals.
 */
export type WizardStepId =
  | "connect"
  | "drainer"
  | "safe-address"
  | "assets"
  | "deploy"
  | "approve"
  | "active"
  // Pro-only steps, collected after protection is active.
  | "whitelist"
  | "rules"
  | "alerts";

export const BEGINNER_STEPS: readonly WizardStepId[] = [
  "connect",
  "drainer",
  "safe-address",
  "assets",
  "deploy",
  "approve",
  "active",
];

/** Pro-only steps, shown after the shared ones. */
export const PRO_STEPS: readonly WizardStepId[] = ["whitelist", "rules", "alerts"];

export interface SelectedAsset {
  address: string;
  symbol: string;
  decimals: number;
  /**
   * Raw on-chain balance as a decimal string. Kept as a string rather than a
   * bigint because this state is persisted to localStorage and JSON has no
   * BigInt representation.
   */
  balance: string;
  selected: boolean;
  /** Unverified / watch-set token: rescued without a fee and routed to quarantine. */
  verified: boolean;
  /** Rescue threshold in the token's smallest unit (Pro mode). */
  threshold?: string;
}

export type DrainerStatus = "idle" | "awaiting-deposit" | "checking" | "clean" | "compromised";

/** Rule thresholds, mirrored into the bot configuration. See StepProConfig. */
export interface RuleSettings {
  rescueOnApproveToUnknown: boolean;
  rescueOnTransferToNonWhitelist: boolean;
  rescueOnContractCallToNonWhitelist: boolean;
  rescueOnEIP7702Delegation: boolean;
  massTransfersMax: number;
  massTransfersWindowMin: number;
  revokeGracePeriodMin: number;
}

/** Alert channels. Values live in the operator's own bot config, never on a server. */
export interface AlertSettings {
  telegramBotToken: string;
  telegramChatId: string;
  webhookUrl: string;
}

interface OnboardingState {
  step: WizardStepId;
  safeAddress: string;
  /** Safe address linked to the platform account by a signature (UPD-3, Sprint 7). */
  safeAddressLinked: boolean;
  vaultAddress: string;
  factoryAddress: string;
  deployTxHash: string;
  chainId: number;
  assets: SelectedAsset[];
  drainerStatus: DrainerStatus;
  drainerDetail: string;
  nativeBalanceWei: bigint;
  /** Pro step: addresses the bot treats as trusted. */
  whitelist: string[];
  /** Pro step: rule thresholds written to the bot config. */
  rules: RuleSettings;
  /** Pro step: alert channels. */
  alertsConfig: AlertSettings;
  completed: boolean;

  setStep: (step: WizardStepId) => void;
  setSafeAddress: (address: string) => void;
  setSafeAddressLinked: (linked: boolean) => void;
  setVaultAddress: (address: string) => void;
  setFactoryAddress: (address: string) => void;
  setDeployTxHash: (hash: string) => void;
  setChainId: (chainId: number) => void;
  setAssets: (assets: SelectedAsset[]) => void;
  toggleAsset: (address: string) => void;
  setAssetVerified: (address: string, verified: boolean) => void;
  setAssetThreshold: (address: string, threshold: string) => void;
  addManualAsset: (asset: SelectedAsset) => void;
  setDrainer: (status: DrainerStatus, detail: string, nativeBalanceWei?: bigint) => void;
  setNativeBalance: (wei: bigint) => void;
  setWhitelist: (addresses: string[]) => void;
  setRules: (rules: RuleSettings) => void;
  setAlertsConfig: (alerts: AlertSettings) => void;
  complete: () => void;
  reset: () => void;
}

const INITIAL = {
  step: "connect" as WizardStepId,
  safeAddress: "",
  safeAddressLinked: false,
  vaultAddress: "",
  factoryAddress: "",
  deployTxHash: "",
  chainId: 1,
  assets: [] as SelectedAsset[],
  drainerStatus: "idle" as DrainerStatus,
  drainerDetail: "",
  nativeBalanceWei: 0n,
  whitelist: [] as string[],
  rules: {
    rescueOnApproveToUnknown: true,
    rescueOnTransferToNonWhitelist: true,
    rescueOnContractCallToNonWhitelist: true,
    rescueOnEIP7702Delegation: true,
    massTransfersMax: 3,
    massTransfersWindowMin: 5,
    revokeGracePeriodMin: 5,
  } as RuleSettings,
  alertsConfig: {
    telegramBotToken: "",
    telegramChatId: "",
    webhookUrl: "",
  } as AlertSettings,
  completed: false,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ...INITIAL,

      setStep: (step) => set({ step }),
      setSafeAddress: (safeAddress) => set({ safeAddress }),
      setSafeAddressLinked: (safeAddressLinked) => set({ safeAddressLinked }),
      setVaultAddress: (vaultAddress) => set({ vaultAddress }),
      setFactoryAddress: (factoryAddress) => set({ factoryAddress }),
      setDeployTxHash: (deployTxHash) => set({ deployTxHash }),
      setChainId: (chainId) => set({ chainId }),
      setAssets: (assets) => set({ assets }),
      toggleAsset: (address) =>
        set((state) => ({
          assets: state.assets.map((asset) =>
            asset.address === address ? { ...asset, selected: !asset.selected } : asset,
          ),
        })),
      setAssetVerified: (address, verified) =>
        set((state) => ({
          assets: state.assets.map((asset) =>
            asset.address === address ? { ...asset, verified } : asset,
          ),
        })),
      setAssetThreshold: (address, threshold) =>
        set((state) => ({
          assets: state.assets.map((asset) =>
            asset.address === address ? { ...asset, threshold } : asset,
          ),
        })),
      addManualAsset: (asset) =>
        set((state) => ({
          assets: state.assets.some((existing) => existing.address === asset.address)
            ? state.assets
            : [...state.assets, asset],
        })),
      setDrainer: (drainerStatus, drainerDetail, nativeBalanceWei) =>
        set((state) => ({
          drainerStatus,
          drainerDetail,
          nativeBalanceWei: nativeBalanceWei ?? state.nativeBalanceWei,
        })),
      setNativeBalance: (nativeBalanceWei) => set({ nativeBalanceWei }),
      setWhitelist: (whitelist) => set({ whitelist }),
      setRules: (rules) => set({ rules }),
      setAlertsConfig: (alertsConfig) => set({ alertsConfig }),
      complete: () => set({ completed: true }),
      reset: () => set({ ...INITIAL }),
    }),
    {
      name: "safegpt-onboarding",
      // bigint is not JSON-serialisable and the native balance is always re-read
      // from the chain, so it is deliberately excluded from persistence.
      partialize: (state) => {
        const { nativeBalanceWei: _liveBalance, ...persisted } = state;
        return persisted;
      },
    },
  ),
);