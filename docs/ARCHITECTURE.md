# Architecture

Three processes, two languages, one deterministic rule engine.

Everything in this document was read out of the code in this repository. Where
an earlier version of this file described an ABI that does not exist, that
version was wrong and this one is right.

---

## 1. Components

```
┌────────────────────────────────┐      ┌─────────────────────────────────┐
│  web/  (React + wagmi)         │      │  bot/  (Node + ethers v6)       │
│                                │      │                                 │
│  /setup    — wizard            │      │  Monitor ── WebSocket mempool  │
│  /dashboard — status           │      │     ├─ rules.ts   (R1–R7)       │
│  /settings — config            │      │     ├─ scanner.ts (R8–R9, post-  │
│                                │      │     │              block)         │
│  localStorage: wizard state    │      │     └─ executor.ts               │
│  mock data: dashboard panels   │      │           ├─ allowance preflight  │
│                                │      │           ├─ rate limits          │
│                                │      │           └─ broadcast            │
│                                │      │     └─ alerts.ts / telegram.ts  │
└───────────────┬────────────────┘      └──────────────┬──────────────────┘
                │                                      │
                │  deploy + configure                 │  rescue()
                ▼                                      ▼
┌────────────────────────────────┐      ┌─────────────────────────────────┐
│  contracts/  (Solidity)        │      │  Chain                          │
│                                │      │                                 │
│  RescueVault (Variant A)       │◀─────│  ERC-20 contracts               │
│  SafeGPTGuardianModule (B)     │      │  Public mempool                 │
│  RescueVaultFactory (CREATE2)  │      │  Confirmed state                │
└────────────────────────────────┘      └─────────────────────────────────┘
```

**The web app never holds the bot key.** It deploys the vault and records the
executor key so it can hand it to the operator. That key is passed once, at
setup, and is not stored by the web app. The bot holds it, in its own
environment.

Splitting it this way means the deployed front end cannot move funds. A
compromised web origin can leak setup data; it cannot drain a vault.

---

## 2. Variant A — the rescue path

### 2.1 Flow

```
Protected wallet
  → ERC-20 approve(RescueVault)        ← a standing allowance
        │
RPC / mempool / blocks
  → bot (WebSocket subscription)
  → deterministic rules (R1–R7)
  → allowance preflight
  → funded executor
  → RescueVault.rescue(tokens, chargeFee)
  → configured safeAddress  (or quarantineAddress for watch tokens)
```

### 2.2 The real ABI

This is the interface as written in
[`contracts/src/interfaces/IRescueVault.sol`](../contracts/src/interfaces/IRescueVault.sol).
An earlier version of this document carried a different signature; that version
was wrong.

```solidity
function rescue(address[] calldata tokens, bool[] calldata chargeFee) external;
```

* `tokens` — the ERC-20 addresses to move.
* `chargeFee` — per token: `true` takes the service fee and routes to the
  `safeAddress`; `false` charges nothing and routes to the
  `quarantineAddress`.
* **There is no `to` parameter, no `amounts` parameter, and no `msg.value`.**
  The destination and the amount are decided inside the contract. The executor
  cannot redirect funds by any means.

Access control: `onlyExecutor`, and `nonReentrant`.

```solidity
function owner() external view returns (address);
function executor() external view returns (address);
function safeAddress() external view returns (address);
function quarantineAddress() external view returns (address);
function feeReceiver() external view returns (address);
function feeBps() external view returns (uint16);
function whitelist(address account) external view returns (bool);
```

### 2.3 The real events

```solidity
event Rescued(address indexed token, uint256 amount, address indexed destination);
event RescueFailed(address indexed token, uint256 amount);
event RescueSkipped(address indexed token, bytes32 reason);
```

Plus the configuration-change events: `SafeChangeRequested` / `SafeChangeConfirmed` /
`SafeChangeCancelled`, `ExecutorChangeRequested` / `ExecutorChanged` /
`ExecutorChangeCancelled`, `QuarantineChangeRequested` / `QuarantineChangeConfirmed` /
`QuarantineChangeCancelled`, `WhitelistAddRequested` / `WhitelistAdded` /
`WhitelistRemoveRequested` / `WhitelistRemoved`.

### 2.4 What happens inside `rescue()`

1. `onlyExecutor` and `nonReentrant` checks.
2. `tokens.length <= MAX_TOKENS_PER_TX` (30).
3. For each token, `_rescueOne()`:
   * `balanceOf` read under a `BALANCE_GAS_LIMIT = 50_000` gas cap via
     `staticcall`. On failure → `RescueSkipped(token, REASON_BALANCE_OF)`.
   * Zero balance → `RescueSkipped(token, ZERO_BALANCE)`.
   * Destination: `chargeFee == false && quarantineAddress != address(0)`
     → `quarantineAddress`, otherwise → `safeAddress`.
   * Fee: `balance * feeBps / 10_000`, charged in **the token itself**, taken by
     a second `transferFrom` to the `feeReceiver`. `msg.value` is not used.
   * The transfer runs under a `TOKEN_GAS_LIMIT = 250_000` gas cap. A token
     that reverts, returns false, or burns the gas is reported as
     `RescueFailed(token, amount)` and **the batch continues**.
   * Success → `Rescued(token, amount, destination)`.

No per-token failure can revert the batch. That is the whole point of the
isolation.

### 2.5 Configuration changes and the timelock

| Change | Delay |
|---|---|
| `safeAddress` | 72 hours |
| `executor` | 72 hours |
| `quarantineAddress` | 72 hours |
| `whitelist` add / remove | 72 hours |

Every one of them is a three-step flow: `requestX` → wait → `confirmX`, with
`cancelX` available throughout. Re-issuing a request invalidates any earlier
approval. `feeBps` is **not** changeable — it is fixed at deployment and
capped at `MAX_FEE_BPS = 1000` (10%).

The executor delay is the reason an attacker with the owner key cannot lock the
legitimate bot out of the rescue path in a single transaction.

### 2.6 What does not exist, on purpose

There is no `pause()`, no `unpause()`, no `withdraw()` and no `setFee()`.
Pausing is a griefing vector for a rescue contract — the attacker can call it
and then the rescue stops. The timelock already covers the legitimate need to
change configuration.

### 2.7 Deployment through the factory

`RescueVaultFactory` deploys via CREATE2 with a caller-supplied salt. Every
user runs the **same bytecode**; only the constructor arguments differ. The
salt is derived from the wallet, so a user can verify the deployed address
before interacting with it.

---

## 3. Variant B — the guardian module

**`SafeGPTGuardianModule` is a standalone smart account.** It is not a Gnosis
Safe module, it is not compatible with Safe multisig accounts, and calling it
one would be wrong. It holds the assets directly and implements its own
queue.

### 3.1 Flow

```
Protected wallet (owner)
  → queueTransaction(to, value, data)
  → [queued, waiting]
  → guardian confirms  → executes
  → or owner cancels

Owner → emergencyExit(tokens[])
  → assets → safeAddress
  → guardian removed
  → all pending transactions and config changes cancelled
```

### 3.2 The real API

```solidity
function queueTransaction(address to, uint256 value, bytes calldata data) external; // onlyOwner
function executeTransaction(bytes32 txId) external;                                   // onlyOwner
function confirmTransaction(bytes32 txId) external;                                  // onlyGuardian
function cancelTransaction(bytes32 txId) external;                                   // onlyOwner
function emergencyExit(address[] calldata tokens) external;                           // onlyOwner
```

Configuration changes use the same shape as Variant A, with one extra step:

```
requestSafeChange → guardianConfirmSafeChange → 72h → confirmSafeChange
```

The whitelist follows the same four-step path.

### 3.3 Constants

| Constant | Value | Meaning |
|---|---|---|
| `TX_QUEUE_TIMEOUT` | `0` | **A queued transaction never expires.** There is no timer that can execute it |
| `MAX_CONFIRMS_PER_HOUR` | `5` | A leaked guardian key cannot green-light a batch |
| `MAX_QUEUE_SIZE` | `200` | The emergency exit always fits in one transaction's gas budget |
| `MAX_TOKENS_PER_EXIT` | `50` | The emergency exit's per-call token cap |
| `SAFE_CHANGE_DELAY` | 72 hours | |
| `WHITELIST_CHANGE_DELAY` | 72 hours | |

### 3.4 The guardian's powers

The guardian can **confirm** and **cancel**. It cannot:

* initiate a transaction (`queueTransaction` is `onlyOwner`),
* execute one (`executeTransaction` is `onlyOwner`),
* call `emergencyExit()`,
* move funds,
* change the owner, the safe address or the whitelist on its own.

The safe address is whitelisted from construction and `requestWhitelistRemove`
reverts with `SafeAddressCannotBeUnlisted()`. Funds always have an exit path.

### 3.5 Contract versus integration

**The contract is not connected to the bot.** The bot returns
`VARIANT_B_UNSUPPORTED` for a Variant B wallet. There is no guardian key
management, no confirm workflow, and no hosted service that runs guardians.

A contract with 27 passing tests is not a working product. See
[`SECURITY.md`](SECURITY.md) §9.

---

## 4. The rule engine

`bot/src/rules.ts`. Every decision is a pure function of
`(transaction, wallet config, state)`. No model, no network access, no timers.

**That property is the product.** A rescue path that depends on an API
response would be unreproducible in a dispute, and the person relying on it
would have no way to check the reasoning.

### 4.1 Evaluation order

```
R4 → R6 → R7(detect) → R1 → R7(escalate) → R2 → R5 → R3
```

The first match wins. The order is not arbitrary:

* **R4 and R6 come first** because a delegation or an executor-swap attempt is
  proof of key compromise, which outranks every heuristic below it.
* **R7's detection comes before R1** even though R1 is the broader approval
  rule, because a revoke *is* an `approve()` whose spender is the vault — R1
  classifies that as trusted and ignores it, which would make R7 unreachable.
* **R7's escalation comes after R1**, so an explicit approval violation
  reports the more specific R1 instead of being flattened into R7.
* **R2 comes before R5** so a sub-threshold transfer cannot slip through during
  the grace period.

### 4.2 The rules

| Rule | Selector / condition | Action | Severity |
|---|---|---|---|
| **R1** `R1_APPROVE_UNKNOWN` | `approve(address,uint256)` or `setApprovalForAll(address,bool)` to a non-whitelisted spender | RESCUE | CRITICAL |
| **R2** `R2_TRANSFER_UNKNOWN` | `transfer` / `transferFrom` to a non-whitelisted recipient | RESCUE | CRITICAL |
| **R3** `R3_CALL_UNKNOWN` | any other contract call to an untrusted destination | RESCUE | HIGH |
| **R4** `R4_EIP7702` | the wallet delegated to a contract | RESCUE | CRITICAL |
| **R5** `R5_MASS_TRANSFERS` | more than `massTransferCount` outgoing transfers within `massTransferWindowMin` | RESCUE | HIGH |
| **R6** `R6_EXECUTOR_CHANGE` | `requestExecutorChange(address)` on the vault | RESCUE | CRITICAL |
| **R7** `R7_REVOKE_APPROVE` | `approve(vault, 0)` — detection, then a 5-minute escalation window | ALERT → RESCUE | CRITICAL |
| **R8** `R8_ALLOWANCE_DROPPED` | post-block: allowance went non-zero → zero | **ALERT** | CRITICAL |
| **R9** `R9_BALANCE_DROPPED` | post-block: a core token's balance fell by ≥ `balanceDropPct` | RESCUE | CRITICAL |

Selectors are derived from signatures with `ethers.id(...)`, so they cannot
drift from the code they match.

R8 and R9 are deliberately **not** in `rules.ts`. They are post-block
observations and belong to `scanner.ts`.

### 4.3 Thresholds

`massTransferCount` (default 3), `massTransferWindowMin` (default 5) and
`balanceDropPct` (default 10) come from the wallet config and are mirrored in
the web wizard, so the operator sets the same numbers the bot enforces.

`rescueThreshold` is a **raw integer in the token's smallest unit**. There is
no USD oracle — a price feed would add a failure mode to the hot path.
Omitting the threshold triggers on *any* transfer, which is the stricter and
usually correct setting for cold storage.

---

## 5. Core and Watch tokens

Two lists per wallet, and they are treated differently:

| | Core | Watch |
|---|---|---|
| Source | Verified tokens the operator configured | Pre-registered or unverified tokens |
| Fee | Charged (`chargeFee = true`) | **Not** charged (`chargeFee = false`) |
| Destination | `safeAddress` | `quarantineAddress` |
| Transaction | Its own | A separate one, after the core batch |
| Cooldown | 1 hour | 15 minutes, max 3 per hour |

The separation is deliberate. A gas bomb in the core batch must not be able to
block the quarantine path, and an unverified airdrop must never reach the cold
wallet.

**Order is configuration order, not USD value.** There is no price oracle and
no sorting by value in the code. The operator's YAML order is the priority
order: the tokens they listed first take the first transaction slots.

Chunks are capped at `MAX_TOKENS_PER_TX = 30` tokens, matching the contract.

---

## 6. The executor

`bot/src/executor.ts`.

### 6.1 Preflight

Checked before anything is sent:

1. **Variant B?** → `VARIANT_B_UNSUPPORTED`. Not sent.
2. **Signer matches the vault's executor?** The address is compared against
   `vault.executor()`. A mismatch → `SKIPPED`. (The contract would reject it
   anyway; catching it here avoids a wasted transaction.)
3. **Executor gas floor.** Below `alerts.minExecutorEth` (default 0.1 ETH) →
   `SKIPPED`, with the balance and the floor in the message.
4. **Rate window.** Per `safeAddress`: core cooldown 1 hour, watch cooldown 15
   minutes, max 3 watch rescues per hour. These values are hard-coded in
   `executor.ts`, not configurable.
5. **Allowance partition.** For every requested token:
   `allowance(protectedWallet, vaultAddress)`.
   * `> 0` → **movable**.
   * `== 0` → **stranded**, dropped.
   * If **every** requested token is stranded → `SKIPPED`, **nothing is sent**.

### 6.2 Broadcasting

* One transaction per chunk, sent sequentially.
* `estimateGas` gets a 20% buffer (`GAS_BUFFER_PCT`).
* `maxFeePerGas` / `maxPriorityFeePerGas` get a 30% buffer (`FEE_BUFFER_PCT`).
* Nonce: `eth_getTransactionCount(wallet, "pending")` **re-read per chunk**,
  plus the chunk index.

That last point is a known weakness. If the node has already counted the
previous transaction in its pending nonce, the increment produces a gap and the
later transaction can stall.

### 6.3 What the executor does not do

* It does not wait for a receipt.
* It does not read the contract's events. Whether a token was rescued, skipped
  or failed is visible in the transaction's logs, not in the bot's output.
* It does not write history anywhere.
* It has no access to the alerting layer. A skipped rescue is reported to
  **stdout**, not to Telegram or the webhook.

---

## 7. The post-block scanner

`bot/src/scanner.ts`. Runs once per new block, per wallet.

For every configured token it reads `balanceOf` and `allowance` and compares
them with the previous snapshot.

* **The first scan only establishes a baseline.** It finds nothing. This is
  why the scanner cannot detect a drain that happened before it started.
* **R9** — a core token's balance fell by at least `balanceDropPct`. Fires a
  RESCUE for that one token. The balance-drop percentage is computed with
  integer truncation downward.
* **R8** — an allowance went from non-zero to zero. Fires an **ALERT**, not a
  rescue, because at zero allowance a `transferFrom` rescue provably cannot
  move anything. An allowance that was already zero at the first snapshot does
  not trigger it.

**R8 and our own rescues.** A successful rescue moves the whole balance, and
`transferFrom` spends the allowance on the way — so the allowance lands on
zero, which is exactly the shape of a revocation. The executor therefore
reports which tokens it moved, and the scanner suppresses R8 for those tokens
on the next scan. Without that, every successful rescue would end with a
CRITICAL "allowance was revoked, no rescue can move this token" alert — the
opposite of what happened, and precisely the kind of false alarm that trains
an operator to ignore the channel that matters.

The suppression covers exactly one scan. A real revocation on a later block is
still reported.

The snapshot map lives in memory. `reset()` exists but is not called anywhere
in the current code.

---

## 8. State, reconnect and persistence

### 8.1 What is in memory

| State | Where | Survives a reconnect? | Survives a restart? |
|---|---|---|---|
| R5 transfer counter, R7 grace window | `monitor.ts` → `states` map | Yes | **No** |
| Rate-limit windows | `executor.ts` → `windows` map | Yes | **No** |
| Scanner baseline | `scanner.ts` → `snapshots` map | Yes | **No** |

The `Monitor`, `Executor` and `Scanner` objects are created once at startup
and reused across sessions, which is why the state survives a reconnect but
not a restart.

### 8.2 Reconnect

* The monitor retries with a 3-second delay, up to 10 attempts.
* A **heartbeat** check: if no event arrives for 90 seconds, the session is
  considered dead and restarted. A chain emits a block roughly every 12
  seconds, so 90 seconds of silence means the socket is broken.
* After 10 failed attempts the bot raises `ReconnectExhaustedError`, sends a
  system alert, and exits with code 1.
* `SIGINT` / `SIGTERM` trigger a clean shutdown.

### 8.3 What reconnect does not do

* **It does not replay missed blocks.** Blocks that happened during the outage
  are not re-scanned. R9 will still notice the balance change, but the block
  number it reports will be the current one, which may be wrong.
* **It does not re-send mempool transactions** that were missed.
* **It does not track its own rescues** to completion.

### 8.4 Persistence

There is none. The bot has no database and writes no files; the only file I/O
is reading the YAML config. All history lives in stdout, in the alerts, and in
the operator's log aggregator.

---

## 9. Alerts

Three channels, composed so that one failing does not stop the others.

| Channel | Where | Format |
|---|---|---|
| Console | always on | `[timestamp] SEVERITY ACTION RULE wallet=… tx=… — reason` |
| Telegram | `alerts.telegramBotToken` + `telegramChatId`, both required | HTML, emoji by severity, 8s timeout |
| Webhook | `alerts.webhookUrl`, optional | `POST` JSON `{ "text": "<Slack markdown>" }`, 5s timeout |

A channel failure is logged and the others still fire. A failed alert never
interrupts the monitoring loop.

**What is alerted:** rule matches, and rescue transactions that failed at the
transaction level.

**What is not alerted:** the result of a rescue (`SENT` / `DRY_RUN` /
`SKIPPED`), transaction hashes of successful rescues, and stranded tokens. The
last one is the important gap — see
[`SECURITY.md`](SECURITY.md) §5.1.

---

## 10. The web interface

### 10.1 Routes

`/setup`, `/dashboard`, `/settings`. Nothing else.

There is no landing page, no pricing table and no AI assistant in this
repository. Those are platform surfaces — see the [architecture notes of the
platform](https://github.com/safegpt/safegpt-platform).

### 10.2 Where the dashboard's data comes from

| Panel | Source |
|---|---|
| ProtectionStatus, WalletCard, TokenList | Real on-chain reads through wagmi/viem |
| AlertFeed | Mock |
| RescueHistory | Mock |
| QuickActions | Real actions |

**Mock and on-chain data are not mixed silently.** The mock panels are the
same ones that would be fed by the platform backend.

There is no connection between this interface and the bot. The dashboard's
"rescue history" is sample data.

### 10.3 Persistence

The wizard's state lives in `localStorage` (zustand `persist`). That is the
only client-side storage.

### 10.4 The verified-token list

`web/src/config/verified-tokens.ts` is a **static file**. It is not replaced
at runtime by any external API — see
[`SECURITY.md`](SECURITY.md) §6.

---

## 11. The AI and auditor path

**This repository has no AI integration.** The ChainGPT client, the chat
widget, the contract auditor and the contract creator live in
`safegpt-platform`, which is proprietary.

The path in the platform, for reference, is deliberately outside the rescue
path:

```
User action → AI client / proxy → ChainGPT → explanation or report
```

The auditor accepts **source code, not an address**. When auditing by address,
the source is fetched by our own code:

| Provider | Chains | Key required |
|---|---|---|
| **Sourcify** | all | No |
| **Etherscan** | per-chain endpoints | Yes |
| **Blockscout** | Arbitrum, Base, Gnosis, Celo, Linea | No |

Sourcify is tried first because it is the only one that works without a key,
and because it verifies the source against the on-chain bytecode rather than
trusting the explorer's label.

Chain detection comes from Sourcify's all-chains endpoint. Etherscan and
Blockscout are per-chain and are skipped when no chain is known — so an address
alone does not reliably resolve a network, and the interface says so.

**Verified source is not the same as a safe contract.** The auditor is a first
pass.

---

## 12. Configuration

One source per concern:

| What | Where |
|---|---|
| Wallets, tokens, thresholds, RPC | `bot/config/config.yaml` (see `config.example.yaml`) |
| Secrets | The environment, referenced as `ENV:NAME` |
| Contract addresses and ABIs | `web/src/config/contracts.ts` |
| Known verified tokens | `web/src/config/verified-tokens.ts` |
| Plan names and prices | `web/src/config/content.ts` (platform only) |

`ENV:NAME` substitution happens **after** YAML parsing, so `ENV:NAME` inside a
comment is ignored.

At startup the bot verifies the RPC's chain id, that each vault is owned by the
configured wallet, and that it pays out to the configured safe address. A
mismatch aborts rather than warns.
