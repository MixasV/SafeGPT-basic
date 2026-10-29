# SafeGPT Core

**MIT licensed.** This is the open-source rescue core: the contracts, the bot
and a three-route operator UI. It runs on your machine, against your RPC, with
your keys. It does not phone home and it does not need an account.

The hosted, managed version — subscriptions, multi-chain monitoring, the ChainGPT
assistant and auditor — is a separate, proprietary repository,
[`safegpt-platform`](https://github.com/safegpt/safegpt-platform).

SafeGPT is a **security tool**, not a trading platform. It does not execute
trades, provide financial advice, or manage investment portfolios.

---

## What problem this solves

You hold crypto on a wallet you use as **cold storage**. Somebody who
phished you has a transaction ready that moves it. You cannot react in the
time a block takes.

This repository gives that wallet a bodyguard: a bot that watches the mempool,
recognises the drain, and moves your approved ERC-20s to an address you chose
before the attacker's transaction settles.

**The protected wallet is for holding, not for using.** Swaps, bridges and dApp
interaction from that wallet are exactly the actions that require the wallet to
sign, and no monitor can protect a wallet that is deliberately signing. If you
need to move funds, use a different wallet.

---

## What is and is not in this repository

The specification draws a hard line, and it is worth stating plainly before
anything else:

> `safegpt-platform` may import from `safegpt-core`. `safegpt-core` must never
> contain code from `safegpt-platform`.

So the following are **absent here on purpose**, not missing:

| Not here | Why | Where it is |
|---|---|---|
| Landing, Pricing, About, Case Study, Open Source pages | Marketing surfaces for the hosted service | `safegpt-platform/web` |
| ChainGPT chat, contract auditor, contract creator | The ChainGPT integration is platform-only | `safegpt-platform/web` |
| Cloudflare proxy Worker | Holds the shared platform API key on a server | `safegpt-platform/proxy` |
| Plan / tier switcher (Basic, Pro, Guardian+) | Subscription tiers on a hosted service | `safegpt-platform/web` |
| Test suites | Development tooling, not product | [`../.tests`](../.tests) |

None of it is stubbed out either. `core` has no AI assistant because it has no
AI integration — not a disabled one that pretends.

What remains is the part that actually protects a wallet.

### What works without any key

| | Works with no key |
|---|---|
| The contracts, the bot, the rule engine | Yes. This is the whole product |
| The wizard, the dashboard | Yes |
| Demo Mode | Yes — no wallet, no gas, no transactions |
| An AI assistant, an auditor | **There is none here.** They are in `safegpt-platform` |

Nothing in this repository needs a ChainGPT key, a platform account, a
subscription or our servers. The MIT core is not a free tier of our SaaS; it
is the whole of the protection mechanism, and it is self-hostable end to end.

### The pricing pages say nothing about your bill

The hosted platform shows prices for a managed service. Running this
repository yourself costs:

| Item | Cost |
|---|---|
| The software | Free. MIT |
| An RPC endpoint | Your provider's price. A free tier covers one wallet |
| Gas for deploy, approvals and rescues | Real money, in ETH |
| The executor's gas balance | Real money, and it has to stay topped up |
| AI requests | None. There is no AI here |
| The service fee | None. `feeBps` is fixed at deployment, capped at 10%. Set it to 0 |

---

## Networks and assets

**Chains wired into the interface:** Ethereum mainnet, Base, Arbitrum,
Sepolia. The bot itself is chain-agnostic — it follows whatever `chainId` and
RPC endpoints the config names.

**Verified tokens:** 27, in a static list
(`web/src/config/verified-tokens.ts`). The list is a file, not a runtime API
call, so the Core/Watch classification is reproducible between two runs.

**What can actually be rescued:**

| Asset | Rescuable? |
|---|---|
| ERC-20 with a live allowance | Yes |
| ERC-20 whose allowance was revoked | **No** — `transferFrom` cannot work |
| Native ETH | **No** — the vault moves ERC-20s. Wrap to WETH |
| NFTs, DeFi positions | **No** |

---

## Status

| Component | Status |
|---|---|
| `contracts/` — RescueVault (Variant A) | ✅ Done |
| `contracts/` — SafeGPTGuardianModule (Variant B) | ✅ Done |
| `bot/` — mempool monitor, rules, executor, alerts | ✅ Done |
| `web/` — Setup, Dashboard, Settings + onboarding wizard | ✅ Done |
| `docs/` — SETUP / ARCHITECTURE / SECURITY | ✅ Done |

**54 Foundry tests** (27 + 27), **202 unit tests** and **40 E2E tests** pass.
The suites live in `../.tests`; `forge test` is wired to find them from
`contracts/`.

Two things are built but **not yet wired into the shipped rescue path**, and the
documentation says so where it matters: Variant B has contracts and tests but no
bot executor. The end-to-end rescue has been run against a local Anvil chain --
the attacker received nothing -- but never against a public testnet with a real
competitor. See
[docs/SECURITY.md](docs/SECURITY.md).
---

## Repository layout

```
safegpt-core/
├── contracts/          # Foundry project
│   ├── src/
│   │   ├── RescueVault.sol            # Rescue contract (single template)
│   │   ├── RescueVaultFactory.sol     # CREATE2 factory
│   │   ├── SafeGPTGuardianModule.sol  # Variant B smart account
│   │   └── interfaces/
│   ├── script/Deploy.s.sol
│   └── foundry.toml
├── bot/                # TypeScript mempool rescue bot
│   ├── src/            # monitor, rules, executor, scanner, alerts, telegram
│   └── config/config.example.yaml
├── web/                # React + Vite operator UI (HashRouter)
│   └── src/pages/      # Setup, Dashboard, Settings
├── docs/
│   ├── SETUP.md        # Contracts → bot → web, in order
│   ├── ARCHITECTURE.md # How the three processes fit together
│   └── SECURITY.md     # Threat model, limits, trust assumptions
├── start.bat           # Windows one-click local start
├── start.sh            # macOS / Linux one-click local start
├── LICENSE             # MIT
└── README.md
```

**Start with [docs/SETUP.md](docs/SETUP.md).** It is ordered, and the order
matters: the web app is an operator console and cannot rescue anything until the
bot is running.

---

## Quick start

### One-click

```bash
./start.sh          # macOS / Linux
start.bat           # Windows
```

Double-click, and it checks the toolchain, installs dependencies, creates
`.env` from the example and opens the UI on <http://localhost:5173>. It runs in
Demo Mode, so nothing is broadcast and nothing costs gas.

**Rehearse in Demo Mode first.** It is the same flow the grant demo recording
uses, and it costs nothing.

### Contracts

```bash
cd contracts
forge build
forge test          # 54 tests, run from ../.tests/contracts
```

### Web

```bash
cd web
npm install
cp .env.example .env.local   # optional: WalletConnect project id, Alchemy key
npm run dev
```

Browser-injected wallets (MetaMask, Rabby, Brave) work with zero configuration.
Add a WalletConnect project id only if you need WalletConnect:
<https://cloud.walletconnect.com>

### Bot

```bash
cd bot
npm install
cp config/config.example.yaml config/config.yaml
# edit config.yaml — every ENV:NAME string is replaced from process.env
npm run bot -- --config config/config.yaml --dry-run
```

`--dry-run` detects and reports without signing or broadcasting anything. Start
there. Confirm the log shows rules matching what you expect, then drop the flag.

The bot needs two RPC endpoints:

| Field | Purpose | Notes |
|---|---|---|
| `rpcWss` | Mempool subscription for pending transactions | Alchemy / Infura / your own node |
| `rpcHttp` | Sending the rescue transaction | Same provider is fine |
| `flashbotsRelay` | Private bundles | Optional. Omit it and the bot sends through the public mempool. |

Secrets are read from the environment, never from the config file:

```bash
export EXECUTOR_KEY=0x...     # bot key; its address must equal the vault's executor
export TG_BOT_TOKEN=...       # alerts
export TG_CHAT_ID=...
```

---

## The two protection variants

SafeGPT ships two independent contracts. Pick per wallet; they are not layered
on each other.

| | Variant A — `RescueVault` | Variant B — `SafeGPTGuardianModule` |
|---|---|---|
| Model | Rescue before the attack | Timelock + veto on every action |
| Who can move funds | The bot (`executor`), only to the safe address | Nobody alone — the guardian must confirm |
| You approve the contract | Yes (ERC-20 allowances) | No; it holds the assets directly |
| Compromised owner key | Bot still rescues; approvals can be revoked | **Cannot act alone** — the guardian blocks everything |
| Compromised guardian key | n/a | Can veto and approve, cannot move funds; 5 confirms/hour |
| Extra dependency | None | A second key on separate hardware |
| Best for | Earning from the service fee | Users who will not accept any custody assumption |

### Variant A — RescueVault

The bot watches the mempool, sees a suspicious transaction leaving your wallet,
and front-runs it with a higher-gas transaction that moves your approved tokens to
the safe address.

**Deploy:**

```bash
cd contracts
export EXECUTOR_PRIVATE_KEY=0x...      # bot key; its address becomes the executor
export PROTECTED_WALLET=0x...         # cold-storage wallet to protect
export SAFE_ADDRESS=0x...             # rescue destination, must differ from PROTECTED_WALLET
export FEE_RECEIVER=0x...             # service fee recipient
export FEE_BPS=500                     # 5%, hard cap 1000 (10%)
export VAULT_SALT=0x...               # 32-byte CREATE2 salt

forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
```

Or deploy from the onboarding wizard, which uses the same bytecode.

**The allowance limitation.** `rescue()` moves funds with `transferFrom`, so a
revoked allowance makes a token unmovable at any price. The bot refuses to send
a rescue it knows will fail — it checks allowances, drops stranded tokens, and
sends nothing if every requested token is stranded. Read
[docs/SECURITY.md](docs/SECURITY.md) before deploying.

### Variant B — SafeGPTGuardianModule

The assets live in the contract itself, so no approvals are needed. The owner
queues an action and nothing happens until a second, independent key — the
guardian — confirms it. There is no timer: a queued transaction waits forever
until the guardian acts. That is the intended failure mode, not a bug.

**Deploy:**

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...
export MODULE_OWNER=0x...       # owner of this smart account
export GUARDIAN_ADDRESS=0x...   # guardian key for THIS wallet only
export SAFE_ADDRESS=0x...       # where emergencyExit() sends everything

forge script script/DeployGuardian.s.sol:DeployGuardian --rpc-url "$RPC_URL" --broadcast
```

**The guardian key must be unique per wallet.** A single shared guardian key
would mean one compromise controls every account, which defeats the entire
design.

**Leaving the service:** `emergencyExit()` is the only way out. It sweeps every
asset to the safe address, removes the guardian and cancels the queue. There is
no `removeGuardian()` and nothing happens automatically.

---

## Security model

### Variant A — RescueVault

* `rescue()` is callable **only** by `executor`, and can send funds **only** to
  the `safeAddress` and `feeReceiver` stored in the contract.
* Each token in a rescue batch is processed **in isolation**: a bounded gas
  stipend per `balanceOf`/`transferFrom`, manual return-value checks, and no
  revert propagation. A reverting or gas-burning token can waste its own budget
  but can never block the rescue of the remaining assets.
* At most `MAX_TOKENS_PER_TX = 30` tokens per call; `rescue()` is `nonReentrant`.
* There is no `pause()`, no `unpause()`, no `withdraw()` and no `setFee()`.
* Changing `safeAddress`, `quarantineAddress`, `executor` or the `whitelist`
  requires an owner request plus a **72-hour timelock**. The executor cannot be
  swapped instantly, so an attacker with the owner key cannot lock the
  legitimate bot out in a single transaction.
* `feeBps` is fixed at deployment and hard-capped at `MAX_FEE_BPS = 1000`.
* Watch-set tokens (`chargeFee = false`) are routed to `quarantineAddress` so
  that unverified airdrops never reach the cold wallet.
* Every user runs the **same contract bytecode** — only constructor arguments
  differ (deployed via CREATE2 by the factory).
* **Native ETH cannot be protected** — the vault only moves ERC-20 tokens. Wrap
  to WETH first.
* **There is no revoke button anywhere in this product.** Revoking is the step
  an attacker takes, and a control that invites it belongs outside this
  interface.

### Variant B — SafeGPTGuardianModule

* **Nothing executes without an explicit guardian confirmation.** There is no
  timeout and no timer that can execute or expire a queued transaction. A silent
  guardian stalls the wallet — that is the intended failure mode.
* Two exceptions, both deliberate: a transaction to a whitelisted destination
  executes immediately, and `emergencyExit()` sweeps everything.
* `emergencyExit()` is safe under a stolen owner key: its only destination is the
  safe address, which the attacker does not control.
* The safe address is whitelisted from construction and can **never** be
  unlisted, so funds always have an exit path.
* Safe-address and whitelist changes each require owner request → guardian
  approval → 72h timelock → owner confirmation.
* Guardian confirms are rate limited to 5 per hour, so a leaked guardian key
  cannot green-light a whole batch.
* The queue is capped at `MAX_QUEUE_SIZE = 200` so the emergency exit always fits
  in one transaction's gas budget.
* The guardian cannot initiate a transaction, execute one, call `emergencyExit`,
  move funds, or change the owner, safe address or whitelist.

### How the contracts were reviewed

Both contracts were reviewed by the ChainGPT Smart Contract Auditor **and** by
manual verification against a security checklist. The automated pass alone is not
sufficient: during the guardian module review it reported "no vulnerabilities"
across every category while two real defects were present — an unbounded queue
that could permanently block the emergency exit, and a stale guardian approval
that survived `emergencyExit()`. Both were found by hand and fixed. Treat the
auditor as a first pass, never as the only gate.

---

## Tests

The suites are not in this repository. They live in [`../.tests`](../.tests),
because this is a repository people download to run, not to read.

```bash
cd ../.tests
npm install
npm run test:unit            # bot + web unit tests
npm run test:e2e             # Playwright, builds the platform app
```

Contract tests are wired through `foundry.toml`, so they still run from here:

```bash
cd contracts && forge test   # 54 tests, sources in ../../.tests/contracts
```

**This is not an independent audit.** 54 passing tests and an AI review are not
a security audit. See [`docs/SECURITY.md`](docs/SECURITY.md) §9 for exactly
what has and has not been verified.

---

## Security

* The vulnerability disclosure policy: [`SECURITY.md`](SECURITY.md)
* The threat model, the mandatory invariants and the honest review status:
  [`docs/SECURITY.md`](docs/SECURITY.md)

---

## Co-branding

The hosted platform in `safegpt-platform` displays a "Powered by ChainGPT AI"
badge, because it ships the managed ChainGPT integration. This repository does
not call ChainGPT and carries no such badge — see the table at the top.

---

## License

MIT. See [LICENSE](LICENSE).