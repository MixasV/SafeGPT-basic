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
| `contracts/` — RescueVault + factory, 16 Foundry tests | ✅ Done (Sprint 1) |
| `bot/` — mempool monitor, rules, executor, alerts | ⏳ Sprint 3 |
| `web/` — onboarding wizard, dashboard, settings | 🚧 Shell + mode switcher (Sprint 1), features in Sprints 2 and 4 |
| `docs/` — SETUP / ARCHITECTURE / SECURITY | ⏳ Sprint 8 |

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
forge test          # 16 tests
```

### Web dashboard

```bash
cd web
npm install
cp .env.example .env.local   # optional: VITE_WALLETCONNECT_PROJECT_ID
npm run dev
```

Browser-injected wallets (MetaMask, Rabby, Brave) work with zero configuration.
Add a WalletConnect project id only if you need WalletConnect.
Get a free WalletConnect Project ID: https://cloud.walletconnect.com

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

## Deploying a vault

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

Then, from the protected wallet, approve each protected ERC-20 to the vault.
Until a token is approved, the vault cannot move it.

**Native ETH cannot be protected** — the vault only moves ERC-20 tokens. Wrap to
WETH first.

---

## Security model

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
* Known accepted trade-offs are recorded in `docs/SECURITY.md` (Sprint 8):
  fee-on-transfer tokens deliver less than the nominal amount.

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