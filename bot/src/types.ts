/**
 * Shared types for the SafeGPT rescue bot.
 *
 * The decision layer is deterministic by design: an LLM never participates in
 * the rescue path. Every verdict is a pure function of the observed transaction
 * and the operator's configuration.
 */

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
  /** RescueVault mode — the bot's own key, which the vault checks against `executor`. */
  executorPrivateKey?: string;
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

/**
 * What the event is, as opposed to what the bot did.
 *
 * This used to be derived from `action === "RESCUE" && txHash !== undefined`,
 * which was wrong in both directions: the hash on a rescue alert was the
 * ATTACK transaction (the pending one the bot saw in the mempool), never the
 * rescue transaction, so a "rescue" event linked to a transfer the attacker
 * sent — and a skipped rescue that still had the attack hash was classified as
 * a rescue too. `kind` is now stated explicitly by the caller.
 */
export type AlertKind = "alert" | "rescue";

/** One token the vault actually moved, as reported by its `Rescued` event. */
export interface RescuedToken {
  /** Token contract. */
  token: string;
  /** Symbol from the bot's own token config, so the UI needs no registry. */
  symbol: string;
  /** Decimals from the same config, for exact amount formatting. */
  decimals: number;
  /** Net amount delivered to the safe, in the token's base units. */
  amount: string;
  /** Fee the vault kept, in the token's base units. `"0"` when none was charged. */
  fee: string;
  /** Where the net amount landed — the vault's stored `safeAddress`. */
  destination: string;
}

/** The outcome of a rescue, as reported to the platform or log. */
export interface RescueReport {
  /** Hash of the transaction that MOVED the funds. */
  txHash: string;
  /** The pending attack transaction that triggered the rescue, when there was one. */
  attackerTxHash?: string;
  /** The address the attacker was trying to reach. */
  attackerTarget?: string;
  /** Per-token amounts actually rescued. Empty when the receipt could not be read. */
  rescued: RescuedToken[];
}

export interface Alert {
  timestamp: number;
  wallet: string;
  kind: AlertKind;
  rule: RuleId | "NONE";
  severity: Severity;
  reason: string;
  action: AlertAction;
  /**
   * The transaction this alert is about: the RESCUE transaction for a rescue,
   * the attack transaction for an alert. Never both.
   */
  txHash?: string;
  /** Populated when the rescue attempt itself failed. */
  error?: string;
  /** Structured rescue result. Present only on a successful rescue. */
  rescue?: RescueReport;
}

/** Why a rescue was triggered, forwarded to the alert and the log. */
export interface RescueReason {
  /** `NONE` is accepted because the field is forwarded straight from a verdict. */
  rule: RuleId | "NONE";
  reason: string;
  severity: Severity;
  txHash?: string;
  /**
   * The pending transaction's priority fee (EIP-1559) or gas price (legacy).
   * The executor uses it to bid high enough to land its rescue BEFORE the
   * attack in the same block. Undefined for post-block rescues (R8/R9), where
   * the attack already landed and a competitive bid is not needed.
   */
  attackerPriorityFee?: bigint | undefined;
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