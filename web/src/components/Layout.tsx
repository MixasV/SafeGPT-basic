import { NavLink, Outlet } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { CoreFooter } from "./CoreFooter";
import { DEMO_MODE } from "../config/demo";
import { useOnboardingStore } from "../state/onboarding";

/**
 * Core application shell.
 *
 * Three routes and a wallet button. There is no public navigation here because
 * this build has no public pages: the marketing site, the pricing table and the
 * ChainGPT tools are platform surfaces and live in `safegpt-platform`.
 *
 * The mode switcher is gone for the same reason — Basic / Pro / Guardian are
 * subscription tiers on a hosted service. A self-hosted user runs one
 * configuration; the Pro wizard steps that used to sit behind that switcher are
 * still available from the setup flow.
 */

const APP_NAV = [
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

/** Application shell: header with navigation and wallet access. */
export function Layout() {
  const vaultAddress = useOnboardingStore((state) => state.vaultAddress);
  const showAppNav = DEMO_MODE || vaultAddress !== "";

  return (
    <div className="flex min-h-full flex-col bg-bg-primary">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-secondary">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <NavLink to="/setup" className="text-lg font-semibold text-text-primary">
            🛡 SafeGPT
          </NavLink>

          {showAppNav && (
            <nav className="flex items-center gap-1" aria-label="Application">
              {APP_NAV.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-3">
            <ConnectButton />
          </div>
        </div>

        {DEMO_MODE && (
          <div className="border-t border-accent-yellow/30 bg-accent-yellow/10 px-4 py-2 text-center text-xs text-accent-yellow">
            ⚠ Demo Mode — no real transactions will be broadcast.
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <CoreFooter />
    </div>
  );
}