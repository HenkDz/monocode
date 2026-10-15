import { expect, test } from "@playwright/test";
import { join } from "node:path";

for (const theme of ["dark", "light"]) {
  test(`footer usage navigation, keyboard and accounts in ${theme}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/tests/browser/ccfb2-usage.html?theme=${theme}`);
    const trigger = page.getByRole("button", { name: "Codex usage details", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Codex usage details" });
    const action = dialog.getByRole("button", { name: "See all usage", exact: true });
    await expect(action).toBeVisible();
    await expect(action).toBeInViewport();
    await expect(dialog.getByRole("heading", { name: "Banked resets" })).toBeVisible();
    await dialog.screenshot({ path: process.env.CCFB2_EVIDENCE
      ? join(process.env.CCFB2_EVIDENCE, `popover-${theme}.png`)
      : testInfo.outputPath(`popover-${theme}.png`) });
    await page.getByRole("button", { name: "Switch Codex account" }).click();
    await expect(page.getByRole("heading", { name: "Codex accounts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "See all usage" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to usage" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await action.focus();
    await action.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { name: "Room to keep working." })).toBeFocused();
    expect(errors).toEqual([]);
  });
}
