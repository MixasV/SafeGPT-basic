import { AbiCoder, id } from "ethers";

import type {
  ObservedTransaction,
  RuleId,
  RuleState,
  Severity,
  TokenConfig,
  Verdict,
  WalletConfig,
} from "./types.js";

/**
 * Deterministic trigger engine.
 *
 * Every decision is a pure function of (transaction, wallet config, state).
 * No LLM, no network access, no timers. That property is the product: the
 * rescue path must be reproducible and auditable, and a model in the loop would
 * make neither possible.
 *
 * Rules are evaluated in a fixed order and the first match wins:
 *
 *     R4 → R6 → R7(detect) → R1 → R7(escalate) → R2 → R5 → R3
 *
 * A delegation (R4) or an executor-swap attempt (R6) is proof of key
 * compromise, so it outranks every heuristic below it.
 *
 * R7's detection runs before R1 even though R1 is the broader approval rule,
 * because a revoke *is* an `approve()` whose spender is the vault — R1 classes
 * that as trusted and would ignore it, making R7 unreachable. Its escalation
 * runs after R1, so an explicit approval violation still reports the more
 * specific R1 rather than being flattened into R7.
 *
 * R8 and R9 are NOT evaluated here. They are post-block observations and belong
 * to the scanner, which sees confirmed state rather than pending transactions.
 */

/** Selector constants, derived from signatures so they cannot drift. */
export const SELECTORS = {
  approve: id("approve(address,uint256)").slice(0, 10),
  setApprovalForAll: id("setApprovalForAll(address,bool)").slice(0, 10),
  transfer: id("transfer(address,uint256)").slice(0, 10),
  transferFrom: id("transferFrom(address,address,uint256)").slice(0, 10),
  requestExecutorChange: id("requestExecutorChange(address)").slice(0, 10),
} as const;

/** How long an approval revoke keeps a wallet in a heightened state. */
export const REVOKE_GRACE_PERIOD_MS = 5 * 60 * 1000;

const coder = AbiCoder.defaultAbiCoder();

function verdict(
  action: Verdict["action"],
  rule: RuleId | "NONE",
  reason: string,
  severity: Severity,
): Verdict {
  return { action, rule, reason, severity };
}

function ignore(reason = "No rule matched."): Verdict {
  return verdict("IGNORE", "NONE", reason, "MEDIUM");
}

function selectorOf(data: string): string | null {
  if (data.length < 10) return null;
  return data.slice(0, 10).toLowerCase();
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function isWhitelisted(wallet: WalletConfig, address: string | null | undefined): boolean {
  if (!address) return false;
  const needle = address.toLowerCase();
  if (needle === wallet.vaultAddress.toLowerCase()) return true;
  return wallet.whitelist.some((entry) => entry.toLowerCase() === needle);
}

/**
 * Decodes the address held in ABI word `index` (0-based, after the selector).
 * Tolerates short or malformed calldata by returning null.
 */
function decodeAddressWord(data: string, index: number): string | null {
  const start = 10 + index * 64;
  if (data.length < start + 64) return null;
  try {
    const [value] = coder.decode(["address"], `0x${data.slice(start, start + 64)}`);
    return value as string;
  } catch {
    return null;
  }
}

/**
 * Decodes ABI word `index` as a uint256. Used for transfer amounts and for the
 * amount in `approve()`, where zero means "revoked" under EIP-2612.
 */
function decodeUintWord(data: string, index = 0): bigint | null {
  const start = 10 + index * 64;
  if (data.length < start + 64) return null;
  try {
    const [value] = coder.decode(["uint256"], `0x${data.slice(start, start + 64)}`);
    return value as bigint;
  } catch {
    return null;
  }
}

/** True when the transaction carries an EIP-7702 delegation. */
export function isDelegation(tx: ObservedTransaction): boolean {
  return tx.type === 4 || (tx.authorizationList?.length ?? 0) > 0;
}

/** Threshold for a token: an explicit raw amount, or zero meaning "any transfer". */
function thresholdOf(token: TokenConfig | undefined): bigint {
  if (!token || token.rescueThreshold === undefined) return 0n;
  try {
    return BigInt(token.rescueThreshold);
  } catch {
    return 0n;
  }
}

function findToken(tokens: TokenConfig[], address: string | null): TokenConfig | undefined {
  if (!address) return undefined;
  const needle = address.toLowerCase();
  return tokens.find((token) => token.address.toLowerCase() === needle);
}

/**
 * Applies the mass-transfer rule to the rolling window, recording this
 * transaction's arrival.
 *
 * Mutates `state.recentTransfers` — that is the only stateful part of the
 * engine, and it lives here so the rules below stay pure.
 */
function matchMassTransfer(wallet: WalletConfig, state: RuleState, now: number): Verdict | null {
  const windowMs = wallet.thresholds.massTransferWindowMin * 60 * 1000;
  state.recentTransfers.push(now);

  // Drop everything outside the window.
  while (state.recentTransfers.length > 0 && (state.recentTransfers[0] as number) <= now - windowMs) {
    state.recentTransfers.shift();
  }

  if (state.recentTransfers.length > wallet.thresholds.massTransferCount) {
    return verdict(
      "RESCUE",
      "R5_MASS_TRANSFERS",
      `${state.recentTransfers.length} outgoing transactions within ${wallet.thresholds.massTransferWindowMin} minutes ` +
        `(limit ${wallet.thresholds.massTransferCount}).`,
      "HIGH",
    );
  }
  return null;
}

/**
 * Evaluates one observed transaction against one wallet configuration.
 *
 * @param now Milliseconds since epoch, injected so tests are deterministic.
 * @returns The first matching verdict, or an IGNORE.
 */
export function evaluate(
  tx: ObservedTransaction,
  wallet: WalletConfig,
  state: RuleState,
  now: number = Date.now(),
): Verdict {
  const selector = selectorOf(tx.data);

  // The rules describe what the *protected wallet* is doing. A transaction
  // from anyone else is none of our business, and treating it as suspicious
  // would fire on every unrelated transaction in the mempool.
  if (!sameAddress(tx.from, wallet.protectedWallet)) {
    return ignore(`Transaction is from ${tx.from}, not the protected wallet.`);
  }

  // R4 — EIP-7702 delegation. The wallet agreed to let a contract act on its
  // behalf, which hands an attacker full control without any approval.
  if (isDelegation(tx)) {
    return verdict(
      "RESCUE",
      "R4_EIP7702",
      "EIP-7702 delegation transaction. The wallet granted a contract authority to act as the owner.",
      "CRITICAL",
    );
  }

  // R6 — an executor swap attempt on the vault. With the 72h timelock this does
  // not change anything by itself, but a cold-storage wallet has no reason to
  // touch it: the key is compromised and this is our chance to move the funds.
  if (selector === SELECTORS.requestExecutorChange && sameAddress(tx.to, wallet.vaultAddress)) {
    return verdict(
      "RESCUE",
      "R6_EXECUTOR_CHANGE",
      "requestExecutorChange() called on the vault. A protected wallet must never rotate its own executor; " +
        "treat the owner key as compromised.",
      "CRITICAL",
    );
  }

  // R7 (detection) — a revoke of the vault's own allowance. This must be tested
  // BEFORE R1 even though R1 is the broader approval rule: a revoke is an
  // approve() whose spender IS the vault, which R1 classifies as trusted and
  // ignores. Testing R1 first would make this branch unreachable.
  //
  // A revoke is not itself a rescue: the funds are still sitting in the wallet,
  // and moving them on a false positive is the harm we are trying to avoid. It
  // opens a 5-minute grace window instead, and the escalation below reacts.
  if (selector === SELECTORS.approve && sameAddress(tx.to, wallet.vaultAddress)) {
    if (decodeUintWord(tx.data, 1) === 0n) {
      state.revokeGraceUntil = now + REVOKE_GRACE_PERIOD_MS;
      return verdict(
        "ALERT",
        "R7_REVOKE_APPROVE",
        "Approval on the vault was revoked. Monitoring for the next 5 minutes.",
        "MEDIUM",
      );
    }
    return ignore("The vault's allowance was increased, not revoked.");
  }

  // R1 — an approval handed to an address that is neither whitelisted nor the vault.
  // `spender` is ABI word 0; word 1 is the amount. Both branches terminate:
  // approve()/setApprovalForAll() is fully understood calldata, so it must never
  // reach R3 and be re-classified as an unknown contract call.
  if (selector === SELECTORS.approve || selector === SELECTORS.setApprovalForAll) {
    const target = decodeAddressWord(tx.data, 0);
    if (target === null) {
      return ignore("Approval calldata is too short to decode.");
    }

    if (isWhitelisted(wallet, target)) {
      return ignore(`${selector === SELECTORS.approve ? "approve" : "setApprovalForAll"}() on trusted address ${target}.`);
    }

    const label = selector === SELECTORS.approve ? "approve() granted to unknown spender" : "setApprovalForAll() granted to unknown operator";
    return verdict("RESCUE", "R1_APPROVE_UNKNOWN", `${label} ${target}. This is the standard drainer opening move.`, "CRITICAL");
  }

  // R7 (escalation) — a revoke was seen recently, so anything untrusted in this
  // window is treated as part of the same attack. It sits after R1 so that an
  // explicit approval violation still reports R1 (equally CRITICAL, but more
  // specific), and before R2 so a sub-threshold transfer cannot slip through
  // during the grace period — being trigger-happy for five minutes is the
  // deliberate cost of a revoke.
  if (state.revokeGraceUntil !== null && now < state.revokeGraceUntil && tx.to !== null && !isWhitelisted(wallet, tx.to)) {
    const remaining = Math.ceil((state.revokeGraceUntil - now) / 1000);
    return verdict(
      "RESCUE",
      "R7_REVOKE_APPROVE",
      `Untrusted activity ${remaining}s after an approval revoke on the vault.`,
      "CRITICAL",
    );
  }

  // R2 — a transfer leaving the wallet for an address we do not trust.
  if (selector === SELECTORS.transfer || selector === SELECTORS.transferFrom) {
    // transfer(address,uint256)      → recipient word 0, amount word 1
    // transferFrom(address,address,uint256) → from word 0, recipient word 1, amount word 2
    const isTransferFrom = selector === SELECTORS.transferFrom;
    const recipient = decodeAddressWord(tx.data, isTransferFrom ? 1 : 0);
    const amount = decodeUintWord(tx.data, isTransferFrom ? 2 : 1) ?? 0n;

    if (isWhitelisted(wallet, recipient)) {
      // A plain asset movement is not the unknown-code activity R3 hunts for,
      // so R2 terminates the evaluation either way.
      return ignore(`Transfer to whitelisted address ${recipient}.`);
    }

    const token = findToken([...wallet.coreTokens, ...wallet.watchTokens], tx.to);
    const threshold = thresholdOf(token);

    if (amount > threshold) {
      const symbol = token?.symbol ?? tx.to ?? "unknown token";
      return verdict(
        "RESCUE",
        "R2_TRANSFER_UNKNOWN",
        `Transfer of ${amount} ${symbol} to non-whitelisted address ${recipient} (threshold ${threshold}).`,
        "CRITICAL",
      );
    }

    // Below the operator's threshold. Returning here rather than falling through
    // to R3 is the whole point of the threshold: an operator who tolerates dust
    // should not have R3 override them.
    return ignore(
      `Transfer of ${amount} to ${recipient} is within the configured threshold of ${threshold}.`,
    );
  }

  // R5 — a burst of outgoing transactions.
  const mass = matchMassTransfer(wallet, state, now);
  if (mass !== null) return mass;

  // R3 — any other contract call to an untrusted destination. This is what
  // catches DEX swaps and arbitrary contract interaction, which do not touch
  // the token ABI at all.
  if (tx.to !== null && !isWhitelisted(wallet, tx.to) && tx.data.length > 2 && selector !== null) {
    return verdict(
      "RESCUE",
      "R3_CALL_UNKNOWN",
      `Contract call to non-whitelisted address ${tx.to} with ${(tx.data.length - 2) / 2} bytes of calldata.`,
      "HIGH",
    );
  }

  return ignore();
}