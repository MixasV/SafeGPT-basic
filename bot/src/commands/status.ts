import { loadConfig } from "../config.js";

export async function status(configPath: string = "./config.yaml"): Promise<void> {
  const config = loadConfig(configPath);
  const w = config.wallets?.[0];
  console.log("SafeGPT Bot Status");
  console.log(`Vault: ${w?.vaultAddress ?? "not configured"}`);
  console.log(`Protected wallet: ${w?.protectedWallet ?? "not set"}`);
  console.log(`Safe address: ${w?.safeAddress ?? "not set"}`);
  console.log(`Tokens: ${w?.coreTokens?.length ?? 0}`);
}
