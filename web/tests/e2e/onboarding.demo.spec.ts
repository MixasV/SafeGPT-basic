import { expect, test } from "@playwright/test";

/**
 * Sprint 2 acceptance: the onboarding wizard must be completable from the first
 * step to the confirmation screen in Demo Mode, with no wallet connected and no
 * transaction broadcast.
 */
test.describe("onboarding wizard in demo mode", () => {
  test.beforeEach(async ({ page }) => {
    // Clear once, after the first load: an addInitScript would also wipe the
    // persisted state on every reload and break the persistence assertions.
    await page.goto("/#/setup");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
  });

  test("completes every step and reaches the active-protection screen", async ({ page }) => {
    // Demo banner must be visible so the recording is honest about what runs.
    await expect(page.getByText("Demo Mode — no real transactions will be broadcast")).toBeVisible();

    // Step 1 — connect, including the honest-limitations warning
    await expect(page.getByRole("heading", { name: "Connect the wallet you want to protect" })).toBeVisible();
    await expect(page.getByText("COLD STORAGE ONLY").first()).toBeVisible();
    await expect(page.getByText(/Basic and Pro protect against the most common attacks/)).toBeVisible();
    await expect(page.getByText(/not insurance/)).toBeVisible();
    await page.getByRole("button", { name: "I understand, connect wallet" }).click();

    // Step 2 — drainer check
    await expect(page.getByRole("heading", { name: "Safety check" })).toBeVisible();
    await page.getByRole("button", { name: "Start the check" }).click();
    await page.getByRole("button", { name: /I've sent ETH/ }).click();
    await expect(page.getByText("Your wallet is clean")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3 — safe address plus the safe-wallet signature
    await expect(page.getByRole("heading", { name: "Set your safe address" })).toBeVisible();
    await expect(page.getByText("DIFFERENT wallet on a DIFFERENT device")).toBeVisible();
    await expect(page.getByText("Valid address")).toBeVisible();

    // Optional in Beginner mode, so Continue works without linking yet.
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: "3. Safe address" }).click();
    await page.getByRole("button", { name: "Simulate signature" }).click();
    await expect(page.getByText("LINKED")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 4 — asset scan with Core/Watch classification
    await expect(page.getByRole("heading", { name: "Select assets to protect" })).toBeVisible();
    await page.getByRole("button", { name: "Scan wallet" }).click();

    // Three curated tokens land in Core, the placeholder one in Watch.
    await expect(page.getByText("3 in Core · 1 in Watch")).toBeVisible();
    await expect(page.getByText("🟢 Verified").first()).toBeVisible();
    await expect(page.getByText("🟡 Unverified").first()).toBeVisible();
    await expect(page.getByText("USDC").first()).toBeVisible();
    await expect(page.getByText("WETH").first()).toBeVisible();
    await expect(page.getByText("DAI").first()).toBeVisible();
    await expect(page.getByText("MYSTERY").first()).toBeVisible();

    // Native ETH cannot be protected and is routed through WETH wrapping.
    await expect(page.getByText("Native ETH cannot be protected directly")).toBeVisible();
    await expect(page.getByText(/WETH 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/)).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();

    // Step 4.5 — deploy the vault
    await expect(page.getByRole("heading", { name: "Deploy your protection contract" })).toBeVisible();
    await page.getByRole("button", { name: /Deploy Protection/ }).click();
    await expect(page.getByText("Protection contract deployed!")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 5 — approvals
    await expect(page.getByRole("heading", { name: "Approve protection" })).toBeVisible();
    await page.getByRole("button", { name: "Approve all" }).click();
    await expect(page.getByRole("button", { name: "Finish" })).toBeEnabled();
    await page.getByRole("button", { name: "Finish" }).click();

    // Step 6 — protection active
    await expect(page.getByRole("heading", { name: "Protection active" })).toBeVisible();
    await expect(page.getByText("Monitoring started").first()).toBeVisible();
    await expect(page.getByText("Safe address", { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to Dashboard" })).toBeVisible();
  });

  test("blocks onboarding when the drainer check reports a compromise", async ({ page }) => {
    await page.getByRole("button", { name: "I understand, connect wallet" }).click();
    await expect(page.getByRole("heading", { name: "Safety check" })).toBeVisible();

    await page.getByRole("button", { name: "Simulate Compromised" }).click();

    await expect(page.getByText("DANGER: Your wallet appears compromised.")).toBeVisible();
    // No way forward: the only action is to run the check again.
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run the check again" })).toBeVisible();
  });

  test("rejects a safe address equal to the protected wallet", async ({ page }) => {
    await page.getByRole("button", { name: "I understand, connect wallet" }).click();
    await page.getByRole("button", { name: "Start the check" }).click();
    await page.getByRole("button", { name: /I've sent ETH/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("checkbox", { name: /Use the demo safe address/ }).uncheck();
    await page.getByTestId("safe-address-input").fill("0x00000000000000000000000000000000000000D1");

    await expect(page.getByText("must be different from the protected wallet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("Pro mode requires the safe-wallet signature before continuing", async ({ page }) => {
    await page.getByRole("button", { name: "🔧 Pro" }).click();
    await page.getByRole("button", { name: "I understand, connect wallet" }).click();
    await page.getByRole("button", { name: "Start the check" }).click();
    await page.getByRole("button", { name: /I've sent ETH/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Required in Pro mode.")).toBeVisible();
    // The safe-wallet rationale is stated on screen, not hidden behind a tooltip.
    await expect(page.getByText(/Platform login uses the SAFE wallet signature/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

    await page.getByRole("button", { name: "Simulate signature" }).click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  test("changing the safe address invalidates the linked signature", async ({ page }) => {
    await page.getByRole("button", { name: "I understand, connect wallet" }).click();
    await page.getByRole("button", { name: "Start the check" }).click();
    await page.getByRole("button", { name: /I've sent ETH/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: "Simulate signature" }).click();
    await expect(page.getByText("LINKED")).toBeVisible();

    // A different address is a different wallet and needs its own signature.
    await page.getByTestId("safe-address-input").fill("0x00000000000000000000000000000000000000D9");
    await expect(page.getByText("LINKED")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Simulate signature" })).toBeVisible();
  });

  test("keeps the mode switcher choice across a reload", async ({ page }) => {
    await page.getByRole("button", { name: "🔧 Pro" }).click();
    await expect(page.getByRole("button", { name: "🔧 Pro" })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.getByRole("button", { name: "🔧 Pro" })).toHaveAttribute("aria-pressed", "true");
    // Pro mode adds the safe-wallet linking requirement, the manual token entry
    // and the per-token controls.
    await page.getByRole("button", { name: "I understand, connect wallet" }).click();
    await page.getByRole("button", { name: "Start the check" }).click();
    await page.getByRole("button", { name: /I've sent ETH/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Required in Pro mode.")).toBeVisible();
    await page.getByRole("button", { name: "Simulate signature" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("+ Add token manually")).toBeVisible();
    await expect(page.getByLabel("Token contract address")).toBeVisible();
  });
});