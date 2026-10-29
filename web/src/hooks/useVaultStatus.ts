import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { Address, PublicClient } from "viem";

import {
  deriveProtectionStatus,
  MIN_EXECUTOR_ETH,
  type ProtectionStatus,
  type TokenAllowance,
} from "../dashboard/status";
import { erc20Abi, rescueVaultAbi } from "../config/contracts";
import { DEMO_MODE } from "../config/demo";
import {
  MOCK_BALANCES,
  MOCK_EXECUTOR_BALANCE,
  MOCK_TOKENS,
  MOCK_VAULT_DEPLOYED,
  MOCK_WALLET,
} from "../mocks/dashboard-mocks";
import type { SelectedAsset } from "../state/onboarding";
import { useOnboardingStore } from "../state/onboarding";

/**
 * Live protection state, read straight from the chain.
 *
 * There is no backend yet (later sprint), so the dashboard polls. Every value
 * comes from a contract read, which means the dashboard shows the same truth the
 * bot would act on rather than a cached opinion.
 */

/** 15s, not per-block: this is a UI, not the bot. */
export const POLL_INTERVAL_MS = 15_000;

export interface VaultState {
  vaultDeployed: boolean;
  executorAddress: `0x${string}` | undefined;
  executorBalance: bigint;
  minExecutorEth: bigint;
  tokens: TokenAllowance[];
  /** Pre-formatted balances keyed by token symbol, so no price feed is needed. */
  balances: Record<string, string>;
  protectedWallet: `0x${string}` | undefined;
  safeAddress: `0x${string}` | undefined;
  vaultAddress: `0x${string}` | undefined;
  chainId: number;
  isDemo: boolean;
  isLoading: boolean;
  error: string | undefined;
  refresh: () => void;
}

const INITIAL: Omit<VaultState, "refresh"> = {
  vaultDeployed: false,
  executorAddress: undefined,
  executorBalance: 0n,
  minExecutorEth: MIN_EXECUTOR_ETH,
  tokens: [],
  balances: {},
  protectedWallet: undefined,
  safeAddress: undefined,
  vaultAddress: undefined,
  chainId: 11155111,
  isDemo: DEMO_MODE,
  isLoading: !DEMO_MODE,
  error: undefined,
};

function formatUnits(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

interface AssetRow {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  balance: bigint;
  allowance: bigint;
  verified: boolean;
}

async function readAssets(
  client: PublicClient,
  vaultAddress: `0x${string}`,
  protectedWallet: `0x${string}`,
  assets: SelectedAsset[],
): Promise<AssetRow[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const address = asset.address as `0x${string}`;

      // Symbol and decimals rarely change and are already known from the
      // wizard, so a failure there must not sink the whole row.
      const [balance, allowance, symbol, decimals] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [protectedWallet] }),
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [protectedWallet, vaultAddress],
        }),
        client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => asset.symbol),
        client.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(() => asset.decimals),
      ]);

      return { address, symbol, decimals, balance, allowance, verified: asset.verified };
    }),
  );
}

const DEMO_STATE: Omit<VaultState, "refresh"> = {
  ...INITIAL,
  vaultDeployed: MOCK_VAULT_DEPLOYED,
  executorAddress: MOCK_WALLET.executorAddress,
  executorBalance: MOCK_EXECUTOR_BALANCE,
  minExecutorEth: MIN_EXECUTOR_ETH,
  tokens: MOCK_TOKENS,
  balances: MOCK_BALANCES,
  protectedWallet: MOCK_WALLET.protectedWallet,
  safeAddress: MOCK_WALLET.safeAddress,
  vaultAddress: MOCK_WALLET.vaultAddress,
  chainId: MOCK_WALLET.chainId,
  isLoading: false,
};

export function useVaultStatus(): VaultState {
  const publicClient = usePublicClient();
  const { address } = useAccount();

  const vaultAddress = useOnboardingStore((state) => state.vaultAddress);
  const safeAddress = useOnboardingStore((state) => state.safeAddress);
  const chainId = useOnboardingStore((state) => state.chainId);
  const assets = useOnboardingStore((state) => state.assets);

  const [state, setState] = useState<Omit<VaultState, "refresh">>(DEMO_MODE ? DEMO_STATE : INITIAL);
  const [nonce, setNonce] = useState(0);

  // Stable identity: a changing `refresh` would restart the poll effect.
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (DEMO_MODE) return;

    const client = publicClient;
    const vault = vaultAddress === "" ? undefined : (vaultAddress as `0x${string}`);
    const wallet = address;

    if (!client || !vault || !wallet) {
      setState({
        ...INITIAL,
        chainId,
        safeAddress: safeAddress === "" ? undefined : (safeAddress as `0x${string}`),
        vaultAddress: vault,
        protectedWallet: wallet,
      });
      return;
    }

    let cancelled = false;
    setState((previous) => ({ ...previous, isLoading: true, vaultAddress: vault, chainId }));

    void (async () => {
      try {
        const [executor, vaultSafe, rows] = await Promise.all([
          client.readContract({ address: vault, abi: rescueVaultAbi, functionName: "executor" }) as Promise<Address>,
          client.readContract({ address: vault, abi: rescueVaultAbi, functionName: "safeAddress" }) as Promise<Address>,
          readAssets(client, vault, wallet, assets.filter((asset) => asset.selected)),
        ]);
        const executorBalance = await client.getBalance({ address: executor });

        if (cancelled) return;

        const tokens: TokenAllowance[] = [];
        const balances: Record<string, string> = {};
        for (const row of rows) {
          tokens.push({
            address: row.address,
            symbol: row.symbol,
            kind: row.verified ? "core" : "watch",
            allowance: row.allowance,
          });
          balances[row.symbol] = formatUnits(row.balance, row.decimals);
        }

        setState({
          vaultDeployed: true,
          executorAddress: executor,
          executorBalance,
          minExecutorEth: MIN_EXECUTOR_ETH,
          tokens,
          balances,
          protectedWallet: wallet,
          safeAddress: vaultSafe,
          vaultAddress: vault,
          chainId,
          isDemo: false,
          isLoading: false,
          error: undefined,
        });
      } catch (error) {
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, vaultAddress, safeAddress, chainId, address, assets, nonce]);

  // Polling is separate from the read effect so `refresh` and the timer cannot
  // fight over the same dependency list.
  useEffect(() => {
    if (DEMO_MODE) return;
    const timer = setInterval(() => setNonce((value) => value + 1), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return { ...state, refresh };
}

/** Derives the headline status. A plain function, not a hook — it has no state. */
export function toProtectionStatus(vault: VaultState): ProtectionStatus {
  return deriveProtectionStatus({
    vaultDeployed: vault.vaultDeployed,
    tokens: vault.tokens,
    executorBalance: vault.executorBalance,
    minExecutorEth: vault.minExecutorEth,
  });
}