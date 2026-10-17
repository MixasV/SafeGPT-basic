# SafeGPT Core

**Active protection for crypto wallets.** SafeGPT watches the mempool for a
transaction leaving your protected wallet that looks like an attack, and
front-runs it with a higher-gas transaction that moves your tokens to a Safe
Address you control — before the malicious transaction executes.

> ⚠️ **A protected wallet is cold storage only.** After protection is enabled,
> never use it for swaps, dApp interaction or transfers. Keep a separate wallet
> for active activity, and store your Safe Address on a different device with a
> different seed phrase.

This repository is the **open-source core** (MIT). It runs fully on its own: it
never requires an account, a subscription or the hosted platform. Rescue decisions
are deterministic rules — no AI, no LLM, ever in the rescue path.

---

## Status

| Component | Status |
|---|---|
| `contracts/` — RescueVault (Variant A), 27 Foundry tests | ✅ Done (Sprints 1–2) |
| `contracts/` — SafeGPTGuardianModule (Variant B), 27 Foundry tests | ✅ Done (Sprint 2) |
| `bot/` — mempool monitor, rules, executor, alerts | ⏳ Sprint 3 |
| `web/` — onboarding wizard, 7 steps, Demo Mode, E2E tested | ✅ Done (Sprint 2) |
| `web/` — dashboard | ⏳ Sprint 4 |
| `docs/` — SETUP / ARCHITECTURE / SECURITY | ⏳ Sprint 8 |

**54 Foundry tests pass** (27 + 27). Playwright E2E covers the onboarding wizard
end to end in Demo Mode.

---

## Repository layout

```
safegpt-core/
├── contracts/          # Foundry project
│   ├── src/
│   │   ├── RescueVault.sol            # Rescue contract (single template)
│   │   ├── RescueVaultFactory.sol     # CREATE2 factory
│   │   └── interfaces/IRescueVault.sol
│   ├── test/RescueVault.t.sol         # 15 specified scenarios + edge cases
│   └── script/Deploy.s.sol
├── bot/                # TypeScript mempool rescue bot (Sprint 3)
│   └── config/config.example.json
├── web/                # React + Vite dashboard (HashRouter, GitHub Pages ready)
└── docs/
```

---

## Quick start

### Contracts

```bash
cd contracts
forge build
forge test          # 54 tests: 27 RescueVault + 27 GuardianModule
```

### Web dashboard

```bash
cd web
npm install
cp .env.example .env.local   # optional: WalletConnect project id, Alchemy key
npm run dev
```

Browser-injected wallets (MetaMask, Rabby, Brave) work with zero configuration.
Add a WalletConnect project id only if you need WalletConnect.
Get a free WalletConnect Project ID: https://cloud.walletconnect.com

### Demo mode

```bash
cd web
npm run build:demo     # .env.demo → VITE_DEMO_MODE=true
npm run preview
```

The whole onboarding wizard — connect, drainer check, safe address, safe-wallet
signature, asset scan with Core/Watch classification, vault deploy, approvals,
protection active — runs end to end with no wallet, no gas and no real
transaction. Use it for demos and for the grant video.

```bash
npm run test:e2e       # Playwright, runs the demo build in your local Chrome
```

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

Or deploy from the onboarding wizard (step 4.5), which uses the same bytecode.

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

**The guardian key must be unique per wallet.** A single shared guardian key would
mean one compromise controls every account, which defeats the entire design. In
the open-source build each user generates their own key and stores it on separate
hardware.

**Leaving the service:** `emergencyExit()` is the only way out. It sweeps every
asset to the safe address, removes the guardian and cancels the queue. There is no
`removeGuardian()` and nothing happens automatically — re-protecting means running
the onboarding again.

### Bot (after Sprint 3)

```bash
cd bot
npm install
cp config/config.example.json config/config.json
# edit config.json — every "ENV:NAME" string is replaced from process.env
npm start
```

The bot needs two RPC endpoints:

| Field | Purpose | Notes |
|---|---|---|
| `rpcWss` | Mempool subscription for pending transactions | Alchemy / Infura / your own node |
| `rpcHttp` | Sending the rescue transaction | Same provider is fine |
| `flashbotsRelay` | Private bundles | Optional. Omit it and the bot sends through the public mempool. The hosted Pro/Guardian+ tiers use it. |

JSON has no comments, so this table is the reference for those fields.

---

## Security model

### Variant A — RescueVault

* `rescue()` is callable **only** by `executor`, and can send funds **only** to
  the `safeAddress` and `feeReceiver` stored in the contract.
* Each token in a rescue batch is processed **in isolation**: a bounded gas
  stipend per `balanceOf`/`transferFrom`, manual return-value checks, and no
  revert propagation. A reverting or gas-burning token can waste its own budget
  but can never block the rescue of the remaining assets (UPD-2).
* At most `MAX_TOKENS_PER_TX = 30` tokens per call; `rescue()` is `nonReentrant`.
* There is no `pause()`, no `unpause()`, no `withdraw()` and no `setFee()`.
* Changing `safeAddress`, `quarantineAddress`, `executor` or the `whitelist`
  requires an owner request plus a **72-hour timelock**. In particular the
  executor cannot be swapped instantly, so an attacker with the owner key cannot
  lock the legitimate bot out of the rescue path in a single transaction (UPD-3).
* `feeBps` is fixed at deployment and hard-capped at `MAX_FEE_BPS = 1000`.
* Watch-set tokens (`chargeFee = false`) are routed to `quarantineAddress` so
  that unverified airdrops never reach the cold wallet.
* Every user runs the **same contract bytecode** — only constructor arguments
  differ (deployed via CREATE2 by the factory).
* Then, from the protected wallet, approve each protected ERC-20 to the vault.
  Until a token is approved, the vault cannot move it.
* **Native ETH cannot be protected** — the vault only moves ERC-20 tokens. Wrap to
  WETH first.
* Known accepted trade-offs are recorded in `docs/SECURITY.md` (Sprint 8):
  fee-on-transfer tokens deliver less than the nominal amount.

### Variant B — SafeGPTGuardianModule

* **Nothing executes without an explicit guardian confirmation.** There is no
  timeout and no timer that can execute or expire a queued transaction. A silent
  guardian stalls the wallet — that is the intended failure mode.
* Two exceptions, both deliberate: a transaction to a whitelisted destination
  executes immediately, and `emergencyExit()` sweeps everything.
* `emergencyExit()` is safe under a stolen owner key: its only destination is the
  safe address, which the attacker does not control. An attacker who calls it is
  helping the user.
* The safe address is whitelisted from construction and can **never** be
  unlisted, so funds always have an exit path.
* Safe-address and whitelist changes each require owner request → guardian
  approval → 72h timelock → owner confirmation. Re-issuing a request invalidates
  any earlier approval.
* Guardian confirms are rate limited to 5 per hour, so a leaked guardian key
  cannot green-light a whole batch.
* The queue is capped at `MAX_QUEUE_SIZE = 200` so the emergency exit always fits
  in one transaction's gas budget. Cancelling entries frees room.
* The guardian cannot initiate a transaction, execute one, call `emergencyExit`,
  move funds, or change the owner, safe address or whitelist.
* Leaving the service is only possible through `emergencyExit()`. There is no
  `removeGuardian()`.

### How the contracts were reviewed

Both contracts were reviewed by the ChainGPT Smart Contract Auditor **and** by
manual verification against a security checklist. The automated pass alone is not
sufficient: during the guardian module review it reported "no vulnerabilities"
across every category while two real defects were present — an unbounded queue
that could permanently block the emergency exit, and a stale guardian approval
that survived `emergencyExit()`. Both were found by hand and fixed. Treat the
auditor as a first pass, never as the only gate.

---

## Built with ChainGPT AI

The core is fully autonomous and does **not** depend on ChainGPT. The optional
integration is documented for self-hosters who want AI assistance around
SafeGPT (configuration review, contract audits) — it never touches the rescue path.

### ChainGPT Integration Guide

1. Get an API key and credits at [app.chaingpt.org](https://app.chaingpt.org).
2. Export it before starting the bot: `export CHAINGPT_API_KEY="your-key"`.
3. Install the ChainGPT developer kit for your agent tooling — it exposes the
   Web3 AI Chatbot and the Smart Contract Auditor over MCP:
   `git clone https://github.com/ChainGPT-org/chaingpt-claude-skill.git`
4. Use it for **configuration review and contract audits only**. Never call an
   LLM from inside the rescue decision path — the rules in `bot/src/rules.ts`
   must stay deterministic.
5. Watch your spend: the chatbot costs 0.5 credits per request, the auditor
   1 credit. On-chain rescue tooling itself is free.

Co-branding: the hosted platform displays a "Powered by ChainGPT AI" badge
because it ships the managed ChainGPT integration.

---

## License

MIT — see [LICENSE](./LICENSE).

SafeGPT is a **security tool**. It does not execute trades, provide financial
advice, or manage investment portfolios.