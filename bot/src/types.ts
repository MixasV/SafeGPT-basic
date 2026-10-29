/**
 * Shared types for the SafeGPT rescue bot.
 *
 * The decision layer is deterministic by design: an LLM never participates in
 * the rescue path. Every verdict is a pure function of the observed transaction
 * and the operator's configuration.
 */

/** Which protection contract a wallet uses. */
export type ProtectionVariant = "A" | "B";

export interface TokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  /**
   * Raw transfer amount (token's smallest unit) above which a transfer to a
   * non-whitelisted address triggers a rescue. Omit to trigger on ANY such
   * transfer — stricter, which suits cold storage.
   */
  rescueThreshold?: string;
}

export interface WalletConfig {
  label: string;
  protectedWallet: string;
  safeAddress: string;
  vaultAddress: string;
  variant: ProtectionVariant;
  /** Variant A only — the bot's own key, which the vault checks against `executor`. */
  executorPrivateKey?: string;
  /** Variant B only — held for the future guardian implementation. */
  guardianPrivateKey?: string;
  coreTokens: TokenConfig[];
  watchTokens: TokenConfig[];
  whitelist: string[];
  thresholds: Thresholds;
}

export interface Thresholds {
  /** Count of outgoing transfers that counts as "mass" activity. */
  massTransferCount: number;
  /** Window in minutes for the mass-transfer rule. */
  massTransferWindowMin: number;
  /** Percentage drop of a core balance that triggers a post-block rescue. */
  balanceDropPct: number;
}

export interface AlertsConfig {
  /** Primary channel. Absent or empty disables it; the bot never fails without it. */
  telegramBotToken: string;
  telegramChatId: string;
  webhookUrl: string;
  /** Notify when the executor balance drops below this many ETH. */
  minExecutorEth: number;
}

export interface BotConfig {
  rpcWss: string;
  rpcHttp: string;
  chainId: number;
  /** Empty disables private bundles; rescue then goes through the public mempool. */
  flashbotsRelay: string;
  wallets: WalletConfig[];
  alerts: AlertsConfig;
}

/** A pending transaction, reduced to what the rules engine needs. */
export interface ObservedTransaction {
  hash: string;
  from: string;
  to: string | null;
  data: string;
  value: bigint;
  /** EIP-2718 transaction type. Some RPCs leave this null on pending txs. */
  type?: number | null;
  /** EIP-7702 delegation list. Present only for type-4 transactions. */
  authorizationList?: ReadonlyArray<unknown> | undefined;
  /** Block the tx landed in, or null while it is still pending. */
  blockNumber: number | null;
}

export type VerdictAction = "RESCUE" | "ALERT" | "IGNORE";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM";

export type RuleId =
  | "R1_APPROVE_UNKNOWN"
  | "R2_TRANSFER_UNKNOWN"
  | "R3_CALL_UNKNOWN"
  | "R4_EIP7702"
  | "R5_MASS_TRANSFERS"
  | "R6_EXECUTOR_CHANGE"
  | "R7_REVOKE_APPROVE"
  | "R8_ALLOWANCE_DROPPED"
  | "R9_BALANCE_DROPPED";

export interface Verdict {
  action: VerdictAction;
  rule: RuleId | "NONE";
  reason: string;
  severity: Severity;
}

export type AlertAction = "RESCUE" | "ALERT";

export interface Alert {
  timestamp: number;
  wallet: string;
  rule: RuleId | "NONE";
  severity: Severity;
  reason: string;
  action: AlertAction;
  txHash?: string;
  /** Populated when the rescue attempt itself failed. */
  error?: string;
}

/** Why a rescue was triggered, forwarded to the alert and the log. */
export interface RescueReason {
  /** `NONE` is accepted because the field is forwarded straight from a verdict. */
  rule: RuleId | "NONE";
  reason: string;
  severity: Severity;
  txHash?: string;
}

/**
 * Mutable state the rules engine needs across calls.
 *
 * R5 counts transfers inside a time window and R7 opens a grace period after an
 * approval revoke, so `evaluate` cannot be a pure function of its two declared
 * arguments alone. The state is passed in explicitly rather than hidden in a
 * module-level variable, which keeps the engine testable and lets one state
 * object exist per wallet.
 */
export interface RuleState {
  /** Timestamps (ms) of recent outgoing transactions, oldest first. */
  recentTransfers: number[];
  /** Set when an approval revoke was seen; suspicious activity before this time escalates. */
  revokeGraceUntil: number | null;
}

export function createRuleState(): RuleState {
  return { recentTransfers: [], revokeGraceUntil: null };
}

/** Post-block scanner bookkeeping for one wallet. */
export interface WalletSnapshot {
  allowances: Map<string, bigint>;
  balances: Map<string, bigint>;
}