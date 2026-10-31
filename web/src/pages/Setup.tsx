import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Address, Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";

import { StepApproveProtection } from "../components/onboarding/StepApproveProtection";
import { StepConnectWallet } from "../components/onboarding/StepConnectWallet";
import { AskAI } from "../features/dashboard/AskAI";
import { StepHowItWorks } from "../components/onboarding/StepHowItWorks";
import { StepQuiz } from "../components/onboarding/StepQuiz";
import { ChainGPTSetup } from "../components/onboarding/ChainGPTSetup";
import { StepDeployProtection } from "../components/onboarding/StepDeployProtection";
import { StepDrainerCheck } from "../components/onboarding/StepDrainerCheck";
import { StepAlerts, StepRules, StepWhitelist } from "../components/onboarding/StepProConfig";
import { StepProtectionActive } from "../components/onboarding/StepProtectionActive";
import { StepSafeAddress } from "../components/onboarding/StepSafeAddress";
import { StepExecutorAddress } from "../components/onboarding/StepExecutorAddress";
import { StepSelectAssets } from "../components/onboarding/StepSelectAssets";
import { PreDeployReview } from "../components/onboarding/PreDeployReview";
import { WizardShell } from "../components/onboarding/WizardShell";
import { DEMO_MODE } from "../config/demo";
import { DEFAULT_FEE_BPS, getWethAddress, wethAbi } from "../config/contracts";
import { DEMO_ADDRESSES } from "../config/tokens";
import { useApprovalFlow } from "../hooks/useApprovalFlow";
import { useMode, useModeStore } from "../hooks/useMode";
import { useVaultDeploy } from "../hooks/useVaultDeploy";
import { BEGINNER_STEPS, PRO_STEPS, useOnboardingStore, type WizardStepId } from "../state/onboarding";
import { trackEvent } from "../utils/analytics";

const STEP_META: Record<WizardStepId, { title: string; description: string }> = {
  "how-it-works": { title: "How it works", description: "Overview" },
  quiz: { title: "Understanding check", description: "Quick quiz" },
  connect: { title: "Connect wallet", description: "Pick the wallet to protect" },
  drainer: { title: "Safety check", description: "Detect an active sweeper" },
  chaingpt: { title: "ChainGPT AI", description: "Optional AI setup" },
  "safe-address": { title: "Safe address", description: "Where funds are rescued to" },
  executor: { title: "Executor (bot)", description: "Bot wallet that pays gas" },
  assets: { title: "Select assets", description: "Scan ERC-20 balances" },
  "pre-deploy": { title: "Pre-deploy review", description: "AI config review" },
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
  const walletChainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const store = useOnboardingStore();
  const {
    step,
    chainId,
    walletAddress,
    safeAddress,
    vaultAddress,
    assets,
    setStep,
    setWalletAddress,
    setAssets,
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

  useEffect(() => {
    if (DEMO_MODE) return;
    if (!account) {
      reset();
      setWalletAddress("");
      return;
    }
    if (walletAddress === "") {
      setWalletAddress(account);
      return;
    }
    if (account !== walletAddress) {
      reset();
      setWalletAddress(account);
    }
  }, [account, walletAddress, reset, setWalletAddress]);

  // Default the executor and fee receiver to the connected wallet so the wizard
  // works out of the box; Pro mode exposes both for a self-hosted deployment.
  const resolvedExecutor = executor;
  const resolvedFeeReceiver =
    feeReceiver === "0x0000000000000000000000000000000000000000"
      ? (safeAddress || account || "0x0000000000000000000000000000000000000000")
      : feeReceiver;

  const deployHook = useVaultDeploy(walletClient, publicClient, {
    owner: account ?? ("0x0000000000000000000000000000000000000000" as Address),
    safeAddress: (safeAddress || "0x0000000000000000000000000000000000000000") as Address,
    executor: resolvedExecutor as Address,
    feeReceiver: resolvedFeeReceiver as Address,
    feeBps,
  });

  const approval = useApprovalFlow(walletClient, publicClient, vaultAddress as Address, assets);

  const activeIndex = Math.max(0, BEGINNER_STEPS.indexOf(step));

  /**
   * Keep the onboarding chain in sync with the connected wallet. Without this
   * the store defaulted to mainnet (1) and the token scan read mainnet contracts
   * even when the wallet was on Sepolia — so a Sepolia WETH balance was never
   * found because the scan asked the mainnet WETH contract, which the wallet
   * does not hold. wagmi is the source of truth for the active network.
   */
  useEffect(() => {
    if (!DEMO_MODE && isConnected && walletChainId && walletChainId !== chainId) {
      setAssets([]);
      setChainId(walletChainId);
    }
  }, [isConnected, walletChainId, chainId, setChainId, setAssets]);

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

  useEffect(() => {
    if (step === "assets") {
      void refreshNativeBalance();
    }
  }, [step, refreshNativeBalance]);

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

  useEffect(() => {
    if (step !== "quiz") return;
    try {
      const raw = localStorage.getItem("safegpt_quiz_completed");
      if (raw) {
        const parsed = JSON.parse(raw) as { version?: number };
        if (parsed.version === 1) {
          goTo(activeIndex + 1);
        }
      }
    } catch {
      // ignore
    }
  }, [step, activeIndex, goTo]);

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
        const msg = cause instanceof Error ? cause.message : "The WETH wrap transaction failed.";
        if (/reject|denied|cancelled/i.test(msg)) {
          setWrapError("Transaction cancelled by user.");
        } else {
          setWrapError(msg);
        }
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
      case "how-it-works":
        return <StepHowItWorks onContinue={() => goTo(activeIndex + 1)} />;

      case "quiz":
        return <StepQuiz onContinue={() => goTo(activeIndex + 1)} />;

      case "connect":
        return <StepConnectWallet connected={isConnected || DEMO_MODE} onContinue={() => goTo(activeIndex + 1)} />;

      case "drainer":
        return <StepDrainerCheck onBack={() => goTo(activeIndex - 1)} onContinue={() => goTo(activeIndex + 1)} />;

      case "chaingpt":
        return <ChainGPTSetup onContinue={() => goTo(activeIndex + 1)} />;

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

      case "executor":
        return <StepExecutorAddress onBack={() => goTo(activeIndex - 1)} onContinue={() => goTo(activeIndex + 1)} />;

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

      case "pre-deploy":
        return <PreDeployReview onContinue={() => goTo(activeIndex + 1)} />;

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
            params={{ executor: resolvedExecutor as Address, feeReceiver: resolvedFeeReceiver as Address, feeBps }}
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
            executorAddress={resolvedExecutor}
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

      {chainId !== 1 && chainId !== 8453 && chainId !== 42161 && (
        <p className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-600">
          Testnet mode — no real assets. Use for testing only.
        </p>
      )}

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => useModeStore.getState().toggleMode()}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
        >
          {mode === "pro" ? "Switch to Beginner" : "Switch to Pro mode"}
        </button>
      </div>

      <WizardShell steps={steps} activeIndex={activeIndex} onNavigate={goTo}>
            {renderStep()}
          </WizardShell>

          <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem("safegpt-onboarding");
            localStorage.removeItem("safegpt_quiz_completed");
            reset();
            setWalletAddress("");
            setExecutor("0x0000000000000000000000000000000000000000");
            setFeeReceiver("0x0000000000000000000000000000000000000000");
            setFeeBps(DEFAULT_FEE_BPS);
            setChainId(chainId);
            window.location.reload();
          }}
          className="text-xs text-text-secondary underline underline-offset-4 hover:text-text-primary"
        >
          Restart onboarding
        </button>
      </div>

      <div className="mt-6">
        <AskAI />
      </div>
    </div>
  );
}