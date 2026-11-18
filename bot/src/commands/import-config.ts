import { Wallet } from "ethers";
import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";

import { ConfigError, loadConfig } from "../config.js";

/**
 * Turns the wizard's JSON export into a working bot config.yaml.
 *
 * The wizard knows the deployed vault, the protected wallet, the safe address,
 * the executor address and the chosen assets. It does NOT know the operator's
 * RPC endpoints or the executor private key — those live in `.env` (the key is
 * created by `npm run init`). This command bridges the two: it writes a config
 * that references secrets as ENV: / ENV_OPT: and validates it with the same
 * loader the bot uses, so a generated config is guaranteed to start.
 */

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const ENV_PATH = join(PROJECT_ROOT, ".env");
const DEFAULT_CONFIG_PATH = join(PROJECT_ROOT, "bot", "config", "config.yaml");

interface WizardToken {
  address: string;
  symbol: string;
  decimals: number;
  verified?: boolean;
  threshold?: string;
}

interface WizardExport {
  chainId: number;
  vault?: { address?: string };
  vaultAddress?: string;
  protectedWallet: string;
  safeAddress: string;
  executor?: string;
  tokens: WizardToken[];
  whitelist?: string[];
  rules?: { massTransferCount?: number; massTransferWindowMin?: number; balanceDropPct?: number };
  alerts?: { telegramBotToken?: string; telegramChatId?: string; webhookUrl?: string };
}

export interface ImportOptions {
  configPath?: string;
  rpcWss?: string;
  rpcHttp?: string;
}

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

function readWizard(filePath: string): WizardExport {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new ConfigError(`Cannot read wizard export: ${filePath}`);
  }
  let data: WizardExport;
  try {
    data = JSON.parse(raw) as WizardExport;
  } catch (error) {
    throw new ConfigError(`Wizard export is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof data.chainId !== "number") throw new ConfigError("Wizard export is missing a numeric chainId.");
  if (!data.protectedWallet) throw new ConfigError("Wizard export is missing protectedWallet.");
  if (!data.safeAddress) throw new ConfigError("Wizard export is missing safeAddress.");
  const vaultAddress = data.vault?.address ?? data.vaultAddress;
  if (!vaultAddress) throw new ConfigError("Wizard export is missing the vault address.");
  if (!Array.isArray(data.tokens) || data.tokens.length === 0) {
    throw new ConfigError("Wizard export lists no tokens. Select at least one asset in the wizard.");
  }
  return data;
}

export async function importWizardConfig(filePath: string, options: ImportOptions = {}): Promise<void> {
  const wizard = readWizard(filePath);
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const vaultAddress = (wizard.vault?.address ?? wizard.vaultAddress) as string;

  // Load the project .env so ENV: references resolve during validation and so
  // RPC endpoints / the executor key can be read from it.
  loadDotenv({ path: ENV_PATH, override: false, quiet: true });

  const rpcWss = options.rpcWss ?? process.env.RPC_WSS ?? "";
  const rpcHttp = options.rpcHttp ?? process.env.RPC_HTTP ?? "";
  if (!rpcWss.startsWith("ws://") && !rpcWss.startsWith("wss://")) {
    throw new ConfigError(
      "No WebSocket RPC endpoint. Pass --rpc-wss wss://... or set RPC_WSS in .env.",
    );
  }
  if (!rpcHttp.startsWith("http://") && !rpcHttp.startsWith("https://")) {
    throw new ConfigError("No HTTP RPC endpoint. Pass --rpc-http https://... or set RPC_HTTP in .env.");
  }

  const executorKey = process.env.EXECUTOR_KEY?.trim();
  if (!executorKey) {
    throw new ConfigError("EXECUTOR_KEY is not set. Run `npm run init` first to create the executor wallet.");
  }
  // The vault's executor is fixed on-chain at deploy time. If the wizard's
  // executor address does not match the key in .env, the bot could never rescue.
  if (wizard.executor) {
    const derived = new Wallet(executorKey).address;
    if (derived.toLowerCase() !== wizard.executor.toLowerCase()) {
      throw new ConfigError(
        `The wizard's executor ${wizard.executor} does not match EXECUTOR_KEY in .env (${derived}). ` +
          `Use the key whose address was deployed as the vault's executor.`,
      );
    }
  }

  const coreTokens: Array<Record<string, unknown>> = [];
  const watchTokens: Array<Record<string, unknown>> = [];
  for (const token of wizard.tokens) {
    if (typeof token.decimals !== "number" || !Number.isInteger(token.decimals)) {
      throw new ConfigError(`Token ${token.symbol ?? token.address} has no integer decimals in the wizard export.`);
    }
    const entry: Record<string, unknown> = { address: token.address, symbol: token.symbol, decimals: token.decimals };
    if (token.threshold !== undefined && token.threshold !== "") entry.rescueThreshold = token.threshold;
    // Verified assets are core (fee, safeAddress); unverified go to the watch set.
    (token.verified === false ? watchTokens : coreTokens).push(entry);
  }
  if (coreTokens.length === 0) {
    throw new ConfigError("No verified (core) tokens in the export. Mark at least one asset as verified in the wizard.");
  }

  // Alert secrets go to .env, never into config.yaml. The config references them
  // as ENV_OPT: so the bot still starts when a channel is left unset.
  const alerts = wizard.alerts ?? {};
  if (alerts.telegramBotToken) {
    upsertEnvValue("TELEGRAM_BOT_TOKEN", alerts.telegramBotToken);
    process.env.TELEGRAM_BOT_TOKEN = alerts.telegramBotToken;
  }
  if (alerts.telegramChatId) {
    upsertEnvValue("TELEGRAM_CHAT_ID", alerts.telegramChatId);
    process.env.TELEGRAM_CHAT_ID = alerts.telegramChatId;
  }
  if (alerts.webhookUrl) {
    upsertEnvValue("WEBHOOK_URL", alerts.webhookUrl);
    process.env.WEBHOOK_URL = alerts.webhookUrl;
  }

  const rules = wizard.rules ?? {};
  const config = {
    rpcWss,
    rpcHttp,
    chainId: wizard.chainId,
    // Private bundles are a future feature; rescue goes through the public mempool.
    flashbotsRelay: "",
    wallets: [
      {
        label: "Main wallet",
        protectedWallet: wizard.protectedWallet,
        safeAddress: wizard.safeAddress,
        vaultAddress,
        executorPrivateKey: "ENV:EXECUTOR_KEY",
        coreTokens,
        watchTokens,
        whitelist: wizard.whitelist ?? [],
        thresholds: {
          massTransferCount: rules.massTransferCount ?? 3,
          massTransferWindowMin: rules.massTransferWindowMin ?? 5,
          balanceDropPct: rules.balanceDropPct ?? 10,
        },
      },
    ],
    alerts: {
      telegramBotToken: "ENV_OPT:TELEGRAM_BOT_TOKEN",
      telegramChatId: "ENV_OPT:TELEGRAM_CHAT_ID",
      webhookUrl: "ENV_OPT:WEBHOOK_URL",
      minExecutorEth: 0.1,
    },
  };

  const header =
    "# Generated by `npm run import-config` from the wizard export.\n" +
    "# Secrets live in .env (ENV: / ENV_OPT: references below). Edit RPC endpoints there or re-run with flags.\n";
  writeFileSync(configPath, header + stringify(config), "utf8");

  // Validate with the bot's own loader so a generated config is guaranteed to
  // start. Throws ConfigError on anything the bot would reject.
  const validated = loadConfig(configPath);

  console.log(`Config written to ${configPath}`);
  console.log(`  Chain ${validated.chainId}, vault ${vaultAddress}`);
  console.log(`  ${coreTokens.length} core token(s), ${watchTokens.length} watch token(s)`);
  console.log(`  Executor ${new Wallet(executorKey).address}`);
  console.log("");
  console.log("Start the bot:");
  console.log(`  npm run bot -- --config ${configPath} --dry-run   # plan only, nothing broadcast`);
  console.log(`  npm run bot -- --config ${configPath}             # live`);
}

interface CliOptions {
  filePath: string;
  configPath?: string;
  rpcWss?: string;
  rpcHttp?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let filePath: string | undefined;
  const options: CliOptions = { filePath: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config" || arg === "--rpc-wss" || arg === "--rpc-http") {
      const next = argv[i + 1];
      if (next === undefined) throw new ConfigError(`${arg} needs a value.`);
      if (arg === "--config") options.configPath = next;
      else if (arg === "--rpc-wss") options.rpcWss = next;
      else options.rpcHttp = next;
      i += 1;
    } else if (arg?.startsWith("--")) {
      throw new ConfigError(`Unknown argument "${arg}".`);
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      throw new ConfigError(`Unexpected argument "${arg}".`);
    }
  }
  if (filePath === undefined) {
    throw new ConfigError("Usage: npm run import-config -- <wizard-export.json> [--config <path>] [--rpc-wss <url>] [--rpc-http <url>]");
  }
  options.filePath = filePath;
  return options;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const cli = parseArgs(process.argv.slice(2));
    const options: ImportOptions = {};
    if (cli.configPath !== undefined) options.configPath = cli.configPath;
    if (cli.rpcWss !== undefined) options.rpcWss = cli.rpcWss;
    if (cli.rpcHttp !== undefined) options.rpcHttp = cli.rpcHttp;
    importWizardConfig(cli.filePath, options).catch((error: unknown) => {
      console.error(`[import-config] ${(error as Error).message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`[import-config] ${(error as Error).message}`);
    process.exitCode = 1;
  }
}