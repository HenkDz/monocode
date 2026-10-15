import { expect, test } from "@playwright/test";
import { join } from "node:path";

const evidence = (name: string, fallback: string) => process.env.CCFB2_EVIDENCE ? join(process.env.CCFB2_EVIDENCE, name) : fallback;

for (const theme of ["dark", "light"]) {
  for (const layout of [
    { name: "regular", width: 1280, height: 800, maximized: false },
    { name: "maximized", width: 1600, height: 1000, maximized: true },
    { name: "narrow", width: 480, height: 720, maximized: false },
  ]) {
    test(`source-selected window chrome in ${theme} ${layout.name}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Win32" }));
      await page.setViewportSize({ width: layout.width, height: layout.height });
      for (const mono of [false, true]) {
        await page.goto(`/tests/browser/ccfb2-shell.html?theme=${theme}&maximized=${layout.maximized}&mono=${mono}`);
        const check = async (destination: string) => {
          const min = page.getByRole("button", { name: "Minimize window", exact: true });
          const max = page.getByRole("button", { name: layout.maximized ? "Restore window" : "Maximize window", exact: true });
          const close = page.getByRole("button", { name: "Close window", exact: true });
          for (const control of [min, max, close]) {
            await expect(control).toHaveCount(1);
            await expect(control).toBeInViewport();
            await expect(control).toHaveAttribute("data-tauri-drag-region", "false");
            expect(await control.evaluate(button => {
              const rect = button.getBoundingClientRect();
              return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") === button;
            })).toBe(true);
          }
          const header = min.locator("xpath=ancestor::header[1]");
          await expect(header).toHaveAttribute("data-tauri-drag-region", "deep");
          const headerBounds = (await header.boundingBox())!;
          const contentBounds = (await page.locator("[data-page-content]").boundingBox())!;
          expect(contentBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
          await expect(page.locator("[data-workspace-content]")).toHaveAttribute("inert", "");
          if (!mono || destination === "mission-control") {
            const name = `chrome-${destination}-${mono ? "mono-" : ""}${theme}-${layout.name}.png`;
            await page.screenshot({ path: evidence(name, testInfo.outputPath(name)), clip: { x: 0, y: 0, width: layout.width, height: 320 } });
          }
          const before = await page.evaluate(() => (window as unknown as { ccfb2NativeCalls: string[] }).ccfb2NativeCalls.length);
          await min.focus();
          await page.keyboard.press("Enter");
          await max.click();
          const opposite = page.getByRole("button", { name: layout.maximized ? "Maximize window" : "Restore window", exact: true });
          await expect(opposite).toBeVisible();
          await opposite.click();
          await close.focus();
          await page.keyboard.press("Space");
          expect(await page.evaluate(start => (window as unknown as { ccfb2NativeCalls: string[] }).ccfb2NativeCalls.slice(start), before)).toEqual([
            "plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|toggle_maximize", "plugin:window|close",
          ]);
        };
        for (const [label, destination] of [["Mission control", "mission-control"], ["Usage", "usage"], ["Attention queue", "attention"], ["Team map", "map-tree"]]) {
          await page.getByRole("button", { name: label, exact: true }).click();
          await check(destination);
          if (destination === "map-tree") {
            await page.getByRole("button", { name: "Orbit", exact: true }).click();
            await check("map-orbit");
            await page.getByRole("button", { name: "Tree", exact: true }).click();
            await page.getByRole("button", { name: "Close team map", exact: true }).press("Enter");
          } else if (destination === "usage") {
            await page.getByRole("button", { name: "Back to conversation", exact: true }).press("Enter");
          } else {
            await page.keyboard.press("Escape");
          }
          await expect(page.locator("[data-workspace-content]")).not.toHaveAttribute("inert", "");
          await expect(page.getByRole("button", { name: "Minimize window", exact: true })).toHaveCount(1);
        }
      }
      expect(errors).toEqual([]);
    });
  }

  test(`preserves Mac compact chrome in ${theme}`, async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "MacIntel" }));
    await page.goto(`/tests/browser/ccfb2-shell.html?theme=${theme}&compact=true`);
    await expect(page.locator("[data-compact-title-nav]")).toBeVisible();
    for (const label of ["Mission control", "Usage", "Attention queue", "Team map"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("button", { name: /^(Minimize|Maximize|Restore|Close) window$/ })).toHaveCount(0);
      await expect(page.locator("[data-workspace-content]")).toHaveAttribute("inert", "");
    }
  });
}

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
