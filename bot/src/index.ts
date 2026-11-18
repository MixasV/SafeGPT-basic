import { config as loadDotenv } from "dotenv";
import { JsonRpcProvider, Signer, Wallet, WebSocketProvider } from "ethers";
import { join } from "node:path";

import {
  BackendAlerter,
  CompositeAlerter,
  ConsoleAlerter,
  TelegramAlerter,
  WebhookAlerter,
  buildAlert,
  type AlertSink,
} from "./alerts.js";
import { AlchemyMonitorProvider } from "./alchemy-pending.js";
import { ConfigError, loadConfig, validateAgainstChain } from "./config.js";
import { Executor, type ExecutorSigner } from "./executor.js";
import { Monitor, ReconnectExhaustedError, type MonitorProvider, type RawTransaction, type Rescuer } from "./monitor.js";
import { Scanner } from "./scanner.js";
import type { BotConfig, WalletConfig } from "./types.js";

/**
 * Entry point for the SafeGPT self-hosted rescue bot.
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
  Set ALCHEMY_API_KEY to enable Alchemy's filtered pending-transaction feed
  (requires a paid plan); without it the bot uses the standard pending feed.
  Set PLATFORM_API_URL (+ BOT_API_KEY, WEBHOOK_SECRET) to also forward alerts
  to a SafeGPT platform backend.
`);
}

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
 * The path is derived from this module's own location, so it does not depend
 * on the working directory.
 */
function loadEnvironment(): void {
  const projectRoot = join(import.meta.dirname, "..", "..");
  loadDotenv({ path: join(projectRoot, ".env"), override: false, quiet: true });
}

/** Alchemy network slugs, keyed by chain id. Used to build a WSS URL from ALCHEMY_API_KEY. */
const ALCHEMY_WSS_SLUGS: Record<number, string> = {
  1: "eth-mainnet",
  11155111: "eth-sepolia",
  137: "polygon-mainnet",
  80002: "polygon-amoy",
  8453: "base-mainnet",
  84532: "base-sepolia",
  42161: "arb-mainnet",
  421614: "arb-sepolia",
  10: "opt-mainnet",
  11155420: "opt-sepolia",
  43114: "avax-mainnet",
  43113: "avax-fuji",
};

/** Builds the Alchemy WSS endpoint for a chain, or undefined when the chain is unknown. */
function alchemyWssUrl(chainId: number, apiKey: string): string | undefined {
  const slug = ALCHEMY_WSS_SLUGS[chainId];
  if (slug === undefined) return undefined;
  return `wss://${slug}.g.alchemy.com/v2/${apiKey}`;
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
 * Builds the signer for a wallet.
 *
 * RescueVault mode (variant A) needs the executor key because the vault only
 * accepts `rescue()` from the authorised executor. Variant B (GuardianModule)
 * is a hosted-platform feature: the executor short-circuits it to
 * VARIANT_B_UNSUPPORTED before any signer call, so a stub is returned that
 * throws loudly if anything ever does try to use it.
 */
async function signerFor(wallet: WalletConfig, provider: JsonRpcProvider): Promise<ExecutorSigner> {
  const key = wallet.executorPrivateKey;
  if (key === undefined) {
    throw new ConfigError(`Wallet "${wallet.label}" has no executor private key configured.`);
  }
  // `new Wallet`, not `provider.getSigner(...)`. In ethers v6 `getSigner` takes
  // the address of an account the NODE holds, and passes the value straight to
  // `getAddress()` — handing it a private key fails with "invalid address".
  // A `Wallet` is the local signer that actually owns the key.
  const signer = new Wallet(key, provider);
  return asExecutorSigner(signer, provider, await signer.getAddress());
}

/**
 * Builds the alert fan-out.
 *
 * The console is always present and always last — it is the durable record when
 * every network channel is down. Telegram, webhook and (optionally) the platform
 * backend are layered on top when configured. A missing or failing channel must
 * never stop the console, so the composite swallows per-sink errors.
 */
function buildAlerter(config: BotConfig, log: (message: string) => void): AlertSink {
  const sinks: AlertSink[] = [];

  const telegramToken = config.alerts.telegramBotToken;
  const telegramChatId = config.alerts.telegramChatId;
  if (telegramToken !== "" && telegramChatId !== "") {
    sinks.push(
      new TelegramAlerter({
        token: telegramToken,
        getChatId: () => telegramChatId,
        onError: (message) => log(`[telegram] ${message}`),
      }),
    );
    log("Alerts: Telegram enabled.");
  }

  if (config.alerts.webhookUrl !== "") {
    sinks.push(new WebhookAlerter(config.alerts.webhookUrl, 5_000, (message) => log(message)));
    log("Alerts: webhook enabled.");
  }

  // Opt-in platform backend: only when the operator points the bot at a
  // SafeGPT platform. Keys come from the environment, never from config.yaml.
  const platformUrl = process.env.PLATFORM_API_URL ?? "";
  const platformKey = process.env.BOT_API_KEY ?? "";
  const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
  if (platformUrl !== "" && platformKey !== "" && webhookSecret !== "") {
    sinks.push(
      new BackendAlerter({
        baseUrl: platformUrl,
        apiKey: platformKey,
        secret: webhookSecret,
        onError: (message) => log(`[backend] ${message}`),
      }),
    );
    log(`Alerts: platform backend enabled (${platformUrl}).`);
  }

  sinks.push(new ConsoleAlerter());
  return new CompositeAlerter(sinks, (message) => {
    console.error(`[bot] ${message}`);
  });
}

/**
 * A WebSocket monitor provider that turns a hash-only pending feed into full
 * transactions.
 *
 * WHY THIS EXISTS
 * ---------------
 * The monitor now expects the provider to push a full transaction object (the
 * shape Alchemy's `alchemy_pendingTransactions` with `hashesOnly: false`
 * produces). A plain ethers `WebSocketProvider` only pushes pending-tx hashes,
 * so this adapter subscribes to `newPendingTransactions`, fetches each hash
 * with `eth_getTransactionByHash`, and re-emits it as a `RawTransaction`. It is
 * the standard-feed fallback used when no Alchemy key is configured.
 */
class WsPendingProvider implements MonitorProvider {
  private readonly ws: WebSocketProvider;
  private pending: ((tx: RawTransaction) => void) | null = null;
  private block: ((blockNumber: bigint) => void) | null = null;
  private error: ((error: unknown) => void) | null = null;
  private readonly seen = new Set<string>();

  constructor(
    wsUrl: string,
    private readonly reader: { send(method: string, params: unknown[]): Promise<unknown> },
  ) {
    this.ws = new WebSocketProvider(wsUrl, undefined, { staticNetwork: true });
    void this.ws.on("pending", (hash: unknown) => {
      void this.onPending(String(hash));
    });
    void this.ws.on("block", (blockNumber: unknown) => {
      this.block?.(BigInt(blockNumber as number));
    });
    void this.ws.on("error", (error: unknown) => {
      this.error?.(error);
    });
  }

  private async onPending(hash: string): Promise<void> {
    // A hash can be re-announced before it is mined; dedupe to avoid refetching.
    if (this.seen.has(hash)) return;
    this.seen.add(hash);
    if (this.seen.size > 10_000) {
      // Bound the cache so a long-running bot on a busy chain does not grow it
      // without limit. The oldest entries are the ones most likely already mined.
      const first = this.seen.values().next();
      if (!first.done) this.seen.delete(first.value);
    }
    try {
      const raw = (await this.reader.send("eth_getTransactionByHash", [hash])) as Record<string, unknown> | null;
      if (raw !== null && raw !== undefined) this.pending?.(parseRawTransaction(raw));
    } catch {
      // A transaction disappearing between notification and fetch is routine.
    }
  }

  on(event: "pending", listener: (tx: RawTransaction) => void): this;
  on(event: "block", listener: (blockNumber: bigint) => void): this;
  on(event: "error", listener: (error: unknown) => void): this;
  on(
    event: "pending" | "block" | "error",
    listener: ((tx: RawTransaction) => void) | ((blockNumber: bigint) => void) | ((error: unknown) => void),
  ): this {
    if (event === "pending") this.pending = listener as (tx: RawTransaction) => void;
    else if (event === "block") this.block = listener as (blockNumber: bigint) => void;
    else this.error = listener as (error: unknown) => void;
    return this;
  }

  async send(method: string, params: unknown[]): Promise<unknown> {
    return this.reader.send(method, params);
  }

  async getTransaction(hash: string): Promise<RawTransaction | null> {
    const raw = (await this.reader.send("eth_getTransactionByHash", [hash])) as Record<string, unknown> | null;
    if (raw === null) return null;
    return parseRawTransaction(raw);
  }

  destroy(): void {
    this.ws.destroy();
    this.pending = null;
    this.block = null;
    this.error = null;
  }
}

/** Converts a raw JSON-RPC transaction object into the bot's `RawTransaction`. */
function parseRawTransaction(raw: Record<string, unknown>): RawTransaction {
  return {
    hash: raw.hash as string,
    from: raw.from as string,
    to: raw.to == null ? null : (raw.to as string),
    data: (raw.input ?? raw.data ?? "0x") as string,
    value: BigInt((raw.value as string) ?? "0x0"),
    type: raw.type !== undefined ? Number.parseInt(raw.type as string, 16) : null,
    blockNumber: null,
    maxFeePerGas: raw.maxFeePerGas !== undefined ? BigInt(raw.maxFeePerGas as string) : null,
    maxPriorityFeePerGas:
      raw.maxPriorityFeePerGas !== undefined ? BigInt(raw.maxPriorityFeePerGas as string) : null,
    gasPrice: raw.gasPrice !== undefined ? BigInt(raw.gasPrice as string) : null,
  };
}

/** Builds the per-attempt provider factory for one wallet. */
function createProviderFactory(
  config: BotConfig,
  reader: JsonRpcProvider,
  protectedWallet: string,
  alchemyKey: string,
): () => MonitorProvider {
  const alchemyUrl = alchemyKey !== "" ? alchemyWssUrl(config.chainId, alchemyKey) : undefined;
  if (alchemyUrl !== undefined) {
    return () =>
      new AlchemyMonitorProvider(alchemyUrl, reader, protectedWallet) as unknown as MonitorProvider;
  }
  return () => new WsPendingProvider(config.rpcWss, reader);
}

async function main(): Promise<void> {
  loadEnvironment();
  const options = parseArgs(process.argv.slice(2));

  // 1. Config — parse, checksum, and shape-check without touching the network.
  const config = loadConfig(options.configPath);
  const log = (message: string): void => console.log(`[bot] ${message}`);

  log(`Loaded ${config.wallets.length} wallet(s) for chain ${config.chainId}.`);
  if (config.flashbotsRelay !== "") {
    log("flashbotsRelay is set — rescues will try the private relay first, then fall back to the public mempool.");
  }
  if (options.dryRun) {
    log("DRY RUN — rescues will be planned and logged, never broadcast.");
  }

  const alchemyKey = (process.env.ALCHEMY_API_KEY ?? "").trim();
  if (alchemyKey !== "") {
    const url = alchemyWssUrl(config.chainId, alchemyKey);
    log(url === undefined
      ? `ALCHEMY_API_KEY is set but chain ${config.chainId} has no Alchemy slug — using the standard pending feed.`
      : "Alchemy pending-transaction feed enabled (filtered by protected wallet).");
  } else {
    log("ALCHEMY_API_KEY not set — using the standard pending feed (hash + eth_getTransactionByHash).");
  }

  // The alert channels are reported before the first network call. An operator
  // who just added a Telegram token wants to know straight away whether it was
  // picked up — and the chain check below can fail first.
  const alerter = buildAlerter(config, log);

  // 2. Verify the node before trusting anything it says.
  const http = new JsonRpcProvider(config.rpcHttp, undefined, { staticNetwork: true });
  try {
    const warnings = await validateAgainstChain(config, http);
    for (const warning of warnings) log(`warning: ${warning}`);
  } catch (error) {
    // Destroy the provider before bailing out. An ethers provider that cannot
    // reach the node keeps a "detect network" retry timer alive, and that timer
    // holds the event loop open: the process would sit there forever.
    http.destroy();
    if (error instanceof ConfigError) {
      console.error(`[bot] configuration does not match the chain: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // The scanner holds its baseline across blocks, so it must outlive any single
  // connection. It reads through a factory rather than a captured provider.
  const scanner = new Scanner(() => http);
  const minExecutorEth = BigInt(Math.round(config.alerts.minExecutorEth * 1e18));

  const controller = new AbortController();
  const shutdown = (signal: string): void => {
    log(`${signal} received — shutting down.`);
    controller.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // One monitor per wallet. Each wallet has its own vault and therefore its own
  // authorised signer, so the dispatch is per-wallet. With Alchemy the pending
  // feed is filtered by the protected wallet; without it each connection sees
  // the standard hash feed and resolves transactions itself.
  const monitors: Monitor[] = [];
  const executors: Executor[] = [];
  const executorAddresses: string[] = [];

  for (const wallet of config.wallets) {
    const signer = await signerFor(wallet, http);
    const address = await signer.getAddress().catch(() => "");
    if (address !== "") executorAddresses.push(address);

    const executor = new Executor(signer, http, {
      dryRun: options.dryRun,
      minExecutorEth,
      maxGasPriceGwei: 0n,
      ...(config.flashbotsRelay !== "" ? { flashbotsRelay: config.flashbotsRelay } : {}),
      log,
      // Stranded tokens and on-chain rescue failures must reach the operator's
      // alert channels, not just the console.
      alert: (alert) => alerter.deliver(alert),
    });
    executors.push(executor);

    if (options.dryRun) {
      // Confirm the signer really is the vault's executor before going live, so
      // a dry run catches the mistake that would otherwise waste a real rescue.
      const outcome = await executor.rescue(wallet, {
        rule: "NONE",
        reason: "startup pre-flight",
        severity: "MEDIUM",
      });
      log(`pre-flight for "${wallet.label}": ${outcome.status}`);
    }

    const rescuer: Rescuer = {
      rescue: (w, reason, tokens) => executor.rescue(w, reason, tokens),
    };

    const monitor = new Monitor({
      createProvider: createProviderFactory(config, http, wallet.protectedWallet, alchemyKey),
      wallets: [wallet],
      executor: rescuer,
      scanner,
      alerter,
      log,
    });
    monitors.push(monitor);
  }

  // Executor balance check: a rescue that cannot pay for gas is worse than none.
  const balanceCheck = setInterval(async () => {
    for (let i = 0; i < executorAddresses.length; i++) {
      try {
        const addr = executorAddresses[i] as string;
        const bal = await http.getBalance(addr);
        if (bal < minExecutorEth) {
          await alerter.deliver(
            buildAlert({
              wallet: "system",
              kind: "alert",
              rule: "NONE",
              severity: "HIGH",
              reason: `Executor ${addr} balance ${bal} wei below floor ${minExecutorEth} wei.`,
              action: "ALERT",
              now: Date.now(),
            }),
          );
        }
      } catch {
        // ignore
      }
    }
  }, 5 * 60 * 1000);
  balanceCheck.unref();

  // Run every wallet's monitor concurrently. A dead feed on one wallet must not
  // stop the others; only an exhausted-reconnect on a monitor is logged.
  await Promise.all(
    monitors.map(async (monitor) => {
      try {
        await monitor.run(controller.signal);
      } catch (error) {
        if (error instanceof ReconnectExhaustedError) {
          console.error(`[bot] lost the mempool feed: ${error.message}`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    }),
  );

  http.destroy();
  log("Stopped.");
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