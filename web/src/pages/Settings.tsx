import { PagePlaceholder } from "../components/PagePlaceholder";

/**
 * `/settings` — deferred by design.
 *
 * The configuration items below were originally listed as Sprint 4 and were
 * explicitly moved out of scope: the settings surface was deferred because it
 * needs the backend (Sprint 7) to read a bot configuration rather than guess
 * at one.
 *
 * The protection dashboard built in Sprint 4 is at `/dashboard`.
 */
export function Settings() {
  return (
    <PagePlaceholder
      title="Settings"
      description="Bot configuration and vault management. Deferred: these need the backend to read real bot state."
      sprint="Sprint 7"
      items={[
        "Protected token list with per-token rescue thresholds",
        "Whitelist manager with the vault's 72h pending-change state visible",
        "Safe address change, showing requested and confirmed states",
        "Rule toggles and threshold editor",
        "Executor address rotation",
        "Rescue fee display (fixed at vault deployment, capped at 10%)",
        "Alert channel configuration: webhook and Telegram",
        "Gas strategy: priority fee multiplier and maximum gas price",
        "Export the bot configuration as JSON",
      ]}
    />
  );
}