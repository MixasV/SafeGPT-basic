import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { StepApproveProtection } from "../components/onboarding/StepApproveProtection";
import { StepConnectWallet } from "../components/onboarding/StepConnectWallet";
import { StepDeployProtection } from "../components/onboarding/StepDeployProtection";
import { StepDrainerCheck } from "../components/onboarding/StepDrainerCheck";
import { StepAlerts, StepRules, StepWhitelist } from "../components/onboarding/StepProConfig";
import { StepProtectionActive } from "../components/onboarding/StepProtectionActive";
import { StepSafeAddress } from "../components/onboarding/StepSafeAddress";
import { StepSelectAssets } from "../components/onboarding/StepSelectAssets";
import { WizardShell } from "../components/onboarding/WizardShell";
import { DEMO_MODE } from "../config/demo";
import { DEFAULT_FEE_BPS, getWethAddress, wethAbi } from "../config/contracts";
import { DEMO_ADDRESSES } from "../config/tokens";
import { useApprovalFlow } from "../hooks/useApprovalFlow";
import { useMode } from "../hooks/useMode";
import { useVaultDeploy } from "../hooks/useVaultDeploy";
import { BEGINNER_STEPS, PRO_STEPS, useOnboardingStore, type WizardStepId } from "../state/onboarding";
import { trackEvent } from "../utils/analytics";

const STEP_META: Record<WizardStepId, { title: string; description: string }> = {
  connect: { title: "Connect wallet", description: "Pick the wallet to protect" },
  drainer: { title: "Safety check", description: "Detect an active sweeper" },
  "safe-address": { title: "Safe address", description: "Where funds are rescued to" },
  assets: { title: "Select assets", description: "Scan ERC-20 balances" },
  deploy: { title: "Deploy protection", description: "Create the vault contract" },
  approve: { title: "Approve protection", description: "One approval per token" },
  active: { title: "Protection active", description: "Monitoring started" },
  // Pro-only steps, reachable once protection is active.
  whitelist: { title: "Whitelist", description: "Trusted addresses" },
  rules: { title: "Rules", description: "Rescue trigger thresholds" },
  alerts: { title: "Alerts", description: "Telegram and webhook" },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Onboarding wizard (specification 4.3.2, plus the UPD-3 deploy step). */
export function Setup() {
  const navigate = useNavigate();
  const mode = useMode();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const store = useOnboardingStore();
  const {
    step,
    chainId,
    safeAddress,
    vaultAddress,
    assets,
    setStep,
    setChainId,
    setNativeBalance,
    complete,
    reset,
  } = store;

  const [executor, setExecutor] = useState<Address>("0x0000000000000000000000000000000000000000");
  const [feeReceiver, setFeeReceiver] = useState<Address>("0x0000000000000000000000000000000000000000");
  const [feeBps, setFeeBps] = useState<number>(DEFAULT_FEE_BPS);
  const [wrapping, setWrapping] = useState(false);
  const [wrapError, setWrapError] = useState("");

  const account = (DEMO_MODE ? DEMO_ADDRESSES.wallet : address) as Address | undefined;

  // Default the executor and fee receiver to the connected wallet so the wizard
  // works out of the box; Pro mode exposes both for a self-hosted deployment.
  const resolvedExecutor = executor === "0x0000000000000000000000000000000000000000" && account ? account : executor;
  const resolvedFeeReceiver =
    feeReceiver === "0x0000000000000000000000000000000000000000" && account ? account : feeReceiver;

  const deployHook = useVaultDeploy(walletClient, publicClient, {
    owner: account ?? ("0x0000000000000000000000000000000000000000" as Address),
    safeAddress: (safeAddress || "0x0000000000000000000000000000000000000000") as Address,
    executor: resolvedExecutor,
    feeReceiver: resolvedFeeReceiver,
    feeBps,
  });

  const approval = useApprovalFlow(walletClient, publicClient, vaultAddress as Address, assets);

  const activeIndex = Math.max(0, BEGINNER_STEPS.indexOf(step));

  const refreshNativeBalance = useCallback(async () => {
    if (!publicClient || !account) {
      setNativeBalance(0n);
      return;
    }
    try {
      const balance = await publicClient.getBalance({ address: account });
      setNativeBalance(balance);
    } catch {
      setNativeBalance(0n);
    }
  }, [account, publicClient, setNativeBalance]);

  const goTo = useCallback(
    (index: number) => {
      // Indexes span the Beginner list plus, in Pro mode, the configuration
      // steps. Looking only at BEGINNER_STEPS made every Pro step unreachable.
      const ids = mode === "pro" ? [...BEGINNER_STEPS, ...PRO_STEPS] : BEGINNER_STEPS;
      const target = ids[index];
      if (target) setStep(target);
    },
    [setStep, mode],
  );

  /** Ends the wizard from any step, Pro or Beginner. */
  const finishWizard = useCallback(() => {
    complete();
    trackEvent("onboarding_completed", {
      chainId,
      tokensCount: store.assets.filter((asset) => asset.selected).length,
      coreCount: store.assets.filter((asset) => asset.selected && asset.verified).length,
      watchCount: store.assets.filter((asset) => asset.selected && !asset.verified).length,
    });
    navigate("/dashboard");
  }, [chainId, complete, navigate, store.assets]);

  const wrapEth = useCallback(
    async (amount: bigint) => {
      setWrapError("");
      const weth = getWethAddress(chainId);

      if (DEMO_MODE) {
        setWrapping(true);
        await delay(600);
        setWrapping(false);
        return;
      }

      if (!weth || !walletClient || !publicClient) {
        setWrapError("WETH wrapping is not available on this network.");
        return;
      }

      try {
        setWrapping(true);
        const hash = (await walletClient.writeContract({
          address: weth,
          abi: wethAbi,
          functionName: "deposit",
          args: [],
          value: amount,
          account: walletClient.account.address,
          chain: walletClient.chain,
        })) as Hex;
        await publicClient.waitForTransactionReceipt({ hash });
        await refreshNativeBalance();
      } catch (cause) {
        setWrapError(cause instanceof Error ? cause.message : "The WETH wrap transaction failed.");
      } finally {
        setWrapping(false);
      }
    },
    [chainId, publicClient, refreshNativeBalance, walletClient],
  );

  const steps = useMemo(() => {
    // Pro mode appends its configuration steps after protection is live. They
    // were defined in the store but never added to the list, so a Pro user saw
    // a sentence promising three steps and no way to reach them.
    const ids = mode === "pro" ? [...BEGINNER_STEPS, ...PRO_STEPS] : BEGINNER_STEPS;

    return ids.map((id) => ({
      id,
      title: STEP_META[id].title,
      description: STEP_META[id].description,
      content: null,
      // Pro steps configure the operator's own bot; they gate nothing, so they
      // must be reachable before they can be filled in.
      ...(PRO_STEPS.includes(id) ? { optional: true } : {}),
      complete:
        (id === "connect" && Boolean(account)) ||
        (id === "drainer" && store.drainerStatus === "clean") ||
        (id === "safe-address" && safeAddress !== "") ||
        (id === "assets" && assets.some((asset) => asset.selected)) ||
        (id === "deploy" && vaultAddress !== "") ||
        (id === "approve" && approval.finished && approval.progress.some((p) => p.state === "approved")) ||
        (id === "active" && store.completed) ||
        (id === "whitelist" && store.whitelist.length > 0) ||
        (id === "alerts" && (store.alertsConfig.telegramChatId !== "" || store.alertsConfig.webhookUrl !== "")) ||
        id === "rules",
    }));
  }, [account, approval.finished, approval.progress, assets, mode === "pro", safeAddress, store.alertsConfig, store.completed, store.drainerStatus, store.whitelist.length, vaultAddress]);

  const renderStep = () => {
    switch (step) {
      case "connect":
        return <StepConnectWallet connected={isConnected || DEMO_MODE} onContinue={() => goTo(activeIndex + 1)} />;

      case "drainer":
        return <StepDrainerCheck onBack={() => goTo(activeIndex - 1)} onContinue={() => goTo(activeIndex + 1)} />;

      case "safe-address":
        return (
          <StepSafeAddress
            protectedWallet={account}
            safeWalletClient={walletClient?.account ? walletClient : undefined}
            onBack={() => goTo(activeIndex - 1)}
            onContinue={() => {
              void refreshNativeBalance();
              goTo(activeIndex + 1);
            }}
          />
        );

      case "assets":
        return (
          <StepSelectAssets
            account={account}
            chainId={chainId}
            nativeBalanceWei={store.nativeBalanceWei}
            vaultAddress={vaultAddress ? (vaultAddress as Address) : undefined}
            onWrapEth={wrapEth}
            wrapping={wrapping}
            onBack={() => goTo(activeIndex - 1)}
            onContinue={() => goTo(activeIndex + 1)}
          />
        );

      case "deploy":
        return (
          <StepDeployProtection
            account={account ?? ("0x0000000000000000000000000000000000000000" as Address)}
            chainId={chainId}
            phase={deployHook.phase}
            error={deployHook.error}
            factoryTxHash={deployHook.factoryTxHash}
            vaultTxHash={deployHook.vaultTxHash}
            predictedVaultAddress={deployHook.predictedVaultAddress}
            deploy={() => void deployHook.deploy()}
            params={{ executor: resolvedExecutor, feeReceiver: resolvedFeeReceiver, feeBps }}
            onParamsChange={(patch) => {
              if (patch.executor !== undefined) setExecutor(patch.executor);
              if (patch.feeReceiver !== undefined) setFeeReceiver(patch.feeReceiver);
              if (patch.feeBps !== undefined) setFeeBps(patch.feeBps);
            }}
            onBack={() => goTo(activeIndex - 1)}
            onContinue={() => goTo(activeIndex + 1)}
          />
        );

      case "approve":
        return (
          <StepApproveProtection
            chainId={chainId}
            vaultAddress={vaultAddress as Address}
            assets={assets}
            progress={approval.progress}
            running={approval.running}
            finished={approval.finished}
            run={() => void approval.run()}
            onBack={() => goTo(activeIndex - 1)}
            onContinue={() => {
              complete();
              goTo(activeIndex + 1);
            }}
          />
        );

      case "active":
        return (
          <StepProtectionActive
            account={account ?? ("0x0000000000000000000000000000000000000000" as Address)}
            chainId={chainId}
            vaultAddress={vaultAddress as Address}
            safeAddress={safeAddress}
            assets={assets}
            onFinish={() => {
              complete();
              navigate("/dashboard");
            }}
          />
        );

      case "whitelist":
        return <StepWhitelist onBack={() => goTo(activeIndex - 1)} onFinish={finishWizard} />;

      case "rules":
        return <StepRules onBack={() => goTo(activeIndex - 1)} onFinish={finishWizard} />;

      case "alerts":
        return <StepAlerts onBack={() => goTo(activeIndex - 1)} onFinish={finishWizard} />;

      default:
        return null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Protect a wallet</h1>
        <p className="mt-1 text-text-secondary">
          Six steps plus contract deployment. The safety check cannot be skipped.
          {mode === "pro" && " Pro mode adds whitelist, rules and alert configuration after protection is active."}
        </p>
      </header>

      {wrapError && (
        <p className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          {wrapError}
        </p>
      )}

      <WizardShell steps={steps} activeIndex={activeIndex} onNavigate={goTo}>
        {renderStep()}
      </WizardShell>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={() => {
            reset();
            setExecutor("0x0000000000000000000000000000000000000000");
            setFeeReceiver("0x0000000000000000000000000000000000000000");
            setFeeBps(DEFAULT_FEE_BPS);
            setChainId(chainId);
          }}
          className="text-xs text-text-secondary underline underline-offset-4 hover:text-text-primary"
        >
          Restart onboarding
        </button>
      </div>
    </div>
  );
}