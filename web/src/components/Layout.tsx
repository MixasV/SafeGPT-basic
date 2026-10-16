import { NavLink, Outlet } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { ModeSwitcher } from "./mode-switcher/ModeSwitcher";
import { DEMO_MODE } from "../config/demo";

const NAV_ITEMS = [
  { to: "/setup", label: "Setup" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/settings", label: "Settings" },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? "bg-bg-tertiary text-text-primary"
      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
  }`;
}

/** Application shell: header with navigation, mode switcher and wallet access. */
export function Layout() {
  return (
    <div className="flex min-h-full flex-col bg-bg-primary">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-secondary">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <NavLink to="/setup" className="text-lg font-semibold text-text-primary">
            🛡️ SafeGPT
          </NavLink>

          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ModeSwitcher />
            <ConnectButton />
          </div>
        </div>

        {DEMO_MODE && (
          <div className="border-t border-accent-yellow/30 bg-accent-yellow/10 px-4 py-2 text-center text-xs text-accent-yellow">
            🔬 Demo Mode — no real transactions will be broadcast
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-bg-secondary">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-text-secondary">
          <span>SafeGPT core — MIT licensed, self-hostable.</span>
          <span>Protected wallets are cold storage only.</span>
        </div>
      </footer>
    </div>
  );
}