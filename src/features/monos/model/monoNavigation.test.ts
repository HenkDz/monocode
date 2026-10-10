// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Storage } from "happy-dom";
import { loadMonoView, saveMonoView, monoForView, memberDetailsView, memberTasks, memberAvailability, selectedOrgMono } from "./monoNavigation";
import { monoForSession, monoStatusLabel, type Mono } from "./mono";
import { reconcileProjectReturn } from "../../projects/model/projectReturn";
import { newTab } from "../../workspace/model/layout";
import { memberMonoState, monoLiveState } from "./monoNavigation";
import { newSession } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

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

it("keeps own status idle while counting working descendants once, including worker sessions", () => {
  const roster = [
    { id: "o", role: "orchestrator", sessionId: "orch", projects: [] },
    { id: "m", role: "manager", reportsTo: "o", sessionId: "manager", projects: ["C:/projects/dzdistro"] },
    { id: "b", role: "member", reportsTo: "m", projects: ["C:/projects/dzdistro"] },
    { id: "old", role: "manager", reportsTo: "o", sessionId: "archived", projects: [], archivedAt: 1 },
  ] as Mono[];
  const sessions = ["orch", "manager", "archived"].map(id => ({ ...newSession("codex", "/app"), id, busy: id !== "orch" }));
  expect(monoLiveState(roster, [], sessions, "o")).toEqual({ status: "idle", teamWorking: 1 });
  const working = [{ ...runs[0], ownerMonoId: "m", tasks: [{ ...runs[0].tasks[1], memberId: "b", status: "running", title: "Routing", prompt: "Routing" }] }] as OrchestrationRun[];
  expect(monoLiveState(roster, working, sessions, "o")).toEqual({ status: "idle", teamWorking: 2 });
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
  expect(state).toEqual({ status: "needs-you", attentionLocation: "dzdistro", activity: "Choose" });
  expect(monoStatusLabel(state)).toBe("Needs you · in dzdistro");
  expect(monoLiveState(roster, [], [manager], "m")).toEqual({ status: "needs-you", activity: "Choose" });
  const paused = [{ leadId: "engine", projectManager: true, ownerMonoId: "m", ownerSessionId: "manager", cwd: "C:/projects/dzdistro", status: "paused", tasks: [] }] as unknown as OrchestrationRun[];
  expect(monoLiveState(roster, paused, [{ ...manager, pendingQuestion: undefined }], "o")).toMatchObject({ status: "needs-you", attentionLocation: "dzdistro" });
  const own = { ...newSession("codex", "/app"), id: "orch", busy: true };
  expect(monoLiveState(roster, [], [own], "o")).toEqual({ status: "working", activity: "Thinking" });
});

it("uses worker availability and tool activity while the durable member chat is idle", () => {
  const worker = { ...newSession("codex", "/app"), id: "worker-chat", busy: true, blocks: [{ id: "step", role: "tool" as const, text: "", tool: { title: "Checking routing" } }] } as ReturnType<typeof newSession>;
  const working = [{ ...runs[0], tasks: [{ ...runs[0].tasks[1], status: "running", prompt: "Routing", title: "Routing" }] }] as OrchestrationRun[];
  expect(memberMonoState(working, "backend", [worker], "idle-chat")).toEqual({ status: "working", activity: "Checking routing" });
  expect(memberMonoState(working, "backend", [{ ...worker, blocks: [{ ...worker.blocks[0], approval: { requestId: 1 } }] }])).toMatchObject({ status: "needs-you" });
  const chat = { ...worker, id: "member-chat", blocks: [{ ...worker.blocks[0], tool: { title: "Answering your question" } }] };
  expect(memberMonoState(working, "backend", [worker, chat], "member-chat")).toEqual({ status: "working", activity: "Answering your question" });
  expect(memberMonoState([], "backend", [chat], "member-chat")).toEqual({ status: "working", activity: "Answering your question" });
});

it("shows current member availability without historical task outcomes dominating", () => {
  const task = (status: OrchestrationRun["tasks"][number]["status"], sessionId = "worker") => ({ status, sessionId }) as OrchestrationRun["tasks"][number];
  expect(memberAvailability([])).toBe("idle");
  for (const status of ["queued", "completed", "cancelled"] as const)
    expect(memberAvailability([task(status)])).toBe("idle");
  for (const status of ["running", "cancelling"] as const)
    expect(memberAvailability([task(status)])).toBe("working");
  for (const status of ["blocked", "failed", "interrupted"] as const)
    expect(memberAvailability([task(status)])).toBe("needs-you");
  expect(memberAvailability([task("running")], new Set(["worker"]))).toBe("needs-you");
  expect(memberAvailability([task("completed")], new Set(), new Set(["worker"]))).toBe("working");
  expect(memberAvailability([task("completed"), task("failed", "old")])).toBe("idle");
  expect(memberAvailability([task("running"), task("blocked", "old")], new Set(["old"]))).toBe("working");
  expect(memberAvailability([], new Set(["chat"]), new Set(["chat"]), "chat")).toBe("needs-you");
  expect(memberAvailability([], new Set(), new Set(["chat"]), "chat")).toBe("working");
});

it("derives a single row from the visible pane, never the hidden workspace session", () => {
  expect(selectedOrgMono("regular-chat", null, runs)).toBeUndefined();
  expect(selectedOrgMono("regular-chat", "manager-chat", runs)).toBe("manager");
  expect(selectedOrgMono("regular-chat", memberDetailsView("backend"), runs)).toBe("backend");
  expect(selectedOrgMono("worker-chat", null, runs)).toBeUndefined();
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
