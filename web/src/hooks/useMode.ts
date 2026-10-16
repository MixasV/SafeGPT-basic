import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Beginner Mode = guided wizard, Pro Mode = full control over every parameter.
 * Switching modes never loses data — only the amount of visible detail changes.
 */
export type UiMode = "beginner" | "pro";

interface ModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  toggleMode: () => void;
}

/** The choice survives a page reload (localStorage, key `safegpt-ui-mode`). */
export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: "beginner",
      setMode: (mode) => set({ mode }),
      toggleMode: () =>
        set((state) => ({ mode: state.mode === "beginner" ? "pro" : "beginner" })),
    }),
    { name: "safegpt-ui-mode" },
  ),
);

/** Convenience selector for components that only need the current mode. */
export const useMode = (): UiMode => useModeStore((state) => state.mode);