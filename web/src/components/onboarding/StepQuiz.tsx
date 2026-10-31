import { useState } from "react";
import { PrimaryButton } from "./StepFrame";

interface Option {
  text: string;
  correct: boolean;
  explanation?: string;
}

interface Question {
  id: number;
  question: string;
  options: Option[];
}

const quizQuestions: Question[] = [
  {
    id: 1,
    question: "If an attacker sends your tokens through a private mempool (private RPC), will SafeGPT Rescue Vault catch it?",
    options: [
      { text: "Yes, SafeGPT monitors all transactions", correct: false, explanation: "Rescue Vault monitors the PUBLIC mempool only. Private/direct transactions are invisible until confirmed in a block." },
      { text: "No, the bot only sees public mempool transactions", correct: true },
    ],
  },
  {
    id: 2,
    question: "You receive an airdrop of a new token (NewCoin). Is it automatically protected?",
    options: [
      { text: "Yes, the vault protects all tokens on the wallet", correct: false, explanation: "The vault can only rescue tokens that have been approved (allowance). You must approve each new token separately." },
      { text: "No, I need to approve the vault for NewCoin first", correct: true },
    ],
  },
  {
    id: 3,
    question: "Can SafeGPT rescue your native ETH (not WETH)?",
    options: [
      { text: "Yes, ETH is protected like any other token", correct: false, explanation: "ETH has no approve/transferFrom mechanism. The vault cannot pull native ETH. Wrap it to WETH for protection." },
      { text: "No, I need to wrap ETH to WETH for vault protection", correct: true },
    ],
  },
  {
    id: 4,
    question: "What happens if the bot (monitoring script) goes offline?",
    options: [
      { text: "The smart contract will rescue funds automatically", correct: false, explanation: "The vault contract cannot act on its own. It needs the bot to call rescue(). No bot = no rescue." },
      { text: "Nothing — the contract does nothing without someone calling rescue()", correct: false, explanation: "Correct that the contract can't act alone, but 'nothing' understates the risk — your wallet is unprotected while the bot is offline." },
      { text: "My wallet is unprotected until the bot is back online", correct: true },
    ],
  },
  {
    id: 5,
    question: "The executor (bot) wallet needs ETH. What is it used for?",
    options: [
      { text: "To pay gas fees when calling rescue() on the vault contract", correct: true },
      { text: "To store my protected tokens temporarily", correct: false, explanation: "The executor wallet only pays gas. Your tokens go directly from the protected wallet to the safe address via the vault." },
      { text: "To pay SafeGPT platform fees", correct: false, explanation: "Self-hosted SafeGPT has 0% fees. The ETH is for on-chain gas costs only." },
    ],
  },
  {
    id: 6,
    question: "Should you use the protected wallet for daily trading and dApp interactions?",
    options: [
      { text: "Yes, SafeGPT will filter legitimate transactions", correct: false, explanation: "The bot treats ANY call to non-whitelisted contracts as suspicious and triggers rescue. The protected wallet must be used as cold storage ONLY." },
      { text: "No, the protected wallet should be cold storage only", correct: true },
    ],
  },
];

export function StepQuiz({ onContinue }: { onContinue: () => void }) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState(false);

  const q = quizQuestions[current];
  const isLast = current === quizQuestions.length - 1;

  function handleSelect(index: number) {
    setSelected(index);
    const opt = q.options[index];
    if (opt.correct) {
      setFeedback("✓ Correct!");
    } else {
      setFeedback(opt.explanation ?? "Incorrect. Try again.");
    }
  }

  function handleNext() {
    if (selected === null) return;
    if (!q.options[selected].correct) return;
    if (isLast) {
      // done
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setFeedback(null);
    }
  }

  const allDone = current === quizQuestions.length - 1 && selected !== null && q.options[selected].correct;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Understanding Check</h2>
      <p className="text-sm text-text-secondary">Question {current + 1} of {quizQuestions.length}</p>

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm font-medium text-text-primary">{q.question}</p>
        <div className="mt-3 space-y-2">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                selected === i
                  ? opt.correct
                    ? "border-green-500 bg-green-500/10 text-green-600"
                    : "border-red-500 bg-red-500/10 text-red-600"
                  : "border-border text-text-primary hover:bg-surface"
              }`}
            >
              {opt.text}
            </button>
          ))}
        </div>
        {feedback && (
          <p className={`mt-3 text-sm ${feedback.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>
            {feedback}
          </p>
        )}
      </div>

      {!allDone && (
        <PrimaryButton
          onClick={handleNext}
          disabled={selected === null || !q.options[selected]?.correct}
        >
          Next
        </PrimaryButton>
      )}

      {allDone && (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={disclaimer}
              onChange={(e) => setDisclaimer(e.target.checked)}
              className="mt-1"
            />
            I understand that SafeGPT Rescue Vault is a "last resort" tool, not a guarantee. Protection depends on the bot running continuously, sufficient executor ETH balance, prior token approvals, and public mempool visibility. I accept full responsibility for my funds and understand the limitations described above.
          </label>
          <PrimaryButton
            onClick={() => {
              localStorage.setItem("safegpt_quiz_completed", JSON.stringify({
                completedAt: new Date().toISOString(),
                version: 1,
                disclaimerAccepted: true,
              }));
              onContinue();
            }}
            disabled={!disclaimer}
          >
            Continue
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
