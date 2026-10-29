# SafeGPT rescue bot

A deterministic mempool watchdog that moves funds out of a compromised wallet
before a drainer finishes.

No LLM is involved in any decision. Every trigger is a pure function of the
observed transaction and the operator's configuration, which is what makes the
rescue path reproducible and auditable.

## How it works

```
WSS pending tx ──► rules engine (R1–R7) ──► executor ──► rescue(address[],bool[])
                                                          │
new block ──► scanner (R8–R9) ────────────────────────────┘
```

- **pending** fires the rules *before* a transaction is mined. That window is the
  only time a rescue can beat an attacker.
- **block** runs the scanner against confirmed state, catching anything the
  mempool feed missed (dropped subscription, RPC hiccup, private relay).

## Quick start

```bash
npm install
cp config/config.example.yaml config/config.yaml   # then edit it
export EXECUTOR_KEY=0x...                         # never store a key in the file

npm run bot -- --config config/config.yaml --dry-run   # plan only, sends nothing
npm run bot -- --config config/config.yaml             # go live
```

`--dry-run` still connects, verifies the chain, and confirms the signer really is
the vault's authorised executor — it just refuses to broadcast. It is the way to
find out that your config is wrong without spending a rescue on the mistake.

## Rules

| Rule | Trigger | Action |
|---|---|---|
| R1 | `approve` / `setApprovalForAll` to a non-whitelisted address | RESCUE (CRITICAL) |
| R2 | Token transfer to a non-whitelisted address, above the token's raw threshold | RESCUE (CRITICAL) |
| R3 | Contract call with calldata to a non-whitelisted address | RESCUE (HIGH) |
| R4 | EIP-7702 delegation (`type === 4` or a non-empty `authorizationList`) | RESCUE (CRITICAL) |
| R5 | More than N outgoing transactions within M minutes | RESCUE (HIGH) |
| R6 | `requestExecutorChange()` called on the vault | RESCUE (CRITICAL) |
| R7 | Vault allowance revoked | ALERT, then escalates untrusted activity for 5 minutes |
| R8 | Vault allowance fell to zero between blocks | ALERT (CRITICAL) |
| R9 | Core token balance dropped past the configured percentage | RESCUE (CRITICAL) |

Evaluation order is `R4 → R6 → R7(detect) → R1 → R7(escalate) → R2 → R5 → R3`,
first match wins. A delegation or an executor-swap attempt outranks everything
below it: both mean the owner key is already gone.

### Why R8 is an alert, not a rescue

The specification asked for a rescue when the vault's allowance drops to zero.
That cannot work. `RescueVault.rescue()` pulls funds with
`transferFrom(owner, destination, amount)`, so at zero allowance every pull
fails, `_rescueOne` emits `RescueFailed` and skips, and the operator would read a
"rescue sent" log while every token stayed where it was. That is a false sense
of safety, which is worse than doing nothing.

So R8 is escalated as a CRITICAL alert instead. Detection is still correct — a
zero allowance means the drainer revoked approval to cover its tracks, and
whatever is left is stranded until a human re-approves.

### Known Variant A limitation: rescue after a revoke is impossible

The executor therefore **verifies every token's allowance before it
broadcasts**. If a token's allowance is zero it is excluded from the rescue and
reported; if *every* requested token is stranded, nothing is sent and the reason
is logged instead:

```
CRITICAL: allowance for 0x1c7D… on vault 0x3333… is zero. RescueVault pulls
funds with transferFrom(), so it CANNOT move these tokens until the owner
re-approves. No rescue transaction was sent for them. Immediate action
required: re-approve the vault or move the funds manually.
```

This is reachable in practice. An attacker who revokes the approval and
transfers in the same block trips R7 (alert) and then R9 (rescue) — with an
allowance of zero. Without the pre-flight check the bot would report a rescue
it cannot perform. Partial allowance loss still rescues what it can: core and
watch lists are partitioned independently, so a stranded core token never blocks
a movable watch token.

**After a revoke, protection for that token is off until the owner re-approves.**
This is an architectural property of the `transferFrom` model, not a bot defect.
It is a further argument for Variant B, where the guardian holds execution
authority without depending on a token allowance.

## Rescue execution

The bot calls exactly one function:

```solidity
rescue(address[] tokens, bool[] chargeFee)
```

It cannot choose a destination — `RescueVault` sends to its own stored
`safeAddress` — and it cannot rescue the native asset. Both are the security
model, not limitations to work around.

- **Core tokens first, in config order.** Config order is priority order.
- **Watch tokens in a separate transaction, fee not charged** — unverified assets
  go to the vault's quarantine address.
- Chunks of 30 (`RescueVault.MAX_TOKENS_PER_TX`), each its own transaction.
- Gas estimate +20%, suggested fee +30%, explicit `pending` nonce advanced per
  chunk.
- Rate limits: core 1/hour with a 1h cooldown; watch max 3/hour with a 15m
  cooldown.

Before anything is broadcast the executor checks that its signer address equals
the vault's `executor()`, and that its balance clears `minExecutorEth`. A rescue
reverted on `onlyExecutor` would burn gas to learn nothing.

**The gas check is a gate, not a warning.** It runs inside `preflight()`, at
the moment a rescue is attempted. There is no background check and no alert:
if the executor runs dry while no rule fires, the bot is silent. Watch the
balance yourself.

## Variant B

GuardianModule wallets are detected and reported, but no rescue is sent:

```
[Main] GuardianModule (variant B) rescue is not yet implemented — no
transaction was sent. Rule R1_APPROVE_UNKNOWN fired.
```

Detection still works, so the alerts are not lost.

## Configuration

See `config/config.example.yaml` for a commented example. Notes:

- Any string written as `ENV:NAME` is replaced with the environment variable —
  **after** YAML parsing, so `ENV:NAME` inside a comment is ignored.
- Addresses are checksum-validated. `safeAddress` must differ from
  `protectedWallet`, because a rescue to the compromised wallet protects nothing.
- `rescueThreshold` is a **raw** integer in the token's smallest unit. There is
  no USD oracle; a price feed would add a failure mode to the hot path.
  Omitting the threshold triggers on *any* transfer, which is the stricter and
  usually correct setting for cold storage.
- At startup the bot verifies the RPC's chain id, and that each vault is owned by
  the configured wallet and pays out to the configured safe address. A mismatch
  aborts rather than warns.

### Alerts

Alerts are sent to every enabled channel. Each channel is independent: one
failing does not stop the others, and a channel that fails is reported in the
log rather than raised as a crash.

| Channel | Config | Notes |
|---|---|---|
| Console | always on | The baseline. Works with no configuration at all |
| Telegram | `telegramBotToken`, `telegramChatId` | The primary channel — it is what reaches you at 3am |
| Webhook | `webhookUrl` | Optional. Any endpoint that accepts a JSON `POST` |

**Telegram setup.** Both values are required and must be set together; the bot
refuses to start if only one is present, because a silently dead alert channel
is worse than a startup error.

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, copy the token.
2. Open your bot's page and send it any message. A bot cannot message you first,
   so there has to be a message for it to reply to.
3. Read your numeric chat id from
   `https://api.telegram.org/bot<TOKEN>/getUpdates`, or ask the bot for it.

```bash
export TG_BOT_TOKEN=...
export TG_CHAT_ID=...
```

Secrets live in the environment, never in the config file — the config only
holds `ENV:TG_BOT_TOKEN` and `ENV:TG_CHAT_ID`. Sending is best-effort: a Telegram
API error is logged and the monitor continues, because losing the monitor to a
rate-limit response from an alert channel would be a self-inflicted outage.

## Reconnection

A WebSocket dies. The bot rebuilds the connection after 3s, up to 10 consecutive
attempts, then raises a CRITICAL system alert and exits non-zero. A rescue bot
that cannot see the mempool is worse than one that says so loudly, so it does not
loop forever. `SIGINT` / `SIGTERM` shut down cleanly.

## Development

```bash
npm run typecheck   # tsc --noEmit over src/
npm run build       # emit dist/ (src/ only)
```

`tsconfig.json` covers `src/` alone; `tsconfig.build.json` compiles `src/`
into `dist/`.

### Tests

**The test suites are not in this repository.** They live in `../../.tests`,
because this is a repository people download to run, not to read.

```bash
cd ../../.tests
npm install
npm run test:unit            # bot + web unit tests
```

The bot's own suites are in `.tests/bot/`, and they import from `bot/src/`
through a relative path.

### Live integration test

`.tests/bot/integration.sepolia.test.ts` runs against a real mempool and is
skipped unless a WSS endpoint is supplied:

```powershell
$env:SAFEGPT_E2E_RPC="wss://ethereum-sepolia-rpc.publicnode.com"
cd ../../.tests
npx vitest run bot/integration.sepolia.test.ts
```

It is the one test that skips itself when it has no key, which is why the
usual run reports `1 skipped` rather than a failure.

It confirms the node actually streams `newPendingTransactions` — a node that
ignored the subscription would leave the bot silently blind, which no unit test
can detect — and that real traffic survives `normalizeTransaction` and produces
verdicts. It does **not** test a full rescue: that needs a deployed
`RescueVault` owned by the protected wallet plus a funded executor, which is an
operator-side deployment.

Any keyless Sepolia WSS endpoint works. Alchemy and Infura need an account;
PublicNode does not, which is preferable for a smoke test.

## Not in this release

Flashbots bundles, USD oracles, persistent state, and any integration with the
web wizard or platform.