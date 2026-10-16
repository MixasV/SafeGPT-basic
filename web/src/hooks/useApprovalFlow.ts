import { useCallback, useState } from "react";
import { maxUint256, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

import { DEMO_MODE } from "../config/demo";
import { erc20Abi } from "../config/contracts";
import type { SelectedAsset } from "../state/onboarding";

export type ApprovalState = "pending" | "approving" | "approved" | "skipped" | "error";

export interface ApprovalProgress {
  address: string;
  symbol: string;
  state: ApprovalState;
  error?: string;
  txHash?: Hex;
}

interface UseApprovalFlow {
  progress: ApprovalProgress[];
  running: boolean;
  finished: boolean;
  run: () => Promise<void>;
  reset: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Step 5 "Approve Protection".
 *
 * The vault can only move a token the owner approved, so every selected asset
 * needs `approve(vault, unlimited)`. Approvals are sent one at a time — running
 * them concurrently makes a partially approved state much harder to reason about
 * if a transaction is dropped.
 */
export function useApprovalFlow(
  walletClient: WalletClient | undefined,
  publicClient: PublicClient | undefined,
  vaultAddress: Address,
  assets: SelectedAsset[],
): UseApprovalFlow {
  const [progress, setProgress] = useState<ApprovalProgress[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const run = useCallback(async () => {
    const targets = assets.filter((asset) => asset.selected);
    setRunning(true);
    setFinished(false);
    setProgress(
      targets.map((asset) => ({ address: asset.address, symbol: asset.symbol, state: "pending" as ApprovalState })),
    );

    for (let index = 0; index < targets.length; index += 1) {
      const asset = targets[index];
      if (!asset) continue;

      const update = (patch: Partial<ApprovalProgress>) =>
        setProgress((current) =>
          current.map((entry, position) =>
            position === index && entry.address === asset.address ? { ...entry, ...patch } : entry,
          ),
        );

      if (DEMO_MODE) {
        update({ state: "approving" });
        await delay(350);
        update({ state: "approved", txHash: "0x00000000000000000000000000000000000000TX" });
        continue;
      }

      if (!walletClient?.account || !publicClient) {
        update({ state: "error", error: "Wallet not connected." });
        continue;
      }

      try {
        update({ state: "approving" });
        const account = walletClient.account.address;
        const hash = await walletClient.writeContract({
          address: asset.address as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddress, maxUint256],
          account,
          chain: walletClient.chain,
        });
        update({ txHash: hash });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          update({ state: "error", error: "The approval transaction reverted." });
          continue;
        }
        update({ state: "approved" });
      } catch (cause) {
        update({
          state: "error",
          error: cause instanceof Error && cause.message ? cause.message : "Approval failed.",
        });
      }
    }

    setRunning(false);
    setFinished(true);
  }, [assets, publicClient, vaultAddress, walletClient]);

  const reset = useCallback(() => {
    setProgress([]);
    setRunning(false);
    setFinished(false);
  }, []);

  return { progress, running, finished, run, reset };
}