import { expect, test } from "@playwright/test";
import { join } from "node:path";

const evidence = (name: string, fallback: string) => process.env.CCFB2_EVIDENCE ? join(process.env.CCFB2_EVIDENCE, name) : fallback;

test("reproduces hidden window controls in the accepted App layout", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/ccfb2-shell.html");
  const controls = page.getByRole("button", { name: "Minimize window" });
  await expect(controls).toHaveCount(1);
  for (const label of ["Mission control", "Usage", "Attention queue", "Team map"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(controls).toHaveCount(0);
  }
  await page.screenshot({ path: evidence("baseline-map-hidden-controls.png", testInfo.outputPath("baseline-map-hidden-controls.png")) });
});

for (const theme of ["dark", "light"]) {
  test(`long running and completed transcript in ${theme}`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
    await page.goto(`/tests/browser/ccfb2-shell.html?theme=${theme}`);
    const labels = page.locator(".compact-work-label");
    await expect(labels).toHaveText(["Working for 1d 3h 22m 8s", "Worked for 1d 3h 22m 8s"]);
    for (const [index, state] of ["running", "completed"].entries()) {
      const row = page.locator("[data-transcript-turn-work]").nth(index);
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport();
      await expect(row).toHaveCSS("opacity", "1");
      await row.screenshot({ path: evidence(`duration-${state}-${theme}.png`, testInfo.outputPath(`duration-${state}-${theme}.png`)) });
    }
    const toggles = page.locator("[data-transcript-turn-work] > button");
    await expect(toggles.first()).toHaveAttribute("aria-expanded", "false");
    await toggles.first().focus();
    await page.keyboard.press("Enter");
    await expect(toggles.first()).toHaveAttribute("aria-expanded", "true");
  });
}
