import { PagePlaceholder } from "../components/PagePlaceholder";

/** `/settings` — vault and bot configuration (Sprint 4). */
export function Settings() {
  return (
    <PagePlaceholder
      title="Settings"
      description="Configuration of the rescue contract and the bot: assets, thresholds, executor, alerts and gas strategy."
      sprint="Sprint 4"
      items={[
        "Protected token list with per-token rescue thresholds",
        "Rescue fee display (fixed at vault deployment, capped at 10%)",
        "Executor address rotation",
        "Telegram and webhook alert configuration",
        "Gas strategy: priority fee multiplier and maximum gas price",
        "Protected wallet is cold storage only — no swaps, no dApp interaction",
      ]}
    />
  );
}