import { createWorkerFixture } from "../../tests/browser/ccmap2WorkerFixture";
import { bindWorkerApp } from "../../tests/browser/ccmap2WorkerPaths";
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { newSession, sessionWorkCwd, type Session } from "../features/sessions/model/session";
import { newTab, leafIds } from "../features/workspace/model/layout";
import type { OrchestrationRun } from "../features/orchestration/model/orchestrationState";
import { newWorkspaceSession } from "./model/newWorkspaceSession";
import { setWorktreeFocus } from "../features/source-control/model/worktreeFocus";
import { boundWorktreeTabs, chatTabWorktree, chatWorktreePath } from "../features/source-control/model/chatWorktree";
import { sameProjectPath } from "../features/projects/model/recents";
import { isBlankSession } from "../features/projects/model/projectReturn";
import { SessionStateStore } from "../features/sessions/model/sessionStateStore";
import { updateSessionState } from "./model/sessionState";
import { collectWorkspaceSnapshot, parseWorkspaceSnapshot, hydrateWorkspaceSnapshot } from "../features/workspace/model/workspaceSnapshot";
import type { Worktree } from "../features/source-control/model/worktrees";
import { pathKey, isEqualOrInside } from "../shared/lib/paths";
import { worktreeSessionGroups } from "../features/source-control/model/worktreeSessions";
import { summaryFromSession } from "../features/sessions/data/sessionHistory";
import { sessionActivityAt } from "../features/sessions/model/sessionActivity";
import { shellPageTabId, shellPageForTab, appViewTabId, isViewTab, REUSABLE_PAGE_TAB_ID } from "../features/workspace/model/appViewTabs";

const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = []; const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
function callback<T extends (...args: any[]) => any>(name: string, scope: Record<string, unknown>): T {
  const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration;
  if (!node || !ts.isCallExpression(node.initializer!)) throw Error(`Missing actual App callback ${name}`);
  const text = node.initializer.arguments[0].getText(ast);
  return new Function(...Object.keys(scope), ts.transpile(`return ${text}`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
const tree = (path: string, isMain = false): Worktree => ({ path, isMain, branch: isMain ? "main" : "feature", head: "abc", missing: false, prunable: false, locked: false, dirty: false, unpushed: 0, sessionIds: [] });
const trees = [tree("C:/repo"), tree("C:/repo/child"), tree("C:/linked-main", true)];

it("actual App task history navigation reuses one worker page and retains every real session", async () => {
  const f = createWorkerFixture(bindWorkerApp), scope = f.host;
  const sessions = Array.from({ length: 20 }, (_, index) => ({ ...newSession("codex", "C:/repo"), id: `worker-${index}`, providerSessionId: `provider-${index}`, busy: index === 0, queuedMessages: [{ id: `queue-${index}`, text: "Keep queued follow-up", attachments: [] }], blocks: [{ id: `user-${index}`, role: "user" as const, text: "Keep transcript" }] }));
  scope.sessions = [...scope.sessions, ...sessions]; scope.sessionsRef.current = scope.sessions;
  f.run.tasks = sessions.map(session => ({ id: session.id, memberId: "worker", sessionId: session.id, title: "Task", prompt: "Task", status: "completed", accepted: false, delivered: true, result: "", harness: "codex", model: "", files: [], scopes: [], dependsOn: [] }));
  const unrelated = scope.tabs[0], originalSessions = scope.sessionsRef.current;
  for (const session of sessions) await scope.onSelectHistorySession(session.id);
  expect(scope.tabs).toHaveLength(1); expect(scope.tabs[0]).toBe(unrelated);
  expect(scope.workerPages.worker.target).toEqual({ taskId: "worker-19", sessionId: "worker-19" });
  expect(scope.openMonoTabs).toEqual(["worker"]);
  expect(scope.sessionsRef.current).toBe(originalSessions);
  expect(sessions[0]).toMatchObject({ providerSessionId: "provider-0", busy: true, queuedMessages: [{ id: "queue-0" }], blocks: [{ text: "Keep transcript" }] });
  expect(sessions.map(session => session.providerSessionId)).toEqual(Array.from({ length: 20 }, (_, index) => `provider-${index}`));
  expect(f.events.filter(event => ["activate-tab", "append-tab", "project", "sidebar", "worktree", "persist"].includes(event.action))).toEqual([]);
});

it("actual worktree selection opens its latest real chat or a calm overview without creating, moving or closing sessions", () => {
  const session = { ...newSession("codex", "C:/repo"), id: "saved", worktreeCwd: "C:/repo/child", providerSessionId: "retained-provider", blocks: [{ id: "u", role: "user" as const, text: "Keep my work", startedAt: 100 }] };
  const sessionsRef = { current: [session] };
  const open = vi.fn(), overview = vi.fn(), setTabs = vi.fn(), createWorkspaceTab = vi.fn(), moveSession = vi.fn();
  const history = [ { ...summaryFromSession(session), updatedAt: 100 }, { ...summaryFromSession(session), id: "older", updatedAt: 50 }, { ...summaryFromSession(session), id: "draft", draft: true, updatedAt: 200 } ];
  const scope = { history, sessionsRef, sessionActivityAt, summaryFromSession, isBlankSession, worktreeSessionGroups, pathKey,
    sameProjectPath, setWorktreeFocus, workspaceSessionRequest: { current: 0 }, workspaceNavigation: { cancel: vi.fn() },
    teamMap: { close: vi.fn() }, closeMonoView: vi.fn(), setProjectCwd: vi.fn(), setRecents: vi.fn(), rememberProject: () => [],
    setSearchViewOpen: vi.fn(), setInboxViewOpen: vi.fn(), setNotesViewOpen: vi.fn(), setAutomationsViewOpen: vi.fn(), setSettingsOpen: vi.fn(),
    setWorktreeOverview: overview, onSelectHistorySession: open, orchestrator: { snapshot: () => [] }, setTabs, createWorkspaceTab, moveSession };
  const select = callback("onSelectProjectWorktree", scope);
  select("C:/repo", trees[1]);
  expect(open).toHaveBeenCalledExactlyOnceWith("saved", { project: "C:/repo", tree: trees[1] });
  select("C:/repo", { ...trees[1], path: "C:/repo/empty" });
  expect(overview).toHaveBeenLastCalledWith({ project: "C:/repo", tree: expect.objectContaining({ path: "C:/repo/empty" }) });
  expect(open).toHaveBeenCalledTimes(1);
  for (const callback of [setTabs, createWorkspaceTab, moveSession]) expect(callback).not.toHaveBeenCalled();
  expect(sessionsRef.current).toEqual([session]);
  expect(session.providerSessionId).toBe("retained-provider");
  setWorktreeFocus("C:/repo", undefined);
});

it("actual reusable-page selection and closing preserve all background work tabs", () => {
  const open = vi.fn(), setTabs = vi.fn(), setReusablePage = vi.fn(), close = vi.fn();
  const scope = { REUSABLE_PAGE_TAB_ID, pageTab: { page: "decisions" }, setWorktreeOverview: vi.fn(), onOpenTeamMap: open,
    DECISIONS_SCOPE: "decisions", INTEGRATIONS_SCOPE: "integrations", USAGE_DASHBOARD_SCOPE: "usage", setTabs };
  callback("onSelectTitleTab", scope)(REUSABLE_PAGE_TAB_ID);
  expect(open).toHaveBeenCalledExactlyOnceWith("decisions");
  const select = vi.fn();
  callback("closeViewTab", { REUSABLE_PAGE_TAB_ID, setReusablePage, setOpenAppViews: vi.fn(), setOpenShellPages: vi.fn(), teamMap: { close },
    setSearchViewOpen: vi.fn(), setInboxViewOpen: vi.fn(), setNotesViewOpen: vi.fn(), setAutomationsViewOpen: vi.fn(),
    displayedTabNavigation: { current: { activeId: REUSABLE_PAGE_TAB_ID, tabs: [{ id: "real-work" }, { id: REUSABLE_PAGE_TAB_ID }], select } },
    nextDisplayedTabAfterClose: () => "real-work", setTabs })(REUSABLE_PAGE_TAB_ID);
  expect(close).toHaveBeenCalledOnce(); expect(setReusablePage).toHaveBeenCalledWith(undefined);
  expect(select).toHaveBeenCalledWith("real-work"); expect(setTabs).not.toHaveBeenCalled();
});

it("uses normalized longest containment, linked main and removed fallback without modifying cwd", () => {
  expect(chatWorktreePath("C:/repo", "c:\\REPO\\child\\src", trees)).toBe("C:/repo/child");
  expect(chatWorktreePath("C:/repo", "C:/linked-main/src", trees)).toBe("C:/linked-main");
  expect(chatWorktreePath("C:/repo", "C:/gone", trees)).toBe("C:/linked-main");
  expect(chatWorktreePath("C:/repo", "C:/repo/child", trees, true)).toBe("C:/linked-main");
  const summary = { id: "removed", cwd: "C:/repo", worktreeCwd: "C:/gone", worktreeRemoved: true, title: "kept", harness: "codex" as const, model: "", runtimeMode: "supervised" as const, createdAt: 1, updatedAt: 2 };
  const grouped = worktreeSessionGroups("C:/repo", trees, [summary], []);
  expect(grouped.get(pathKey("C:/linked-main"))).toEqual([summary]);
  expect(summary.worktreeCwd).toBe("C:/gone");
});

it("actual App new-chat callback starts in the visibly selected worktree", () => {
  const store = new SessionStateStore([]);
  const appendTab = vi.fn(); const active = vi.fn();
  setWorktreeFocus("C:/repo", { path: "C:/repo/child", branch: "child" });
  const action = callback("onNew", { setWorktreeOverview: vi.fn(), teamMap: { close: vi.fn() }, setSearchViewOpen: vi.fn(), setInboxViewOpen: vi.fn(), setNotesViewOpen: vi.fn(), setAutomationsViewOpen: vi.fn(),
    sidebarCwd: "C:/repo", newWorkspaceSession, sessionDefaults: {}, newTab, setSessions: store.setState, appendTab, setActiveTabId: active, setComposerFocused: vi.fn() });
  action();
  expect(sessionWorkCwd(store.snapshot()[0])).toBe("C:/repo/child");
  expect(appendTab.mock.calls[0][1]).toBe("C:/repo");
  expect(active).toHaveBeenCalledWith(appendTab.mock.calls[0][0].id);
  setWorktreeFocus("C:/repo", undefined);
});

it("actual App mode callback refuses first-message/provider/queue locks and preserves homes", () => {
  const draft = { ...newSession("codex", "C:/repo"), id: "draft", worktreeCwd: "C:/repo/child", codexStorageHome: "synthetic-home" };
  const store = new SessionStateStore([draft]);
  const pendingComposerSubmits = { current: new Set<string>() };
  const action = callback("onWorkspaceModeChange", { updateSessionState, sessionsRef: store.ref, setSessions: store.setState, isBlankSession, switchingWorktrees: { current: new Map() }, pendingComposerSubmits });
  action("draft", "worktree", "main");
  expect(store.snapshot()[0]).toMatchObject({ worktreeCwd: undefined, workspaceMode: "worktree", worktreeBase: "main", codexStorageHome: "synthetic-home" });
  for (const locked of [ { busy: true }, { providerSessionId: "thread" }, { blocks: [{ id: "first", role: "user", text: "started" }] }, { queuedMessages: [{ id: "queue", text: "pending" }] }, { worktreePreparing: "Preparing" } ]) {
    store.setState([{ ...draft, ...locked } as Session]);
    const before = store.snapshot()[0]; action("draft", "worktree", "main");
    expect(store.snapshot()[0]).toBe(before);
  }
  store.setState([draft]); pendingComposerSubmits.current.add("draft");
  action("draft", "worktree", "main"); expect(store.snapshot()[0]).toBe(draft);
  const preparing = { ...draft, workspaceMode: "worktree" as const, worktreeBase: "main" };
  store.setState([preparing]);
  const base = callback("onWorktreeBaseChange", { updateSessionState, sessionsRef: store.ref, setSessions: store.setState, isBlankSession, switchingWorktrees: { current: new Map() }, pendingComposerSubmits });
  base("draft", "other"); expect(store.snapshot()[0]).toBe(preparing);
});

it("actual App union predicate roundtrips all checkout tabs and hidden state without extra schema", async () => {
  const sessions = trees.map((tree, index) => ({ ...newSession("codex", "C:/repo"), id: `s${index}`, worktreeCwd: tree.path,
    providerSessionId: `thread${index}`, providerAccountId: "account", codexStorageHome: "synthetic-home", blocks: [{ id: `u${index}`, role: "user" as const, text: "keep" }] }));
  const tabs = sessions.map(session => newTab(session.id));
  const keep = callback("keepWorkspaceTab", {});
  const snapshot = collectWorkspaceSnapshot(tabs, sessions, tabs[1].id, "C:/repo", new Map(), [], undefined, keep);
  expect(snapshot.tabs).toHaveLength(3);
  const parsed = parseWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)))!;
  expect(parsed.tabs).toHaveLength(3);
  const restored = hydrateWorkspaceSnapshot(parsed, new Map(sessions.map(session => [session.id, session])));
  expect(chatTabWorktree(restored!.tabs.find(tab => tab.id === restored!.activeTabId)!, restored!.sessions, trees)).toBe("C:/repo/child");
  const store = new SessionStateStore(sessions);
  store.update(rows => rows.map(session => session.id === "s2" ? { ...session, busy: true, queuedMessages: [{ id: "q", text: "queued", attachments: [] }], blocks: [...session.blocks, { id: "hidden", role: "assistant", text: "arrived", streaming: true }] } : session), true);
  expect(store.session("s2")!.blocks.slice(-1)[0].text).toBe("arrived");
  expect(store.session("s2")!.providerSessionId).toBe("thread2");
  expect(store.session("s2")!.queuedMessages).toHaveLength(1);
  const closed = collectWorkspaceSnapshot(tabs.filter(tab => tab.id !== tabs[2].id), store.snapshot(), tabs[1].id, "C:/repo", new Map(), [], undefined, keep);
  expect(closed.tabs).toHaveLength(2);
  expect(store.snapshot()).toHaveLength(3);
});

it("bounds only open tab surfaces per checkout while keeping the active tab and all sessions", () => {
  const sessions = Array.from({ length: 30 }, (_, index) => ({ ...newSession("codex", "C:/repo"), id: `s${index}`, worktreeCwd: index < 15 ? "C:/repo" : "C:/repo/child" }));
  const tabs = sessions.map(session => newTab(session.id));
  const kept = boundWorktreeTabs(tabs, sessions, tabs[0].id, tab => chatTabWorktree(tab, sessions, trees));
  expect(kept).toHaveLength(24); expect(kept).toContain(tabs[0]); expect(sessions).toHaveLength(30);
});

it("actual App worktree callback refuses a started chat and rechecks after async checkout discovery", async () => {
  const draft = { ...newSession("codex", "C:/repo"), id: "draft", codexStorageHome: "synthetic-home" };
  const store = new SessionStateStore([draft]);
  const list = vi.fn<() => Promise<{ worktrees: Worktree[] }>>();
  const forget = vi.fn();
  const action = callback("onWorktreeChange", { sessionsRef: store.ref, pendingComposerSubmits: { current: new Set() }, isProjectManager: () => false, isBlankSession,
    removingSessionIds: { current: new Set() }, switchingWorktrees: { current: new Map() }, removingWorktreePaths: { current: new Set() }, pendingPersist: { current: new Map() },
    orchestrator: { forSession: () => undefined }, pathKey, sessionWorkCwd, isEqualOrInside, listWorktrees: list, forgetHarnessSession: forget });
  store.setState([{ ...draft, providerSessionId: "thread", blocks: [{ id: "sent", role: "user", text: "started" }] }]);
  await expect(action("draft", trees[1], true)).rejects.toThrow("original worktree");
  expect(list).not.toHaveBeenCalled();
  store.setState([draft]);
  let resolve!: (value: { worktrees: Worktree[] }) => void;
  list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = action("draft", trees[1], true);
  store.setState([{ ...draft, providerSessionId: "new-thread", blocks: [{ id: "sent", role: "user", text: "started while waiting" }] }]);
  resolve({ worktrees: trees });
  await expect(pending).rejects.toThrow("session changed");
  expect(forget).not.toHaveBeenCalled(); expect(store.session("draft")!.providerSessionId).toBe("new-thread");
  expect(store.session("draft")!.codexStorageHome).toBe("synthetic-home");
});

it("actual App script callback runs only after confirmation against the exact selected checkout", async () => {
  const open = vi.fn(); const ask = vi.fn(async () => false); const list = vi.fn(async () => ({ worktrees: trees }));
  const projectCwdRef = { current: "C:/repo" }; let focus = { path: "C:/repo/child", branch: "feature" };
  const action = callback("onRunProjectScript", { workspaceSessionRequest: { current: 0 }, sameProjectPath, projectCwdRef, worktreeFocus: () => focus, removingWorktreePaths: { current: new Set() }, isEqualOrInside, isLocalProject: (path: string) => path.startsWith("C:"),
    packageScripts: async () => [{ name: "test", command: "vitest run", run: "npm run test" }], listWorktrees: list, ask, openProjectTerminal: open });
  expect(open).not.toHaveBeenCalled();
  await action("C:/repo", focus.path, "test"); expect(open).not.toHaveBeenCalled();
  ask.mockResolvedValue(true); await action("C:/repo", focus.path, "test"); expect(open).toHaveBeenCalledExactlyOnceWith("C:/repo/child", "npm run test", expect.any(Function));
  ask.mockImplementation(async () => { focus = { path: "C:/repo", branch: "main" }; return true; });
  await expect(action("C:/repo", "C:/repo/child", "test")).rejects.toThrow("changed"); expect(open).toHaveBeenCalledTimes(1);
});

it("opens and closes shell pages under their own title-tab identities through actual App callbacks", () => {
  const open = vi.fn();
  const select = callback("onSelectTitleTab", { setWorktreeOverview: vi.fn(), REUSABLE_PAGE_TAB_ID, shellPageForTab, onOpenTeamMap: open, DECISIONS_SCOPE: "decision-scope", INTEGRATIONS_SCOPE: "integration-scope", USAGE_DASHBOARD_SCOPE: "usage-scope" });
  for (const [page, scope] of [["commandMap", undefined], ["decisions", "decision-scope"], ["integrations", "integration-scope"], ["usage", "usage-scope"]] as const) {
    const id = shellPageTabId(page); expect(isViewTab(id)).toBe(true); select(id); expect(open).toHaveBeenLastCalledWith(scope);
  }
  let pages = ["commandMap", "decisions"], order = ["chat", "shell-page:commandMap", "shell-page:decisions"];
  const close = vi.fn(), neighbor = vi.fn();
  const action = callback("closeViewTab", { REUSABLE_PAGE_TAB_ID, shellPageForTab, setOpenShellPages: (update: (value: string[]) => string[]) => { pages = update(pages); }, setTitleTabOrder: (update: (value: string[]) => string[]) => { order = update(order); },
    displayedTabNavigation: { current: { activeId: "shell-page:decisions", tabs: order.map(id => ({ id })), select: neighbor } }, teamMap: { close }, nextDisplayedTabAfterClose: () => "chat" });
  action("shell-page:decisions"); expect(pages).toEqual(["commandMap"]); expect(order).toEqual(["chat", "shell-page:commandMap"]);
  expect(close).toHaveBeenCalledOnce(); expect(neighbor).toHaveBeenCalledWith("chat");
});

it("actual App quit/save getters serialize only workspace chats while all seven page identities stay outside the persisted union", () => {
  const session = { ...newSession("codex", "C:/repo"), id: "retained-chat", providerSessionId: "bound-thread", blocks: [{ id: "user", role: "user" as const, text: "keep this conversation" }] };
  const tab = newTab(session.id);
  const pages = [shellPageTabId("commandMap"), shellPageTabId("decisions"), shellPageTabId("integrations"), shellPageTabId("usage"), appViewTabId("inbox"), appViewTabId("notes"), appViewTabId("automations")];
  const registration = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "setQuitWorkspace") as ts.CallExpression;
  const scope = { sessionsRef: { current: [session] }, tabsRef: { current: [tab] }, activeTabIdRef: { current: tab.id } };
  const getter = (index: number) => new Function(...Object.keys(scope), ts.transpile(`return ${registration.arguments[index].getText(ast)}`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  for (const page of pages) {
    const rendererNavigation = { activeId: page, tabs: [{ id: tab.id }, ...pages.map(id => ({ id }))] };
    expect(rendererNavigation.tabs).toHaveLength(8);
    const snapshot = collectWorkspaceSnapshot(getter(1)(), getter(0)(), getter(2)(), "C:/repo", new Map());
    const serialized = JSON.stringify(snapshot);
    for (const id of pages) expect(serialized).not.toContain(id);
    expect(snapshot.tabs.map(tab => tab.id)).toEqual([tab.id]);
    expect(snapshot.activeTabId).toBe(tab.id);
    const restored = hydrateWorkspaceSnapshot(parseWorkspaceSnapshot(JSON.parse(serialized))!, new Map([[session.id, session]]))!;
    expect(restored.tabs).toHaveLength(1); expect(restored.sessions.map(session => session.id)).toEqual(["retained-chat"]);
    expect(restored.sessions[0].providerSessionId).toBe("bound-thread");
  }
});
