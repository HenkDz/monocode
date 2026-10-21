import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import type { createWorkerFixture } from "./ccmap2WorkerFixture";
import type { WorkerPageSelection } from "../../src/features/monos/model/workerPage";
declare global {
  interface Window {
    ccmap2Worker: ReturnType<typeof createWorkerFixture> & { state: () => { active?: string; targets: Record<string, WorkerPageSelection> } };
  }
}
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

test("A real project drawer saved task opens exact history independently of the current assignment", async ({ page }) => {
  const errors = await fixture(page); await page.getByRole("button", { name: "Project drawer", exact: true }).click();
  await page.getByRole("button", { name: "Open project project", exact: true }).click();
  const member = page.locator('.command-map-task').filter({ has: page.getByRole("button", { name: "Vale", exact: true }) });
  await member.getByRole("button", { name: /Show work/ }).click();
  await member.getByLabel("Vale work attempt", { exact: true }).selectOption("a-1");
  await expect(member).toContainText("History · Task a · dispatch a-1 · completed");
  await member.getByRole("button", { name: "Vale", exact: true }).click(); await selected(page, "past-a");
  expect(errors).toEqual([]);
});

test("C notification, reminder and approval session interceptors render exact current/history", async ({ page }) => {
  const errors = await fixture(page); await page.getByRole("button", { name: "Notification A" }).click(); await selected(page, "task-a");
  await page.getByRole("button", { name: "Reminder history" }).click(); await selected(page, "past-a");
  await page.evaluate(async () => { await (window as any).ccmap2Worker.host.onSelectHistorySession("task-b"); }); await selected(page, "task-b");
  await page.evaluate(async () => { await (window as any).ccmap2Worker.host.onOpenInboxSession("past-a"); }); await selected(page, "past-a");
  expect(errors).toEqual([]);
});

test("D E real switcher keyboard/default/title and Back/Forward retain exact local selection and drafts", async ({ page }) => {
  const errors = await fixture(page);
  await page.evaluate(() => { (window as any).ccmap2Worker.run.tasks.find((task: any) => task.id === "b").sessionId = "stale-session"; });
  await page.getByRole("button", { name: "Sidebar Vale" }).click(); await selected(page, "task-b");
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
  await page.getByRole("button", { name: "Allow", exact: true }).click();
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

test("P2 queued task starts visibly and Escape stops only its real selected pane", async ({ page }) => {
  const errors = await fixture(page); await open(page, "queued", "queued-session");
  await expect(page.getByText("Not started yet", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const f = window.ccmap2Worker, h = f.host;
    const task = f.run.tasks.find(task => task.id === "queued");
    if (!task) throw Error("Missing queued fixture task");
    task.status = "running";
    h.setSessions([...h.sessions, { ...h.sessions.find((session: { id: string }) => session.id === "task-a"), id: "queued-session",
      blocks: [{ id: "queued-start", role: "user", text: "Exact started queued conversation" }] }]);
  });
  await selected(page, "queued-session");
  await expect(page.locator('[data-worker-conversation="queued-session"]')).toContainText("Exact started queued conversation");
  expect((await page.evaluate(() => window.ccmap2Worker.state())).targets.worker.opened).toEqual([]);
  await page.locator("[data-workbench-header]:visible h2").click(); await page.keyboard.press("Escape");
  await expect.poll(async () => (await page.evaluate(() => window.ccmap2Worker.events)).filter((event: { action: string }) => event.action === "stop")).toEqual([{ action: "stop", id: "queued-session" }]);
  await page.screenshot({ path: `${evidence}/queued-started-visible.png` }); expect(errors).toEqual([]);
});

test("P2 Manager Home keeps normal real SessionPane controls after a memberless task", async ({ page }) => {
  const errors = await fixture(page); await open(page, "direct", "manager-task", "manager");
  await selected(page, "manager-task", "manager");
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  const home = page.locator('[data-worker-conversation="manager-home"]:visible [data-session-drop="manager-home"]');
  await expect(home).toBeVisible();
  await expect(home).not.toHaveAttribute("data-member-workbench", "true");
  await expect(home.locator('[data-workbench-header], [data-member-work], [aria-label="Composer target"]')).toHaveCount(0);
  await expect(home.locator('[data-session-composer] textarea:visible')).toBeVisible();
  await expect(home).toContainText("Exact conversation manager-home");
  expect((await page.evaluate(() => window.ccmap2Worker.state())).active).toBe("manager-home");
  await expect(page.getByRole("tab", { name: "Home", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: `${evidence}/manager-home-normal.png` }); expect(errors).toEqual([]);
});

test("P2 migration preserves newer Home and its visible input and Stop ownership", async ({ page }) => {
  const errors = await fixture(page);
  await page.evaluate(async () => {
    const f = window.ccmap2Worker, h = f.host, old = h.newTab("task-a");
    h.tabs = h.tabsRef.current = [old, h.tabs[0]]; h.activeTabIdRef.current = old.id;
    await h.openWorkerTask("worker", null); f.events.length = 0;
    h.migrate();
  });
  await selected(page, "worker-home");
  expect(await page.evaluate(() => { const h = window.ccmap2Worker.host; return h.tabs.some((tab: { id: string }) => tab.id === h.activeTabId && tab.id === h.activeTabIdRef.current); })).toBe(true);
  const home = page.locator('[data-worker-conversation="worker-home"]:visible');
  await expect(home.locator('[data-session-composer] textarea:visible')).toBeVisible();
  await page.locator("[data-workbench-header]:visible h2").click(); await page.keyboard.press("Escape");
  await expect.poll(async () => (await page.evaluate(() => window.ccmap2Worker.events)).filter((event: { action: string }) => event.action === "stop")).toEqual([{ action: "stop", id: "worker-home" }]);
  expect((await page.evaluate(() => window.ccmap2Worker.state())).targets.worker.target).toBeNull();
  await page.screenshot({ path: `${evidence}/migration-keeps-home.png` }); expect(errors).toEqual([]);
});

test("C10 restored six-tab boot autofocus before real hydration keeps shell and underlying workspace after Back and title close", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/tests/browser/ccmap2-worker.html?boot=c8");
  const initial = await page.evaluate(() => {
    const h = window.ccmap2Worker.host;
    return { sessions: JSON.stringify(h.sessions), survivors: h.tabs.slice(2), active: h.activeTabId };
  });
  await expect.poll(() => page.evaluate(() => (window.ccmap2Worker as any).bootFocus.some((focus: any) => focus.id === "task-a" && !focus.ready && focus.mono === null && focus.elapsed < 3000))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.ccmap2Worker.host.workerLayoutReady)).toBe(true);
  const state = await page.evaluate(() => {
    const f = window.ccmap2Worker, h = f.host;
    return { tabs: h.tabs, active: h.activeTabId, activeRef: h.activeTabIdRef.current, sessions: JSON.stringify(h.sessions), target: h.workerPages.worker?.target, mono: h.monoViewId, events: f.events };
  });
  expect(state.tabs).toEqual(initial.survivors);
  expect(state.active).toBe(initial.survivors[2].id); expect(state.activeRef).toBe(state.active);
  expect(state.tabs.some((tab: { id: string }) => tab.id === state.active)).toBe(true);
  expect(state.target).toEqual({ taskId: "a", sessionId: "task-a" }); expect(state.mono).toBe("worker-home");
  expect(state.sessions).toBe(initial.sessions); expect(state.events).toEqual([]);
  const assertShell = async () => {
    await expect(page.locator('[data-startup-sidebar]')).toBeVisible();
    await expect(page.locator('[data-startup-title] [data-title-tab-strip]')).toBeVisible();
    await expect(page.locator('[data-startup-title] [data-title-tab-id]').first()).toBeVisible();
    await expect(page.locator('main > [data-workspace-tab]:visible, main > [data-mono-view]:visible')).toHaveCount(1);
    const box = await page.locator('main > [data-workspace-tab]:visible, main > [data-mono-view]:visible').boundingBox();
    expect(box?.width).toBeGreaterThan(0); expect(box?.height).toBeGreaterThan(0);
  };
  await assertShell();
  await expect(page.locator('main [data-worker-conversation="task-a"]:visible [data-session-drop="task-a"]')).toBeVisible();
  await page.screenshot({ path: `${evidence}/c10-boot-worker.png` });
  await page.locator(`[data-title-tab-id="${state.active}"] button`).first().click();
  await expect(page.locator(`main > [data-workspace-tab="${state.active}"]`)).toBeVisible();
  await page.evaluate(async () => { await window.ccmap2Worker.host.onOpenRailMono("worker"); });
  await expect(page.locator('[data-mono-view="worker-home"]')).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(`main > [data-workspace-tab="${state.active}"]`)).toBeVisible(); await assertShell();
  await page.evaluate(async () => { await window.ccmap2Worker.host.onOpenRailMono("worker"); });
  await expect(page.locator('[data-mono-view="worker-home"]')).toBeVisible();
  await page.getByRole("button", { name: "Close worker tab", exact: true }).click();
  await expect(page.locator('main > [data-workspace-tab]:visible')).toHaveCount(1); await assertShell();
  expect(await page.evaluate(() => { const h = window.ccmap2Worker.host; return h.tabs.some((tab: { id: string }) => tab.id === h.activeTabId && tab.id === h.activeTabIdRef.current); })).toBe(true);
  await page.screenshot({ path: `${evidence}/c10-boot-closed.png` }); expect(errors).toEqual([]);
});

test("P2 retry keeps exact saved conversation in History and permits explicit group browsing", async ({ page }) => {
  const errors = await fixture(page);
  await page.evaluate(() => {
    const f = window.ccmap2Worker; f.defer("task-a");
    f.host.pendingA = f.host.openWorkerTask("worker", { taskId: "a", sessionId: "task-a" });
  });
  await page.evaluate(async () => {
    const f = window.ccmap2Worker, task = f.run.tasks.find(task => task.id === "a"), dispatch = f.run.dispatches?.find(dispatch => dispatch.id === "a-2");
    if (!task || !dispatch) throw Error("Missing retry fixture identity");
    task.sessionId = "replacement"; task.activeDispatchId = "a-3"; dispatch.state = "cancelled";
    f.run.dispatches?.push({ ...dispatch, id: "a-3", sessionId: "replacement", state: "running", startedAt: 500 });
    f.refresh(); f.release("task-a"); await f.host.pendingA;
  });
  await selected(page, "task-a");
  await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.cc-worker-assignments button[aria-pressed="true"]')).toContainText("cancelled");
  await page.getByRole("tab", { name: "Current (3)", exact: true }).click();
  await page.evaluate(() => window.ccmap2Worker.refresh());
  await expect(page.getByRole("tab", { name: "Current (3)", exact: true })).toHaveAttribute("aria-selected", "true");
  await selected(page, "task-a");
  await page.screenshot({ path: `${evidence}/retry-keeps-saved-attempt.png` }); expect(errors).toEqual([]);
});
