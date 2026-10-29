import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";

import { rescueVaultAbi } from "../config/contracts";
import { DEMO_MODE } from "../config/demo";
import { MOCK_RESCUES, MOCK_WALLET, type DemoRescue } from "../mocks/dashboard-mocks";
import { useOnboardingStore } from "../state/onboarding";

/**
 * Rescue history, reconstructed from vault events.
 *
 * No backend yet, so this reads the chain directly. All three event types are
 * rendered, because showing only the happy path is exactly how a silent failure
 * stays hidden:
 *
 *   Rescued(token, amount, destination) — the pull succeeded
 *   RescueFailed(token, amount)        — transferFrom failed; the asset is still out
 *   RescueSkipped(token, reason)       — empty balance, or an unreadable token
 *
 * WHY THERE IS NO "TRIGGER" FIELD
 * ------------------------------
 * The vault does not know which bot rule fired; R1..R9 live in the bot. A
 * reconstructed history can therefore never state a cause. Demo Mode fakes one
 * so the UI can be shown; real mode omits the field rather than inventing it.
 * It becomes real when the bot writes to a backend.
 */

/** How far back to read. Public RPCs reject unbounded `eth_getLogs` ranges. */
const LOOKBACK_BLOCKS = 50_000n;

/** Maximum batches rendered, newest first. */
const MAX_BATCHES = 20;

export type RescueOutcome = "success" | "failed" | "skipped";

export interface RescueEvent {
  id: string;
  token: `0x${string}`;
  symbol: string;
  rawAmount: bigint;
  amount: string;
  outcome: RescueOutcome;
  destination: `0x${string}` | undefined;
  txHash: `0x${string}`;
  blockNumber: bigint;
  /** Milliseconds since epoch, from the block. Null when unavailable. */
  timestamp: number | null;
  skipReason?: string;
}

export interface RescueBatch {
  id: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp: number | null;
  events: RescueEvent[];
  destination: `0x${string}` | undefined;
  /** "success" only when every pull in the batch succeeded. */
  outcome: RescueOutcome;
  trigger?: string;
}

export interface RescueHistoryData {
  batches: RescueBatch[];
  isDemo: boolean;
  isLoading: boolean;
  error: string | undefined;
}

export type RescueHistoryState = RescueHistoryData & { reload: () => void };

const EMPTY: RescueHistoryState = { batches: [], isDemo: DEMO_MODE, isLoading: !DEMO_MODE, error: undefined, reload: () => {} };

/** bytes32 reason constants mirrored from RescueVault. */
const SKIP_REASONS: Record<string, string> = {
  "0x0000000000000000000000000000000000000000000000000000000000000000": "Balance could not be read",
  "0x0000000000000000000000000000000000000000000000000000000000000001": "Zero balance",
};

function shortAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function demoBatches(now: number): RescueBatch[] {
  return MOCK_RESCUES.map((rescue: DemoRescue) => ({
    id: rescue.id,
    txHash: rescue.txHash,
    blockNumber: 0n,
    timestamp: now - rescue.minutesAgo * 60_000,
    destination: MOCK_WALLET.safeAddress,
    outcome: rescue.outcome,
    ...(rescue.trigger === undefined ? {} : { trigger: rescue.trigger }),
    events: rescue.tokens.map((token, index) => ({
      id: `${rescue.id}-${index}`,
      token: MOCK_WALLET.vaultAddress,
      symbol: token.symbol,
      rawAmount: 0n,
      amount: token.amount,
      outcome: "success" as const,
      destination: MOCK_WALLET.safeAddress,
      txHash: rescue.txHash,
      blockNumber: 0n,
      timestamp: now - rescue.minutesAgo * 60_000,
    })),
  }));
}

export function useRescueEvents(): RescueHistoryState {
  const publicClient = usePublicClient();
  const vaultAddress = useOnboardingStore((state) => state.vaultAddress);
  const assets = useOnboardingStore((state) => state.assets);

  const [state, setState] = useState<RescueHistoryState>(EMPTY);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const symbolByAddress = useMemo(
    () => new Map(assets.map((asset) => [asset.address.toLowerCase(), asset.symbol])),
    [assets],
  );
  const decimalsByAddress = useMemo(
    () => new Map(assets.map((asset) => [asset.address.toLowerCase(), asset.decimals])),
    [assets],
  );

  useEffect(() => {
    if (DEMO_MODE) {
setState({ batches: demoBatches(Date.now()), isDemo: true, isLoading: false, error: undefined, reload });
      return;
    }

    const client = publicClient;
    const vault = vaultAddress === "" ? undefined : (vaultAddress as `0x${string}`);
    if (!client || !vault) {
      setState({ batches: [], isDemo: false, isLoading: false, error: undefined, reload });
      return;
    }

    let cancelled = false;
    setState((previous) => ({ ...previous, isLoading: true }));

    void (async () => {
      try {
        const head = await client.getBlockNumber();
        const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;

        const [rescued, failed, skipped] = await Promise.all([
          client.getContractEvents({
            address: vault,
            abi: rescueVaultAbi,
            eventName: "Rescued",
            fromBlock,
            toBlock: head,
          }),
          client.getContractEvents({
            address: vault,
            abi: rescueVaultAbi,
            eventName: "RescueFailed",
            fromBlock,
            toBlock: head,
          }),
          client.getContractEvents({
            address: vault,
            abi: rescueVaultAbi,
            eventName: "RescueSkipped",
            fromBlock,
            toBlock: head,
          }),
        ]);

        // Group first, then resolve one timestamp per distinct block. Fetching
        // per-event would repeat identical RPC calls; inventing a timestamp
        // from the block number would be a lie.
        const grouped = new Map<string, { blockNumber: bigint; events: RescueEvent[] }>();
        const push = (txHash: string, blockNumber: bigint, event: RescueEvent): void => {
          const key = `${txHash}:${blockNumber}`;
          const entry = grouped.get(key);
          if (entry === undefined) grouped.set(key, { blockNumber, events: [event] });
          else entry.events.push(event);
        };

        for (const log of rescued) {
          const args = log.args as { token: `0x${string}`; amount: bigint; destination: `0x${string}` };
          push(log.transactionHash, log.blockNumber ?? 0n, {
            id: `${log.transactionHash}-${args.token}`,
            token: args.token,
            symbol: symbolByAddress.get(args.token.toLowerCase()) ?? shortAddress(args.token),
            rawAmount: args.amount,
            amount: formatUnits(args.amount, decimalsByAddress.get(args.token.toLowerCase()) ?? 18),
            outcome: "success",
            destination: args.destination,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber ?? 0n,
            timestamp: null,
          });
        }

        for (const log of failed) {
          const args = log.args as { token: `0x${string}`; amount: bigint };
          push(log.transactionHash, log.blockNumber ?? 0n, {
            id: `${log.transactionHash}-${args.token}-failed`,
            token: args.token,
            symbol: symbolByAddress.get(args.token.toLowerCase()) ?? shortAddress(args.token),
            rawAmount: args.amount,
            amount: formatUnits(args.amount, decimalsByAddress.get(args.token.toLowerCase()) ?? 18),
            outcome: "failed",
            destination: undefined,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber ?? 0n,
            timestamp: null,
          });
        }

        for (const log of skipped) {
          const args = log.args as { token: `0x${string}`; reason: `0x${string}` };
          push(log.transactionHash, log.blockNumber ?? 0n, {
            id: `${log.transactionHash}-${args.token}-skipped`,
            token: args.token,
            symbol: symbolByAddress.get(args.token.toLowerCase()) ?? shortAddress(args.token),
            rawAmount: 0n,
            amount: "0",
            outcome: "skipped",
            destination: undefined,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber ?? 0n,
            timestamp: null,
            skipReason: SKIP_REASONS[args.reason] ?? `Unknown reason ${args.reason}`,
          });
        }

        const entries = [...grouped.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber));

        const stamps = await Promise.all(
          entries.slice(0, MAX_BATCHES).map(async (entry) => {
            try {
              const block = await client.getBlock({ blockNumber: entry.blockNumber });
              return Number(block.timestamp) * 1000;
            } catch {
              // A missing timestamp must not lose the rescue itself.
              return null;
            }
          }),
        );

        if (cancelled) return;

        const batches: RescueBatch[] = entries.slice(0, MAX_BATCHES).map((entry, index) => ({
          id: entry.events[0]?.id ?? `batch-${index}`,
          txHash: entry.events[0]?.txHash ?? (`0x${"0".repeat(64)}` as `0x${string}`),
          blockNumber: entry.blockNumber,
          timestamp: stamps[index] ?? null,
          events: entry.events,
          destination: entry.events.find((event) => event.destination !== undefined)?.destination,
          outcome: entry.events.every((event) => event.outcome === "success")
            ? ("success" as const)
            : entry.events.some((event) => event.outcome === "failed")
              ? ("failed" as const)
              : ("skipped" as const),
        }));

        setState({ batches, isDemo: false, isLoading: false, error: undefined, reload });
      } catch (error) {
        if (cancelled) return;
        setState({
          batches: [],
          isDemo: false,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
          reload,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, vaultAddress, symbolByAddress, decimalsByAddress, nonce, reload]);

  return state;
}

export { LOOKBACK_BLOCKS, MAX_BATCHES };