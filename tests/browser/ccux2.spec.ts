import { expect, test } from "@playwright/test";
import type { AppRoutes } from "virtual:ccux2-app";
import type { Session } from "../../src/features/sessions/model/session";
import type { WorkspaceTab } from "../../src/features/workspace/model/layout";
declare global { interface Window { ccux2: { routes: AppRoutes; sessions: Session[]; tabs: WorkspaceTab[]; events: { action: string; value?: unknown }[]; zoom(value: number): Promise<number> } } }
const captures = "../cc-program/ccux2/evidence/captures";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Win32" }));
});
test("actual App navigation keeps worker identity, real sessions, worktree selection and one reusable page tab", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/ccux2.html');
  await expect(page.locator('[data-current-view]')).toHaveText('Latest discussion');
  const initial = await page.evaluate(() => ({ sessions: window.ccux2.sessions.map(row => [row.id, row.providerSessionId]), tabs: window.ccux2.tabs.map(row => row.id) }));
  await page.getByRole('button', { name: 'Open current assignment', exact: true }).click();
  await expect(page.locator('[data-current-view]')).toHaveText('Chooser focus');
  await expect(page.locator('[data-title-tab-active]')).toHaveAttribute('aria-label', 'Atlas');
  await expect(page.locator('[data-title-tab-active]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open previous assignment', exact: true }).click();
  await expect(page.locator('[data-current-view]')).toHaveText('Earlier chooser review');
  await expect(page.locator('[data-title-tab-active]')).toHaveAttribute('aria-label', 'Atlas');
  await page.getByRole('button', { name: 'Tasks and history', exact: true }).click();
  await expect(page.locator('[data-current-view]')).toHaveText('Atlas');
  for (const label of ['Command map', 'Decisions', 'Integrations', 'Usage', 'Inbox', 'Notes', 'Automations', 'Search']) {
    await page.locator('aside').first().getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('[data-title-tab-active]')).toHaveAttribute('aria-label', label);
    await expect(page.locator('[data-context-panel]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Panel', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.ccux2.routes.readTitle().title.tabs?.filter(tab => tab.id === 'shell-page:reusable').length)).toBe(1);
  }
  await page.getByRole('button', { name: 'Worktree empty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'empty', exact: true })).toBeVisible();
  await expect(page.getByText('No conversations here yet')).toBeVisible();
  expect(await page.evaluate(() => window.ccux2.events.filter(event => event.action === 'new-chat'))).toEqual([]);
  await page.getByRole('button', { name: 'Worktree feature', exact: true }).click();
  await expect(page.locator('[data-current-view]')).toHaveText('Permission conversation');
  expect(await page.evaluate(() => window.ccux2.sessions.map(row => [row.id, row.providerSessionId]))).toEqual(initial.sessions);
  expect(await page.evaluate(ids => ids.every(id => window.ccux2.tabs.some(tab => tab.id === id)), initial.tabs)).toBe(true);
  await page.getByRole('button', { name: 'Worktree empty', exact: true }).click();
  await page.locator('main').getByRole('button', { name: 'New chat here', exact: true }).click();
  expect(await page.evaluate(() => window.ccux2.events.filter(event => event.action === 'new-chat').length)).toBe(1);
  expect(errors).toEqual([]);
});
test("canonical Decisions count preserves distinct verbatim approvals and real action routing", async ({ page }) => {
  await page.goto('/tests/browser/ccux2.html');
  await page.locator('aside').first().getByRole('button', { name: 'Decisions', exact: true }).click();
  await expect(page.locator('.decisions-heading')).toContainText('2 need you');
  await expect(page.locator('[data-attention-source="approval"]')).toHaveCount(2);
  const cards = page.locator('[data-attention-source="approval"]');
  for (const card of await cards.all()) {
    await card.getByRole('button', { name: /evidence/ }).click();
    await expect(page.getByText('git show 0123456789abcdef0123456789abcdef01234567', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await cards.first().getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.locator('.decisions-heading')).toContainText('1 need you');
  expect(await page.evaluate(() => window.ccux2.events.filter(event => event.action === 'approval'))).toEqual([{ action: 'approval', value: { id: 'permission', requestId: 1, decision: 'allow' } }]);
  await page.getByRole('button', { name: 'Decision log', exact: true }).click();
  await expect(page.getByText('No decisions yet', { exact: true })).toBeVisible();
});
test("one Run menu keeps confirmation, cancellation and exact checkout command", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/tests/browser/ccux2.html');
  const panel = page.locator('[data-context-panel]');
  await panel.getByRole('button', { name: 'Run ▾', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(3);
  expect(await page.getByRole('menuitem').allTextContents()).toEqual(['Run appnpm run dev', 'Run testsnpm run test', 'lintnpm run lint']);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('menuitem', { name: /Run tests/ }).click();
  expect(await page.evaluate(() => window.ccux2.events.filter(event => event.action === 'terminal'))).toEqual([]);
  await panel.getByRole('button', { name: 'Run ▾', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: /Run tests/ }).click();
  await expect.poll(() => page.evaluate(() => window.ccux2.events.filter(event => event.action === 'terminal'))).toEqual([{ action: 'terminal', value: { cwd: 'C:/synthetic/Chooser/feature', command: 'npm run test' } }]);
});
for (const [width, theme, zoom] of [[1600, 'dark', 1], [1024, 'light', 1], [480, 'dark', 1], [1600, 'light', 2]] as const) {
  test(`production shell frames and reachable window corners ${width} ${theme} ${zoom * 100}%`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/tests/browser/ccux2.html?theme=${theme}`);
    await expect(page.locator('[data-current-view]')).toBeVisible();
    if (zoom !== 1) await page.evaluate(value => window.ccux2.zoom(value), zoom);
    for (const route of ['conversation', 'Decisions', 'Command map']) {
      if (route !== 'conversation') await page.locator('aside').first().getByRole('button', { name: route, exact: true }).click();
      for (const name of ['Minimize window', 'Maximize window', 'Close window']) {
        const button = page.getByRole('button', { name, exact: true });
        await expect(button).toBeInViewport();
        expect(await button.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
      }
      const corner = (await page.getByRole('button', { name: 'Close window', exact: true }).boundingBox())!;
      expect(corner.y).toBe(0); expect(Math.round(corner.x + corner.width)).toBe(width);
      await page.screenshot({ path: `${captures}/${route}-${width}-${theme}-${zoom}.png` });
    }
  });
}
