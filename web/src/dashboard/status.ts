/**
 * Protection status derivation.
 *
 * PURE. No React, no viem, no clock. This module is the product's core promise
 * rendered as a number, and it is unit-tested across every combination of
 * allowance and executor balance. Keeping it free of hooks is what makes that
 * possible — the same discipline as the bot's rules engine.
 *
 * The one thing it must never do is look uncertain. A protection product that
 * says "attention" when it should say "compromised" teaches the user to ignore
 * it.
 */

export type ProtectionLevel = "active" | "attention" | "compromised";

export type TokenKind = "core" | "watch";

export type TokenStatus = "protected" | "monitoring" | "reapprove" | "not-deployed";

export interface TokenAllowance {
  address: `0x${string}`;
  symbol: string;
  kind: TokenKind;
  /** Raw on-chain allowance. `0n` means the vault cannot pull this token. */
  allowance: bigint;
}

export interface StatusInput {
  vaultDeployed: boolean;
  tokens: TokenAllowance[];
  /** Balance of `vault.executor()` — the bot's own key, NOT the owner's. */
  executorBalance: bigint;
  minExecutorEth: bigint;
}

export interface TokenStatusInfo {
  token: TokenAllowance;
  status: TokenStatus;
  label: string;
  /** Beginner-mode sentence with no jargon and no raw numbers. */
  beginnerLabel: string;
}

export interface ProtectionStatus {
  level: ProtectionLevel;
  headline: string;
  /** Every condition that produced the level, worst first. */
  reasons: string[];
  tokens: TokenStatusInfo[];
  counts: {
    core: number;
    watch: number;
    protected: number;
    needsReapprove: number;
  };
}

const HEADLINES: Record<ProtectionLevel, string> = {
  active: "Protection Active",
  attention: "Attention Required",
  compromised: "Protection Compromised",
};

/**
 * Executor gas floor. Mirrors `alerts.minExecutorEth` in the bot config: below
 * this the executor cannot reliably pay for a rescue, so the dashboard warns
 * before the bot refuses outright.
 */
export const MIN_EXECUTOR_ETH = 100_000_000_000_000_000n; // 0.1 ETH

export function classifyToken(token: TokenAllowance, vaultDeployed: boolean): TokenStatus {
  if (!vaultDeployed) return "not-deployed";
  if (token.allowance === 0n) return "reapprove";
  return token.kind === "core" ? "protected" : "monitoring";
}

const TOKEN_LABELS: Record<TokenStatus, string> = {
  protected: "Protected",
  monitoring: "Monitoring",
  reapprove: "Re-approve needed",
  "not-deployed": "Not deployed",
};

const TOKEN_BEGINNER_LABELS: Record<TokenStatus, string> = {
  protected: "Protected",
  monitoring: "Watched for you",
  reapprove: "Needs your approval",
  "not-deployed": "Not set up yet",
};

/**
 * Derives the headline protection state.
 *
 * Severity ladder, checked in order:
 *   compromised — no vault, or the executor cannot pay for gas at all, or
 *                every core asset is unpullable.
 *   attention   — something needs a human: a core asset lost its allowance, or
 *                the executor is running low, or nothing is registered yet.
 *   active      — every core asset is pullable and the executor is funded.
 *
 * Note that only CORE assets gate the headline. A watch token whose allowance
 * was revoked does not downgrade the whole wallet — it is quarantined by
 * design, and the bot reports it as R8 in its own channel.
 */
export function deriveProtectionStatus(input: StatusInput): ProtectionStatus {
  const { vaultDeployed, tokens, executorBalance, minExecutorEth } = input;

  const tokenStatuses = tokens.map((token) => {
    const status = classifyToken(token, vaultDeployed);
    return {
      token,
      status,
      label: TOKEN_LABELS[status],
      beginnerLabel: TOKEN_BEGINNER_LABELS[status],
    };
  });

  const core = tokens.filter((token) => token.kind === "core");
  const coreStranded = core.filter((token) => token.allowance === 0n);
  const counts = {
    core: core.length,
    watch: tokens.length - core.length,
    protected: tokenStatuses.filter((entry) => entry.status === "protected").length,
    needsReapprove: tokenStatuses.filter((entry) => entry.status === "reapprove").length,
  };

  const reasons: string[] = [];

  if (!vaultDeployed) {
    return {
      level: "compromised",
      headline: HEADLINES.compromised,
      reasons: ["No protection contract is deployed for this wallet yet."],
      tokens: tokenStatuses,
      counts,
    };
  }

  // Executor first: with no gas there is no rescue regardless of allowances.
  const executorDry = executorBalance === 0n;
  const executorLow = !executorDry && executorBalance < minExecutorEth;

  if (executorDry) {
    reasons.push("The rescue executor holds no ETH, so no rescue transaction can be sent.");
  } else if (executorLow) {
    reasons.push("The rescue executor is running low on ETH and a rescue may fail.");
  }

  if (core.length === 0) {
    reasons.push("No core assets are registered, so nothing is protected yet.");
  } else if (coreStranded.length === 0) {
    // Healthy: no reason recorded.
  } else if (coreStranded.length === core.length) {
    reasons.push("Every core asset has lost its approval, so the vault cannot pull any of them.");
  } else {
    const symbols = coreStranded.map((token) => token.symbol).join(", ");
    reasons.push(`${symbols} lost the vault's approval and need to be re-approved.`);
  }

  const level: ProtectionLevel = executorDry || (core.length > 0 && coreStranded.length === core.length)
    ? "compromised"
    : reasons.length > 0
      ? "attention"
      : "active";

  return {
    level,
    headline: HEADLINES[level],
    // The executor problem outranks everything: no gas means no protection
    // even when every allowance is intact.
    reasons,
    tokens: tokenStatuses,
    counts,
  };
}

/**
 * Beginner-mode sentence. Deliberately free of addresses, wei and basis
 * points — a user who has never seen an allowance should still understand it.
 */
export function beginnerSummary(status: ProtectionStatus): string {
  switch (status.level) {
    case "active":
      return "Your protection is working. Assets are being watched and can be moved to safety automatically.";
    case "attention":
      return status.reasons[0] ?? "Something needs your attention.";
    case "compromised":
      return "Your assets cannot be protected right now. Please read the details below and act.";
  }
}

/** Pro-mode sentence: explicit about what failed and how many assets it affects. */
export function proSummary(status: ProtectionStatus): string {
  if (status.level === "active") {
    return `${status.counts.protected} of ${status.counts.core} core assets pullable, executor funded.`;
  }
  return status.reasons.join(" ");
}