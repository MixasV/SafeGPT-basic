import { Wallet } from "ethers";
import { parse } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Creates the bot's executor wallet and stores its private key in the project
 * `.env` as EXECUTOR_KEY.
 *
 * The key never goes into config.yaml — the config references it as
 * ENV:EXECUTOR_KEY, and `.env` is gitignored, so the secret stays on this
 * machine. The address printed here is what the operator pastes into the
 * wizard's Executor step and funds with gas.
 */

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const ENV_PATH = join(PROJECT_ROOT, ".env");

/** Replaces an existing `NAME=` line, or appends one when absent. */
function upsertEnvValue(name: string, value: string): void {
  const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(raw)
    ? raw.replace(pattern, () => line)
    : raw === "" || raw.endsWith("\n")
      ? `${raw}${line}\n`
      : `${raw}\n${line}\n`;
  writeFileSync(ENV_PATH, next);
}

export async function init(): Promise<void> {
  const existing = existsSync(ENV_PATH) ? parse(readFileSync(ENV_PATH, "utf8")) : {};
  const currentKey = existing.EXECUTOR_KEY?.trim();
  if (currentKey) {
    // A funded executor key must never be replaced silently — doing so would
    // orphan the vault's approvals and strand the gas money.
    const address = new Wallet(currentKey).address;
    console.log(`EXECUTOR_KEY is already set in ${ENV_PATH}.`);
    console.log(`Existing executor address: ${address}`);
    console.log("Refusing to overwrite it. To use a different wallet, remove EXECUTOR_KEY from .env and run init again.");
    return;
  }

  const wallet = Wallet.createRandom();
  upsertEnvValue("EXECUTOR_KEY", wallet.privateKey);

  console.log(`Executor wallet created: ${wallet.address}`);
  console.log(`Private key saved to ${ENV_PATH} as EXECUTOR_KEY (gitignored — never commit it).`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Send 0.02-0.05 ETH to ${wallet.address} so the bot can pay for rescue gas.`);
  console.log("  2. Paste that address into the wizard's Executor step.");
  console.log("  3. After deploying, download the config from the wizard and run:");
  console.log("       npm run import-config -- <wizard-export.json> --rpc-wss <wss://...> --rpc-http <https://...>");
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  init().catch((error: unknown) => {
    console.error(`[init] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}