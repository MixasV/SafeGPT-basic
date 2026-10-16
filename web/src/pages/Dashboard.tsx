import { PagePlaceholder } from "../components/PagePlaceholder";

/** `/dashboard` — protection status overview (Sprint 4). */
export function Dashboard() {
  return (
    <PagePlaceholder
      title="Protection dashboard"
      description="Live status of every protected wallet: vault state, protected assets, rescue history and bot health."
      sprint="Sprint 4"
      items={[
        "Beginner — protection status, protected wallet and safe address, asset list with balances",
        "Recent activity: incident and rescue timeline with transaction links",
        "Pro — wallet transaction timeline graph",
        "Whitelist manager with visible 72h pending changes",
        "Safe address change with pending / confirmed state",
        "Rule toggles and thresholds editor, executor address and bot status",
        "Allowance management with revoke actions, gas settings",
        "Export configuration JSON",
      ]}
    />
  );
}