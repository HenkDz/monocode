// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { newSession, sessionWorkCwd, type Session } from "../features/sessions/model/session";
import { newTab } from "../features/workspace/model/layout";
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
  const action = callback("onNew", { teamMap: { close: vi.fn() }, setSearchViewOpen: vi.fn(), setInboxViewOpen: vi.fn(), setNotesViewOpen: vi.fn(), setAutomationsViewOpen: vi.fn(),
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
  const action = callback("onWorkspaceModeChange", { updateSessionState, sessionsRef: store.ref, setSessions: store.setState, isBlankSession, switchingWorktrees: { current: new Map() } });
  action("draft", "worktree", "main");
  expect(store.snapshot()[0]).toMatchObject({ worktreeCwd: undefined, workspaceMode: "worktree", worktreeBase: "main", codexStorageHome: "synthetic-home" });
  for (const locked of [ { busy: true }, { providerSessionId: "thread" }, { blocks: [{ id: "first", role: "user", text: "started" }] }, { queuedMessages: [{ id: "queue", text: "pending" }] }, { worktreePreparing: "Preparing" } ]) {
    store.setState([{ ...draft, ...locked } as Session]);
    const before = store.snapshot()[0]; action("draft", "worktree", "main");
    expect(store.snapshot()[0]).toBe(before);
  }
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

it("actual App script callback runs only after confirmation against the exact selected checkout", async () => {
  const open = vi.fn(); const ask = vi.fn(async () => false); const list = vi.fn(async () => ({ worktrees: trees }));
  const projectCwdRef = { current: "C:/repo" }; let focus = { path: "C:/repo/child", branch: "feature" };
  const action = callback("onRunProjectScript", { sameProjectPath, projectCwdRef, worktreeFocus: () => focus, removingWorktreePaths: { current: new Set() }, isEqualOrInside, isLocalProject: (path: string) => path.startsWith("C:"),
    packageScripts: async () => [{ name: "test", command: "vitest run", run: "npm run test" }], listWorktrees: list, ask, openProjectTerminal: open });
  expect(open).not.toHaveBeenCalled();
  await action("C:/repo", focus.path, "test"); expect(open).not.toHaveBeenCalled();
  ask.mockResolvedValue(true); await action("C:/repo", focus.path, "test"); expect(open).toHaveBeenCalledExactlyOnceWith("C:/repo/child", "npm run test");
  ask.mockImplementation(async () => { focus = { path: "C:/repo", branch: "main" }; return true; });
  await expect(action("C:/repo", "C:/repo/child", "test")).rejects.toThrow("changed"); expect(open).toHaveBeenCalledTimes(1);
});
