import { Link } from "react-router-dom";

import { PRODUCT, DISCLAIMER } from "../config/content";

/**
 * Core footer.
 *
 * No ChainGPT attribution, and that is not an oversight. The ChainGPT logo and
 * the "Powered by ChainGPT AI" line are required on every page of
 * `safegpt-platform`, which is where the integration actually lives. This
 * repository does not call ChainGPT: its AI features were removed rather than
 * stubbed, so there is nothing here to attribute and nothing here that depends
 * on anyone else's service.
 *
 * Keeping the risk disclaimer is a separate matter — it describes what this
 * build does and does not protect against, so it stays.
 */
export function CoreFooter() {
  return (
    <footer className="border-t border-border bg-bg-secondary">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link className="text-text-secondary hover:text-text-primary" to="/setup">
            Setup
          </Link>
          <Link className="text-text-secondary hover:text-text-primary" to="/dashboard">
            Dashboard
          </Link>
          <Link className="text-text-secondary hover:text-text-primary" to="/settings">
            Settings
          </Link>
          <a
            className="text-text-secondary hover:text-text-primary"
            href="https://github.com/safegpt/safegpt-core"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source ↗
          </a>
          <a
            className="text-text-secondary hover:text-text-primary"
            href="https://github.com/safegpt/safegpt-platform"
            target="_blank"
            rel="noreferrer noopener"
          >
            Hosted platform ↗
          </a>
        </nav>

        <p className="mt-6 border-t border-border pt-4 text-xs text-text-secondary" data-testid="footer-disclaimer">
          {DISCLAIMER.footer}
        </p>

        <p className="mt-2 text-xs text-text-secondary">
          {PRODUCT} is a security tool. It does not execute trades, provide financial advice, or manage
          investment portfolios.
        </p>
      </div>
    </footer>
  );
}