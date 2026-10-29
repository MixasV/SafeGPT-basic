# Security policy

The full security model — threat model, mandatory invariants, asset boundaries
and the honest status of the review — is in
[`docs/SECURITY.md`](docs/SECURITY.md). This file covers how to report a
problem.

---

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository
(<https://github.com/safegpt/safegpt-core/security/advisories/new>). If that
is unavailable for your account, open a regular issue that contains **no
technical detail** and asks for a private channel.

We do not publish a security contact address, because an address nobody
monitors is worse than no address at all: it looks like a channel exists.

Please include, as far as you can:

* which component (`contracts/`, `bot/`, `web/`);
* the chain and the configuration involved;
* the steps to reproduce;
* what an attacker gains.

Please do not include a working exploit for a live deployment, and do not test
against wallets or funds that are not yours.

---

## What to expect

| Stage | What happens |
|---|---|
| Acknowledgement | Within 3 working days |
| Triage | Within 10 working days: confirmed, duplicate, or not a vulnerability |
| Fix | We aim to publish a fix before disclosing. The timeline depends on severity |
| Disclosure | Coordinated with you. We credit you unless you prefer otherwise |

We ask for a reasonable window before public disclosure. We do not run a
bounty programme, and we will not ask you to delay a disclosure that is
already public.

---

## Supported versions

This repository has no release tags yet. Until it does, the `main` branch is
the supported version.

---

## Scope

**In scope:** the rescue contracts, the bot, and the web interface in this
repository.

**Out of scope:**

* Third-party services, including RPC providers, explorers and the ChainGPT
  API. Report those to their operators.
* The hosted platform, which is a separate proprietary repository. See the
  platform's own security policy.
* Attacks that require a compromised protected-wallet key **and** a
  compromised safe address **and** a compromised guardian key simultaneously.
  With all three, the design has no answer and does not claim one.
* Denial of service against a user's own node or RPC provider.

---

## Known limitations

The following are documented design limits, not undisclosed vulnerabilities. If
you believe one of them can be exploited in a way the documentation does not
describe, that is a report.

* A token whose allowance was revoked cannot be rescued.
* Native ETH, NFTs and DeFi positions cannot be rescued.
* A transaction in a private mempool cannot be seen before it settles.
* The bot keeps no persistent state and no rescue history.
