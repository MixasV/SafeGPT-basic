import { useState } from "react";

const QUESTIONS = [
  "I understand the executor wallet needs ETH for gas.",
  "I understand funds are rescued to the safe address.",
  "I understand approvals are required for each token.",
];

export function StepQuiz({ onContinue }: { onContinue: () => void }) {
  const [checked, setChecked] = useState<boolean[]>(QUESTIONS.map(() => false));
  const allChecked = checked.every(Boolean);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-primary">Understanding check</h2>
      {QUESTIONS.map((q, i) => (
        <label key={i} className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={checked[i]}
            onChange={(e) => {
              const next = [...checked];
              next[i] = e.target.checked;
              setChecked(next);
            }}
          />
          {q}
        </label>
      ))}
      <button
        onClick={onContinue}
        disabled={!allChecked}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}
