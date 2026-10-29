import { readFileSync } from "node:fs";
import { isAddress, getAddress } from "ethers";
import { parse } from "yaml";

import { readAddress, getChainId, SELECTORS, type RpcReader } from "./chain.js";
import type { AlertsConfig, BotConfig, TokenConfig, WalletConfig } from "./types.js";

/**
 * Configuration loading and validation.
 *
 * Two phases, deliberately separated:
 *   1. `loadConfig` — parse and shape-check, no network access. This is what
 *      `--dry-run` exercises, so an operator can validate a config offline.
 *   2. `validateAgainstChain` — confirm the chain id and, for Variant B, that
 *      the guardian on-chain matches the operator's expectation.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Replaces `ENV:NAME` with the matching environment variable.
 *
 * `ENV_OPT:NAME` is the optional form: it resolves to an empty string when the
 * variable is not set.
 *
 * WHY BOTH FORMS EXIST
 * --------------------
 * `ENV:` fails loudly on a missing variable, which is what you want for a
 * secret that the bot cannot work without — a typo in `ENV:EXECUTOR_KEY` must
 * not silently become an empty string and a bot that signs nothing.
 *
 * But an optional channel is a different case. Telegram is one alert channel
 * among several: the console always works, and the webhook is optional. If the
 * shipped example config referenced `ENV:TG_BOT_TOKEN`, then every operator who
 * did not want Telegram would have to hand-edit the YAML before the bot would
 * start at all. "Add the keys you need and run" has to mean exactly that.
 *
 * Runs on the *parsed* document, never on the raw text. A textual pass would
 * also rewrite `ENV:NAME` inside a YAML comment — which is exactly how the
 * shipped example documents the feature — and would mangle any `#` that belongs
 * to a URL fragment. Walking values only cannot hit either.
 */
function expandEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/ENV_OPT:([A-Z0-9_]+)/g, (_match, name: string) => process.env[name] ?? "")
      .replace(/ENV:([A-Z0-9_]+)/g, (_match, name: string) => {
        const resolved = process.env[name];
        if (resolved === undefined) {
          throw new ConfigError(
            `Config references ENV:${name} but that environment variable is not set. ` +
              `Export it before starting the bot, or remove the reference.`,
          );
        }
        return resolved;
      });
  }

  if (Array.isArray(value)) return value.map(expandEnv);

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expandEnv(entry)]));
  }

  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${path} is required and must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ConfigError(`${path} must be a string.`);
  return value.trim();
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`${path} is required and must be a number.`);
  }
  return value;
}

function optionalNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`${path} must be a number.`);
  }
  return value;
}

/** Validates and checksums an address, with a message that names the field. */
function requireAddress(value: unknown, path: string): string {
  const raw = requireString(value, path);
  if (!isAddress(raw)) {
    throw new ConfigError(`${path} is not a valid EVM address: "${raw}".`);
  }
  // getAddress throws on a bad checksum, which catches a mistyped address even
  // when it happens to be a real contract.
  try {
    return getAddress(raw);
  } catch {
    throw new ConfigError(`${path} has an invalid EIP-55 checksum: "${raw}".`);
  }
}

function parseAddressList(value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be a list of addresses.`);
  return value.map((entry, index) => requireAddress(entry, `${path}[${index}]`));
}

function parseTokens(value: unknown, path: string): TokenConfig[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be a list.`);
  return value.map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new ConfigError(`${itemPath} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const decimals = requireNumber(record.decimals, `${itemPath}.decimals`);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new ConfigError(`${itemPath}.decimals must be an integer between 0 and 36.`);
    }

    const token: TokenConfig = {
      address: requireAddress(record.address, `${itemPath}.address`),
      symbol: requireString(record.symbol, `${itemPath}.symbol`),
      decimals,
    };

    const threshold = optionalString(record.rescueThreshold, `${itemPath}.rescueThreshold`);
    if (threshold !== undefined) {
      if (!/^\d+$/.test(threshold)) {
        throw new ConfigError(
          `${itemPath}.rescueThreshold must be a raw integer amount in the token's smallest unit, not "${threshold}".`,
        );
      }
      token.rescueThreshold = threshold;
    }

    return token;
  });
}

function parseWallet(value: unknown, index: number): WalletConfig {
  const path = `wallets[${index}]`;
  if (typeof value !== "object" || value === null) {
    throw new ConfigError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;

  const variant = requireString(record.variant, `${path}.variant`).toUpperCase();
  if (variant !== "A" && variant !== "B") {
    throw new ConfigError(`${path}.variant must be "A" (RescueVault) or "B" (GuardianModule), got "${variant}".`);
  }

  const safeAddress = requireAddress(record.safeAddress, `${path}.safeAddress`);
  const protectedWallet = requireAddress(record.protectedWallet, `${path}.protectedWallet`);

  if (safeAddress.toLowerCase() === protectedWallet.toLowerCase()) {
    throw new ConfigError(
      `${path}.safeAddress must differ from ${path}.protectedWallet — the protected wallet is cold storage, ` +
        `and a rescue that returns funds to the same wallet protects nothing.`,
    );
  }

  const coreTokens = parseTokens(record.coreTokens, `${path}.coreTokens`);
  const watchTokens = parseTokens(record.watchTokens, `${path}.watchTokens`);

  if (coreTokens.length === 0) {
    throw new ConfigError(
      `${path}.coreTokens is empty. Without at least one core token the vault has nothing to rescue.`,
    );
  }

  const seen = new Set<string>();
  for (const token of [...coreTokens, ...watchTokens]) {
    const key = token.address.toLowerCase();
    if (seen.has(key)) {
      throw new ConfigError(`${path} lists ${token.symbol} more than once.`);
    }
    seen.add(key);
  }

  const thresholds = (typeof record.thresholds === "object" && record.thresholds !== null
    ? (record.thresholds as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const thresholdsConfig = {
    massTransferCount: optionalNumber(thresholds.massTransferCount, `${path}.thresholds.massTransferCount`, 3),
    massTransferWindowMin: optionalNumber(
      thresholds.massTransferWindowMin,
      `${path}.thresholds.massTransferWindowMin`,
      5,
    ),
    balanceDropPct: optionalNumber(thresholds.balanceDropPct, `${path}.thresholds.balanceDropPct`, 10),
  };

  if (thresholdsConfig.massTransferCount < 1) {
    throw new ConfigError(`${path}.thresholds.massTransferCount must be at least 1.`);
  }
  if (thresholdsConfig.massTransferWindowMin <= 0) {
    throw new ConfigError(`${path}.thresholds.massTransferWindowMin must be positive.`);
  }
  if (thresholdsConfig.balanceDropPct <= 0 || thresholdsConfig.balanceDropPct > 100) {
    throw new ConfigError(`${path}.thresholds.balanceDropPct must be between 0 and 100.`);
  }

  const wallet: WalletConfig = {
    label: optionalString(record.label, `${path}.label`) ?? `wallet-${index}`,
    protectedWallet,
    safeAddress,
    vaultAddress: requireAddress(record.vaultAddress, `${path}.vaultAddress`),
    variant,
    coreTokens,
    watchTokens,
    whitelist: parseAddressList(record.whitelist, `${path}.whitelist`),
    thresholds: thresholdsConfig,
  };

  if (variant === "A") {
    const key = requireString(record.executorPrivateKey, `${path}.executorPrivateKey`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new ConfigError(`${path}.executorPrivateKey must be a 32-byte hex private key.`);
    }
    wallet.executorPrivateKey = key;
  } else {
    const key = requireString(record.guardianPrivateKey, `${path}.guardianPrivateKey`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new ConfigError(`${path}.guardianPrivateKey must be a 32-byte hex private key.`);
    }
    wallet.guardianPrivateKey = key;
  }

  return wallet;
}

/** Reads and validates a config file. Performs no network access. */
export function loadConfig(path: string): BotConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`Cannot read config file: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new ConfigError(`Config is not valid YAML: ${(error as Error).message}`);
  }

  // Only after parsing, so `ENV:` inside a comment is left alone.
  parsed = expandEnv(parsed);

  if (typeof parsed !== "object" || parsed === null) {
    throw new ConfigError("Config must be a YAML mapping at the top level.");
  }
  const record = parsed as Record<string, unknown>;

  const rpcWss = requireString(record.rpcWss, "rpcWss");
  if (!rpcWss.startsWith("wss://") && !rpcWss.startsWith("ws://")) {
    throw new ConfigError(`rpcWss must be a ws:// or wss:// URL, got "${rpcWss}".`);
  }

  const rpcHttp = requireString(record.rpcHttp, "rpcHttp");
  if (!rpcHttp.startsWith("http://") && !rpcHttp.startsWith("https://")) {
    throw new ConfigError(`rpcHttp must be an http:// or https:// URL, got "${rpcHttp}".`);
  }

  if (!Array.isArray(record.wallets) || record.wallets.length === 0) {
    throw new ConfigError("wallets is required and must contain at least one entry.");
  }

  const wallets = record.wallets.map((entry, index) => parseWallet(entry, index));

  const labels = new Set<string>();
  for (const wallet of wallets) {
    if (labels.has(wallet.label)) throw new ConfigError(`Duplicate wallet label: "${wallet.label}".`);
    labels.add(wallet.label);
  }

  const alertsRecord = (typeof record.alerts === "object" && record.alerts !== null
    ? (record.alerts as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const alerts: AlertsConfig = {
    telegramBotToken: optionalString(alertsRecord.telegramBotToken, "alerts.telegramBotToken") ?? "",
    telegramChatId: optionalString(alertsRecord.telegramChatId, "alerts.telegramChatId") ?? "",
    webhookUrl: optionalString(alertsRecord.webhookUrl, "alerts.webhookUrl") ?? "",
    minExecutorEth: optionalNumber(alertsRecord.minExecutorEth, "alerts.minExecutorEth", 0.1),
  };

  if (alerts.webhookUrl !== "" && !alerts.webhookUrl.startsWith("http")) {
    throw new ConfigError(`alerts.webhookUrl must be an http(s) URL, got "${alerts.webhookUrl}".`);
  }

  // Half-configured Telegram is a silent failure waiting to happen: the bot
  // would build a URL with an empty token and log a 404 hours later, during an
  // actual attack. Caught at startup instead.
  const hasToken = alerts.telegramBotToken !== "";
  const hasChat = alerts.telegramChatId !== "";
  if (hasToken !== hasChat) {
    throw new ConfigError(
      hasToken
        ? "alerts.telegramChatId is required when alerts.telegramBotToken is set."
        : "alerts.telegramBotToken is required when alerts.telegramChatId is set.",
    );
  }
  if (hasToken && !/^\d+$/.test(alerts.telegramChatId.replace(/^-/, ""))) {
    throw new ConfigError(
      `alerts.telegramChatId must be a numeric chat id, got "${alerts.telegramChatId}".`,
    );
  }

  return {
    rpcWss,
    rpcHttp,
    chainId: requireNumber(record.chainId, "chainId"),
    flashbotsRelay: optionalString(record.flashbotsRelay, "flashbotsRelay") ?? "",
    wallets,
    alerts,
  };
}

/**
 * Confirms the config matches reality on chain: the network id, and that each
 * vault really points at the configured wallet and safe address.
 *
 * A mismatch here is dangerous rather than cosmetic — a wrong `vaultAddress`
 * would make the bot send rescue transactions somewhere that cannot help, and a
 * wrong `safeAddress` in the config would send the operator's funds to an
 * address the operator does not control. Both fail closed.
 *
 * @returns Non-fatal warnings. Throws `ConfigError` on anything fatal.
 */
export async function validateAgainstChain(config: BotConfig, provider: RpcReader): Promise<string[]> {
  const warnings: string[] = [];

  const chainId = await getChainId(provider);
  if (chainId !== config.chainId) {
    throw new ConfigError(
      `Config chainId is ${config.chainId} but the RPC reports ${chainId}. ` +
        `Point rpcWss/rpcHttp at the network you intend to protect.`,
    );
  }

  for (const wallet of config.wallets) {
    const vaultOwner = await readAddress(provider, wallet.vaultAddress, SELECTORS.owner);
    if (vaultOwner.toLowerCase() !== wallet.protectedWallet.toLowerCase()) {
      throw new ConfigError(
        `Vault ${wallet.vaultAddress} (${wallet.label}) is owned by ${vaultOwner}, ` +
          `but the config protects ${wallet.protectedWallet}.`,
      );
    }

    const vaultSafe = await readAddress(provider, wallet.vaultAddress, SELECTORS.safeAddress);
    if (vaultSafe.toLowerCase() !== wallet.safeAddress.toLowerCase()) {
      throw new ConfigError(
        `Vault ${wallet.vaultAddress} (${wallet.label}) pays out to ${vaultSafe}, ` +
          `but the config expects ${wallet.safeAddress}.`,
      );
    }

    if (wallet.variant === "B") {
      const guardian = await readAddress(provider, wallet.vaultAddress, SELECTORS.guardian);
      // The guardian key is the whole point of Variant B, and its address cannot
      // be derived from a private key without trying every signature — out of
      // scope. The operator must confirm it themselves.
      warnings.push(
        `Wallet "${wallet.label}" uses Variant B. Verify separately that ${guardian} ` +
          `is the guardian address derived from guardianPrivateKey — the bot cannot check a private key.`,
      );
    }
  }

  return warnings;
}