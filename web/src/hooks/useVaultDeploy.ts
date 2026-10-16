import { useCallback, useMemo, useState } from "react";
import {
  encodeDeployData,
  getCreate2Address,
  keccak256,
  parseEventLogs,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import { DEMO_MODE } from "../config/demo";
import {
  rescueVaultAbi,
  rescueVaultBytecode,
  rescueVaultFactoryAbi,
  rescueVaultFactoryBytecode,
} from "../config/contracts";
import { DEMO_ADDRESSES } from "../config/tokens";
import { useOnboardingStore } from "../state/onboarding";

export type DeployPhase = "idle" | "deploying-factory" | "creating-vault" | "confirming" | "done" | "error";

interface VaultDeployParams {
  owner: Address;
  safeAddress: Address;
  executor: Address;
  feeReceiver: Address;
  feeBps: number;
}

interface UseVaultDeploy {
  phase: DeployPhase;
  error: string;
  factoryTxHash: Hex | null;
  vaultTxHash: Hex | null;
  /** CREATE2 address for the current constructor arguments (Pro mode). */
  predictedVaultAddress: Address | null;
  deploy: () => Promise<Address | null>;
  reset: () => void;
}

/** Deterministic salt so re-running the wizard cannot collide on CREATE2. */
function defaultSalt(owner: Address, safeAddress: Address): Hex {
  return keccak256(toBytes(`safegpt-${owner.toLowerCase()}-${safeAddress.toLowerCase()}`));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Step 4.5 "Deploy Protection" (UPD-3).
 *
 * Deploys the RescueVaultFactory once, then creates the vault through it. The
 * factory address is persisted because the vault address is a CREATE2 function
 * of the factory, the constructor arguments and the salt — losing the factory
 * would orphan the user's vault.
 *
 * In Demo Mode both transactions resolve instantly to placeholder addresses so
 * the whole wizard can be recorded without a wallet or gas.
 */
export function useVaultDeploy(
  walletClient: WalletClient | undefined,
  publicClient: PublicClient | undefined,
  params: VaultDeployParams,
): UseVaultDeploy {
  const factoryAddress = useOnboardingStore((state) => state.factoryAddress);
  const vaultAddress = useOnboardingStore((state) => state.vaultAddress);
  const setVaultAddress = useOnboardingStore((state) => state.setVaultAddress);
  const setFactoryAddress = useOnboardingStore((state) => state.setFactoryAddress);
  const setDeployTxHash = useOnboardingStore((state) => state.setDeployTxHash);

  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [error, setError] = useState("");
  const [factoryTxHash, setFactoryTxHash] = useState<Hex | null>(null);
  const [vaultTxHash, setVaultTxHash] = useState<Hex | null>(null);

  const salt = useMemo(() => defaultSalt(params.owner, params.safeAddress), [params.owner, params.safeAddress]);

  const predictedVaultAddress = useMemo<Address | null>(() => {
    if (vaultAddress) return vaultAddress as Address;
    if (!factoryAddress) return null;

    const factory = factoryAddress as Address;
    const initCode = encodeDeployData({
      abi: rescueVaultAbi,
      bytecode: rescueVaultBytecode,
      args: [params.owner, params.safeAddress, params.executor, params.feeReceiver, params.feeBps],
    });

    // getCreate2Address hashes the init code internally.
    return getCreate2Address({ from: factory, salt, bytecode: initCode }) as Address;
  }, [factoryAddress, params, salt, vaultAddress]);

  const deploy = useCallback(async (): Promise<Address | null> => {
    setError("");

    if (DEMO_MODE) {
      try {
        setPhase("deploying-factory");
        await delay(500);
        if (!useOnboardingStore.getState().factoryAddress) setFactoryAddress(DEMO_ADDRESSES.factory);
        setPhase("creating-vault");
        await delay(700);
        setVaultTxHash(DEMO_ADDRESSES.tx as Hex);
        setDeployTxHash(DEMO_ADDRESSES.tx);
        setVaultAddress(DEMO_ADDRESSES.vault);
        setPhase("done");
        return DEMO_ADDRESSES.vault;
      } catch (cause) {
        setPhase("error");
        setError(cause instanceof Error ? cause.message : "Demo deployment failed.");
        return null;
      }
    }

    if (!walletClient?.account || !publicClient) {
      setError("Connect a wallet before deploying.");
      setPhase("error");
      return null;
    }

    const account = walletClient.account.address;
    if (account.toLowerCase() !== params.owner.toLowerCase()) {
      setError("Connect the wallet you are protecting before deploying the vault.");
      setPhase("error");
      return null;
    }

    try {
      let factory: Address | undefined = factoryAddress ? (factoryAddress as Address) : undefined;

      if (!factory) {
        setPhase("deploying-factory");
        const hash = await walletClient.deployContract({
          abi: rescueVaultFactoryAbi,
          bytecode: rescueVaultFactoryBytecode,
          account,
          chain: walletClient.chain,
        });
        setFactoryTxHash(hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success" || !receipt.contractAddress) {
          throw new Error("The factory deployment transaction reverted.");
        }
        factory = receipt.contractAddress;
        setFactoryAddress(factory);
      }

      setPhase("creating-vault");
      const hash = await walletClient.writeContract({
        address: factory,
        abi: rescueVaultFactoryAbi,
        functionName: "createVault",
        args: [account, params.safeAddress, params.executor, params.feeReceiver, params.feeBps, salt],
        account,
        chain: walletClient.chain,
      });
      setVaultTxHash(hash);

      setPhase("confirming");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The vault creation transaction reverted.");
      }

      // Prefer the event; fall back to the deterministic CREATE2 computation.
      const logs = parseEventLogs({
        abi: rescueVaultFactoryAbi,
        eventName: "VaultCreated",
        logs: receipt.logs,
        strict: false,
      });
const created = (logs[0] as { args?: { vault?: Address } } | undefined)?.args?.vault;

      const address =
        created ??
        (getCreate2Address({
          from: factory,
          salt,
          bytecode: encodeDeployData({
            abi: rescueVaultAbi,
            bytecode: rescueVaultBytecode,
            args: [account, params.safeAddress, params.executor, params.feeReceiver, params.feeBps],
          }),
        }) as Address);

      setVaultAddress(address);
      setDeployTxHash(hash);
      setPhase("done");
      return address;
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error && cause.message ? cause.message : "Deployment failed.");
      return null;
    }
  }, [factoryAddress, params, publicClient, setDeployTxHash, setFactoryAddress, setVaultAddress, walletClient]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError("");
    setFactoryTxHash(null);
    setVaultTxHash(null);
  }, []);

  return { phase, error, factoryTxHash, vaultTxHash, predictedVaultAddress, deploy, reset };
}