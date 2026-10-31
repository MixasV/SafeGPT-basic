import { useOnboardingStore } from "../../state/onboarding";
import type { SelectedAsset } from "../../state/onboarding";

export function buildPreDeployReviewPrompt(): string {
  const state = useOnboardingStore.getState();
  const selected = state.assets.filter((a: SelectedAsset) => a.selected);
  const totalUSD = selected.length * 1000; // placeholder
  const hasWETH = selected.some((a: SelectedAsset) => a.symbol === "WETH");
  const zeroBalance = selected.filter((a: SelectedAsset) => a.balance === "0");
  const custom = selected.filter((a: SelectedAsset) => !a.verified);

  return `You are SafeGPT Security Advisor. The user is about to deploy a RescueVault contract. Analyze this configuration and identify any issues BEFORE they spend gas on deployment.

CONFIGURATION TO DEPLOY:
- Chain ID: ${state.chainId}
- Protected wallet: ${state.walletAddress || "unknown"}
- Safe address: ${state.safeAddress || "NOT SET"} (balance: 0 ETH)
- Executor (bot): not set
- Fee: 0%

TOKENS SELECTED (${selected.length}):
${selected.map((t: SelectedAsset) => `- ${t.symbol} (${t.address})${!t.verified ? " [CUSTOM - not verified]" : ""} balance: ${t.balance}`).join("\n")}

Total protected value: ~$${totalUSD}
WETH included: ${hasWETH ? "yes" : "NO — native ETH NOT protected"}
Zero-balance tokens (pre-approve): ${zeroBalance.length}
Custom (unverified) tokens: ${custom.length}
Telegram notifications: NOT configured

ANALYZE AND REPORT:
1. Any critical issues that should BLOCK deployment?
2. Warnings (missing tokens, low executor balance, no Telegram)
3. Suggestions (pre-approve more tokens, wrap ETH, etc.)
4. Confirmation of what IS correctly configured

RULES:
- Be concise (max 200 words)
- Bullet points only
- Never say "guaranteed" or "insurance"
- If safe address is a contract, WARN strongly
- End with: "Recommendation: ✅ Safe to deploy" or "⚠️ Review issues above before deploying"`;
}
