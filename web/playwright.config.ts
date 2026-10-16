import { defineConfig } from "@playwright/test";

/**
 * E2E configuration.
 *
 * The specs run against a Demo Mode build (`.env.demo`), because that is the
 * flow that must work without a wallet, without gas and without broadcasting
 * anything — the same build used for the grant demo recording.
 *
 * Browsers: uses the locally installed Google Chrome (`channel: "chrome"`), so
 * no Playwright browser download is required.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "off",
  },
  webServer: {
    command: "npm run build -- --mode demo && npm run preview -- --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});