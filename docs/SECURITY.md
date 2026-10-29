# Security model

This document describes what SafeGPT Core protects against, what it does not,
and what it will not let you do. Every claim here is checked against the code
in this repository; where the code and this document disagree, the code is a
bug and the document is right.

The vulnerability disclosure policy is in [`../SECURITY.md`](../SECURITY.md).

---

## 1. What this product is

A **security tool**. It watches one wallet you designate and, when a
transaction matching a published rule appears, it moves that wallet's ERC-20
assets to an address you chose.

It is not a trading platform. It does not execute trades, provide financial
advice, or manage investment portfolios. Nothing in this repository invests,
swaps, bridges or recommends anything.

The protected wallet is for **cold storage**. Swaps, bridges and dApp
interaction from that wallet are outside what any monitor can protect, because
those are exactly the actions that require the wallet to sign.

---

## 2. Threat model

### 2.1 What the attacker gets

| Key | How it is exposed | What it buys the attacker |
|---|---|---|
| Protected wallet key | The wallet is the *victim*; assume it is compromised | Everything in the wallet |
| Executor key | Runs on the operator's machine; the bot holds it | `rescue()` — but only to the stored `safeAddress` |
| Owner key (Vault) | The protected wallet itself | Configuration changes, all behind a 72-hour timelock |
| Guardian key (Variant B) | Operator-controlled, must be unique per wallet | Veto and confirm. Cannot move funds |
| RPC provider | Third party | Can lie about or censor transactions. See §6 |
| Hosted platform | Only in `safegpt-platform`, not here | See the platform's own documents |

### 2.2 Why `safeAddress` must stay under independent control

`safeAddress` is the only destination rescued funds can reach. The executor key
cannot redirect them, and the owner cannot change it without a 72-hour delay
during which the user can cancel.

If the same key controls the protected wallet and the safe address, a stolen
wallet key moves the money by two steps instead of one, and the "safe" address
is not safe. Keep it on separate hardware, or at minimum on a different
mnemonic.

### 2.3 Roles and their limits

**Owner** (the protected wallet, in Variant A):

* Cannot call `rescue()`. That is `onlyExecutor` — the owner has no path to
  move funds through the vault at all.
* Can request a change to `safeAddress`, `quarantineAddress`, `executor` or the
  whitelist. Every one of them requires **72 hours** plus an explicit
  confirmation, and re-issuing a request invalidates any earlier approval.
* Can cancel a pending change at any time.

**Executor** (the bot's key):

* Can call `rescue()` and nothing else that moves funds.
* **Cannot choose a destination.** `rescue(address[] tokens, bool[] chargeFee)`
  takes no recipient. The destination is decided inside the contract: the
  `safeAddress`, or the `quarantineAddress` for watch-set tokens.
* Cannot change the fee. `feeBps` is fixed at deployment and capped at
  `MAX_FEE_BPS = 1000` (10%). There is no `setFee()`.

**Guardian** (Variant B):

* Can confirm or veto queued transactions.
* **Cannot initiate a transfer.** `queueTransaction` is `onlyOwner`; the
  guardian can only confirm what the owner queued, or cancel it.
* Cannot change the owner, the safe address or the whitelist on its own —
  every such change needs owner request **and** guardian approval **and** the
  72-hour delay **and** owner confirmation.
* Cannot call `emergencyExit()`.

### 2.4 Consequences of failure

| Failure | What happens |
|---|---|
| Bot stopped | Nothing is detected or rescued. No asset is at risk *from stopping* — the risk is the attack proceeding unopposed |
| Executor has no gas | The bot refuses to send: `preflight()` returns `SKIPPED` with the balance and the floor. **This check is not proactive** — see §5.2 |
| Guardian unavailable | Variant B stalls. A queued transaction waits forever. This is the intended failure mode, not a bug |
| RPC provider lies | The bot acts on what it is told. A provider that hides a pending transaction makes the bot blind to it; a provider that fabricates one can cause a rescue of your own funds to the safe address, which is not a loss |
| No guardian confirm | Variant B cannot execute. Funds stay where they are |

---

## 3. Asset boundaries

This is the part most likely to be misunderstood, so it is stated plainly.

**Detecting a suspicious action does not mean the corresponding asset can be
saved.**

| Asset | Rescue possible? | Why |
|---|---|---|
| ERC-20 tokens with a live allowance | Yes | `transferFrom(owner, safeAddress, amount)` |
| ERC-20 tokens whose allowance was revoked | **No** | `transferFrom` returns false. The vault cannot move them at any price |
| Native ETH | **No** | The vault moves ERC-20s only. Wrap to WETH first |
| NFTs | **No** | Not ERC-20. `transferFrom` with a token id is a different ABI |
| DeFi positions (LP tokens, staked balances, vault shares) | **No** | They are not your tokens to transfer; the position is a contract state |
| Tokens arriving after setup | **No** | The vault was never approved for them |

The allowance case is not an edge case — it is the most common drainer
sequence: the attacker revokes your allowance *first*, so that when the drain
tries to move funds it is already too late for any rescue mechanism.

### 3.1 What the bot does when the allowance is zero

The executor checks `allowance(protectedWallet, vaultAddress)` for every
requested token before broadcasting:

* Tokens with a non-zero allowance are **movable** and go into the rescue.
* Tokens with a zero allowance are **stranded** and are dropped.
* If **every** requested token is stranded, **nothing is sent at all**. The
  reason is written to the log.

This is deliberate. Broadcasting a rescue that provably moves nothing costs
gas and produces a transaction that looks like a success while doing nothing.

The operator is told about it — but see §5.1 for an honest description of
*where* that message goes. The CRITICAL alert channel for this condition is
**R8**, which the post-block scanner raises once the revoke has landed (§4.2).

---

## 4. Detection

### 4.1 Public mempool (pre-confirmation)

The bot subscribes to the mempool over WebSocket and evaluates every pending
transaction from the protected wallet against a fixed rule set. The first match
wins, in this order:

```
R4 → R6 → R7(detect) → R1 → R7(escalate) → R2 → R5 → R3
```

| Rule | Condition | Action |
|---|---|---|
| **R4** EIP-7702 delegation | The wallet delegated to a contract | RESCUE |
| **R6** Executor swap attempt | `requestExecutorChange` on the vault | RESCUE |
| **R7** Revoke of the vault's own allowance | `approve(vault, 0)` | ALERT + grace window |
| **R1** Approval to an unknown spender | `approve()`/`setApprovalForAll()` to a non-whitelisted address | RESCUE |
| **R7** Escalation | Within 5 minutes of a revoke, any untrusted action | RESCUE |
| **R2** Transfer to an unknown address | `transfer()`/`transferFrom()` to a non-whitelisted address | RESCUE |
| **R5** Mass transfers | More than N outgoing transfers in the window | RESCUE |
| **R3** Any other contract call to an untrusted destination | Arbitrary call, including DEX swaps | RESCUE |
| **R8** Allowance dropped | Post-block: allowance went from non-zero to zero | **ALERT only** |
| **R9** Balance dropped | Post-block: a core token's balance fell by ≥ the configured percentage | RESCUE |

R8 and R9 are not evaluated by the mempool rule engine. They are post-block
observations and belong to the scanner, which reads confirmed state.

### 4.2 Post-block detection

The scanner runs once per new block and compares the current balance and
allowance of every configured token against the previous snapshot.

This is the backstop for transactions the bot never saw: a lost subscription,
an RPC hiccup, or a private relay. **Confirmed state is the only thing that
cannot lie.**

The first scan only establishes a baseline and finds nothing. The scanner's
snapshot lives in memory and is lost when the process restarts.

### 4.3 Private mempools

A transaction submitted through a private relay or a builder bundle is never
broadcast. No watcher can see it. **Variant A cannot respond to it** — the
attacker's transaction simply settles first.

This is not a configuration gap; it is a property of the model. Variant B does
not depend on seeing the attack, because funds only move on an executed
transaction the guardian confirms.

### 4.4 What is left in the balance

The last line of defence is not prevention. After a drain has executed, the
bot still watches the wallet: R9 fires when a core token's balance drops by at
least the configured percentage (10% by default), and the remaining balance is
rescued to the safe address.

This is a partial recovery, not a prevention, and it should not be presented as
the primary defence.

---

## 5. Implementation limits, stated honestly

### 5.1 "Stranded" tokens are logged, not alerted

When the executor drops stranded tokens, the reason goes to **stdout only**. It
is not sent to Telegram or the webhook. The reason is structural: the executor
has no access to the alerting layer, and the monitor reports `SKIPPED` results
to the log as well.

The CRITICAL alert for this condition is **R8** in the post-block scanner. It
arrives on the next block after the revoke lands — not at the moment the
rescue was skipped.

### 5.2 There is no proactive low-gas warning

`alerts.minExecutorEth` (default 0.1 ETH) is checked inside `preflight()`,
before a rescue is attempted. If the executor is below the floor, the rescue is
refused.

**There is no background check and no alert.** If the executor runs dry while
no rule fires, the bot is silent. The comment in `config.example.yaml` that
describes this as a warning overstates what the code does.

### 5.3 No persistence, no history

The bot has no database and writes no files. All state — the R5 transfer
counter, the R7 grace window, the rate-limit windows, the scanner's baseline —
lives in memory and is **lost when the process restarts**.

Consequences: after a restart the mass-transfer counter resets, the grace
window resets, cooldowns reset, and the scanner's first pass finds nothing.

There is also no rescue history. Alerts go to the console, Telegram and the
webhook, and nowhere else. The dashboard's "rescue history" panel shows mock
data and is not connected to the bot.

### 5.4 The bot does not read its own receipts

After broadcasting a rescue the bot records the transaction hash and moves on.
It does not wait for confirmation and does not parse the contract's events, so
it cannot report whether a token was rescued, skipped or failed. Those outcomes
are visible in the contract's logs, not in the bot's output.

### 5.5 Rate limits are per wallet and hard-coded

| Limit | Value | Configurable? |
|---|---|---|
| Core rescue cooldown | 1 hour | No |
| Watch rescue cooldown | 15 minutes | No |
| Watch rescues per hour | 3 | No |

The window key is the `safeAddress`, not the token. There is no per-token
cooldown.

### 5.6 The nonce is re-read per chunk

When a rescue is split into several transactions, each chunk reads
`eth_getTransactionCount(..., "pending")` again and adds the chunk index. If
the node has already counted the previous transaction in its pending nonce,
this produces a gap and the later transaction can stall.

---

## 6. Trust in the outside world

| Dependency | What we trust | What happens if it lies |
|---|---|---|
| RPC / WebSocket provider | Balances, allowances, pending transactions | The bot acts on false data. A fabricated transaction could trigger a rescue to your safe address — not a loss, but a wasted fee |
| Explorers (Sourcify, Etherscan, Blockscout) | Verified contract source | Only affects the Auditor, never the rescue path |
| Static token list | Which addresses are "verified" | It is a file in this repository. It is not replaced at runtime by any external API |

The verified-token list is static on purpose. A runtime API could be
compromised, or could return a different answer between two runs, and the
Core/Watch classification decides which assets get a fee-free quarantine
routing. That decision has to be reproducible.

---

## 7. Mandatory invariants

These are the properties the design must not lose. Each one is enforced in code
and, where it is testable, in the test suite.

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **AI never participates in a rescue decision.** The rule engine is deterministic and has no model in the loop | `bot/src/rules.ts` |
| 2 | One contract template and one configuration — not AI-generated Solidity per user | `RescueVaultFactory.sol` (CREATE2) |
| 3 | The executor cannot choose an arbitrary recipient | `rescue(address[],bool[])` has no recipient argument |
| 4 | There is no `pause()` as a defensive mechanism | No such function exists; the timelock covers legitimate changes |
| 5 | There is no revoke button in the dashboard presented as a way to stay safe | No revoke control in either web app |
| 6 | A revoked allowance is an alert signal, not a standalone unconditional rescue trigger | R8 → `action: "ALERT"` |
| 7 | With allowance = 0, a `transferFrom` rescue cannot work: a CRITICAL alert, never a fake "successful rescue" | `partitionByAllowance()`, R8 CRITICAL |
| 8 | Core and Watch are rescued separately, and a single token's failure is isolated | Separate transactions; `RescueSkipped`/`RescueFailed` events, no batch revert |
| 9 | The verified-token list is static and is not substituted by an external runtime API | `web/src/config/verified-tokens.ts` |
| 10 | In Variant B an unknown transaction is **never** executed on the passage of time without a guardian confirmation | `TX_QUEUE_TIMEOUT = 0` |
| 11 | No automatic guardian removal on a timer, on outage or on non-payment | `guardianRemoved` is set only by `emergencyExit()` |
| 12 | The guardian cannot initiate a transfer or redirect funds | `queueTransaction` is `onlyOwner` |
| 13 | The safe address cannot be removed from the whitelist | `SafeAddressCannotBeUnlisted()` |
| 14 | Changing the safe address in Variant B requires 72 hours **and** a guardian confirmation | `requestSafeChange` → `guardianConfirmSafeChange` → 72h → `confirmSafeChange` |
| 15 | The only guardian removal is `emergencyExit()`: funds → safe address, pending actions cancelled, guardian removed | `emergencyExit()` |
| 16 | There is no separate `removeGuardian()` and no automatic guardian rotation | No such function exists |
| 17 | One unique guardian key per wallet | Enforced by configuration and by design, not by the contract |
| 18 | Platform login is a signature over the **safe address**, not the protected wallet | ✅ Implemented in the platform — see the platform's `SECURITY.md` §3 |
| 19 | Weakening managed protection requires safe-key authorization and 72 hours; strengthening it does not | ⛔ Not implemented — the platform has no pending-changes mechanism yet |

---

## 8. `emergencyExit()` — precisely what it does

`emergencyExit(address[] tokens)` is the exit path in Variant B. It is safe
even under a stolen owner key: its only destination is the safe address, which
an attacker holding the owner key does not control. An attacker who calls it is
helping the user.

What it actually does:

1. Sweeps the **listed** tokens to the safe address. The token list is an
   argument — it is not a discovery of everything the contract holds.
2. Sends the entire native balance to the safe address with unlimited gas.
3. Removes the guardian and sets `guardianRemoved = true`.
4. Cancels every pending transaction and every pending configuration change,
   including any stale guardian approval.

Limits, stated precisely:

* **At most `MAX_TOKENS_PER_EXIT = 50` tokens per call.** More than that reverts.
* **Only the tokens you name are swept.** A token that is not in the array is
  left in the contract. Do not write "sweeps everything" — it does not, for
  arbitrary tokens.
* Per-token gas is capped at `TOKEN_GAS_LIMIT = 250_000`, and the balance read
  at `BALANCE_GAS_LIMIT = 50_000`. A token that consumes more gas than that is
  skipped, not fatal to the rest.
* **This is not a Gnosis Safe module.** `SafeGPTGuardianModule` is a standalone
  smart account. It is not compatible with Safe multisig accounts, and calling
  it one would be wrong.

---

## 9. Honest status of the security review

| What | Status |
|---|---|
| Unit tests (bot + web) | 202 passing, 1 skipped (the skipped one needs a live RPC key) |
| Contract tests | 54 passing (27 + 27) |
| E2E tests | 40 passing against the platform build |
| End-to-end rescue on a local chain | Ran — the attacker received nothing, the safe address received the balance |
| AI review of both contracts | Done — the ChainGPT Smart Contract Auditor |
| Manual review against a security checklist | Done |
| **Independent external audit** | **Not done** |

**27/27 tests and an AI report are not an independent audit.** During the
guardian module review the auditor reported "no vulnerabilities" across every
category while two real defects were present: an unbounded queue that could
permanently block the emergency exit, and a stale guardian approval that
survived `emergencyExit()`. Both were found by hand and fixed.

Do not describe this code as "audited" or "deployed" without independent
confirmation.

### Known gaps

* **Variant B has no bot executor.** The contract exists and is tested; the bot
  cannot execute rescues through it. The bot returns
  `VARIANT_B_UNSUPPORTED`.
* **The end-to-end rescue has been run on a local Anvil chain, not on a public
  testnet.** The full path — attack detected in the mempool, R2 matched, the
  vault front-running the attacker, the balance arriving at the safe address —
  was exercised against a local chain with a mock ERC-20, and the attacker
  received nothing. What that does **not** cover is real gas bidding against a
  real competitor, real RPC latency, or a real drainer contract.
* **No persistence and no rescue history** (§5.3).
* **No proactive low-gas warning** (§5.2).
* **Flashbots is a configuration field, not a working integration.** The bot
  sends through the public mempool.
* **The platform's managed bot is not managed yet.** The bot process is still
  run by hand, and the platform stores the events without forwarding them to
  the user. The platform's own documentation has the full list.

---

## 10. There is no revoke button

SafeGPT does not offer a control that revokes the vault's allowance, in any
mode, on any page.

Revoking is the step an attacker takes. It disables the vault without touching
the funds, and the drain can then proceed unopposed. A "Revoke" button sitting
next to "Re-approve" in a protection product invites a mistake whose cause is
not visible to the person making it.

Users who need to de-authorise do it deliberately, outside this interface.

The dashboard does offer **re-approval**, which is the opposite operation and
is what an operator actually needs after a revoke.

---

## 11. Keys and secrets

* `VITE_*` variables are compiled into the JavaScript bundle and are readable
  in DevTools. Use them for your own keys only.
* Bot secrets are referenced as `ENV:NAME` in the config and are read from the
  environment. The bot never writes a key to disk.
* The protected wallet is cold storage. The executor is a hot key by necessity
  — it has to sign at any moment. It is deliberately powerful and
  deliberately limited: it can move funds only to the safe address.

---

## 12. Analytics

Counts and enums only: which step was reached, how many assets were selected,
which rule fired, whether an AI response was real or simulated.

No addresses, no transaction hashes, no balances, no amounts. An analytics
payload that identifies a wallet would turn a metrics endpoint into a tracking
database for exactly the people who trusted us with a cold-storage key.

---

## 13. Reporting a vulnerability

See [`../SECURITY.md`](../SECURITY.md).
