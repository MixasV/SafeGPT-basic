import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";

/**
 * HashRouter (not BrowserRouter) so the built SPA works on GitHub Pages
 * without any server-side rewrite rule.
 */
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* The open-source build has no landing page — onboarding is the entry point. */}
          <Route index element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}