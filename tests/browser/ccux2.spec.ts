import { expect, test } from "@playwright/test";
import type { AppRoutes } from "virtual:ccux2-app";
import type { Session } from "../../src/features/sessions/model/session";
import type { WorkspaceTab } from "../../src/features/workspace/model/layout";
declare global { interface Window {
  ccux2: { routes: AppRoutes; sessions: Session[]; tabs: WorkspaceTab[]; events: { action: string; value?: unknown }[]; zoom(value: number): Promise<number> };
  ccwb1: { events: { action: string; id?: string; text?: string; options?: { followUpBehavior?: string }; behavior?: string }[] };
} }
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
  await expect(page.locator('main').getByRole('heading', { name: 'empty', exact: true })).toBeVisible();
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
    await card.getByRole('button', { name: 'Evidence', exact: true }).click();
    await expect(page.getByText('git show 0123456789abcdef0123456789abcdef01234567', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await cards.first().getByRole('button', { name: 'Allow once', exact: true }).click();
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
test("approval-first canonical projection agrees across sidebar, badge, header and cards with a retained Manager request", async ({ page }) => {
  for (const priority of ['active', 'paused']) {
    await page.goto(`/tests/browser/ccux2.html?priority=${priority}`);
    const sidebar = page.locator('aside').first().getByRole('button', { name: 'Decisions', exact: true });
    await expect(sidebar.locator('span[aria-hidden]')).toHaveText('2');
    await sidebar.click();
    await expect(page.locator('.decisions-heading')).toContainText('2 need you');
    await expect(page.locator('.decision-card')).toHaveCount(1);
    await expect(page.locator('[data-attention-status="open"]')).toHaveCount(1);
    await expect(page.locator('[data-attention-status="open"]')).toHaveAttribute('data-attention-source', 'approval');
    await expect(page.getByRole('button', { name: /Continue this request|Continue Manager/ })).toHaveCount(0);
    await expect(page.getByText('Which review path should we take?', { exact: true })).toBeVisible();
  }
});
test("production coordination details, grouped member feed, usage and custom folds stay calm", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/tests/browser/ccux2.html?surface=details');
  const goals = page.getByRole('tabpanel', { name: 'Goal & tasks', exact: true });
  await expect(goals.getByRole('button', { name: 'Show details', exact: true })).toHaveCount(1);
  const goalTitle = goals.locator('p.truncate.font-medium');
  expect((await goalTitle.innerText()).length).toBeLessThanOrEqual(60);
  await goals.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(goals.getByRole('button', { name: 'Copy commit 0123456', exact: true })).toHaveAttribute('title', '0123456789abcdef0123456789abcdef01234567');
  await expect(page.locator('[data-team-message="manager"]')).not.toContainText('11111111-2222-3333-4444-555555555555');
  const feed = page.locator('main li').filter({ hasText: 'Atlas · 3 updates' });
  await expect(feed).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText('Unrelated member message');
  await feed.getByRole('button', { name: /Show work/ }).click();
  await expect(feed.getByRole('link', { name: 'Review notes' })).toHaveCount(3);
  await expect(feed.getByRole('link', { name: 'Review notes' }).first()).toHaveAttribute('href', 'https://example.com/review');
  await expect(page.locator('main [data-task-metrics]')).toContainText('Usage');
  await expect(page.locator('main [data-task-metrics] span[title]')).toHaveAttribute('title', '1,240 in / 240 out tokens');
  await expect(page.locator('main details, main summary')).toHaveCount(0);
  const work = page.locator('[data-transcript-turn-work] > button');
  await expect(work).toContainText('Worked for 14m');
  await expect(work).not.toContainText('failed');
  await work.click();
  await expect(page.locator('[data-transcript-work-details]')).toContainText('Temporary command failure');
  await page.screenshot({ path: `${captures}/coordination-details-1600-dark.png` });
});
test("project picker stays opaque and tree project opens the approved drawer with focus return", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/tests/browser/ccux2.html?theme=light');
  const picker = page.getByRole('button', { name: /^Switch project/ });
  await picker.click();
  await expect(picker).not.toHaveAttribute('title');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox')).toBeVisible();
  expect(await dialog.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: `${captures}/opaque-picker-1024-light.png` });
  await page.keyboard.press('Escape');
  await page.locator('aside').first().getByRole('button', { name: 'Command map', exact: true }).click();
  const tree = page.getByRole('button', { name: 'Tree', exact: true });
  if (await tree.count()) await tree.click();
  const project = page.getByRole('button', { name: 'Focus Chooser team', exact: true });
  await project.click();
  const drawer = page.getByRole('dialog', { name: 'Chooser', exact: true });
  await expect(drawer).toBeVisible();
  for (const title of ['Current goal', 'This project decides', 'Waiting decisions', 'Team & tasks']) await expect(drawer.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Show work/ })).toHaveCount(1);
  await page.screenshot({ path: `${captures}/tree-project-drawer-1024-light.png` });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Team map', exact: true })).toBeVisible();
  await expect(project).toBeFocused();
});
test("worker page close and restored tabs keep history accessible without accumulating task slots", async ({ page }) => {
  await page.goto('/tests/browser/ccux2.html');
  const before = await page.evaluate(() => window.ccux2.tabs.length);
  for (let index = 0; index < 6; index++) {
    await page.getByRole('button', { name: 'Open current assignment', exact: true }).click();
    await page.getByRole('button', { name: 'Open previous assignment', exact: true }).click();
  }
  expect(await page.evaluate(() => window.ccux2.tabs.length)).toBe(before);
  await page.evaluate(() => window.ccux2.routes.onCloseMonoTab('atlas'));
  expect(await page.evaluate(() => {
    const task = window.ccux2.tabs.find(tab => tab.focusedId === 'past-task');
    return !!task && window.ccux2.routes.readTitle().title.tabs.some(tab => tab.id === task.id);
  })).toBe(true);
  expect(await page.evaluate(() => window.ccux2.sessions.find(session => session.id === 'task')?.providerSessionId)).toBe('retained-task');
  await page.goto('/tests/browser/ccux2.html?restored=true');
  expect(await page.evaluate(() => {
    const task = window.ccux2.tabs.find(tab => tab.focusedId === 'task');
    return !!task && window.ccux2.routes.readTitle().title.tabs.some(tab => tab.id === task.id);
  })).toBe(true);
  await page.getByRole('button', { name: 'Open current assignment', exact: true }).click();
  await expect(page.locator('[data-title-tab-active]')).toHaveAttribute('aria-label', 'Atlas');
});
test("real inset Settings header portals search and Appearance restore alongside reusable and work tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/tests/browser/ccux2.html');
  await page.locator('aside').first().getByRole('button', { name: 'Decisions', exact: true }).click();
  await page.locator('aside').first().getByRole('button', { name: 'Settings', exact: true }).click();
  const header = page.locator('header').first();
  await expect(header.getByRole('button', { name: 'Restore defaults', exact: true })).toBeVisible();
  await expect(header.getByRole('combobox', { name: 'Search settings', exact: true })).toBeVisible();
  await expect(page.locator('[data-context-panel]')).toHaveCount(0);
  expect(await page.evaluate(() => window.ccux2.routes.readTitle().title.tabs.some(tab => tab.id === 'shell-page:reusable'))).toBe(true);
  await header.getByRole('combobox', { name: 'Search settings', exact: true }).fill('font');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${captures}/settings-header-1600-dark.png` });
});
test("real SessionPane routes task approval, Queue, Steer and Stop to the worker and preserves its home", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/ccwb1-workbench.html?state=approval');
  const header = page.locator('[data-workbench-header]:visible');
  await expect(header).toBeVisible();
  await header.getByRole('button', { name: 'View live', exact: true }).click();
  await expect(page.locator('[data-view]')).toContainText('task-session');
  await expect(page.getByLabel('Command awaiting approval', { exact: true })).toHaveText("printf 'verbatim approval'");
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(await page.evaluate(() => window.ccwb1.events)).toContainEqual({ action: 'stop', id: 'task-session' });
  await header.getByRole('button', { name: 'Iris · Tasks & history', exact: true }).click();
  await expect(page.locator('[data-view]')).toContainText('iris-home');
  await page.goto('/tests/browser/ccwb1-workbench.html');
  await page.locator('[data-workbench-header]:visible').getByRole('button', { name: 'View live', exact: true }).click();
  const delivery = page.getByRole('group', { name: 'Message delivery' });
  const input = page.locator('[data-session-composer] textarea:visible');
  await input.fill('Check the new evidence');
  for (const mode of ['Queue', 'Steer']) {
    await delivery.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    expect(await page.evaluate(() => window.ccwb1.events)).toContainEqual(expect.objectContaining({ action: 'submit', id: 'task-session', text: 'Check the new evidence', behavior: mode.toLowerCase(), options: expect.objectContaining({ followUpBehavior: mode.toLowerCase() }) }));
  }
  await page.screenshot({ path: `${captures}/real-session-pane-task-1600-dark.png` });
  expect(errors).toEqual([]);
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
