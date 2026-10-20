import { expect, test } from "@playwright/test";
import { join } from "node:path";

test("real shared Continue is goal-scoped across Manager, goal and Decisions; synthetic click is refused", async ({ page }) => {
  await page.goto("/");
  const buttons = page.locator(".command-map-drawer").getByRole("button", { name: "Manager paused — Continue", exact: true });
  await expect(buttons).toHaveCount(3); // Manager header, selected goal and project Decisions.
  await buttons.nth(1).dispatchEvent("click");
  expect(await page.evaluate(() => window.goalFixture.continued)).toEqual([]);
  await buttons.nth(1).dblclick();
  await expect.poll(() => page.evaluate(() => window.goalFixture.continued)).toEqual(["engine"]);
  await buttons.last().click();
  expect(await page.evaluate(() => window.goalFixture.continued)).toEqual(["engine"]);
});

test("Open navigates to the actual approval conversation without Continue", async ({ page }) => {
  await page.goto("/?mode=approval");
  const open = page.locator(".command-map-drawer").getByRole("button", { name: "Waiting for your approval — Open", exact: true });
  await expect(open).toHaveCount(3);
  await open.nth(1).click();
  expect(await page.evaluate(() => window.goalFixture.opened)).toEqual(["chat"]);
  expect(await page.evaluate(() => window.goalFixture.continued)).toEqual([]);
});

test("keeps raw task work behind the custom fold and opens retained info without acknowledging it", async ({ page }) => {
  await page.goto("/?mode=info");
  await expect(page.getByText("RAW PROMPT:", { exact: false })).toHaveCount(0);
  await expect(page.getByText("RAW REPORT:", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: /^Show work/ }).first().click();
  await expect(page.locator(".command-map-brief")).toContainText("RAW PROMPT:");
  await page.getByRole("button", { name: "Has an update for you", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manager updates", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByText("RAW UPDATE:", { exact: false })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Show work", exact: true })).toContainText("RAW UPDATE:");
  expect(await page.evaluate(() => window.goalFixture.continued)).toEqual([]);
});

test("Ask me for stays a clean stack in dark/light narrow/wide frames", async ({ page }) => {
  for (const theme of ["dark", "light"]) for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`/?theme=${theme}`);
    const control = page.locator(".command-map-drawer .decision-autonomy");
    await expect(control).toBeVisible();
    await expect(control).toContainText("You'll still approve merges, installs and deletes.");
    expect(await page.locator(".command-map-drawer > header svg").evaluate(element => element.getBoundingClientRect().width)).toBe(32);
    const boxes = await control.locator("button").evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; }));
    expect(boxes).toHaveLength(3); expect(new Set(boxes.map(box => box.y)).size).toBe(3);
    expect(new Set(boxes.map(box => box.width)).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(process.env.CCUX1_GOALS_EVIDENCE!, `${theme}-${width}.png`), fullPage: true });
  }
});
