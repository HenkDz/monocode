import { expect, test } from "@playwright/test";
import { join } from "node:path";
const fixture = "/tests/browser/ccmap.html";
const frames = process.env.CCMAP_EVIDENCE!;
if (!frames) throw Error("CCMAP_EVIDENCE must name this run's durable capture directory");
const screenshot = (name: string) => join(frames, `${name}.png`);
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const [width, height] of [[1600, 950], [3432, 1308]]) {
  test(`approved prototype and connected map/project/details at ${width}x${height}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto("/__ccmap_prototype"); await page.screenshot({ path: screenshot(`prototype-map-${width}`) });
    await page.locator("#n-mc").click(); await page.waitForTimeout(800); await page.screenshot({ path: screenshot(`prototype-project-${width}`) });
    await page.goto(fixture);
    await expect(page.locator(".zoom-map-project")).toHaveCount(4);
    await expect(page.locator(".zoom-map-rail .decision-card")).toHaveCount(2);
    await page.screenshot({ path: screenshot(`map-${width}`) });
    await page.getByRole("button", { name: "Open monocode project", exact: true }).click();
    await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", "manager-2"); await page.waitForTimeout(800);
    await expect(page.locator(".zoom-map-team")).toContainText("×2");
    await expect(page.locator(".zoom-map-task")).toHaveCount(6);
    await expect(page.getByRole("textbox", { name: "Tell the CC Coordinator what you want" })).toBeEnabled();
    const reading = await page.locator(".zoom-map-world").evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a / 4);
    expect(reading).toBeGreaterThanOrEqual(.8); expect(reading).toBeLessThanOrEqual(1.2);
    const designWidth = await page.locator(".zoom-map-board-wrap:not([hidden])").evaluate(element => (element as HTMLElement).offsetWidth);
    expect(designWidth).toBeGreaterThanOrEqual(1000); expect(designWidth).toBeLessThanOrEqual(1800);
    if (width === 3432) expect(designWidth).toBe(1800);
    await page.screenshot({ path: screenshot(`project-${width}`) });
    await page.locator('[data-task="task-2-2"]').click();
    await expect(page.locator(".zoom-map-detail")).toContainText("Release gates + C7 build");
    await page.getByRole("button", { name: "Show work", exact: true }).click();
    await expect(page.locator(".zoom-map-detail")).toContainText("Recorded fixture model");
    await page.screenshot({ path: screenshot(`detail-${width}`) });
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("wheel approach/dive locks, stable partial zoom-out, interior pan and relative exit", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 }); await page.goto(fixture);
  const project = page.getByRole("button", { name: "Open monocode project", exact: true });
  await project.hover(); await page.mouse.wheel(0, -150);
  await expect(project).toHaveAttribute("data-approach", "true");
  await project.hover(); await page.mouse.wheel(0, -450);
  const viewport = page.locator(".zoom-map-viewport"), world = page.locator(".zoom-map-world");
  await expect(viewport).toHaveAttribute("data-focused", "manager-2");
  const fitted = await world.getAttribute("style"); await page.mouse.wheel(0, -700); await page.waitForTimeout(200); expect(await world.getAttribute("style")).toBe(fitted);
  await page.waitForTimeout(800);
  const box = (await viewport.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await page.mouse.wheel(0, 85); await page.waitForTimeout(100); const partial = await world.getAttribute("style"); expect(partial).not.toBe(fitted);
  await page.waitForTimeout(300); expect(await world.getAttribute("style")).toBe(partial); await expect(viewport).toHaveAttribute("data-focused", "manager-2");
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height - 45); await page.mouse.up(); expect(await world.getAttribute("style")).not.toBe(partial);
  await page.mouse.wheel(0, 400); await expect(viewport).toHaveAttribute("data-focused", "");
  const out = await world.getAttribute("style"); await page.mouse.wheel(0, -600); await page.waitForTimeout(150); expect(await world.getAttribute("style")).toBe(out);
});

test("one rail, selected outline, segment highlight and keyboard selection-before-exit", async ({ page }) => {
  await page.goto(fixture); const project = page.getByRole("button", { name: "Open monocode project", exact: true });
  await project.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  const segment = page.locator('.zoom-map-lane').first().locator('.zoom-map-segments > span[title^="Release gates"]');
  await segment.hover(); await expect(page.locator('[data-task="task-2-2"]')).toHaveAttribute("data-highlight", "true");
  await page.locator('[data-task="task-2-2"]').click(); await expect(page.locator('[data-task="task-2-2"]')).toHaveAttribute("data-selected", "true");
  await page.getByRole("button", { name: "Open goal →", exact: true }).first().click();
  await expect(page.locator('[data-task="task-2-2"]')).toHaveAttribute("data-selected", "false");
  await expect(page.locator(".zoom-map-detail")).toContainText("Ask me for");
  await page.keyboard.press("Escape"); await expect(page.locator(".zoom-map-detail")).toHaveCount(0); await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", "manager-2");
  await page.keyboard.press("Escape"); await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", ""); await expect(project).toBeFocused();
  expect(await page.locator(".zoom-map-rail").count()).toBe(1); expect(await page.locator("details").count()).toBe(0);
});

test("actual App Manager ordinary send retains exact text, draft on refusal and Boss request identity", async ({ page }) => {
  await page.goto(fixture);
  const boss = page.getByRole("textbox", { name: "Tell the Boss what you want" }); await boss.fill("Boss draft");
  await page.getByRole("button", { name: "Open monocode project", exact: true }).click();
  const manager = page.getByRole("textbox", { name: "Tell the CC Coordinator what you want" });
  await manager.fill("  Exact Manager request\nkeep source  "); await page.evaluate(() => window.ccmapFixture.refuse(true)); await manager.press("Enter");
  await expect(manager).toHaveValue("  Exact Manager request\nkeep source  "); await expect(page.getByRole("alert")).toContainText("not accepted");
  await page.evaluate(() => window.ccmapFixture.refuse(false)); await manager.press("Enter"); await expect(manager).toHaveValue("");
  expect(await page.evaluate(() => window.ccmapFixture.sends)).toEqual([{ sessionId: "manager-chat-2", text: "  Exact Manager request\nkeep source  ", attachments: [] }]);
  await page.getByRole("button", { name: "Show whole map" }).click(); await expect(boss).toHaveValue("Boss draft"); await boss.press("Enter");
  expect(await page.evaluate(() => window.ccmapFixture.bossGoals)).toMatchObject([{ ownerId: "boss", choice: { mode: "goal", override: "grand" } }]);
});

test("actual App rejects Manager archive during awaited preparation", async ({ page }) => {
  await page.goto(fixture); await page.getByRole("button", { name: "Open monocode project", exact: true }).click();
  await page.evaluate(() => window.ccmapFixture.hold());
  const manager = page.getByRole("textbox", { name: "Tell the CC Coordinator what you want" }); await manager.fill("Retain this request"); await manager.press("Enter");
  await expect(manager).toBeDisabled(); await page.evaluate(() => { window.ccmapFixture.archive("manager-2"); window.ccmapFixture.release(); });
  await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", "");
  expect(await page.evaluate(() => window.ccmapFixture.sends)).toEqual([]);
});

test("canonical decision zoom stays in place and preserves native click and exact ordinary answer text", async ({ page }) => {
  await page.goto(fixture);
  const card = page.getByRole("article", { name: "Support the legacy XLS invoice template?" });
  await card.getByRole("button", { name: "Open project" }).click();
  await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", "manager-1"); await page.waitForTimeout(800);
  await page.locator('[data-task="task-1-1"]').click();
  await expect(page.locator(".zoom-map-detail")).toHaveCount(0); await expect(card).toBeFocused();
  const choice = card.getByRole("button", { name: "CSV only, announce deprecation Recommended" });
  await choice.dispatchEvent("click"); await expect(card.getByRole("alert")).toContainText("Couldn't reach Nova");
  expect(await page.evaluate(() => window.ccmapFixture.sends)).toEqual([]);
  await choice.click();
  expect(await page.evaluate(() => window.ccmapFixture.sends)).toEqual([{ sessionId: "worker-1-1", text: 'Decision on your question "Support the legacy XLS invoice template?": go with "CSV only, announce deprecation".', attachments: [] }]);
});

test("ready task highlights existing merge card and opens existing confirmation without executing", async ({ page }) => {
  await page.goto(fixture); await page.getByRole("button", { name: "Open browser-link-4 project", exact: true }).click(); await page.waitForTimeout(800);
  await page.locator('[data-task="task-0-2"]').click();
  await expect(page.locator(".zoom-map-detail")).toHaveCount(0); await expect(page.locator(".zoom-map-merge")).toHaveAttribute("data-selected", "true");
  await page.locator('.zoom-map-lane .zoom-map-segments > span[title^="Fix 3 review comments"]').hover();
  await page.getByRole("heading", { name: "Command map", exact: true }).hover();
  await expect(page.locator('[data-task="task-0-2"]')).toHaveAttribute("data-selected", "true");
  await expect(page.locator('.zoom-map-merge')).toHaveCount(1);
  await page.screenshot({ path: screenshot("selected-after-hover") });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-task="task-0-2"]')).toHaveAttribute("data-selected", "false");
  await expect(page.locator('.zoom-map-viewport')).toHaveAttribute("data-focused", "manager-0");
  await page.locator('[data-task="task-0-2"]').click();
  await page.locator(".zoom-map-merge").getByRole("button", { name: "Merge pull request", exact: true }).click();
  await expect(page.getByText("Merge this pull request?", { exact: true })).toBeVisible();
  await page.screenshot({ path: screenshot("merge-confirmation") });
  await page.keyboard.press("Escape"); await expect(page.getByText("Merge this pull request?", { exact: true })).toHaveCount(0);
  await expect(page.locator('.zoom-map-viewport')).toHaveAttribute('data-focused', 'manager-0');
  expect(await page.evaluate(() => window.ccmapFixture.native.filter(command => command.includes("git_pr_action")))).toEqual([]);
});

test("actual App Escape never stops hidden busy work in composer, rail or body after pan, then cleans up", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 }); await page.goto(fixture);
  await page.getByRole("textbox", { name: "Tell the Boss what you want" }).press("Escape");
  await expect(page.locator('.zoom-map')).toHaveCount(1);
  await page.getByRole("button", { name: "Open monocode project", exact: true }).click(); await page.waitForTimeout(800);
  await page.locator('[data-task="task-2-2"]').click(); await page.getByRole('button', { name: 'Show work', exact: true }).click();
  const railField = page.getByRole('combobox', { name: 'Work attempt' }); await expect(railField).toBeVisible(); await railField.press("Escape");
  await expect(page.locator('.zoom-map-detail')).toHaveCount(1);
  await expect(page.locator('.zoom-map-viewport')).toHaveAttribute("data-focused", "manager-2");
  await page.getByRole('button', { name: '← Needs you', exact: true }).click();
  const viewport = page.locator('.zoom-map-viewport'), world = page.locator('.zoom-map-world'), before = await world.getAttribute('style'), box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height - 45); await page.mouse.up();
  expect(await world.getAttribute('style')).not.toBe(before);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Escape"); await expect(viewport).toHaveAttribute("data-focused", "");
  await page.waitForTimeout(30); expect(await page.evaluate(() => window.ccmapFixture.stops)).toEqual([]);
  await page.getByRole('button', { name: 'Close team map' }).click(); await expect(page.locator('.zoom-map')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect.poll(() => page.evaluate(() => window.ccmapFixture.stops)).toEqual(['worker-2-2']);
});

test("retained completed and cancelled goals do not become active lanes or summaries", async ({ page }) => {
  await page.goto(fixture);
  await page.evaluate(async () => {
    const { monoManagerGoals: ledger } = await import('/src/features/monos/model/monoManagerGoals.ts');
    const goal = ledger.goals('manager-2')[0];
    ledger.goals('manager-2').push({ ...goal, id: 'independent-done-history', title: 'Completed historical goal', state: 'done', createdAt: 1, updatedAt: 2 }, { ...goal, id: 'cancelled-history', title: 'Cancelled historical goal', state: 'cancelled', createdAt: 1, updatedAt: 2 });
    await ledger.recordDecision('manager-2', { ...ledger.decisions('manager-2')[0], id: 'independent-refresh', question: 'Independent synthetic refresh' });
  });
  await expect(page.locator('.zoom-map-goal-line').filter({ hasText: /Completed historical goal|Cancelled historical goal/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open monocode project', exact: true }).click(); await page.waitForTimeout(800);
  await expect(page.locator('.zoom-map-lane')).toHaveCount(2);
  await expect(page.locator('.zoom-map-lane[aria-label="Completed historical goal"]')).toHaveCount(0);
  await expect(page.locator('.zoom-map-lane[aria-label="Cancelled historical goal"]')).toHaveCount(0);
  await expect(page.locator('.zoom-map-finished')).toContainText('Done');
  await page.screenshot({ path: screenshot('completed-history') });
  await page.evaluate(async () => {
    const { monoManagerGoals: ledger } = await import('/src/features/monos/model/monoManagerGoals.ts');
    ledger.goals('manager-2').forEach(goal => { goal.state = 'done'; });
    await ledger.recordDecision('manager-2', { ...ledger.decisions('manager-2')[0], id: 'terminal-refresh' });
  });
  await expect(page.locator('.zoom-map-lane[aria-label="Calm navigation & summaries (CC-UX2)"]')).toHaveCount(0);
  await expect(page.locator('.zoom-map-lane[aria-label="Integrations: Composio (V4b)"]')).toHaveCount(0);
  await expect(page.locator('.zoom-map-lane[aria-label="Tasks without active goal"]')).toHaveCount(1);
  await expect(page.locator('.zoom-map-task')).toHaveCount(6);
  await expect(page.locator('.zoom-map-finished')).toContainText('Done');
  await page.screenshot({ path: screenshot('terminal-only-board') });
  await page.getByRole('button', { name: 'Show whole map' }).click();
  const summary = page.getByRole('button', { name: 'Open monocode project', exact: true });
  await expect(summary).toContainText('No active goal'); await expect(summary.locator('.zoom-map-goal-line')).toHaveCount(0);
  await page.screenshot({ path: screenshot('terminal-only-summary') });
});

for (const [width, theme, reduced] of [[390, "dark", false], [1600, "light", false], [1600, "dark", true]] as const) {
  test(`narrow/theme/reduced and keyboard ${width} ${theme} ${reduced}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 }); await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.goto(`${fixture}?theme=${theme}`); const project = page.getByRole("button", { name: "Open monocode project", exact: true }); await project.focus(); await page.keyboard.press("Enter");
    await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", "manager-2"); await page.waitForTimeout(reduced ? 100 : 800);
    if (reduced) {
      expect(await page.locator(".zoom-map-world").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
      expect(await page.locator(".zoom-map-board-wrap:not([hidden])").evaluate(element => getComputedStyle(element).animationName)).toBe("zoom-map-reveal");
    }
    if (width === 390) {
      expect(await page.locator(".zoom-map-viewport").evaluate(element => element.scrollLeft)).toBe(0);
      const goal = await page.locator('.zoom-map-goal').first().boundingBox(); expect(goal!.x).toBeGreaterThanOrEqual(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: screenshot(`project-${width}-${theme}-reduce-${reduced}`) });
    await page.keyboard.press("Escape"); await expect(project).toBeFocused(); await expect(page.locator(".zoom-map-viewport")).toHaveAttribute("data-focused", "");
    await page.keyboard.press("Tab"); expect(await page.locator(":focus").count()).toBe(1);
  });
}
