/**
 * Single source of truth for every number and claim shown in this build.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Sprint 5's specification had the landing page quoting "~70-90% coverage" and
 * the pricing page quoting "~60-70%" for the same product. Two pages, two
 * numbers, no contradiction anyone noticed until review.
 *
 * Content that appears on more than one surface does not live in the page
 * components. If a coverage figure changes, it changes here and every surface
 * updates together — a contradiction becomes unrepresentable rather than
 * something to remember.
 *
 * The same applies to the disclaimers. They are mandatory copy, exported as
 * constants so the disclosure tests assert against the same strings the pages
 * render, instead of hard-coded literals that can drift.
 */

/** Product name, used in titles and the footer. */
export const PRODUCT = "SafeGPT";
export const GITHUB_URL = "https://github.com/safegpt/safegpt-core";

/**
 * Coverage estimates.
 *
 * These describe the ARCHITECTURE of each plan, not the current state of the
 * software. They are ranges on purpose and are labelled as estimates wherever
 * they appear — a single number would imply a precision nobody can honestly
 * claim about mempool competition.
 */
export const COVERAGE = {
  /** Variant A (RescueVault) spans Basic and Pro. */
  variantA: "60–90%",
  /** Variant B (GuardianModule) — architecturally stronger. */
  variantB: "~95%",
  basic: "~60–70%",
  pro: "~80–90%",
  guardian: "~95%",
} as const;

/**
 * Risk disclaimer.
 *
 * SHOWN IN EXACTLY TWO PLACES, on purpose.
 *
 * A disclaimer repeated on every screen stops being read and starts costing
 * credibility — the product starts arguing against itself. The antivirus
 * analogy holds: nobody expects "we cannot detect every threat" stamped across
 * the file manager. The honest version is one detailed disclosure where a
 * purchase decision is actually made, plus one quiet line in the footer.
 *
 *   - `DISCLOSURE_ROWS` on /pricing — the full attack-by-attack table.
 *   - `footer` below — one line, no exclamation marks.
 *
 * The hero deliberately makes its positive claim instead. It sells; it does not
 * talk itself down before the reader has read a single feature.
 */
export const DISCLAIMER = {
  footer: "SafeGPT is a risk-reduction service, not insurance.",
} as const;

/** Landing hero. Sells the mechanism; the caveats live on /pricing. */
export const HERO = {
  title: "Crypto Wallet Protection",
  subtitle: "Detects unauthorized transactions. Rescues your funds.",
  claim: "Automated rescue for wallets under attack.",
  primaryCta: { label: "Get Started", to: "/setup" },
  secondaryCta: { label: "View on GitHub", href: GITHUB_URL },
} as const;

/** Shown under the coverage figures on the variants section. */
export const ESTIMATE_NOTE = "These are estimates, not guarantees.";

/** The three onboarding steps, in beginner language. */
export const STEPS = [
  {
    title: "Connect your cold storage wallet",
    body: "The wallet you rarely use to hold assets. Never a hot wallet, never one you trade from.",
  },
  {
    title: "Set a safe destination address",
    body: "Where your funds go if someone tries to take them. An address only you control.",
  },
  {
    title: "The bot watches the mempool around the clock",
    body: "It reacts to a suspicious transaction before it can confirm, and moves your funds first.",
  },
] as const;

/**
 * The two protection variants.
 *
 * Guardian+ is priced and specified because grant reviewers need to see a
 * business model, but the bot cannot yet execute a rescue through
 * GuardianModule — it logs "not yet implemented" and sends nothing. The CTA is
 * therefore a waitlist, not a purchase, and the card says so in the same block
 * a reader's eye lands on rather than in a footnote.
 */
export const VARIANTS = [
  {
    id: "A",
    name: "Variant A — Approve",
    audience: "For standard wallet addresses",
    mechanics: "Pre-approve the vault, then race the attacker on gas",
    coverage: COVERAGE.variantA,
    price: "From $9/mo",
    available: true,
    cta: { label: "Get Started", to: "/setup" },
    note: null,
  },
  {
    id: "B",
    name: "Variant B — Guardian+",
    audience: "For smart accounts",
    mechanics: "Timelock plus guardian veto instead of a standing approval",
    coverage: COVERAGE.variantB,
    price: "$149/mo",
    available: false,
    cta: { label: "Join Waitlist", to: "/pricing" },
    note: "Contracts reviewed by the ChainGPT Smart Contract Auditor and manually verified (27/27 tests). Bot integration in progress.",
  },
] as const;

/**
 * Pricing tiers. `cells` aligns with FEATURE_ROWS.
 *
 * The hosted service is in its launch window, so no tier is sellable yet: the
 * open-source tier points at the GitHub repo, and the three paid tiers point at
 * the waitlist. The admin can activate a plan on purpose through the backend's
 * admin grant — that is the demo path, not the public purchase path.
 */
export const PRICING_TIERS = [
  { id: "open-source", name: "Open Source", price: "Free", cta: { label: "Self-host", to: "/opensource" }, available: true },
  { id: "basic", name: "Basic", price: "$9/mo", cta: { label: "Join Waitlist", to: "/pricing" }, available: false },
  { id: "pro", name: "Pro", price: "$29/mo", cta: { label: "Join Waitlist", to: "/pricing" }, available: false },
  { id: "guardian", name: "Guardian+", price: "$149/mo", cta: { label: "Join Waitlist", to: "/pricing" }, available: false },
] as const;

export const YEARLY_DISCOUNT = "$90/yr — save 17%";

/** One row per feature, one cell per tier in `PRICING_TIERS` order. */
export const FEATURE_ROWS: ReadonlyArray<{ feature: string; cells: readonly string[] }> = [
  { feature: "Price", cells: ["Free", "$9/mo", "$29/mo", "$149/mo"] },
  { feature: "Wallets", cells: ["Unlimited (self-host)", "1", "3", "10"] },
  { feature: "Extra wallet", cells: ["—", "$5/mo", "$5/mo", "$10/mo"] },
  { feature: "Variant", cells: ["A", "A", "A", "A + B"] },
  { feature: "Watch tokens", cells: ["Unlimited", "10", "30", "100"] },
  { feature: "Rescue fee", cells: ["0%", "5% (cap $10K)", "5% (cap $10K)", "3% (cap $10K)"] },
  { feature: "AI assistant", cells: ["With own key", "Included", "Included", "Included"] },
  { feature: "Contract auditor", cells: ["With own key", "Included", "Included", "Included"] },
  { feature: "Flashbots", cells: ["—", "—", "Included", "Included"] },
  { feature: "Dedicated node", cells: ["—", "—", "Included", "Included"] },
];

/**
 * Attack-by-attack disclosure.
 *
 * The most important block on the site. A reader who sees only the coverage
 * headline will overestimate what they get; a reader who sees this table can
 * decide whether their threat model is covered at all.
 *
 * `state` is one of "yes" | "no" | "partial" | "post-block".
 */
export interface DisclosureRow {
  attack: string;
  states: readonly ("yes" | "no" | "partial" | "post-block")[];
  note?: string;
}

export const DISCLOSURE_ROWS: readonly DisclosureRow[] = [
  {
    attack: "Public mempool attack",
    states: ["yes", "yes", "yes"],
    note: "The bot sees the transaction before it confirms.",
  },
  { attack: "Phishing approval", states: ["yes", "yes", "yes"] },
  {
    attack: "Private mempool (Flashbots)",
    states: ["no", "post-block", "yes"],
    note: "Private mempools hide the transaction from any watcher, so Variant A reacts only after the block lands. Guardian+ cannot be bypassed this way: funds only move on an executed transaction, and the guardian must confirm it first.",
  },
  { attack: "Validator collusion", states: ["no", "no", "post-block"] },
  { attack: "Smart contract exploit", states: ["no", "no", "no"] },
  { attack: "Physical key theft", states: ["no", "no", "yes"] },
];

export const DISCLOSURE_COLUMNS = ["Basic", "Pro", "Guardian+"] as const;

export const STATE_LABELS: Record<DisclosureRow["states"][number], string> = {
  yes: "Yes",
  no: "No",
  partial: "Partial",
  "post-block": "Post-block only",
};

/**
 * The Guardian+ column describes the DESIGNED architecture. The contracts exist
 * and are tested, but the bot cannot yet execute a rescue through
 * GuardianModule, so the integration is in progress. Without this line the
 * table would read as a claim about shipped software rather than a design.
 */
export const GUARDIAN_COLUMN_NOTE =
  "Guardian+ figures describe the designed architecture. The contracts were reviewed by the ChainGPT Smart Contract Auditor and manually verified (27/27 tests), but bot integration is still in progress — the row above is not a live capability yet.";

/**
 * Competitor framing for the About page.
 *
 * Harpie closed on 27 March 2025 after failing to find a sustainable business
 * model — verified against the company's own announcement and trade press. That
 * is stated as a fact about the market, never as a jab.
 */
export const COMPETITORS = [
  {
    name: "Harpie",
    status: "Shut down 27 March 2025 after four years, having failed to find a sustainable business model.",
    contrast: "The market exists. The monetisation was the problem, not the problem itself.",
  },
  {
    name: "Blowfish",
    status: "Sells to institutions, not to individuals.",
    contrast: "There is no self-serve option for someone holding their own wallet.",
  },
  {
    name: "Hardware wallets",
    status: "Protect the private key at rest.",
    contrast:
      "SafeGPT protects the funds after the key is already compromised. The two are complementary, not alternatives.",
  },
] as const;

/**
 * The Curve Finance incident, as it actually happened.
 *
 * The recovery figure is real but its attribution matters. Around 70% of the
 * roughly $73.5M was recovered, but that total came from TWO different
 * mechanisms: MEV bots that intercepted some exploit transactions before the
 * attacker could drain, AND attackers voluntarily returning ~90% of what they
 * kept under Curve's whitehat amnesty and bounty.
 *
 * Claiming the 70% for automated frontrunning alone would misrepresent a real
 * incident. What the case genuinely validates is narrower and still useful:
 * automated mempool intervention is a proven defence, and SafeGPT automates it.
 */
export const CURVE = {
  date: "30 July 2023",
  amount: "$69.3M",
  amountNote: "drained from several Vyper-based pools",
  recovered: "~$52M",
  recoveredPct: "~70%",
  mechanisms: [
    {
      title: "MEV bots intercepted the exploit",
      body:
        "Searchers paid a higher gas price and landed their transactions ahead of the attacker. In the " +
        "JPEG'd pETH-ETH pool roughly $11.4M in WETH went to a bot instead of the attacker. Operators " +
        "such as c0ffeebabe.eth later returned their frontrun profits to the affected protocols.",
      relevance: "This is the mechanism SafeGPT automates: react to a pending transaction before it settles.",
    },
    {
      title: "Attackers returned funds voluntarily",
      body:
        "Curve offered a whitehat amnesty and a $1.85M bounty. Attackers chose to return around 90% of " +
        "what they had kept, which accounted for the majority of the recovered total.",
      relevance: "Not a mechanism any product can rely on. Included here because omitting it would overstate ours.",
    },
  ],
  honestLimit:
    "SafeGPT detects unauthorized transfers, not smart contract vulnerabilities. In the Curve case it " +
    "would have helped during the drain phase, not during the exploit itself.",
} as const;

export const WHY_NOT_HARDWARE = {
  title: "Why not just a hardware wallet?",
  hardware: "A hardware wallet protects your private key.",
  safegpt: "SafeGPT protects your funds at the moment the key is already compromised.",
  conclusion: "These are complementary, not competing solutions.",
} as const;

export const OPEN_SOURCE = {
  title: "Self-hosting SafeGPT",
  promise: "The core protection is MIT licensed. The contracts, the bot and this interface are all public.",
} as const;

export const WAITLIST_COPY = "Guardian+ is in active development. Join the waitlist for early access.";

/**
 * The copy shown under a waitlist CTA on the pricing page. Applies to Basic,
 * Pro and Guardian+ alike: the hosted service has not opened for paying users
 * yet, and nobody should be asked to "get started" into a plan that is not
 * activatable from the public side.
 */
export const HOSTED_WAITLIST_NOTE = "Hosted service launching soon. Join the waitlist for early access.";