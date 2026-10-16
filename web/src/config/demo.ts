/**
 * Demo mode (specification section 9).
 *
 * When VITE_DEMO_MODE=true the UI runs the complete onboarding flow without
 * broadcasting real transactions. Demo mode is also used for the grant demo,
 * where no funded wallet is available.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";