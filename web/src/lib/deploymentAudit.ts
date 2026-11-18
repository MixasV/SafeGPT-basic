import type { SelectedAsset } from "../state/onboarding";

/**
 * Builds the per-user deployment manifest that the ChainGPT auditor reviews
 * BEFORE deploy.
 *
 * Core deploys a RescueVaultFactory once, then creates the user's vault
 * through `factory.createVault(...)` (CREATE2, deterministic salt derived from
 * owner + safeAddress). The vault constructor is:
 *   (owner, safeAddress, executor, feeReceiver, feeBps, withdrawDelay)
 * and the factory call is:
 *   createVault(owner, safeAddress, executor, feeReceiver, feeBps, withdrawDelay, salt)
 *
 * Auditing the template source for every user would review the same bytes each
 * time and miss instance-specific mistakes (wrong safe address, safe == owner,
 * fee above cap, unverified tokens, etc.). This manifest is the exact code and
 * configuration the user's contract will consist of, so the auditor reviews
 * THIS specific deployment instance, not the template.
 */

export interface DeploymentManifestInput {
  owner: string;
  safeAddress: string;
  executor: string;
  feeReceiver: string;
  feeBps: number;
  /** Seconds before a pending ETH withdrawal can be executed (0 = instant). */
  withdrawDelay: number;
  chainId: number;
  assets: SelectedAsset[];
  whitelist: string[];
  factoryAddress?: string;
  predictedVaultAddress?: string | null;
  /** CREATE2 salt used by factory.createVault. */
  salt?: string;
  contractType?: string;
}

export function buildDeploymentAuditInput(input: DeploymentManifestInput): string {
  const selected = input.assets.filter((a) => a.selected);
  const warnings: string[] = [];

  if (input.safeAddress.toLowerCase() === input.owner.toLowerCase()) {
    warnings.push("CRITICAL: safeAddress equals owner (protected wallet) — rescue would return funds to the attacked wallet.");
  }
  if (input.feeBps > 1000) warnings.push(`feeBps ${input.feeBps} exceeds MAX_FEE_BPS 1000 (10%).`);
  if (selected.length === 0) warnings.push("No tokens selected — nothing would be rescued.");
  const watch = selected.filter((a) => !a.verified);
  if (watch.length > 0) warnings.push(`Unverified tokens selected: ${watch.map((a) => `${a.symbol} (${a.address})`).join(", ")}.`);

  return [
    "// SafeGPT per-user vault deployment manifest — review THIS instance, not the template.",
    "// Contract template: RescueVault (Solidity 0.8.x), deployed via RescueVaultFactory.createVault (CREATE2).",
    "// Core flow: deploy RescueVaultFactory once, then createVault(...) creates this user's vault deterministically.",
    "",
    `contract SafeGPTVaultForUser {`,
    `  address constant OWNER = ${input.owner};`,
    `  address constant SAFE_ADDRESS = ${input.safeAddress};`,
    `  address constant EXECUTOR = ${input.executor}; // bot gas wallet`,
    `  address constant FEE_RECEIVER = ${input.feeReceiver};`,
    `  uint16  constant FEE_BPS = ${input.feeBps}; // ${(input.feeBps / 100).toFixed(2)}%, capped at 1000 bps`,
    `  uint256 constant WITHDRAW_DELAY = ${input.withdrawDelay}; // seconds before a pending ETH withdrawal executes`,
    `  uint256 constant CHAIN_ID = ${input.chainId};`,
    input.factoryAddress ? `  address constant FACTORY = ${input.factoryAddress};` : "",
    input.predictedVaultAddress ? `  address constant PREDICTED_VAULT = ${input.predictedVaultAddress}; // CREATE2 address` : "",
    input.salt ? `  bytes32 constant SALT = ${input.salt}; // CREATE2 salt for createVault` : "",
    `}`,
    "",
    "// Constructor args that will be used (RescueVault constructor):",
    `new RescueVault(owner=${input.owner}, safeAddress=${input.safeAddress}, executor=${input.executor}, feeReceiver=${input.feeReceiver}, feeBps=${input.feeBps}, withdrawDelay=${input.withdrawDelay})`,
    "",
    "// Factory call that will be used:",
    `factory.createVault(owner=${input.owner}, safeAddress=${input.safeAddress}, executor=${input.executor}, feeReceiver=${input.feeReceiver}, feeBps=${input.feeBps}, withdrawDelay=${input.withdrawDelay}, salt=${input.salt ?? "<derived from owner+safeAddress>"})`,
    "",
    "// Tokens the user selected for approval (approve(vault, maxUint256) — unlimited):",
    selected.length > 0
      ? selected.map((a) => `- ${a.symbol} ${a.address} decimals=${a.decimals} verified=${a.verified} approveAmount=maxUint256${a.threshold ? ` threshold=${a.threshold}` : ""}`).join("\n")
      : "- none",
    "",
    "// Whitelist (addresses that must NOT trigger rescue):",
    input.whitelist.length > 0 ? input.whitelist.map((a) => `- ${a}`).join("\n") : "- none configured",
    "",
    warnings.length > 0 ? `// Warnings detected in this config:\n${warnings.map((w) => `// - ${w}`).join("\n")}` : "",
    "",
    "// Audit task: review this specific deployment instance (factory params, constructor args,",
    "// withdrawDelay, salt, selected tokens, whitelist) for mistakes that would make rescue fail",
    "// or send funds to the wrong place. Give a clear verdict: SAFE TO APPROVE / REVIEW REQUIRED /",
    "// DO NOT APPROVE, with concrete advice. No financial advice.",
  ]
    .filter(Boolean)
    .join("\n");
}