import { createTokenReader, type RpcReader, type TokenReader } from "./chain.js";
import type { RuleId, Severity, WalletConfig, WalletSnapshot } from "./types.js";

export type { TokenReader };

/**
 * Post-block scanner: R8 and R9.
 *
 * The mempool rules answer "is this wallet about to do something dangerous".
 * The scanner answers the complementary question: "did anything dangerous
 * happen anyway". A transaction can slip past a WSS feed — a dropped
 * subscription, an RPC hiccup, a private relay — and confirmed state is the
 * only thing that cannot lie. Every block we re-read the wallet and compare.
 */

export interface ScannerFinding {
  wallet: WalletConfig;
  rule: RuleId;
  action: "RESCUE" | "ALERT";
  severity: Severity;
  reason: string;
  /** Tokens the executor should move. Empty for a pure alert. */
  tokens: string[];
  blockNumber: bigint;
}

/**
 * WHY R8 IS AN ALERT AND NOT A RESCUE
 * -----------------------------------
 * The original spec asked the scanner to trigger a rescue when the vault's
 * allowance fell to zero. That cannot work, and shipping it anyway would be
 * worse than not shipping it: `RescueVault.rescue()` pulls funds with
 * `transferFrom(owner, destination, amount)`, so with a zero allowance every
 * `transferFrom` fails, `_rescueOne` emits `RescueFailed` and skips, and the
 * operator would see a "rescue succeeded" log while every token stayed put.
 *
 * So R8 is reported as CRITICAL ALERT. It is still the right trigger to detect:
 * a zero allowance means the drainer revoked approval to cover its tracks, and
 * any funds still in the wallet are stranded until a human re-approves. The
 * operator has to act, which an alert tells them to do and a no-op rescue does
 * not. R9 covers the case where funds actually moved.
 */
export class Scanner {
  private readonly snapshots = new Map<string, WalletSnapshot>();

  /**
   * Tokens this bot rescued itself, per wallet, waiting to be seen by the next
   * scan.
   *
   * WHY THIS EXISTS
   * ---------------
   * A successful rescue moves the whole balance, and `transferFrom` spends the
   * allowance on the way. The allowance therefore goes to zero — exactly the
   * shape of an R8 revoke. Without this, every successful rescue ends with a
   * CRITICAL "allowance was revoked, no rescue can move this token" alert,
   * which is the opposite of what happened and trains the operator to ignore
   * the channel that matters.
   */
  private readonly selfRescued = new Map<string, Set<string>>();

  /**
   * Records that this bot just rescued these tokens, so the next scan does not
   * report the consumed allowance as a revocation.
   */
  noteSelfRescue(wallet: WalletConfig, tokens: string[]): void {
    if (tokens.length === 0) return;
    const key = wallet.safeAddress.toLowerCase();
    const set = this.selfRescued.get(key) ?? new Set<string>();
    for (const token of tokens) set.add(token.toLowerCase());
    this.selfRescued.set(key, set);
  }

  /**
   * @param provider Resolved per scan, not captured once. The monitor replaces
   *        its WebSocket on every reconnect, and a reader bound to a destroyed
   *        provider would fail every block for the rest of the process's life.
   * @param reader Injectable for tests; defaults to a real ERC-20 reader.
   */
  constructor(
    private readonly provider: () => RpcReader,
    private readonly reader?: TokenReader,
  ) {}

  private tokenReader(): TokenReader {
    return this.reader ?? createTokenReader(this.provider());
  }

  /**
   * Compares the wallet's current state against the previous block.
   *
   * @returns Findings for this block. Empty on the first call, which only
   *          establishes a baseline — without that, a freshly started bot would
   *          fire on whatever the wallet happens to hold.
   */
  async scan(wallet: WalletConfig, blockNumber: bigint): Promise<ScannerFinding[]> {
    const tokens = [...wallet.coreTokens, ...wallet.watchTokens];
    const previous = this.snapshots.get(wallet.safeAddress);
    const reader = this.tokenReader();

    const allowances = new Map<string, bigint>();
    const balances = new Map<string, bigint>();
    for (const token of tokens) {
      const [balance, allowance] = await Promise.all([
        reader.balanceOf(wallet.protectedWallet, token.address),
        reader.allowance(wallet.protectedWallet, wallet.vaultAddress, token.address),
      ]);
      balances.set(token.address, balance);
      allowances.set(token.address, allowance);
    }

    const current: WalletSnapshot = { allowances, balances };
    this.snapshots.set(wallet.safeAddress, current);

    if (previous === undefined) return [];

    const findings: ScannerFinding[] = [];

    // R9 — a core balance fell by at least the configured percentage.
    for (const token of wallet.coreTokens) {
      const before = previous.balances.get(token.address);
      const now = balances.get(token.address) ?? 0n;
      if (before === undefined) continue;

      if (before === 0n) continue;
      if (now >= before) continue;

      const dropPct = Number(((before - now) * 10_000n) / before) / 100;
      if (dropPct < wallet.thresholds.balanceDropPct) continue;

      findings.push({
        wallet,
        rule: "R9_BALANCE_DROPPED",
        action: "RESCUE",
        severity: "CRITICAL",
        reason:
          `${token.symbol} balance fell ${dropPct.toFixed(2)}% in block ${blockNumber} ` +
          `(${before} → ${now}); the configured trigger is ${wallet.thresholds.balanceDropPct}%.`,
        tokens: [token.address],
        blockNumber,
      });
    }

    // R8 — the vault's allowance was revoked. See the class comment: this cannot
    // be rescued programmatically, so it is escalated to the operator instead.
    //
    // A token this bot just rescued is skipped: its allowance was spent by the
    // rescue, not taken away by an attacker. Reporting that would be a false
    // alarm on the one channel the operator is supposed to trust.
    const rescuedByUs = this.selfRescued.get(wallet.safeAddress.toLowerCase());
    for (const token of tokens) {
      const before = previous.allowances.get(token.address);
      const now = allowances.get(token.address) ?? 0n;
      if (before === undefined) continue;
      if (before === 0n) continue;
      if (now !== 0n) continue;
      if (rescuedByUs?.has(token.address.toLowerCase()) === true) continue;

      findings.push({
        wallet,
        rule: "R8_ALLOWANCE_DROPPED",
        action: "ALERT",
        severity: "CRITICAL",
        reason:
          `CRITICAL: allowance for ${token.symbol} on vault ${wallet.vaultAddress} was revoked ` +
          `in block ${blockNumber} (${before} → 0). RescueVault pulls funds with transferFrom(), so the ` +
          `vault CANNOT rescue this token until the owner re-approves. No rescue can move it. ` +
          `Immediate action required: re-approve the vault or move the funds manually.`,
        tokens: [],
        blockNumber,
      });
    }

    // The suppression covers exactly one scan — the block in which our own
    // rescue landed. Later blocks are back to reporting a real revocation.
    this.selfRescued.delete(wallet.safeAddress.toLowerCase());

    return findings;
  }

  /** Clears the baseline, so the next scan re-establishes it instead of alerting. */
  reset(): void {
    this.snapshots.clear();
  }
}

/** Format helper shared by the alert payloads. */
export function describeFinding(finding: ScannerFinding): string {
  return `[${finding.severity}] ${finding.rule} ${finding.wallet.label}: ${finding.reason}`;
}