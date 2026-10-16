import { PagePlaceholder } from "../components/PagePlaceholder";

/** `/setup` — six-step onboarding wizard (Sprint 2). */
export function Setup() {
  return (
    <PagePlaceholder
      title="Wallet setup"
      description="Guided onboarding that connects a cold-storage wallet, runs the drainer check and approves your assets for protection."
      sprint="Sprint 2"
      items={[
        "Step 1 — Connect wallet (cold-storage warning)",
        "Step 2 — Drainer check (send ~$1 ETH, verify it stays)",
        "Step 3 — Set safe address (different seed, different device)",
        "Step 4 — Select assets (ERC-20 balance scan, native ETH cannot be protected)",
        "Step 5 — Approve protection (sequential approvals to the vault)",
        "Step 6 — Protection active",
        "Pro mode extras — whitelist editor, rule thresholds, alert configuration",
      ]}
    />
  );
}