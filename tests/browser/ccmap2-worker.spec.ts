import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const evidence = process.env.CCMAP_EVIDENCE ?? "target/ccmap2-worker";
mkdirSync(evidence, { recursive: true });
test.setTimeout(120000);
const fixture = async (page: Page) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/tests/browser/ccmap2-worker.html");
  await expect(page.getByRole("button", { name: "Sidebar Vale" })).toBeVisible();
  await expect(page.getByLabel("Project and worktree", { exact: true })).toHaveCount(1);
  return errors;
};
const open = (page: Page, taskId: string, sessionId?: string, owner = "worker") => page.evaluate(async ({ owner, taskId, sessionId }) => { await (window as any).ccmap2Worker.open(owner, { taskId, sessionId }); }, { owner, taskId, sessionId });
const selected = async (page: Page, sessionId: string, owner = "worker") => {
  await expect(page.locator(`[data-worker-conversation="${sessionId}"]:visible [data-session-drop="${sessionId}"]`)).toBeVisible();
  const state = await page.evaluate(() => (window as any).ccmap2Worker.state());
  expect(state.mono).toBe(`${owner}-home`); expect(state.active).toBe(sessionId); expect(state.tabs).toHaveLength(1);
  expect(state.monoTabs.filter((id: string) => id === owner)).toHaveLength(1);
  const events = await page.evaluate(() => (window as any).ccmap2Worker.events);
  expect(events.filter((event: any) => ["sidebar", "project", "worktree", "project-addition", "append-tab", "activate-tab", "focus-workspace", "persist"].includes(event.action))).toEqual([]);
  await expect(page.locator("[data-workbench-header]:visible")).toHaveCount(1);
  await expect(page.locator(".ccwb1-view-identity:visible")).toHaveCount(0);
  await expect(page.getByLabel("Project and worktree", { exact: true })).toHaveCount(0);
};

test("A real map task and Goal owner open their exact conversation in the real worker pane", async ({ page }) => {
  const errors = await fixture(page); await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Open project project", exact: true }).click();
  await page.locator('.zoom-map-task[data-task="a"]').click();
  await page.locator('.zoom-map-detail').getByRole("button", { name: "Open conversation", exact: true }).click();
  await selected(page, "task-a"); await expect(page.locator("[data-workbench-header]:visible h2")).toHaveText("Vale");
  await page.getByRole("button", { name: "Goal panel", exact: true }).click();
  await page.getByRole("tabpanel", { name: "Goal & tasks" }).getByRole("button", { name: "Vale", exact: true }).first().click();
  await selected(page, "task-a"); expect(errors).toEqual([]);
});

test("B real assignment Open and activity saved attempt stay on one page; queued remains truthful", async ({ page }) => {
  const errors = await fixture(page);
  await page.evaluate(async () => { await (window as any).ccmap2Worker.open("worker", null); });
  await page.locator('[data-member-work]:visible [data-task-open]').first().click();
  const state = await page.evaluate(() => (window as any).ccmap2Worker.state()); await selected(page, state.active);
  await open(page, "a", "past-a"); await selected(page, "past-a");
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.cc-worker-assignments:visible')).toContainText("Attempt 1");
  await open(page, "queued", "queued-session"); await expect(page.getByText("Not started yet", { exact: true })).toBeVisible();
  expect((await page.evaluate(() => (window as any).ccmap2Worker.state())).active).toBeUndefined(); expect(errors).toEqual([]);
});

test("C notification, reminder and approval session interceptors render exact current/history", async ({ page }) => {
  const errors = await fixture(page); await page.getByRole("button", { name: "Notification A" }).click(); await selected(page, "task-a");
  await page.getByRole("button", { name: "Reminder history" }).click(); await selected(page, "past-a");
  await page.evaluate(async () => { await (window as any).ccmap2Worker.host.onSelectHistorySession("task-b"); }); await selected(page, "task-b");
  await page.evaluate(async () => { await (window as any).ccmap2Worker.host.onOpenInboxSession("past-a"); }); await selected(page, "past-a");
  expect(errors).toEqual([]);
});

test("D E real switcher keyboard/default/title and Back/Forward retain exact local selection and drafts", async ({ page }) => {
  const errors = await fixture(page); await page.getByRole("button", { name: "Sidebar Vale" }).click(); await selected(page, "task-b");
  await page.getByRole("tab", { name: "Home", exact: true }).click(); await selected(page, "worker-home");
  const home = page.locator('[data-worker-conversation="worker-home"] textarea:visible').last(); await home.fill("Keep Home draft");
  await page.getByRole("tab", { name: "Home", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Current (3)", exact: true })).toBeFocused();
  await page.locator('.cc-worker-assignments:visible button').filter({ hasText: "Assignment a" }).click(); await selected(page, "task-a");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.locator('.cc-worker-assignments:visible button').filter({ hasText: "Attempt 1" }).click(); await selected(page, "past-a");
  await page.getByRole("button", { name: "Back", exact: true }).click(); await selected(page, "task-a");
  await page.getByRole("button", { name: "Forward", exact: true }).click(); await selected(page, "past-a");
  await page.getByRole("button", { name: "Title Vale" }).click(); await selected(page, "past-a");
  await page.getByRole("tab", { name: "Home", exact: true }).click(); await expect(home).toHaveValue("Keep Home draft");
  await page.screenshot({ path: `${evidence}/worker-home.png` }); expect(errors).toEqual([]);
});

test("F memberless task uses canonical Manager page and real task provider identity", async ({ page }) => {
  const errors = await fixture(page); await page.evaluate(async () => { await (window as any).ccmap2Worker.host.onOpenApprovalSession("manager-task"); });
  await selected(page, "manager-task", "manager"); await expect(page.locator("[data-workbench-header]:visible h2")).toHaveText("Mira");
  expect(await page.evaluate(() => { const f = (window as any).ccmap2Worker; const s = f.host.sessions.find((s: any) => s.id === "manager-task"); return { mono: f.host.monoForSession(s.id), account: s.providerAccountId, provider: s.providerSessionId }; })).toEqual({ mono: undefined, account: "account-manager-task", provider: "provider-manager-task" });
  expect(errors).toEqual([]);
});

test("G actual migration detaches recognized attempt leaves once, retains mixed/deleted-run panes and calls no lifecycle", async ({ page }) => {
  const errors = await fixture(page);
  const state = await page.evaluate(() => {
    const f = (window as any).ccmap2Worker, h = f.host;
    const mixed = { ...h.newTab("past-a"), id: "mixed", layout: { type: "split", id: "split", dir: "right", sizes: [.3, .4, .3], children: [h.leaf("past-a"), h.leaf("unrelated"), h.leaf("editor")] },
      editorPanes: [{ id: "editor", files: [{ id: "file", path: "C:/retained-draft", cwd: f.project }], activeFileId: "file" }] };
    h.tabs = h.tabsRef.current = [h.newTab("task-a"), mixed, h.newTab("deleted-run-session")]; h.activeTabIdRef.current = "mixed";
    f.events.length = 0; const sessions = JSON.stringify(h.sessions); h.migrate(); const once = h.tabs; h.migrate();
    return { tabs: h.tabs.map((tab: any) => ({ ids: h.leafIds(tab.layout), files: tab.editorPanes })), active: h.activeSessionId, target: h.workerPages.worker.target,
      sameSessions: sessions === JSON.stringify(h.sessions), once: once === h.tabs, events: f.events };
  });
  expect(state.tabs).toHaveLength(2); expect(state.tabs[0].ids).toEqual(["unrelated", "editor"]); expect(state.tabs[0].files[0].files[0].path).toBe("C:/retained-draft");
  expect(state.tabs[1].ids).toEqual(["deleted-run-session"]); expect(state.target).toEqual({ taskId: "a", sessionId: "past-a" });
  expect(state.sameSessions).toBe(true); expect(state.once).toBe(true); expect(state.events).toEqual([]);
  await expect(page.locator('[data-worker-conversation="past-a"] [data-session-drop="past-a"]')).toBeVisible(); expect(errors).toEqual([]);
});

test("H real composer, approvals and Escape target only selected task; placeholders/nonbusy cannot stop busy Home", async ({ page }) => {
  const errors = await fixture(page); await open(page, "a", "task-a"); await selected(page, "task-a");
  const input = page.locator('[data-worker-conversation="task-a"] [data-session-composer] textarea:visible').last(); await input.fill("Exact worker follow-up");
  await page.locator('[data-worker-conversation="task-a"] [data-session-composer]').getByRole("button", { name: "Send", exact: true }).click();
  expect(await page.evaluate(() => (window as any).ccmap2Worker.events)).toContainEqual(expect.objectContaining({ action: "submit", id: "task-a", text: "Exact worker follow-up" }));
  await page.locator("[data-workbench-header]:visible h2").click(); await page.keyboard.press("Escape");
  await expect.poll(async () => (await page.evaluate(() => (window as any).ccmap2Worker.events)).filter((event: any) => event.action === "stop")).toEqual([{ action: "stop", id: "task-a" }]);
  await open(page, "b", "task-b"); await page.locator("[data-workbench-header]:visible h2").click(); await page.keyboard.press("Escape");
  await open(page, "queued", "queued-session"); await page.getByText("Not started yet", { exact: true }).click(); await page.keyboard.press("Escape");
  expect((await page.evaluate(() => (window as any).ccmap2Worker.events)).filter((event: any) => event.action === "stop")).toEqual([{ action: "stop", id: "task-a" }]);
  await open(page, "a", "task-a"); await page.evaluate(() => (window as any).ccmap2Worker.approval());
  await expect(page.getByLabel("Command awaiting approval", { exact: true })).toHaveText("exact worker approval");
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  expect(await page.evaluate(() => (window as any).ccmap2Worker.events)).toContainEqual(expect.objectContaining({ action: "approval", id: "task-a", requestId: 42 }));
  await page.screenshot({ path: `${evidence}/worker-task-approval.png` }); expect(errors).toEqual([]);
});

test("H delayed A to B/Home/close never applies stale selection; unavailable has no actionable pane", async ({ page }) => {
  const errors = await fixture(page);
  await page.evaluate(async () => { const f = (window as any).ccmap2Worker; f.defer("task-a"); f.pendingA = f.open("worker", { taskId: "a", sessionId: "task-a" }); });
  await open(page, "b", "task-b"); await page.evaluate(async () => { const f = (window as any).ccmap2Worker; f.release("task-a"); await f.pendingA; }); await selected(page, "task-b");
  await open(page, "gone", "gone-session"); await expect(page.locator('.cc-worker-placeholder:visible')).toContainText("no longer available");
  expect((await page.evaluate(() => (window as any).ccmap2Worker.state())).active).toBeUndefined();
  await page.screenshot({ path: `${evidence}/worker-unavailable.png` }); expect(errors).toEqual([]);
});
