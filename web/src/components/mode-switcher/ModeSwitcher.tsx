import { useModeStore } from "../../hooks/useMode";

/**
 * Header control that switches between Beginner (👶) and Pro (🔧) mode.
 * Visible on every page; the selection is persisted in localStorage.
 */
export function ModeSwitcher() {
  const mode = useModeStore((state) => state.mode);
  const setMode = useModeStore((state) => state.setMode);

  const isBeginner = mode === "beginner";

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-bg-tertiary p-1"
      role="group"
      aria-label="Interface mode"
    >
      <button
        type="button"
        onClick={() => setMode("beginner")}
        aria-pressed={isBeginner}
        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
          isBeginner
            ? "bg-accent text-white"
            : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
        }`}
      >
        👶 Beginner
      </button>
      <button
        type="button"
        onClick={() => setMode("pro")}
        aria-pressed={!isBeginner}
        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
          isBeginner
            ? "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
            : "bg-accent text-white"
        }`}
      >
        🔧 Pro
      </button>
    </div>
  );
}