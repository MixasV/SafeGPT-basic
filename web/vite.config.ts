import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * The .env belongs to the project, not to this sub-directory.
 *
 * There is exactly one file — `<project>/.env`, next to the README — and the
 * bot, the contracts tooling and this interface all share it. `envDir` points
 * the loader at it, so a key is configured in one place rather than in a file
 * per sub-directory.
 *
 * Only the VITE_ prefixed values reach the browser bundle. Everything else in
 * that file stays on the machine.
 */
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

// SafeGPT web is a static SPA. `base: "./"` plus HashRouter (see src/App.tsx)
// keeps it deployable on GitHub Pages without any server-side rewrite rules.
export default defineConfig({
  base: "./",
  envDir: PROJECT_ROOT,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});