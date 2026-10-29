# Setup

Three scenarios, and they are genuinely different:

* **[A. Demo](#a-demo)** — no wallet, no ETH, no keys. Rehearse the whole flow.
* **[B. Self-hosted on testnet](#b-self-hosted-on-testnet)** — the real thing,
  on Sepolia.
* **[C. Publishing the frontend](#c-publishing-the-frontend)** — build it, and
  keep the keys out of the bundle.

Do A before B. B before C.

---

## A. Demo

### A.1 Run it

There is **one** configuration file for the whole project, at its root:

```bash
cp .env.example .env
```

Everything reads it — the bot, the web interface, the contracts tooling. There
is no per-sub-directory `.env`, so there is nothing to hunt for.

```bash
./start.sh          # macOS / Linux
start.bat           # Windows
```

The launcher checks that Node is installed, installs dependencies if needed,
creates `.env` from `.env.example` if it is missing, starts the interface on
<http://localhost:5173> and opens your browser.

Or by hand:

```bash
cd web
npm install
npm run dev
```

**Only the `VITE_` prefixed values reach the browser bundle.** The Telegram
token and the executor key stay on the machine.

### A.2 What Demo Mode is

`VITE_DEMO_MODE=true` — set in the project's `.env`, or built in with
`npm run build:demo` (which uses the project's `.env.demo`).

### A.3 What is simulated

| Area | In Demo Mode |
|---|---|
| Wallet connection | A mock wallet; no real signature is requested |
| The drainer check | Both outcomes are available on demand, so you can record either one |
| The token scan | A bundled token list with fabricated balances |
| Vault deployment | No transaction is broadcast; a plausible address is produced |
| Approvals | Simulated, one step at a time |
| The dashboard | Real component code, mock data |
| **Any real transaction** | **None. Nothing is broadcast, nothing costs gas** |

A banner is shown across the top of the interface the whole time.

### A.4 What Demo Mode is not

**It is not protection.** Nothing in Demo Mode can rescue anything, because
nothing is deployed and no transaction is ever sent. It exercises the
interface, not the mechanism.

The drainer check in Demo Mode is a simulation of a balance comparison. The
real one waits two blocks and reads your actual balance.

**Use Demo Mode for rehearsal, screenshots and the grant video. Use it on a
throwaway wallet if you like — but never point it at the wallet you actually
care about, and never rehearse the real path on it.**

---

## B. Self-hosted on testnet

### B.0 Configuration

The configuration lives in one file, <project>/.env, next to this README. Copy it
from the example and fill it in:

``bash
cp .env.example .env
``r

The bot reads the TG_ and EXECUTOR_ variables, and the web interface reads
the VITE_ ones. There is one file for both.

### B.1 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20.19 or newer | `node --version` |
| Foundry | stable | `forge --version` |
| A wallet | — | The **protected** wallet. Cold storage |
| An executor key | — | A separate hot key. Its address becomes the vault's `executor` |
| An RPC | — | Alchemy, Infura or your own node |

The protected wallet is the one being defended. If it has ever typed a seed
phrase into a website, replace it before setting this up.

### B.2 Build the contracts

```bash
cd contracts
forge build
```

The Foundry test suite lives outside this repository, in `../../.tests`:

```bash
forge test          # 54 tests
```

### B.3 Generate the frontend artifacts

The web interface needs the deployed addresses and the ABIs.

```bash
cd web
npm install
```

`web/src/config/contracts.ts` holds the addresses and ABIs. After deploying,
put your vault's address there (or point the wizard at it during setup).

### B.4 Configure the chain

```bash
cd bot
npm install
cp config/config.example.yaml config/config.yaml
```

```yaml
rpcWss: "wss://sepolia.infura.io/ws/v3/YOUR_KEY"
rpcHttp: "https://sepolia.infura.io/v3/YOUR_KEY"
chainId: 11155111
```

`chainId` must match the chain. The bot verifies the RPC's chain id at startup
and aborts on a mismatch.

### B.5 Deploy the contracts

```bash
cd contracts
export EXECUTOR_PRIVATE_KEY=0x...      # the executor key
export PROTECTED_WALLET=0x...         # the cold-storage wallet to protect
export SAFE_ADDRESS=0x...             # where rescued funds land
export FEE_RECEIVER=0x...             # service fee recipient
export FEE_BPS=500                     # 5%, hard cap 1000 (10%)
export VAULT_SALT=0x...               # 32-byte CREATE2 salt

forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
```

Record the deployed vault address.

**Variant B** is a separate deployment:

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export MODULE_OWNER=0x...
export GUARDIAN_ADDRESS=0x...         # unique per wallet
export SAFE_ADDRESS=0x...

forge script script/DeployGuardian.s.sol:DeployGuardian --rpc-url "$RPC_URL" --broadcast
```

### B.6 Choose the safe address carefully

`safeAddress` is the only destination rescued funds can reach. The executor
cannot redirect them and the owner cannot change it without a 72-hour delay.

Use a different key from the protected wallet. If the same key controls both,
the safe address is not safe.

### B.7 The executor key and its gas

The executor is a hot key — it has to sign at any moment. It must hold gas.

**Read the executor balance through `vault.executor()`, not `owner()`.** They
are different addresses, and reading the owner's balance tells you nothing
about whether the bot can act.

```bash
cast balance $(cast wallet address --private-key "$EXECUTOR_PRIVATE_KEY") \
  --rpc-url "$RPC_URL"
```

The bot refuses to send a rescue when the executor is below
`alerts.minExecutorEth` (default 0.1 ETH). It does not warn you proactively —
the check only happens at the moment a rescue is attempted. If you want to be
told, watch the balance yourself.

### B.8 Core and Watch tokens, and the whitelist

```yaml
wallets:
  - label: "Main wallet"
    protectedWallet: "0x1111..."
    safeAddress: "0x2222..."
    vaultAddress: "0x3333..."
    executorPrivateKey: "ENV:EXECUTOR_KEY"

    coreTokens:
      - address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"   # USDC (Sepolia)
        symbol: "USDC"
        decimals: 6
        rescueThreshold: "1000000"    # raw units: 1 USDC

    watchTokens: []

    whitelist:
      - "0x4444..."
```

* `rescueThreshold` is a **raw integer in the token's smallest unit**. There is
  no USD oracle. Omitting it triggers on *any* transfer, which is the stricter
  setting and usually the right one for cold storage.
* Core tokens are verified and listed by you. Watch tokens are pre-registered
  or unverified, are rescued **without a fee**, and go to the quarantine
  address so an unverified airdrop never reaches the cold wallet.
* The whitelist lists destinations you legitimately interact with. Anything
  else is a rescue trigger.
* Order matters: it is the priority order for the rescue transaction slots.
  There is no sorting by USD value.

### B.9 Approvals

From the **protected wallet**, approve the vault for each protected ERC-20.
Until a token is approved, the vault cannot move it.

The wizard's "Approve Protection" step does this one token at a time.

**The allowance is the weak point.** If the attacker revokes it before the
drain, that token cannot be rescued by any means. See
[`SECURITY.md`](SECURITY.md) §3.

### B.10 Run the bot

```bash
export EXECUTOR_KEY=0x...
export TG_BOT_TOKEN=...
export TG_CHAT_ID=...

npm run bot -- --config config/config.yaml --dry-run
```

`--dry-run` detects and reports without signing or broadcasting. Confirm the
log shows the rules matching what you expect, then drop the flag.

The bot verifies at startup that the RPC's chain id matches, that each vault is
owned by the configured wallet, and that it pays out to the configured safe
address. A mismatch aborts rather than warns.

### B.11 If the frontend defaults the executor to the connected wallet

The onboarding wizard can deploy the vault with the **connected wallet** as
the executor. That is convenient and it is a trap.

**A deployed vault without a correctly configured, running bot does not mean
automatic protection is active.** If the connected wallet is the executor but
no bot holds that key, then:

* no bot is watching the mempool,
* no rule ever fires,
* nothing is ever rescued,
* and the allowance you granted is standing permission for the vault to move
  funds with nobody on the other end.

Check the vault's executor on-chain before you assume you are protected:

```bash
cast call "$VAULT_ADDRESS" "executor()(address)" --rpc-url "$RPC_URL"
```

That address must be the one whose key is in `EXECUTOR_KEY`.

---

## C. Publishing the frontend

### C.1 Without any key

The interface runs fully with no API key. The AI features report that they
are unconfigured instead of failing silently.

**This repository has no AI features.** The ChainGPT chat, the contract
auditor and the contract creator live in `safegpt-platform`. There is nothing
to configure here.

### C.2 With your own key, locally

For the platform build:

```
VITE_CHAINGPT_API_KEY=your-own-key
```

A `VITE_*` variable is compiled into the JavaScript bundle and is readable in
DevTools. That is fine for **your own key on your own machine**, which is what
local use is.

### C.3 With a proxy, for a hosted build

Never put a shared key in a `VITE_*` variable. Put it in the Worker secret:

```bash
cd proxy        # in safegpt-platform
npx wrangler secret put CHAINGPT_API_KEY
npx wrangler deploy
```

Then point the app at it:

```
VITE_CHAINGPT_PROXY_URL=https://<your-worker>
```

The proxy takes precedence over the key.

| Variable | Read by | Safe in a public bundle? |
|---|---|---|
| `VITE_CHAINGPT_API_KEY` | the browser bundle | Only if it is your own key |
| `CHAINGPT_API_KEY` | Node code — the backend and the Worker | Yes, it stays on the server |

Never reuse one for the other.

### C.4 GitHub Pages

```bash
cd web
npm run build:pages
npm run deploy:pages
```

The build uses `base: "./"` and the app uses `HashRouter`, so it works from any
repository path with no server-side rewrite rule and no 404 fallback.

### C.5 Two checks you should run yourself

**There is no build-time prohibition and no post-build leak check in this
repository.** Nothing stops you from publishing your own key by accident. So
check, every time:

```bash
# 1. no key literal in the built bundle
grep -r "VITE_CHAINGPT_API_KEY" dist/assets/*.js
```

Every hit should be **UI text** — a message telling the user which variable to
set. A hit that looks like a real key value is a leak: rebuild without it.

```bash
# 2. the key is not in the environment of the build
echo "$VITE_CHAINGPT_API_KEY"
```

Empty means the build could not have embedded it.

**Do not publish a build that was made with a shared key.** Use the proxy.

### C.6 Live smoke test

There is no `test:live:chaingpt` script in this repository, and no automated
live test should be run as part of checking the documentation. A live test
costs money and a live test against a real chain moves real funds.

If you want to check the AI path by hand, do it with your own key, in your own
browser, and check the credits you spent afterwards.

---

## D. What it costs you

Running the open-source core yourself costs:

| Item | Cost |
|---|---|
| The software | Free. MIT licence |
| An RPC endpoint | Whatever your provider charges. A free tier is enough for one wallet |
| Gas for rescue transactions | Real money, in ETH, only when a rescue actually happens |
| Gas for the deploy and the approvals | Real money, once |
| The executor's gas balance | Real money, and it has to stay topped up |
| AI requests | **None.** There is no AI in this repository |
| A service fee | **None.** `feeBps` is fixed at deployment and is capped at 10%. Set it to 0 if you do not want to charge anything |

**The pricing pages on the hosted platform say nothing about the cost of
self-hosting.** The free core is not a free tier of our SaaS. If you run it
yourself, you pay your infrastructure provider and nobody else.

---

## E. A checklist before you rely on it

1. `forge test` passes.
2. The vault is deployed and `vault.executor()` returns the address whose key
   is in `EXECUTOR_KEY`.
3. `safeAddress` is controlled by a different key from the protected wallet.
4. The executor holds gas.
5. Each protected token has a live allowance to the vault.
6. The bot runs without `--dry-run` and its log shows a live mempool
   subscription.
7. Telegram arrives. Send yourself a test alert.
8. The rescue cooldown settings suit you — they are hard-coded, not
   configurable.
