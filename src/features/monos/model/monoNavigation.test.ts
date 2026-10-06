// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { loadMonoView, saveMonoView, memberDetailsView, memberTasks, selectedOrgMono } from "./monoNavigation";
import { reconcileProjectReturn } from "../../projects/model/projectReturn";
import { newTab } from "../../workspace/model/layout";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

vi.mock("./mono", () => {
  const roster = [
    { id: "manager", role: "manager", sessionId: "manager-chat", projects: ["/app"] },
    { id: "backend", role: "member", projects: ["/app"] },
    { id: "boss", role: "orchestrator", sessionId: "boss-chat", projects: ["/app"] },
  ];
  return { findMono: (id: string) => roster.find(m => m.id === id), monoForSession: (id: string) => roster.find(m => m.sessionId === id) };
});
beforeEach(() => localStorage.clear());
const runs = [{ tasks: [
  { id: "old", memberId: "backend", sessionId: "old-chat" },
  { id: "new", memberId: "backend", sessionId: "worker-chat" },
], dispatches: [{ taskId: "old", startedAt: 10 }, { taskId: "new", startedAt: 20 }] }] as OrchestrationRun[];

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
