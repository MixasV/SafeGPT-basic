import { useCallback, useState } from "react";
import type { Address, PublicClient } from "viem";

import { DEMO_MODE } from "../config/demo";
import { useOnboardingStore } from "../state/onboarding";
import { trackEvent } from "../utils/analytics";

export interface DrainerCheckResult {
  status: "clean" | "compromised";
  message: string;
  depositedWei: bigint;
}

export type DrainerCheckPhase =
  /** Nothing recorded yet. */
  | "idle"
  /** Reading the starting balance. */
  | "recording"
  /** Balance captured вЂ” waiting for the user to send the test deposit. */
  | "awaiting-deposit"
  /** Waiting for two blocks to elapse. */
  | "checking"
  /** The result is on screen. */
  | "verdict";

interface UseDrainerCheck {
  phase: DrainerCheckPhase;
  balanceBefore: bigint;
  balanceAfter: bigint;
  error: string;
  /** Snapshot the balance before the user sends the test deposit. */
  recordBalance: () => Promise<void>;
  /** Wait two blocks and compare balances, exactly as specified in section 6. */
  runCheck: () => Promise<DrainerCheckResult | null>;
  /** Demo-only: force either outcome so both states can be recorded on video. */
  simulate: (outcome: "clean" | "compromised") => void;
  reset: () => void;
}

const BLOCKS_TO_WAIT = 2n;
const POLL_INTERVAL_MS = 4_000;
const DEMO_BALANCE = 1_000_000_000_000_000n; // 0.001 ETH, only a stand-in for the UI

/** Polls until the chain reaches `targetBlock`. Works with HTTP and WS transports. */
async function waitForBlock(publicClient: PublicClient, targetBlock: bigint): Promise<void> {
  for (;;) {
    const current = await publicClient.getBlockNumber();
    if (current >= targetBlock) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function asError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Drainer check (specification section 6).
 *
 * Records the native balance, asks the user to deposit about $1 of ETH, waits
 * two blocks and verifies the deposit survived. A balance that failed to grow
 * means an active sweeper is draining the wallet.
 *
 * This check detects ACTIVE ETH sweepers only. It does NOT detect token-specific
 * drainers, dormant compromises, or malicious approvals вЂ” the UI repeats that.
 */
export function useDrainerCheck(publicClient: PublicClient | undefined, account: Address | undefined): UseDrainerCheck {
  const setDrainer = useOnboardingStore((state) => state.setDrainer);

  const [phase, setPhase] = useState<DrainerCheckPhase>("idle");
  const [balanceBefore, setBalanceBefore] = useState(0n);
  const [balanceAfter, setBalanceAfter] = useState(0n);
  const [error, setError] = useState("");

  const recordBalance = useCallback(async () => {
    if (DEMO_MODE) {
      setBalanceBefore(DEMO_BALANCE);
      setBalanceAfter(DEMO_BALANCE);
      setPhase("awaiting-deposit");
      setDrainer("awaiting-deposit", "Demo mode: no deposit is required.", DEMO_BALANCE);
      return;
    }

    if (!publicClient || !account) {
      setError("Connect a wallet before running the drainer check.");
      return;
    }

    try {
      setError("");
      setPhase("recording");
      const balance = await publicClient.getBalance({ address: account });
      setBalanceBefore(balance);
      setPhase("awaiting-deposit");
      setDrainer("awaiting-deposit", "Waiting for the test deposit.", balance);
    } catch (cause) {
      setPhase("idle");
      setError(asError(cause, "Failed to read the wallet balance."));
    }
  }, [account, publicClient, setDrainer]);

  const runCheck = useCallback(async (): Promise<DrainerCheckResult | null> => {
    if (DEMO_MODE) {
      // No deposit and no blocks to wait for: resolve to the clean outcome so the
      // wizard keeps moving. The compromised outcome stays reachable through the
      // explicit simulate() buttons.
      setPhase("verdict");
      setBalanceBefore(DEMO_BALANCE);
      setBalanceAfter(DEMO_BALANCE * 2n);
      setDrainer("clean", "Demo mode: no active drainer detected.", DEMO_BALANCE * 2n);
      return null;
    }

    if (!publicClient || !account) {
      setError("Connect a wallet before running the drainer check.");
      return null;
    }

    try {
      setError("");
      setPhase("checking");

      const startBlock = await publicClient.getBlockNumber();
      await waitForBlock(publicClient, startBlock + BLOCKS_TO_WAIT);

      const balance = await publicClient.getBalance({ address: account });
      setBalanceAfter(balance);
      setPhase("verdict");

      if (balance <= balanceBefore) {
        const message = "ETH deposit disappeared within 2 blocks. Active drainer detected.";
        setDrainer("compromised", message, balance);
        // Grant reporting counts how many wallets arrive already compromised — the
    // clearest signal that the check is doing its job.
    trackEvent("drainer_check_failed", { errorKind: "balance-dropped" });
    return { status: "compromised", message, depositedWei: 0n };
      }

      const deposited = balance - balanceBefore;
      const message = "No active drainer detected. Proceeding with setup.";
      setDrainer("clean", message, balance);
      trackEvent("drainer_check_passed", {});
    return { status: "clean", message, depositedWei: deposited };
    } catch (cause) {
      setPhase("idle");
      setError(asError(cause, "The drainer check failed."));
      return null;
    }
  }, [account, balanceBefore, publicClient, setDrainer]);

  const simulate = useCallback(
    (outcome: "clean" | "compromised") => {
      if (!DEMO_MODE) return;
      setPhase("verdict");
      if (outcome === "clean") {
        setBalanceBefore(DEMO_BALANCE);
        setBalanceAfter(DEMO_BALANCE * 2n);
        setDrainer("clean", "Demo mode: no active drainer detected.", DEMO_BALANCE * 2n);
      } else {
        setBalanceBefore(DEMO_BALANCE);
        setBalanceAfter(DEMO_BALANCE);
        setDrainer(
          "compromised",
          "Demo mode: the ETH deposit disappeared within 2 blocks. Active drainer detected.",
          DEMO_BALANCE,
        );
      }
    },
    [setDrainer],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError("");
    setBalanceBefore(0n);
    setBalanceAfter(0n);
    setDrainer("idle", "");
  }, [setDrainer]);

  return { phase, balanceBefore, balanceAfter, error, recordBalance, runCheck, simulate, reset };
}