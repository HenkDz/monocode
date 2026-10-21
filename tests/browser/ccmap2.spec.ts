import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const fixture = "/tests/browser/ccmap.html?real=1";
const evidence = process.env.CCMAP_EVIDENCE!;
if (!evidence) throw Error("CCMAP_EVIDENCE must name this run's durable capture directory");
const bounds = (page: Page) => page.locator('.zoom-map-board').evaluate(board => {
  const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const viewport = document.querySelector('.zoom-map-viewport') as HTMLElement;
  return { board: rect(board), viewport: rect(viewport), rows: [...board.children].map(rect), scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight, scrollTop: viewport.scrollTop };
});
async function fitted(page: Page) {
  await expect.poll(async () => {
    const geometry = await bounds(page);
    return geometry.rows.every(row => row.x >= geometry.viewport.x - 1 && row.right <= geometry.viewport.right + 1);
  }).toBe(true);
  await page.waitForTimeout(800);
  const geometry = await bounds(page);
  for (const row of geometry.rows) {
    expect(row.x).toBeGreaterThanOrEqual(geometry.viewport.x - 1);
    expect(row.right).toBeLessThanOrEqual(geometry.viewport.right + 1);
  }
  return geometry;
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const [width, height] of [[1600, 950], [1710, 1390], [3432, 1308]]) {
  test(`real rendered rows fit, resize and arrivals refit at ${width}x${height}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height }); await page.goto(fixture);
    await page.getByRole('button', { name: 'Open monocode project', exact: true }).click();
    await expect(page.locator('.zoom-map-mono')).toHaveCount(8);
    await expect(page.locator('.zoom-map-lane')).toHaveCount(2);
    const initial = await fitted(page);
    writeFileSync(join(evidence, `geometry-${width}.json`), JSON.stringify(initial, null, 2));
    await expect(page.locator('.zoom-map-lane[aria-label="Connector contract"]')).toHaveCount(1);
    await expect(page.locator('.zoom-map-lane[aria-label="Browser profile routing"]')).toHaveCount(1);
    await expect(page.locator('.zoom-map-board')).not.toContainText(/RAW_MULTILINE_SENTINEL|UNRELATED_TITLE_SENTINEL|already authorized/);
    await expect(page.locator('.zoom-map-done-chip')).toHaveCount(4);
    await expect(page.locator('.zoom-map-finished .zoom-map-task')).toHaveCount(0);
    await expect(page.locator('.zoom-map-finished')).toContainText('Failed');
    await expect(page.locator('.zoom-map-finished')).toContainText('Cancelled');
    await expect(page.getByRole('button', { name: '+13 more', exact: true })).toBeVisible();
    await expect(page.locator('.zoom-map-rail .aq-filters')).toHaveCount(0);
    await expect(page.locator('.zoom-map-top nav')).toHaveText('Map/ monocode⋯');
    await expect(page.locator('.zoom-map-you-inline')).toBeVisible();
    const composer = page.locator('.command-map-ask > div');
    expect((await composer.boundingBox())!.height).toBeLessThan(55);
    const field = page.getByRole('textbox', { name: 'Tell the CC Coordinator what you want' });
    await field.fill('Line one\nLine two\nLine three');
    expect((await composer.boundingBox())!.height).toBeGreaterThan(60); await field.fill('');
    expect((await composer.boundingBox())!.height).toBeLessThan(55);
    const card = page.locator('[data-task="task-2-2"]');
    const fullTitle = await card.locator('.zoom-map-title').getAttribute('title');
    const display = await card.locator('.zoom-map-title').textContent();
    expect(display).toMatch(/…$/); expect(fullTitle!.startsWith(display!.slice(0, -1))).toBe(true);
    expect(fullTitle![display!.length - 1]).toBe(' ');
    expect(await card.locator('.zoom-map-title').evaluate(element => element.getBoundingClientRect().height / (new DOMMatrix(getComputedStyle(document.querySelector('.zoom-map-world')!).transform).a / 4))).toBeLessThanOrEqual(36.1);
    await card.focus(); await expect(page.getByRole('tooltip')).toHaveText(fullTitle!);
    await page.getByRole('button', { name: 'Map options' }).focus();
    await page.screenshot({ path: join(evidence, `real-project-${width}.png`) });
    await page.getByRole('button', { name: '+13 more', exact: true }).click();
    await expect(page.locator('.zoom-map-done-chip')).toHaveCount(17); await fitted(page);
    await page.locator('[data-task="terminal-14"]').click();
    await expect(page.locator('.zoom-map-detail')).toContainText('Saved change 14');
    await page.getByRole('button', { name: 'Show work', exact: true }).click();
    await expect(page.locator('.zoom-map-detail')).toContainText('Task terminal-14');
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Show less', exact: true }).click();
    await fitted(page);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const manual = await page.locator('.zoom-map-world').getAttribute('style');
    await page.evaluate(() => window.ccmapFixture.arrive());
    await expect(page.locator('.zoom-map-task')).toHaveCount(26);
    await fitted(page); expect(await page.locator('.zoom-map-world').getAttribute('style')).not.toBe(manual);
    const tall = await bounds(page); expect(tall.scrollHeight).toBeGreaterThan(tall.clientHeight);
    await page.locator('.zoom-map-finished').scrollIntoViewIfNeeded();
    expect((await bounds(page)).scrollTop).toBeGreaterThan(0);
    await expect(page.locator('.zoom-map-finished')).toBeVisible();
    await page.setViewportSize({ width: width === 3432 ? 1710 : 1350, height });
    const resized = await fitted(page); expect(resized.scrollTop).toBe(0);
    writeFileSync(join(evidence, `geometry-resize-content-${width}.json`), JSON.stringify(resized, null, 2));
    await page.screenshot({ path: join(evidence, `real-arrivals-resize-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test('legacy default migrates once, accessible Classic choice and Map survive reload', async ({ page }) => {
  await page.goto(`${fixture}&legacy=tree&persist=1`);
  await expect(page.locator('.zoom-map')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('monocode:team-map-orbit')!))).toMatchObject({ mapView: 'map', view: 'tree', focus: 'manager-2', order: ['manager-0', 'manager-1', 'manager-2', 'manager-3'] });
  await page.getByRole('button', { name: 'Map options' }).click();
  await page.getByRole('menuitem', { name: 'Classic view' }).focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Close team map' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Map options' })).toBeFocused();
  await page.getByRole('button', { name: 'Map options' }).click(); await page.getByRole('menuitem', { name: 'Classic view' }).click();
  await expect(page.locator('.zoom-map')).toHaveCount(0); await page.reload(); await expect(page.locator('.zoom-map')).toHaveCount(0);
  await page.getByRole('button', { name: 'Map', exact: true }).click(); await page.reload(); await expect(page.locator('.zoom-map')).toHaveCount(1);
});
