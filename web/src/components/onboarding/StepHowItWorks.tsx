export function StepHowItWorks({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-text-primary">How SafeGPT Protection Works</h2>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">What SafeGPT Protects Against</h3>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li>✅ Attacker transfers your tokens to an unknown address → Bot detects in mempool, races to rescue tokens to your safe address</li>
          <li>✅ Attacker approves a malicious spender on your tokens → Bot detects approve, immediately rescues tokens before spender can act</li>
          <li>✅ Attacker calls unknown smart contracts from your wallet → Bot detects any call to non-whitelisted contracts, triggers rescue</li>
          <li>✅ Attacker attempts EIP-7702 delegation → Bot detects and rescues immediately</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">What SafeGPT CANNOT Protect Against</h3>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li>вќЊ Private mempool / private RPC transactions — Bot monitors public mempool only.</li>
          <li>вќЊ Native ETH theft — ETH has no approve/transferFrom. Wrap ETH → WETH for protection, or use Guardian Module.</li>
          <li>вќЊ Tokens without prior approve — The vault can only rescue tokens you have approved in advance.</li>
          <li>вќЊ Bot is offline or RPC is down — No one calls rescue(). Protection requires the bot running 24/7.</li>
          <li>вќЊ Sweeper bots on compromised wallet — If attacker drains any incoming ETH instantly, you cannot send ETH for gas.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Your Responsibilities</h3>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li>рџ”§ Keep the bot running 24/7 (your PC, VPS, or server)</li>
          <li>рџ”§ Keep the executor wallet funded with ETH for gas (~0.01-0.05 ETH)</li>
          <li>рџ”§ Approve new tokens manually when you receive them</li>
          <li>рџ”§ Do NOT use the protected wallet for trading, swaps, or dApps</li>
          <li>рџ”§ Monitor alerts and act on warnings</li>
          <li>рџ”§ Keep your safe address key secure (separate from protected wallet)</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Estimated Costs</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm text-text-secondary">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Estimated Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border"><td className="px-3 py-2">Deploy RescueVault contract</td><td className="px-3 py-2">~0.005-0.02 ETH</td></tr>
              <tr className="border-b border-border"><td className="px-3 py-2">Approve per token (one-time)</td><td className="px-3 py-2">~0.001-0.005 ETH</td></tr>
              <tr className="border-b border-border"><td className="px-3 py-2">5 tokens total approve</td><td className="px-3 py-2">~0.005-0.025 ETH</td></tr>
              <tr className="border-b border-border"><td className="px-3 py-2">Executor wallet funding (gas)</td><td className="px-3 py-2">~0.01-0.05 ETH</td></tr>
              <tr className="border-b border-border"><td className="px-3 py-2">TOTAL to start</td><td className="px-3 py-2">~0.02-0.10 ETH (~$50-250)</td></tr>
              <tr className="border-b border-border"><td className="px-3 py-2">Rescue fee (self-hosted)</td><td className="px-3 py-2">0% (free)</td></tr>
              <tr><td className="px-3 py-2">Monthly cost</td><td className="px-3 py-2">$0 + server/VPS cost</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-secondary">
          All costs are on-chain gas fees paid to the Ethereum network, not to SafeGPT. Self-hosted SafeGPT has zero platform fees.
        </p>
      </section>

      <button onClick={onContinue} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
        I understand, continue →
      </button>
    </div>
  );
}

