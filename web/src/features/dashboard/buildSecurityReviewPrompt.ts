import { useOnboardingStore } from "../../state/onboarding";
import type { SelectedAsset } from "../../state/onboarding";

export function buildSecurityReviewPrompt(): string {
  const state = useOnboardingStore.getState();
  const protectedTokens: SelectedAsset[] = state.assets.filter((t: SelectedAsset) => t.selected);
  const unapprovedTokens: SelectedAsset[] = protectedTokens.filter((t: SelectedAsset) => !t.verified);

  return `You are SafeGPT Security Advisor. Analyze this wallet protection configuration and provide specific, actionable recommendations.

PROTECTION SETUP:
- Chain ID: ${state.chainId}
- Vault contract: ${state.vaultAddress || "NOT DEPLOYED"}
- Safe address: ${state.safeAddress || "NOT SET"}

TOKENS (${protectedTokens.length} total):
${protectedTokens.map((t: SelectedAsset) => `- ${t.symbol} (${t.address}) — vault approval: ${t.verified ? "✅ approved" : "❌ NOT APPROVED — NOT PROTECTED"}`).join("\n")}

${unapprovedTokens.length > 0 ? `⚠️ ${unapprovedTokens.length} token(s) have NO approval — they CANNOT be rescued by the vault.` : ""}

ANALYSIS REQUESTED:
1. Tokens without approval — list them, explain they are not protected
2. Is rescue threshold appropriate for portfolio size?
3. Common high-value tokens that might be missing (USDC, USDT, WETH, WBTC, DAI)
4. Native ETH protection: remind that ETH cannot be protected by Rescue Vault (must wrap to WETH)
5. For portfolios >$10K, suggest considering Guardian Module for stronger protection
6. Any other security concerns

RULES FOR YOUR RESPONSE:
- Be concise (max 300 words)
- Use bullet points
- Never say "guaranteed" or "insurance" — protection has limitations
- End with a severity rating: 🟢 Good / 🟡 Needs Attention / 🔴 Critical Issues`;
}
