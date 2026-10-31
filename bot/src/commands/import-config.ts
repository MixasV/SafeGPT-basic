import { readFileSync } from "node:fs";
import { loadConfig } from "../config.js";

export async function importWizardConfig(filePath: string, configPath: string = "./config.yaml"): Promise<void> {
  const wizardData = JSON.parse(readFileSync(filePath, "utf8"));
  const config = loadConfig(configPath);
  const w = config.wallets?.[0];
  if (!w) { console.error("No wallet configured"); process.exit(1); }
  // executor key is in w.executorPrivateKey
  w.vaultAddress = wizardData.vault?.address ?? w.vaultAddress;
  w.protectedWallet = wizardData.protectedWallet ?? w.protectedWallet;
  w.safeAddress = wizardData.safeAddress ?? w.safeAddress;
  w.coreTokens = (wizardData.tokens ?? []).map((t: any) => ({ address: t.address, symbol: t.symbol, decimals: 18, rescueThreshold: "0" }));
  console.log(`Config updated. Vault: ${w.vaultAddress}, Tokens: ${w.coreTokens.length}`);
}
