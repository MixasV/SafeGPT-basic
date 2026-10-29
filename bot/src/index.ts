import { config as loadDotenv } from "dotenv";
import { JsonRpcProvider, Signer, Wallet, WebSocketProvider } from "ethers";
import { join } from "node:path";

import { CompositeAlerter, ConsoleAlerter, WebhookAlerter, type AlertSink } from "./alerts.js";
import { ConfigError, loadConfig, validateAgainstChain } from "./config.js";
import { Executor, type ExecutorSigner, type RescueOutcome } from "./executor.js";
import { Monitor, ReconnectExhaustedError, type MonitorProvider, type Rescuer } from "./monitor.js";
import { Scanner } from "./scanner.js";
import { TELEGRAM_SETUP_HINT, TelegramAlerter } from "./telegram.js";
import type { BotConfig, RescueReason, WalletConfig } from "./types.js";

/**
 * Loads the environment file.
 *
 * ONE FILE PER PROJECT
 * --------------------
 * The `.env` belongs to THIS PROJECT and travels with it. A user who copies
 * `safegpt-core` onto their own machine must get a working bot with the same
 * two steps — copy the folder, put the keys in `.env` — and nothing may
 * depend on a file outside the project, or on the directory the process
 * happens to be started from.
 *
 * So there is exactly one file: `<project>/.env`, next to the README. The
 * bot, the web interface and the contracts tooling all share it. Searching
 * through sub-directories to find where a key goes is the wrong interface.
 *
 * The path is derived from this module's own location, so it does not depend
 * on the working directory.
 */
function loadEnvironment(): void {
  const projectRoot = join(import.meta.dirname, "..", "..");
  loadDotenv({ path: join(projectRoot, ".env"), override: false, quiet: true });
}

/**
 * Entry point.
 *
 *   npm run bot -- --config config/config.yaml --dry-run
 *
 * The startup order matters and is deliberate:
 *   1. load and validate the config      — no network, fails fast on typos
 *   2. connect over HTTP and verify chain — the WSS feed is worthless if the
 *                                          node is the wrong network
 *   3. connect over WSS and watch
 *
 * Failing before step 3 matters: a bot that spends an hour "monitoring" the
 * wrong chain is indistinguishable from a working one until it fails to save
 * anything.
 */

interface CliOptions {
  configPath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let configPath = "config/config.yaml";
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--config" || arg === "-c") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new ConfigError("--config needs a path to a YAML config file.");
      }
      configPath = next;
      i += 1;
    } else if (arg?.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new ConfigError(`Unknown argument "${arg}". Try --help.`);
    }
  }

  return { configPath, dryRun };
}

function printHelp(): void {
  console.log(`SafeGPT rescue bot

Usage:
  npm run bot -- --config <path> [--dry-run]

Options:
  -c, --config <path>  Path to the YAML config (default: config/config.yaml)
      --dry-run        Plan rescues and log them without broadcasting anything
  -h, --help           Show this message

Environment:
  Any config value written as ENV:NAME is replaced with the NAME environment
  variable. This is how private keys are supplied — never put one in the file.
`);
}

/** Bridges an ethers provider to the narrow interfaces the bot depends on. */
function asMonitorProvider(provider: WebSocketProvider): MonitorProvider {
  return {
    send: (method, params) => provider.send(method, params),
    // ethers dispatches by event name; the cast keeps our narrower listener
    // types from leaking into ethers' generic ones.
    on: (event, listener) => provider.on(event, listener as never),
    getTransaction: (hash) => provider.getTransaction(hash) as never,
    destroy: () => provider.destroy(),
  } as MonitorProvider;
}

/**
 * Bridges an ethers signer to the executor's narrow signer.
 *
 * Fee data and gas estimation come from the provider rather than the signer:
 * ethers v6 puts `getFeeData` on the provider, and a non-null signer would
 * silently drop EIP-1559 fields if we asked it directly.
 */
function asExecutorSigner(signer: Signer, provider: JsonRpcProvider, address: string): ExecutorSigner {
  return {
    getAddress: async () => address,
    getBalance: (who) => provider.getBalance(who),
    getFeeData: () => provider.getFeeData(),
    estimateGas: (tx) => provider.estimateGas(tx),
    sendTransaction: async (tx) => {
      const sent = await signer.sendTransaction(tx);
      return { hash: sent.hash };
    },
  };
}

/**
 * Builds the signer for a wallet. Variant A needs the executor key because the
 * vault only accepts `rescue()` from the authorised executor; Variant B's
 * guardian key is loaded but unused in this release.
 */
async function signerFor(wallet: WalletConfig, provider: JsonRpcProvider): Promise<ExecutorSigner> {
  const key = wallet.variant === "A" ? wallet.executorPrivateKey : wallet.guardianPrivateKey;
  if (key === undefined) {
    throw new ConfigError(`Wallet "${wallet.label}" has no signing key for variant ${wallet.variant}.`);
  }
  // `new Wallet`, not `provider.getSigner(...)`. In ethers v6 `getSigner` takes
  // the address of an account the NODE holds, and passes the value straight to
  // `getAddress()` — handing it a private key fails with "invalid address".
  // A `Wallet` is the local signer that actually owns the key.
  const signer = new Wallet(key, provider);
  return asExecutorSigner(signer, provider, await signer.getAddress());
}

function buildAlerter(alerts: BotConfig["alerts"], log: (message: string) => void): AlertSink {
  const sinks: AlertSink[] = [];

  // Telegram first: it is the channel that reaches the operator at 3am.
  const telegram = new TelegramAlerter({ botToken: alerts.telegramBotToken, chatId: alerts.telegramChatId });
  if (telegram.isConfigured()) {
    sinks.push({ deliver: async (alert) => void (await telegram.send(alert)) });
    log("Alerts: Telegram enabled.");
  } else {
    log(`Alerts: Telegram disabled. ${TELEGRAM_SETUP_HINT}`);
  }

  if (alerts.webhookUrl !== "") {
    sinks.push(new WebhookAlerter(alerts.webhookUrl));
    log("Alerts: webhook enabled.");
  }

  // The console is always last and always present: it is the durable record
  // when every network channel is down.
  sinks.push(new ConsoleAlerter());
  return new CompositeAlerter(sinks, (error) => {
    console.error(`[bot] alert delivery failed: ${(error as Error).message}`);
  });
}

async function main(): Promise<void> {
  loadEnvironment();
  const options = parseArgs(process.argv.slice(2));

  // 1. Config — parse, checksum, and shape-check without touching the network.
  const config = loadConfig(options.configPath);
  const log = (message: string): void => console.log(`[bot] ${message}`);

  log(`Loaded ${config.wallets.length} wallet(s) for chain ${config.chainId}.`);
  if (options.dryRun) {
    log("DRY RUN — rescues will be planned and logged, never broadcast.");
  }

  // The alert channels are reported before the first network call. An operator
  // who just added a Telegram token wants to know straight away whether it was
  // picked up — and the chain check below can fail first, in which case they
  // would never see the answer and would conclude the key is wrong.
  const alerter = buildAlerter(config.alerts, log);

  // 2. Verify the node before trusting anything it says.
  const http = new JsonRpcProvider(config.rpcHttp, undefined, { staticNetwork: true });
  try {
    const warnings = await validateAgainstChain(config, http);
    for (const warning of warnings) log(`warning: ${warning}`);
  } catch (error) {
    // Destroy the provider before bailing out. An ethers provider that cannot
    // reach the node keeps a "detect network" retry timer alive, and that timer
    // holds the event loop open: the process would sit there forever instead of
    // exiting with the error the operator needs to see.
    http.destroy();
    if (error instanceof ConfigError) {
      console.error(`[bot] configuration does not match the chain: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const ws = new WebSocketProvider(config.rpcWss, undefined, { staticNetwork: true });
  // The scanner holds its baseline across blocks, so it must outlive any single
  // connection. It reads through a factory rather than a captured provider so
  // that a reconnect does not leave it pointing at a destroyed socket.
  const executorByWallet = new Map<string, Executor>();
  const scanner = new Scanner(() => ws);

  const minExecutorEth = BigInt(Math.round(config.alerts.minExecutorEth * 1e18));

  const executors = await Promise.all(
    config.wallets.map(async (wallet) => {
      const executor = new Executor(await signerFor(wallet, http), http, {
        dryRun: options.dryRun,
        minExecutorEth,
        log,
      });
      executorByWallet.set(wallet.label, executor);
      return { wallet, executor };
    }),
  );

  if (options.dryRun) {
    // Confirm the signer really is the vault's executor before going live, so a
    // dry run catches the mistake that would otherwise waste a real rescue.
    for (const { wallet, executor } of executors) {
      const outcome = await executor.rescue(wallet, {
        rule: "NONE",
        reason: "startup pre-flight",
        severity: "MEDIUM",
      });
      log(`pre-flight for "${wallet.label}": ${outcome.status}`);
    }
  }

  const monitor = new Monitor({
    createProvider: () => asMonitorProvider(new WebSocketProvider(config.rpcWss, undefined, { staticNetwork: true })),
    wallets: config.wallets,
    // Every wallet is protected by its own vault, so a shared executor must know
    // which vault it is acting for. Wrap the map in a dispatcher.
    executor: new DispatchingExecutor(executorByWallet),
    scanner,
    alerter,
    log,
  });

  const controller = new AbortController();
  const shutdown = (signal: string): void => {
    log(`${signal} received — shutting down.`);
    controller.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await monitor.run(controller.signal);
  } catch (error) {
    if (error instanceof ReconnectExhaustedError) {
      console.error(`[bot] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  http.destroy();
  ws.destroy();
  log("Stopped.");
}

/**
 * Routes a rescue to the executor that owns that wallet's vault. The monitor
 * holds a single rescuer, but each wallet has its own vault and therefore its
 * own authorised signer, so the dispatch happens here.
 */
class DispatchingExecutor implements Rescuer {
  private readonly fallback: Executor;

  constructor(private readonly byWallet: Map<string, Executor>) {
    const first = byWallet.values().next();
    if (first.done === true) throw new ConfigError("No wallets configured.");
    this.fallback = first.value;
  }

  async rescue(wallet: WalletConfig, reason: RescueReason, tokens?: string[]): Promise<RescueOutcome> {
    return (this.byWallet.get(wallet.label) ?? this.fallback).rescue(wallet, reason, tokens);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`[bot] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error(`[bot] unexpected failure: ${(error as Error).stack ?? String(error)}`);
  process.exitCode = 1;
  // A fatal startup error must end the process, not leave it hanging on the
  // provider's retry timers. `process.exit` rather than `exitCode` alone,
  // because a live timer would keep the process alive with the error already
  // printed — which looks like a hung bot rather than a failed one.
  setTimeout(() => {
    process.exit(1);
  }, 100);
});