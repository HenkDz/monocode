// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Storage } from "happy-dom";
import { loadMonoView, saveMonoView, monoForView, memberDetailsView, memberTasks, selectedOrgMono, workbenchSessionTask } from "./monoNavigation";
import { monoForSession, monoStatusLabel, type Mono } from "./mono";
import { reconcileProjectReturn } from "../../projects/model/projectReturn";
import { newTab } from "../../workspace/model/layout";
import { memberMonoState, monoLiveState } from "./monoNavigation";
import { newSession } from "../../sessions/model/session";
import { workspaceIdentity, type OrchestrationRun, type OrchestrationTask, type OrchestrationDispatch } from "../../orchestration/model/orchestrationState";
import { selectAgentLiveState } from "../../agents/model/agentLiveState";

vi.mock("./mono", async (original) => {
  const roster = [
    { id: "manager", role: "manager", sessionId: "manager-chat", projects: ["/app"] },
    { id: "backend", role: "member", projects: ["/app"] },
    { id: "boss", role: "orchestrator", sessionId: "boss-chat", projects: ["/app"] },
    { id: "archived-member", role: "member", sessionId: "archived-chat", projects: ["/app"], archivedAt: 1 },
  ];
  return { ...(await original<object>()), findMono: (id: string) => roster.find(m => m.id === id), monoForSession: (id: string) => roster.find(m => m.sessionId === id) };
});
beforeEach(() => vi.stubGlobal("localStorage", new Storage()));
afterEach(() => vi.unstubAllGlobals());
it("does not restore or select archived member chats, while retaining their history lookup", () => {
  localStorage.setItem("monocode:mono-view:main", "archived-chat");
  expect(loadMonoView("main")).toBeNull();
  expect(monoForView("archived-chat")).toBeUndefined();
  expect(monoForView(memberDetailsView("archived-member"))).toBeUndefined();
  expect(selectedOrgMono("archived-chat", null, [])).toBeUndefined();
  expect(monoForSession("archived-chat")?.id).toBe("archived-member");
});
const runs = [{ tasks: [
  { id: "old", memberId: "backend", sessionId: "old-chat" },
  { id: "new", memberId: "backend", sessionId: "worker-chat" },
], dispatches: [{ taskId: "old", startedAt: 10 }, { taskId: "new", startedAt: 20 }] }] as OrchestrationRun[];

function workbenchTask(patch: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    id: "review", memberId: "backend", sessionId: "latest-worker", title: "Review the saved change",
    harness: "codex", model: "fixture", prompt: "Review", files: [], scopes: [], dependsOn: [],
    status: "running", accepted: false, result: "", delivered: false,
    workspace: workspaceIdentity("/repo", "/latest", "latest"), activeDispatchId: "latest-dispatch", lastDispatchId: "latest-dispatch",
    ...patch,
  };
}
function workbenchDispatch(patch: Partial<OrchestrationDispatch> = {}): OrchestrationDispatch {
  return {
    id: "old-dispatch", taskId: "review", sessionId: "old-worker",
    workspace: workspaceIdentity("/repo", "/historical", "historical"),
    state: "failed", stage: "settled", startedAt: 10, updatedAt: 20,
    ...patch,
  };
}
function workbenchRun(leadId: string, tasks: OrchestrationTask[], dispatches: OrchestrationDispatch[]): OrchestrationRun {
  return { version: 2, leadId, cwd: "/repo", status: "active", allowedHarnesses: ["codex"], maxWorkers: 1, cli: "fixture", tasks, dispatches, continuations: 0, requests: {} };
}

it("keeps the current member worker's binding object authoritative over an older dispatch", () => {
  const task = workbenchTask();
  const run = workbenchRun("lead", [task], [workbenchDispatch({ sessionId: task.sessionId, error: "Old failure" })]);
  expect(workbenchSessionTask([run], task.sessionId)).toBe(task);
  expect(workbenchSessionTask([run], task.sessionId)?.workspace?.checkoutCwd).toBe("/latest");
  expect(task.status).toBe("running");
  expect(task.error).toBeUndefined();
});

it.each([
  [{ error: "Historical launch failed" }, "Historical launch failed"],
  [{ cleanupError: "Historical cleanup failed" }, "Historical cleanup failed"],
  [{}, undefined],
] as const)("uses exact historical dispatch workspace/error without mutating the live task: %s", (patch, error) => {
  const task = workbenchTask({ error: "Latest worker failed" });
  const dispatch = workbenchDispatch(patch);
  const run = workbenchRun("lead", [task], [dispatch]);
  const before = structuredClone(run);
  const view = workbenchSessionTask([run], "old-worker")!;
  expect(view).not.toBe(task);
  expect(view).toMatchObject({ sessionId: "old-worker", status: "failed", lastDispatchId: "old-dispatch", accepted: false });
  expect(view.activeDispatchId).toBeUndefined();
  expect(view.workspace).toBe(dispatch.workspace);
  expect(view.workspace?.checkoutCwd).toBe("/historical");
  expect(view.error).toBe(error);
  expect(run).toEqual(before);
});

it("scopes the historical task link to its exact Manager run when task IDs are reused", () => {
  const other = workbenchTask({ sessionId: "other-current", error: "Other Manager error", workspace: workspaceIdentity("/other", "/other-current") });
  const task = workbenchTask({ title: "Correct Manager assignment" });
  const dispatch = workbenchDispatch({ error: "Correct historical error" });
  const runs = [
    workbenchRun("other-lead", [other], [workbenchDispatch({ sessionId: "other-old", workspace: workspaceIdentity("/other", "/other-old"), error: "Other old error" })]),
    workbenchRun("correct-lead", [task], [dispatch]),
  ];
  const view = workbenchSessionTask(runs, "old-worker")!;
  expect(view.title).toBe("Correct Manager assignment");
  expect(view.workspace).toBe(dispatch.workspace);
  expect(view.error).toBe("Correct historical error");
  expect(view.memberId).toBe(task.memberId);
});

it.each(["completed", "running"] as const)("keeps %s historical dispatch content separate from the latest task", state => {
  const task = workbenchTask({ prompt: "New brief", result: "New report", reportArtifactId: "new-report", reviewArtifactId: "new-review", prSummaryArtifactId: "new-summary", prUrl: "https://example.test/new", checkoutBaseline: { head: "new", fingerprint: "new", inheritedChangedPaths: ["new-a", "new-b"] } });
  const dispatch = workbenchDispatch({ state, result: "Old report", checkoutBaseline: { head: "old", fingerprint: "old", inheritedChangedPaths: ["old-a"] } });
  const view = workbenchSessionTask([workbenchRun("lead", [task], [dispatch])], "old-worker")!;
  expect(view).toMatchObject({ historical: true, prompt: "", result: "Old report", checkoutBaseline: dispatch.checkoutBaseline });
  for (const key of ["reportArtifactId", "reviewArtifactId", "reviewVerdict", "prSummaryArtifactId", "prUrl"] as const) expect(view[key]).toBeUndefined();
  expect(task.result).toBe("New report");
});

it("withholds historical content when the dispatch never saved it", () => {
  const task = workbenchTask({ result: "New report", checkoutBaseline: { head: "new", fingerprint: "new" } });
  const view = workbenchSessionTask([workbenchRun("lead", [task], [workbenchDispatch()])], "old-worker")!;
  expect(view.result).toBe("");
  expect(view.prompt).toBe("");
  expect(view.checkoutBaseline).toBeUndefined();
});

it("does not join an orphan dispatch to a matching task ID in a different Manager run", () => {
  const runWithDispatch = workbenchRun("old-lead", [workbenchTask({ id: "unrelated" })], [workbenchDispatch()]);
  const runWithTask = workbenchRun("other-lead", [workbenchTask()], []);
  expect(workbenchSessionTask([runWithDispatch, runWithTask], "old-worker")).toBeUndefined();
  expect(workbenchSessionTask([workbenchRun("lead", [workbenchTask({ memberId: undefined })], [workbenchDispatch()])], "old-worker")).toBeUndefined();
});

it.each([
  ["starting", "queued"],
  ["start_unknown", "interrupted"],
  ["stop_unknown", "interrupted"],
] as const)("keeps historical %s dispatches from claiming running or done", (state, status) => {
  const run = workbenchRun("lead", [workbenchTask()], [workbenchDispatch({ state })]);
  const view = workbenchSessionTask([run], "old-worker")!;
  expect(view.status).toBe(status);
  expect(view.accepted).toBe(false);
  const liveState = selectAgentLiveState(undefined, { task: view });
  expect(["thinking", "running-tool", "done"]).not.toContain(liveState.status);
});

it.each([true, false])("only credits historical review acceptance for its own dispatch (matching: %s)", matching => {
  const task = workbenchTask({ accepted: true, acceptedDispatchId: matching ? "old-dispatch" : "latest-dispatch" });
  const view = workbenchSessionTask([workbenchRun("lead", [task], [workbenchDispatch({ state: "completed" })])], "old-worker")!;
  expect(view.accepted).toBe(matching);
  expect(view.lastDispatchId).toBe("old-dispatch");
  expect(selectAgentLiveState(undefined, { task: view }).status).toBe(matching ? "done" : "waiting-review");
  expect(task.activeDispatchId).toBe("latest-dispatch");
});

it("keeps own status idle while counting working descendants once, including worker sessions", () => {
  const roster = [
    { id: "o", role: "orchestrator", sessionId: "orch", projects: [] },
    { id: "m", role: "manager", reportsTo: "o", sessionId: "manager", projects: ["C:/projects/dzdistro"] },
    { id: "b", role: "member", reportsTo: "m", projects: ["C:/projects/dzdistro"] },
    { id: "old", role: "manager", reportsTo: "o", sessionId: "archived", projects: [], archivedAt: 1 },
  ] as Mono[];
  const sessions = ["orch", "manager", "archived"].map(id => ({ ...newSession("codex", "/app"), id, busy: id !== "orch" }));
  expect(monoLiveState(roster, [], sessions, "o")).toEqual({ status: "idle", liveState: { status: "idle" }, teamWorking: 1 });
  const working = [{ ...runs[0], ownerMonoId: "m", tasks: [{ ...runs[0].tasks[1], memberId: "b", status: "running", title: "Routing", prompt: "Routing" }] }] as OrchestrationRun[];
  expect(monoLiveState(roster, working, sessions, "o")).toEqual({ status: "idle", liveState: { status: "idle" }, teamWorking: 2 });
  expect(monoLiveState(roster, working, sessions, "m")).toMatchObject({ status: "working", teamWorking: 1 });
  expect(monoLiveState(roster, working, sessions, "b").status).toBe("working");
});

it("labels rolled-up attention with its project while retaining direct decisions and own work", () => {
  const roster = [
    { id: "o", role: "orchestrator", sessionId: "orch", projects: [] },
    { id: "m", role: "manager", reportsTo: "o", sessionId: "manager", managerProject: "C:/projects/dzdistro", projects: [] },
  ] as Mono[];
  const manager = { ...newSession("codex", "C:/projects/dzdistro"), id: "manager", pendingQuestion: { requestId: 1, title: "Choose", questions: [] } };
  const state = monoLiveState(roster, [], [manager], "o");
  expect(state).toEqual({ status: "needs-you", attentionLocation: "dzdistro", activity: "Choose", liveState: { status: "needs-you", reason: "decision", detail: "Choose" } });
  expect(monoStatusLabel(state)).toBe("Needs you · in dzdistro");
  expect(monoLiveState(roster, [], [manager], "m")).toEqual({ status: "needs-you", activity: "Choose", liveState: { status: "needs-you", reason: "decision", detail: "Choose" } });
  const paused = [{ leadId: "engine", projectManager: true, ownerMonoId: "m", ownerSessionId: "manager", cwd: "C:/projects/dzdistro", status: "paused", tasks: [] }] as unknown as OrchestrationRun[];
  expect(monoLiveState(roster, paused, [{ ...manager, pendingQuestion: undefined }], "o")).toMatchObject({ status: "needs-you", attentionLocation: "dzdistro" });
  const own = { ...newSession("codex", "/app"), id: "orch", busy: true };
  expect(monoLiveState(roster, [], [own], "o")).toEqual({ status: "working", activity: "Thinking", liveState: { status: "thinking", detail: "Thinking" } });
});

it("uses worker availability and tool activity while the durable member chat is idle", () => {
  const worker = { ...newSession("codex", "/app"), id: "worker-chat", busy: true, blocks: [{ id: "step", role: "tool" as const, text: "", tool: { title: "Checking routing" } }] } as ReturnType<typeof newSession>;
  const working = [{ ...runs[0], tasks: [{ ...runs[0].tasks[1], status: "running", prompt: "Routing", title: "Routing" }] }] as OrchestrationRun[];
  expect(memberMonoState(working, "backend", [worker], "idle-chat")).toEqual({ status: "working", activity: "Checking routing", liveState: { status: "running-tool", detail: "Checking routing" } });
  expect(memberMonoState(working, "backend", [{ ...worker, blocks: [{ ...worker.blocks[0], approval: { requestId: 1 } }] }])).toMatchObject({ status: "needs-you" });
  const chat = { ...worker, id: "member-chat", blocks: [{ ...worker.blocks[0], tool: { title: "Answering your question" } }] };
  expect(memberMonoState(working, "backend", [worker, chat], "member-chat")).toEqual({ status: "working", activity: "Answering your question", liveState: { status: "running-tool", detail: "Answering your question" } });
  expect(memberMonoState([], "backend", [chat], "member-chat")).toEqual({ status: "working", activity: "Answering your question", liveState: { status: "running-tool", detail: "Answering your question" } });
});

it("keeps a queued member blocked by storage out of Idle and preserves the block in its parent", () => {
  const roster = [
    { id: "m", role: "manager", sessionId: "manager", projects: ["/app"] },
    { id: "b", role: "member", reportsTo: "m", sessionId: "member", projects: ["/app"] },
  ] as Mono[];
  const member = { ...newSession("codex", "/app"), id: "member", codexStorageError: "Repair required", queuedMessages: [{ id: "q", text: "review", attachments: [] }] };
  expect(memberMonoState([], "b", [member], "member").liveState).toEqual({ status: "blocked", reason: "storage", detail: "Repair required" });
  expect(monoStatusLabel(monoLiveState(roster, [], [member], "m"))).toBe("Blocked · storage · in app");
});

it("preserves storage blocking from the member chat or current worker above running work", () => {
  const chat = { ...newSession("codex", "/app"), id: "member-chat", codexStorageError: "hooks.json conflict" };
  const worker = { ...newSession("codex", "/app"), id: "worker-chat", busy: true };
  const working = [{ ...runs[0], tasks: [{ ...runs[0].tasks[1], status: "running", title: "Routing", prompt: "Routing" }] }] as OrchestrationRun[];
  const blocked = { status: "needs-you", activity: "hooks.json conflict", liveState: { status: "blocked", reason: "storage", detail: "hooks.json conflict" } };
  expect(memberMonoState(working, "backend", [worker, chat], chat.id)).toEqual(blocked);
  expect(memberMonoState(working, "backend", [{ ...worker, codexStorageError: "hooks.json conflict" }, { ...chat, codexStorageError: undefined }], chat.id)).toEqual(blocked);
  expect(memberMonoState(working, "backend", [{ ...worker, codexStorageError: "hooks.json conflict" }, { ...chat, codexStorageError: undefined, pendingQuestion: { requestId: 1, title: "Choose", questions: [] } }], chat.id)).toEqual(blocked);
  expect(memberMonoState(working, "backend", [worker, { ...chat, codexStorageError: undefined }], chat.id)).toEqual({ status: "working", activity: "Thinking", liveState: { status: "thinking", detail: "Thinking" } });
  const roster = [{ id: "backend", role: "member", sessionId: chat.id, projects: [] }] as unknown as Mono[];
  expect(monoStatusLabel(monoLiveState(roster, working, [worker, chat], "backend"))).toBe("Blocked · storage");
});

it("keeps canonical blockers above rolled-up decisions in the same agent", () => {
  const roster = [{ id: "reviewer", role: "member", sessionId: "reviewer-chat", projects: ["/app"] }] as Mono[];
  const reviewer = { ...newSession("codex", "/app"), id: "reviewer-chat", codexStorageError: "Repair hooks.json", pendingQuestion: { requestId: 1, title: "Choose", questions: [] } };
  const state = monoLiveState(roster, [], [reviewer], "reviewer");
  expect(state.liveState).toEqual({ status: "blocked", reason: "storage", detail: "Repair hooks.json" });
  expect(monoStatusLabel(state)).toBe("Blocked · storage");
});

it("shows held updates across the manager's owned runs without attributing them to its parent", () => {
  const roster = [
    { id: "o", role: "orchestrator", sessionId: "orch", projects: [] },
    { id: "m", role: "manager", reportsTo: "o", sessionId: "manager", projects: ["/app"] },
  ] as Mono[];
  const runs = [
    { ownerMonoId: "m", status: "active", tasks: [{ id: "one", status: "running", activeDispatchId: "one" }], wakeState: {
      waves: [{ id: "wave-one", dispatchIds: ["one"], sealedAt: 1 }],
      events: [{ id: "one", kind: "info", at: 1, text: "Progress" }, { id: "two", kind: "info", at: 2, text: "Progress" }],
    } },
    { ownerSessionId: "manager", status: "active", tasks: [{ id: "two", status: "cancelling", lastDispatchId: "two" }], wakeState: {
      waves: [{ id: "wave-two", dispatchIds: ["two"], sealedAt: 1 }],
      events: [{ id: "three", kind: "info", at: 3, text: "Progress" }, { id: "seen", kind: "info", at: 0, text: "Seen", acknowledgedAt: 0 }],
    } },
    { ownerMonoId: "other", status: "active", tasks: [], wakeState: { waves: [], events: [{ id: "other", kind: "info", at: 1, text: "Other manager" }] } },
  ] as unknown as OrchestrationRun[];
  const manager = { ...newSession("codex", "/app"), id: "manager" };
  const state = monoLiveState(roster, runs, [manager], "m");
  expect(state.liveState).toEqual({ status: "waiting-on-member", reason: "held-updates", detail: "Waiting for 2 workers · Has an update for you" });
  expect(state.status).toBe("idle");
  expect(monoStatusLabel(state)).toBe("Waiting for 2 workers · Has an update for you");
  expect(monoLiveState(roster, runs, [manager], "o").liveState).toEqual({ status: "idle" });
  const blocked = monoLiveState(roster, runs, [{ ...manager, codexStorageError: "Repair required" }], "m");
  expect(blocked.liveState).toEqual({ status: "blocked", reason: "storage", detail: "Repair required" });
  expect(monoStatusLabel(blocked)).toBe("Blocked · storage");
});

it("shows current member availability without historical task outcomes dominating", () => {
  const current = { id: "current", memberId: "backend", status: "running", sessionId: "worker" } as OrchestrationRun["tasks"][number];
  const old = { id: "old", memberId: "backend", status: "failed", sessionId: "old-worker" } as OrchestrationRun["tasks"][number];
  const runs = [{ tasks: [old, current], dispatches: [{ taskId: "old", startedAt: 1 }, { taskId: "current", startedAt: 2 }] }] as OrchestrationRun[];
  expect(memberMonoState(runs, "backend", []).liveState?.status).toBe("thinking");
  current.status = "completed"; current.accepted = true;
  expect(memberMonoState(runs, "backend", []).liveState?.status).toBe("done");
  current.status = "queued";
  expect(memberMonoState(runs, "backend", []).liveState?.status).toBe("queued");
});

it("uses the selected member task's own run pause instead of another run with the same task ID", () => {
  const older = workbenchTask({ status: "queued" });
  const newer = workbenchTask({ status: "queued" });
  const unrelated = { ...workbenchRun("older", [older], [workbenchDispatch({ startedAt: 1 })]), status: "active" as const };
  const paused = { ...workbenchRun("newer", [newer], [workbenchDispatch({ startedAt: 2 })]), status: "paused" as const, lastPauseReason: "Owner explicitly paused for review" };
  expect(memberMonoState([unrelated, paused], "backend", []).liveState).toEqual(
    selectAgentLiveState(undefined, { task: newer, tasks: paused.tasks, runStatus: paused.status, pauseReason: paused.lastPauseReason }),
  );
  expect(memberMonoState([unrelated, paused], "backend", []).liveState?.detail).toBe(paused.lastPauseReason);
});

it("resolves a member's dependencies against all tasks in its owning run", () => {
  const dependency = workbenchTask({ id: "prepare", memberId: "other", status: "completed", accepted: true });
  const task = workbenchTask({ status: "queued", dependsOn: [dependency.id] });
  const run = workbenchRun("lead", [dependency, task], []);
  expect(memberMonoState([run], "backend", []).liveState).toEqual(
    selectAgentLiveState(undefined, { task, tasks: run.tasks, runStatus: run.status }),
  );
  expect(memberMonoState([run], "backend", []).liveState?.reason).not.toBe("dependency");
});

it("derives a single row from the visible pane, never the hidden workspace session", () => {
  expect(selectedOrgMono("regular-chat", null, runs)).toBeUndefined();
  expect(selectedOrgMono("regular-chat", "manager-chat", runs)).toBe("manager");
  expect(selectedOrgMono("regular-chat", memberDetailsView("backend"), runs)).toBe("backend");
    expect(selectedOrgMono("worker-chat", null, runs)).toBe("backend");
  expect(selectedOrgMono("worker-chat", "boss-chat", runs)).toBe("boss");
  expect(memberTasks(runs, "backend")[0].sessionId).toBe("worker-chat");
});

it("remembers the actual manager/member selection for project return and reload", () => {
  const tab = newTab("regular-chat");
  const state = { tabs: [tab], sessions: [{ id: "regular-chat", cwd: "/app" }], activeTabId: tab.id };
  let memory = reconcileProjectReturn({ ...state, memory: new Map() });
  expect(memory.get("/app")).toBe("regular-chat");
  for (const view of ["manager-chat", memberDetailsView("backend")]) {
    memory = reconcileProjectReturn({ ...state, memory, activeStandaloneId: view });
    expect(memory.get("/app")).toBe(view);
    saveMonoView("main", view);
    expect(loadMonoView("main")).toBe(view);
    expect(reconcileProjectReturn({ ...state, memory, activeStandaloneId: loadMonoView("main") }).get("/app")).toBe(view);
  }
  memory = reconcileProjectReturn({ ...state, memory, activeStandaloneId: "boss-chat" });
  expect(memory.get("/app")).toBe(memberDetailsView("backend"));
  saveMonoView("main", null);
  expect(loadMonoView("main")).toBeNull();
});
