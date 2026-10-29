#!/usr/bin/env node
/**
 * Fail-fast guard for builds that ship a browser bundle to a public host.
 *
 * A `VITE_*` value is inlined into the JavaScript bundle at build time, so a
 * ChainGPT API key that is acceptable for a local self-host would be readable by
 * every visitor of a published build. The hosted deployment uses the proxy
 * (`VITE_CHAINGPT_PROXY_URL`) and keeps the real key on the server; a direct key
 * must never reach a public build.
 *
 * Wired into the public build scripts in package.json:
 *   build:demo  -> node scripts/check-public-build.mjs && vite build --mode demo
 *   build:pages -> node scripts/check-public-build.mjs && vite build --mode demo
 *
 * Exits with code 1 when a ChainGPT API key is configured, so `npm run build:*`
 * fails instead of silently producing a bundle that may contain it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Env files Vite itself would load for the current mode. */
const ENV_FILES = [".env", ".env.local", ".env.demo", ".env.demo.local"];

function readKeyFrom(filePath) {
  if (!existsSync(filePath)) {
    return undefined;
  }
  const text = readFileSync(filePath, "utf8");
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("VITE_CHAINGPT_API_KEY="));
  if (line === undefined) {
    return undefined;
  }
  // `VITE_X=` (empty) is treated as unset, mirroring resolveTransport.
  return line.split("=").slice(1).join("=").trim();
}

const problems = [];
const processKey = (process.env.VITE_CHAINGPT_API_KEY ?? "").trim();
if (processKey !== "") {
  problems.push({ source: "process environment", value: processKey });
}

for (const file of ENV_FILES) {
  const value = readKeyFrom(join(projectRoot, file));
  if (value !== undefined && value !== "") {
    problems.push({ source: file, value });
  }
}

if (problems.length > 0) {
  console.error("ERROR: VITE_CHAINGPT_API_KEY must not be set for a public build.");
  for (const problem of problems) {
    console.error(`  - ${problem.source}: ${problem.value}`);
  }
  console.error("A VITE_* value is inlined into the browser bundle at build time.");
  console.error("Hosted deployments must use VITE_CHAINGPT_PROXY_URL (server-side key) instead.");
  process.exit(1);
}

console.log("check-public-build: VITE_CHAINGPT_API_KEY is not set — public build may proceed.");
