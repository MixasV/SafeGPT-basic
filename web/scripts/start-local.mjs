#!/usr/bin/env node
/**
 * Local launcher for the self-hosted build.
 *
 *     npm run start:local
 *     (or double-click ../start.bat)
 *
 * Checks the environment, starts Vite, and opens the browser once the server is
 * actually serving. Self-hosting should be one command and a visible page, not a
 * README and three terminals.
 *
 * Plain JavaScript on purpose: this runs before any build step, and a launcher
 * that needs a transpiler to start is a launcher that cannot bootstrap.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The project root, where the single `.env` lives.
 *
 * There is one configuration file for the whole project, not one per
 * sub-directory, so this script has to look a level up. The path is derived
 * from the script's own location, not from the working directory.
 */
const PROJECT_ROOT = resolve(WEB_ROOT, "..");
const PORT = Number.parseInt(process.env.PORT ?? "5173", 10);
const ORIGIN = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 60_000;

/** Reads a .env file into a map, without executing anything in it. */
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};

  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Environment as Vite will see it: process env wins over .env.local over .env. */
function collectEnv() {
  return {
    ...parseEnvFile(join(PROJECT_ROOT, ".env")),
    ...parseEnvFile(join(PROJECT_ROOT, ".env.local")),
    ...process.env,
  };
}

function reportConfiguration(env) {
  const hasAlchemy = (env.VITE_ALCHEMY_API_KEY ?? "").trim() !== "";

  console.log("");
  console.log("  SafeGPT - local build");
  console.log("");

  // No AI section here on purpose. This repository has no AI features: the
  // ChainGPT integration lives in safegpt-platform, so there is no key to
  // configure here and nothing to warn about.
  console.log(
    hasAlchemy
      ? "  Scan       Alchemy, fast"
      : "  Scan       explorer fallback (set VITE_ALCHEMY_API_KEY for a faster scan)",
  );
  console.log("");
}

/** Resolves once the dev server answers with a real page. */
async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // Not up yet. Keep waiting.
    }
    await new Promise((done) => setTimeout(done, 400));
  }
  return false;
}

function openBrowser(url) {
  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };

  try {
    spawn(command.file, command.args, { detached: true, stdio: "ignore" }).unref();
    console.log(`  → ${url}`);
    console.log("");
  } catch {
    console.log(`  Server is running. Open ${url} in your browser.`);
    console.log("");
  }
}

async function main() {
  reportConfiguration(collectEnv());

  // On Windows `npm` is a .cmd shim. Node 22 and later refuse to spawn a .cmd
  // or .bat directly — it raises EINVAL — unless a shell is used. That is a
  // deliberate restriction in Node, not a bug here.
  //
  // `shell: true` is safe in this specific case: every argument below is an
  // internal constant and the port is a number parsed from this file. No user
  // input reaches the command line.
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const vite = spawn(npmCommand, ["run", "dev", "--", "--port", String(PORT), "--strictPort"], {
    cwd: WEB_ROOT,
    stdio: "inherit",
    env: process.env,
    ...(process.platform === "win32" ? { shell: true } : {}),
  });

  const up = await waitForServer(STARTUP_TIMEOUT_MS);
  if (up) {
    openBrowser(ORIGIN);
  } else {
    console.log("  The dev server did not respond in time. Check the output above.");
    console.log("");
  }

  vite.on("exit", (code) => process.exit(code ?? 0));
}

void main();