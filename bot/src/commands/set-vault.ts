import { loadConfig } from "../config.js";

export async function setVault(address: string, configPath: string = "./config.yaml"): Promise<void> {
  const config = loadConfig(configPath);
  const w = config.wallets?.[0];
  if (!w) { console.error("No wallet configured"); process.exit(1); }
  w.vaultAddress = address;
  console.log(`Vault set to ${address}`);
}
