import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";

/**
 * Core entry point.
 *
 * Three routes, on purpose. This repository is the open-source rescue core: it
 * is the part you run yourself, and it does what the paid platform does not
 * need to do — show you how it is protected.
 *
 * There is no landing page, no pricing table, no ChainGPT assistant and no
 * auditor here. Those are platform surfaces; they live in `safegpt-platform`,
 * which is proprietary and hosted. See docs/ARCHITECTURE.md for why the split
 * exists and what may not cross it.
 *
 * HashRouter (not BrowserRouter) so the built SPA works when opened from the
 * filesystem or served from any static path with no rewrite rule.
 */
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/setup" element={<Setup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}