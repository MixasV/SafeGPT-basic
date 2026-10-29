import { MIN_EXECUTOR_ETH, type TokenAllowance } from "../dashboard/status";

/**
 * Demo Mode fixtures for the dashboard.
 *
 * These exist so the grant demo shows a working, fully-populated dashboard with
 * no wallet, no gas and no deployed contract. They are deliberately NOT used in
 * normal operation — `useVaultStatus` falls back to real reads.
 *
 * The numbers below are chosen to exercise every status path, not to look
 * plausible: one stranded core asset and a healthy executor (attention), plus a
 * watch token, so the grant video can show both a warning and a green check in
 * one screen.
 */

export const MOCK_CHAIN_ID = 11155111;

/** Typed so these can be handed straight to components expecting `0x${string}`. */
export const MOCK_WALLET = {
  protectedWallet: "0x1234567890AbcdEF1234567890aBcdef12345678",
  safeAddress: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
  vaultAddress: "0xcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc",
  executorAddress: "0xeXeXeXeEeEeEeEeEeEeEeEeEeEeEeEeEeEeE",
  variant: "A",
  chainId: MOCK_CHAIN_ID,
} as const satisfies {
  protectedWallet: `0x${string}`;
  safeAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  executorAddress: `0x${string}`;
  variant: "A" | "B";
  chainId: number;
};

export const MOCK_MIN_EXECUTOR_ETH = MIN_EXECUTOR_ETH;

export const MOCK_EXECUTOR_BALANCE = 420_000_000_000_000_000n; // 0.42 ETH — healthy

export const MOCK_VAULT_DEPLOYED = true;

export const MOCK_TOKENS: TokenAllowance[] = [
  {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    symbol: "USDC",
    kind: "core",
    allowance: 2n ** 256n - 1n,
  },
  {
    address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    symbol: "WETH",
    kind: "core",
    allowance: 2n ** 256n - 1n,
  },
  {
    // Allowance revoked — this is what produces the "needs re-approval" row and
    // the yellow headline in the demo.
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7239",
    symbol: "DAI",
    kind: "core",
    allowance: 0n,
  },
  {
    address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
    symbol: "SHIB",
    kind: "watch",
    allowance: 2n ** 256n - 1n,
  },
];

/** Display balances, pre-formatted so the demo never needs a price feed. */
export const MOCK_BALANCES: Record<string, string> = {
  USDC: "1,000.00",
  WETH: "0.500",
  DAI: "500.00",
  SHIB: "1,000,000",
};

export type AlertSeverity = "critical" | "high" | "info";
export type AlertAction = "rescue" | "alert" | "none";

export interface DemoAlert {
  id: string;
  minutesAgo: number;
  ruleId: string;
  /** Human sentence shown in Beginner mode; the Rule ID is Pro-only. */
  description: string;
  severity: AlertSeverity;
  action: AlertAction;
}

export const MOCK_ALERTS: DemoAlert[] = [
  {
    id: "a1",
    minutesAgo: 2,
    ruleId: "R1_APPROVE_UNKNOWN",
    description: "Suspicious approval detected, funds were moved to safety.",
    severity: "critical",
    action: "rescue",
  },
  {
    id: "a2",
    minutesAgo: 15,
    ruleId: "R7_REVOKE_APPROVE",
    description: "An approval was removed. Watching for follow-up activity.",
    severity: "high",
    action: "alert",
  },
  {
    id: "a3",
    minutesAgo: 60,
    ruleId: "SCAN_STABLE",
    description: "Scheduled check completed, everything looks normal.",
    severity: "info",
    action: "none",
  },
  {
    id: "a4",
    minutesAgo: 180,
    ruleId: "R3_CALL_UNKNOWN",
    description: "Unknown contract interaction detected, funds were moved to safety.",
    severity: "critical",
    action: "rescue",
  },
];

export type RescueOutcome = "success" | "failed" | "skipped";

export interface DemoRescueToken {
  symbol: string;
  amount: string;
}

export interface DemoRescue {
  id: string;
  minutesAgo: number;
  txHash: `0x${string}`;
  tokens: DemoRescueToken[];
  outcome: RescueOutcome;
  /**
   * Only ever populated in Demo Mode. The vault does not know which rule fired,
   * so a real on-chain history can never carry this — it arrives with the
   * backend in a later sprint.
   */
  trigger?: string;
}

export const MOCK_RESCUES: DemoRescue[] = [
  {
    id: "r1",
    minutesAgo: 2,
    txHash: "0xef12c4b7a9d3e5f60718293a4b5c6d7e8f901234a5b6c7d8e9f00112233445566",
    tokens: [
      { symbol: "USDC", amount: "1,000.00" },
      { symbol: "WETH", amount: "0.500" },
      { symbol: "DAI", amount: "500.00" },
    ],
    outcome: "success",
    trigger: "Suspicious approval to an unknown address",
  },
  {
    id: "r2",
    minutesAgo: 180,
    txHash: "0x1122334455667788990011223344556677889900aabbccddeeff001122334455",
    tokens: [{ symbol: "WETH", amount: "0.250" }],
    outcome: "success",
    trigger: "Interaction with an unknown contract",
  },
];

/** Pre-computed status for the demo, so the page does not recompute per render. */
export const MOCK_STATUS_INPUT = {
  vaultDeployed: MOCK_VAULT_DEPLOYED,
  tokens: MOCK_TOKENS,
  executorBalance: MOCK_EXECUTOR_BALANCE,
  minExecutorEth: MOCK_MIN_EXECUTOR_ETH,
};