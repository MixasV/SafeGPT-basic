import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SafeGPT web is a static SPA. `base: "./"` plus HashRouter (see src/App.tsx)
// keeps it deployable on GitHub Pages without any server-side rewrite rules.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});