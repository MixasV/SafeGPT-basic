
interface Props {
  score: number;
}

export function ProtectionScore({ score }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped <= 40 ? "bg-red-500" : clamped <= 60 ? "bg-orange-500" : clamped <= 80 ? "bg-yellow-500" : "bg-green-500";
  const label =
    clamped <= 40 ? "Critical" : clamped <= 60 ? "Basic" : clamped <= 80 ? "Good" : "Strong";

  return (
    <div className="rounded-xl border border-border bg-surface p-3" title="Score factors: +10 vault deployed, +10 safe≠owner, +4 per token (max 20), +10 WETH, +15 AI, +10 audit, +10 executor funded, +5 Telegram, +5 pre-approve zero-balance, +5 custom verified.">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>Protection Score</span>
        <span>{clamped}% — {label}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
        <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function calculateProtectionScore(factors: {
  hasAI: boolean;
  tokensApproved: number;
  hasWETH: boolean;
  executorFunded: boolean;
  telegramConfigured: boolean;
  contractAudited: boolean;
  preApprovedZeroBalance: number;
  customTokensVerified: boolean;
}): number {
  let score = 0;
  score += 10;
  score += 10;
  score += Math.min(factors.tokensApproved * 4, 20);
  if (factors.hasWETH) score += 10;
  if (factors.hasAI) score += 15;
  if (factors.contractAudited) score += 10;
  if (factors.executorFunded) score += 10;
  if (factors.telegramConfigured) score += 5;
  if (factors.preApprovedZeroBalance > 0) score += 5;
  if (factors.customTokensVerified) score += 5;
  return Math.min(score, 100);
}
