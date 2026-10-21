import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
const evidence = process.env.CCMAP_EVIDENCE!;
test.setTimeout(120000);
test("actual goal headings use exact linked title or neutral Goal for short, clipped and multiline prompts", async ({ page }) => {
  await page.goto("/tests/browser/ccmap.html?real=1");
  await page.getByRole("button", { name: "Open monocode project", exact: true }).click();
  await expect(page.locator('.zoom-map-lane[aria-label="Browser profile routing"]')).toHaveCount(1);
  for (const raw of ["and complete the already authorized migration", "...e and complete the already authorized migration", "Migration details\nRAW_MULTILINE_SENTINEL"]) {
    await page.evaluate(async raw => {
      const { monoManagerGoals } = await import("/src/features/monos/model/monoManagerGoals.ts");
      const goal = monoManagerGoals.goals().find((goal: any) => goal.id === "goal-2-1")!;
      goal.title = raw;
      (window as any).ccmapFixture.renameTitle("Refresh actual goal header");
    }, raw);
    await expect(page.locator('.zoom-map-lane[aria-label="Goal"] h3')).toHaveText("Goal");
    await expect(page.locator('.zoom-map-board')).not.toContainText(raw.split("\n")[0]);
    await expect(page.locator('.zoom-map-lane[aria-label="Browser profile routing"]')).toHaveCount(1);
  }
  await page.screenshot({ path: `${evidence}/neutral-goal-heading.png` });
});
for (const [width, height] of [[800, 950], [1600, 950], [1710, 1390], [3432, 1308]]) {
  test(`actual sidebar width, readable fit and tall reachability ${width}x${height}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.goto("/tests/browser/ccmap.html?real=1");
    await page.evaluate(() => {
      const root = document.getElementById("root")!;
      Object.assign(root.style, { position: "relative", inset: "auto", width: "auto", height: "calc(100vh - 40px)", marginLeft: "260px", marginTop: "40px" });
      const sidebar = document.createElement("aside"); sidebar.dataset.shellSidebar = "true"; sidebar.textContent = "Workspace";
      Object.assign(sidebar.style, { position: "fixed", left: "0", top: "40px", width: "260px", height: "calc(100vh - 40px)", padding: "20px", background: "#202020", color: "white" }); document.body.append(sidebar);
    });
    await page.getByRole("button", { name: "Open monocode project", exact: true }).click();
    await expect(page.locator('.zoom-map-mono')).toHaveCount(8);
    await page.waitForTimeout(1000);
    const geometry = async () => page.locator('.zoom-map-board').evaluate(board => {
      const viewport = document.querySelector<HTMLElement>('.zoom-map-viewport')!, map = document.querySelector('.zoom-map')!;
      const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const reading = new DOMMatrix(getComputedStyle(document.querySelector('.zoom-map-world')!).transform).a / 4;
      return { viewport: rect(viewport), board: rect(board), map: rect(map), sidebar: rect(document.querySelector('[data-shell-sidebar]')!), rail: rect(document.querySelector('.zoom-map-rail')!),
        children: [...board.querySelectorAll('.zoom-map-mono, .zoom-map-lane, .zoom-map-task, .zoom-map-finished')].map(rect), reading,
        labels: [...board.querySelectorAll<HTMLElement>('.zoom-map-title')].map(element => ({ text: element.textContent, effectiveFont: parseFloat(getComputedStyle(element).fontSize) * reading })),
        scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight, scrollTop: viewport.scrollTop };
    });
    const initial = await geometry();
    expect(initial.sidebar.width).toBe(260); expect(initial.map.left).toBeGreaterThanOrEqual(260); expect(initial.map.width).toBeLessThanOrEqual(width - 260);
    expect(initial.reading).toBeGreaterThanOrEqual(.8 - .001);
    for (const label of initial.labels) expect(label.effectiveFont).toBeGreaterThanOrEqual(9.6 - .01);
    for (const row of initial.children) { expect(row.left).toBeGreaterThanOrEqual(initial.viewport.left - 1); expect(row.right).toBeLessThanOrEqual(initial.viewport.right + 1); }
    if (width === 800) expect(initial.rail.top).toBeGreaterThanOrEqual(initial.map.top + 560);
    const field = page.getByRole('textbox', { name: 'Tell the CC Coordinator what you want' });
    expect((await field.boundingBox())!.width).toBeGreaterThan(140);
    await page.screenshot({ path: `${evidence}/sidebar-readable-${width}.png` });
    writeFileSync(`${evidence}/sidebar-readable-${width}.json`, JSON.stringify(initial, null, 2));
    await page.evaluate(() => (window as any).ccmapFixture.arrive()); await expect(page.locator('.zoom-map-task')).toHaveCount(26); await page.waitForTimeout(1000);
    const tall = await geometry(); expect(tall.reading).toBeGreaterThanOrEqual(.8 - .001); expect(tall.scrollHeight).toBeGreaterThan(tall.clientHeight);
    for (const row of tall.children) { expect(row.left).toBeGreaterThanOrEqual(tall.viewport.left - 1); expect(row.right).toBeLessThanOrEqual(tall.viewport.right + 1); }
    await page.locator('.zoom-map-finished').scrollIntoViewIfNeeded(); expect((await geometry()).scrollTop).toBeGreaterThan(0);
    await expect(page.locator('.zoom-map-finished')).toBeVisible();
    await page.screenshot({ path: `${evidence}/sidebar-tall-${width}.png` });
    writeFileSync(`${evidence}/sidebar-tall-${width}.json`, JSON.stringify(await geometry(), null, 2));
    expect(errors).toEqual([]);
  });
}
