// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindWorkerApp } from "../../tests/browser/ccmap2WorkerPaths";
import { createWorkerFixture } from "../../tests/browser/ccmap2WorkerFixture";
import { WorkerConversationPicker } from "../features/monos/ui/WorkerConversationPicker";
import { leaf, leafIds, newTab, type WorkspaceTab } from "../features/workspace/model/layout";
import { monoTabId } from "../features/workspace/model/appViewTabs";
import { openGoalTarget } from "../features/commandCenter/model/goalView";

let mount: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount); });
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
function fixture() {
  const f = createWorkerFixture(bindWorkerApp), h = f.host;
  Object.assign(h, { React, WorkerConversationPicker, TeamMapHeaderAction: () => null, Modal: ({ title, children }: any) => <div role="dialog" aria-modal="true">{title}{children}</div>,
    SessionPane: (props: any) => <section data-actual-pane={props.session.id} data-task-state={props.workerPage?.task?.status} data-focused={props.focused} data-add-to-chat={props.addToChatTarget} data-composer={props.composerFocused}>{props.session.blocks[0]?.text}<button onClick={() => props.onFocus(props.session.id)}>Focus</button></section>,
    sessionPaneProps: { onFocus: h.onFocusPane },
  });
  f.onRefresh(() => root.render(<>{h.renderPages()}</>));
  const render = async () => act(async () => { h.refreshFocus(); root.render(<>{h.renderPages()}</>); });
  const open = async (owner: string, target?: any) => act(async () => { await h.openWorkerTask(owner, target); h.recordVisit(); await render(); });
  const visible = () => [...mount.querySelectorAll<HTMLElement>('[data-worker-conversation]')].filter(node => node.getAttribute("aria-hidden") === "false");
  const assertTask = (owner: string, id: string) => {
    expect(h.monoViewId).toBe(`${owner}-home`); expect(h.activeSessionId).toBe(id);
    expect(visible().map(node => node.dataset.workerConversation)).toEqual([id]);
    expect(h.openMonoTabs.filter((value: string) => value === owner)).toHaveLength(1);
    expect(h.tabs).toHaveLength(1); expect(h.tabs[0].focusedId).toBe("unrelated");
    expect(f.events.filter(event => ["project", "worktree", "sidebar", "project-addition", "append-tab", "activate-tab", "focus-workspace", "persist"].includes(event.action))).toEqual([]);
    expect(mount.querySelectorAll('[data-actual-pane][data-focused="true"]')).toHaveLength(1);
  };
  return { ...f, h, open, render, visible, assertTask };
}

it("A direct task props select exact current/saved conversation on one owner page without changing workspace", async () => {
  const f = fixture(), before = JSON.stringify(f.sessions);
  await act(async () => { await f.h.onOpenRailMono("worker", { taskId: "a", sessionId: "task-a" }); });
  f.assertTask("worker", "task-a");
  await f.open("worker", { taskId: "a", sessionId: "past-a" }); f.assertTask("worker", "past-a");
  expect(mount.textContent).toContain("in task-checkout");
  expect(JSON.stringify(f.sessions)).toBe(before);
});

it("B assignment/activity/card callback uses exact attempt metadata including queued tasks", async () => {
  const f = fixture();
  await act(async () => { f.h.openCard("past-a", { taskId: "a", sessionId: "past-a" }); }); f.assertTask("worker", "past-a");
  await f.open("worker", { taskId: "queued", sessionId: "queued-session" });
  expect(mount.textContent).toContain("Not started yet"); expect(f.visible()).toHaveLength(0); expect(f.h.activeSessionId).toBeUndefined();
  expect(f.h.tabs).toHaveLength(1);
});

it("C history/approval/notification/timeline/reminder intercept before load/focus/project fallbacks", async () => {
  const f = fixture();
  for (const name of ["onSelectHistorySession", "onOpenApprovalSession", "onOpenInboxSession", "onOpenMonoLaunchedSession", "openReminderSession"]) {
    await act(async () => { await f.h[name]("past-a"); }); f.assertTask("worker", "past-a");
  }
  await act(async () => { await openGoalTarget({ taskId: "a", sessionId: "task-a" }, { close: vi.fn(), request: f.h.onOpenApprovalSession, mono: f.h.onOpenMono, session: f.h.onOpenMonoLaunchedSession,
    task: target => f.h.openWorkerTask("worker", target) }); });
  f.assertTask("worker", "task-a");
});

it("D sidebar/title/floating/default return remembers explicit Home or task, otherwise newest current", async () => {
  const f = fixture(); await f.open("worker"); f.assertTask("worker", "task-b");
  await f.open("worker", { taskId: "a", sessionId: "past-a" });
  await act(async () => { f.h.closeMonoView(); f.h.onSelectTitleTab(monoTabId("worker")); }); f.assertTask("worker", "past-a");
  await f.open("worker", null); expect(f.h.activeSessionId).toBe("worker-home");
  await act(async () => { f.h.closeMonoView(); await f.h.onOpenMono("worker"); }); expect(f.h.activeSessionId).toBe("worker-home");
});

it("E switcher supports arrow keys, all Current tasks, saved attempt N and Back/Forward exact selections", async () => {
  const f = fixture(); await f.open("worker", null);
  const home = mount.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  await act(async () => home.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe("Current (3)");
  expect(mount.querySelectorAll('.cc-worker-assignments button')).toHaveLength(3);
  await f.open("worker", { taskId: "a", sessionId: "task-a" }); await f.open("worker", { taskId: "a", sessionId: "past-a" });
  expect(mount.querySelector('.cc-worker-assignments')?.textContent).toContain("Attempt 1");
  expect(mount.querySelector('.cc-worker-assignments')?.textContent).toContain("Attempt 2");
  await act(async () => { f.h.onVisitBack(); }); f.assertTask("worker", "task-a");
  await act(async () => { f.h.onVisitForward(); }); f.assertTask("worker", "past-a");
});

it("F memberless task opens its canonical Manager conversation in place", async () => {
  const f = fixture(); await act(async () => { await f.h.onSelectHistorySession("manager-task"); });
  f.assertTask("manager", "manager-task"); expect(f.h.workerPages.manager.target.taskId).toBe("direct");
});

it("G one-time migration detaches current/any-attempt leaves, preserves mixed panes/deleted-run tabs and makes zero lifecycle calls", async () => {
  const f = fixture(), original = JSON.stringify(f.sessions);
  const mixed: WorkspaceTab = { ...newTab("past-a"), id: "mixed", layout: { type: "split", id: "split", dir: "right", sizes: [.2, .4, .4], children: [leaf("past-a"), leaf("unrelated"), leaf("editor")] },
    editorPanes: [{ id: "editor", files: [{ id: "file", path: "C:/draft", cwd: f.project }], activeFileId: "file" }] };
  const deleted = newTab("deleted-run-session"); f.h.tabs = [newTab("task-a"), mixed, deleted]; f.h.tabsRef.current = f.h.tabs; f.h.activeTabIdRef.current = "mixed";
  await act(async () => f.h.migrate());
  expect(f.h.tabs).toHaveLength(2); expect(leafIds(f.h.tabs[0].layout)).toEqual(["unrelated", "editor"]);
  expect(f.h.tabs[0].editorPanes).toBe(mixed.editorPanes); expect(f.h.tabs[1]).toBe(deleted);
  expect(f.h.workerPages.worker.target).toEqual({ taskId: "a", sessionId: "past-a" });
  const migrated = f.h.tabs; await act(async () => f.h.migrate()); expect(f.h.tabs).toBe(migrated);
  expect(f.events).toEqual([]); expect(JSON.stringify(f.sessions)).toBe(original);
});

it("H Escape stops only the selected busy session; nonbusy/placeholder/hidden Home cannot own Stop or focus", async () => {
  const f = fixture(), cleanup = f.h.registerEscape();
  const esc = async () => act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
  try {
    await f.open("worker", { taskId: "a", sessionId: "task-a" }); await esc();
    expect(f.events.filter(e => e.action === "stop")).toEqual([{ action: "stop", id: "task-a" }]);
    await f.open("worker", { taskId: "b", sessionId: "task-b" }); await esc();
    await f.open("worker", { taskId: "queued", sessionId: "queued-session" }); await esc();
    expect(f.events.filter(e => e.action === "stop")).toHaveLength(1);
    f.h.onFocusPane("worker-home"); expect(f.h.monoViewId).toBe("worker-home"); expect(f.h.activeSessionId).toBeUndefined();
  } finally { cleanup(); }
});

it.each(["B", "Home", "close"])("H delayed A completion cannot replace newer %s intent or focus", async kind => {
  const f = fixture(); f.defer("task-a");
  let pending!: Promise<void>; await act(async () => { pending = f.h.openWorkerTask("worker", { taskId: "a", sessionId: "task-a" }); });
  if (kind === "close") await act(async () => f.h.closeMonoView());
  else await f.open("worker", kind === "Home" ? null : { taskId: "b", sessionId: "task-b" });
  const selected = JSON.stringify(f.h.workerPages), focus = f.h.composerFocusToken;
  await act(async () => { f.release("task-a"); await pending; });
  expect(JSON.stringify(f.h.workerPages)).toBe(selected); expect(f.h.composerFocusToken).toBe(focus);
  expect(f.h.monoViewId).toBe(kind === "close" ? null : "worker-home");
});

it("H gone/archived/mismatched targets show unavailable without a Home or workspace fallback", async () => {
  const f = fixture(); await f.open("worker", { taskId: "gone", sessionId: "gone-session" }); expect(f.visible()).toHaveLength(0);
  expect(mount.textContent).toContain("no longer available"); expect(f.h.activeSessionId).toBeUndefined();
  f.h.workerHistoryRef.current = f.h.history = [{ id: "task-a", archived: true }];
  await f.open("worker", { taskId: "a", sessionId: "task-a" }); expect(mount.textContent).toContain("archived");
  await f.open("worker", { taskId: "a", sessionId: "task-b" }); expect(mount.textContent).toContain("no longer available for this worker");
  expect(f.h.activeSessionId).toBeUndefined(); expect(f.h.tabs).toHaveLength(1);
});

it("H archive metadata from another project is checked before loading, and a removed worker stays unavailable", async () => {
  const f = fixture(); f.h.invoke = async () => [{ id: "task-a", archived: true }];
  await f.open("worker", { taskId: "a", sessionId: "task-a" });
  expect(mount.textContent).toContain("archived"); expect(f.events.filter(e => e.action === "load" && e.id === "task-a")).toEqual([]);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(f.roster.filter(owner => owner.id !== "worker")));
  await f.open("worker", { taskId: "a", sessionId: "task-a" });
  expect(mount.querySelector('[role="dialog"]')?.textContent).toContain("no longer available"); expect(f.h.activeSessionId).toBeUndefined();
});

it("H retry during load retains only the requested saved attempt and its recorded display state", async () => {
  const f = fixture(); f.defer("task-a");
  let pending!: Promise<void>; await act(async () => { pending = f.h.openWorkerTask("worker", { taskId: "a", sessionId: "task-a" }); });
  const task = f.run.tasks.find(task => task.id === "a")!;
  task.sessionId = "replacement"; task.activeDispatchId = "a-3";
  f.run.dispatches!.find(dispatch => dispatch.id === "a-2")!.state = "cancelled";
  f.run.dispatches!.push({ ...f.run.dispatches![1], id: "a-3", sessionId: "replacement", state: "running", startedAt: 500 });
  await act(async () => { f.release("task-a"); await pending; });
  f.assertTask("worker", "task-a"); expect(mount.querySelector('[data-actual-pane="task-a"]')?.getAttribute("data-task-state")).toBe("cancelled");
  expect(task.status).toBe("running"); expect(task.sessionId).toBe("replacement");
});

it("D implicit default is recomputed on reopen; an explicit Home stays Home", async () => {
  const f = fixture(); await f.open("worker"); f.assertTask("worker", "task-b");
  const task = f.run.tasks.find(task => task.id === "a")!;
  f.run.dispatches!.find(dispatch => dispatch.id === task.activeDispatchId)!.startedAt = 500;
  await f.open("worker"); f.assertTask("worker", "task-a");
  await f.open("worker", null); await f.open("worker"); expect(f.h.activeSessionId).toBe("worker-home");
});

it("H session-list shortcuts select the worker conversation in place, and explicit worktree/plain/non-PM routes retain their path", async () => {
  const f = fixture(); await f.open("worker", { taskId: "a", sessionId: "task-a" });
  await act(async () => { f.h.onNavigateSessionList(1, true); }); f.assertTask("worker", "past-a");
  const workspace = { project: f.project, tree: { path: f.foreign, missing: false, branch: "feature" } };
  await act(async () => { await f.h.onSelectHistorySession("task-a", workspace); });
  expect(f.events.some(event => event.action === "worktree")).toBe(true); expect(f.events.some(event => event.action === "append-tab")).toBe(true);
  const plain = fixture(); await act(async () => { await plain.h.onSelectHistorySession("unrelated"); }); expect(plain.events.some(event => event.action === "append-tab")).toBe(true);
  const nonPm = fixture(); nonPm.h.orchestrationRuns = [{ ...nonPm.run, projectManager: false, ownerMonoId: undefined, ownerSessionId: "plain-lead", leadId: "plain-lead", tasks: [{ ...nonPm.run.tasks[0], memberId: undefined }] }];
  await act(async () => { await nonPm.h.onSelectHistorySession("task-a"); }); expect(nonPm.events.some(event => event.action === "append-tab")).toBe(true);
});
