// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoTeamActivity } from "./MonoTeamActivity";
import { teamDecisions, orgDescendants } from "../model/monoTeamActivity";
import { newSession } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Mono } from "../model/mono";
import { monoManagerGoals, type MonoManagerGoal } from "../model/monoManagerGoals";
import { orchestrator } from "../../orchestration/model/orchestration";
const roster: Mono[] = [
  { id: "o", role: "orchestrator", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "m", role: "manager", reportsTo: "o", sessionId: "manager-chat", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#abc" },
  { id: "b", role: "member", reportsTo: "m", projects: ["/app"], specialty: "Backend", name: "Backend", mascot: "cat", color: "#abc" },
];
it("groups descendant decisions once and routes inline approval to the worker session", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const session = { ...newSession("codex", "/app"), id: "worker", busy: true, blocks: [{ id: "a", role: "tool" as const, text: "Run guarded command", approval: { requestId: 42, autoApprovalReason: "wrapped by untrusted rtk, call the app CLI directly" } }] };
  const runs = [{ leadId: "engine", ownerMonoId: "m", cwd: "/app", tasks: [{ id: "t", title: "API", memberId: "b", sessionId: "worker", status: "running" }], dispatches: [] }] as unknown as OrchestrationRun[];
  expect([...orgDescendants(roster, "o")]).toEqual(["o", "m", "b"]);
  const shared = teamDecisions(roster, [session], runs);
  expect(shared).toHaveLength(1);
  expect(teamDecisions(roster, [{ ...session, blocks: [...session.blocks, { ...session.blocks[0], id: "duplicate" }] }], runs)).toHaveLength(1);
  expect(teamDecisions(roster, [session, session], runs)).toHaveLength(1);
  expect(teamDecisions(roster, [session], runs, "m")).toHaveLength(1);
  expect(teamDecisions(roster, [session], runs, "unrelated")).toHaveLength(0);
  const container = document.createElement("div"), root = createRoot(container), approve = vi.fn();
  const resume = vi.spyOn(orchestrator, "continueManager").mockResolvedValue();
  const goals = vi.spyOn(monoManagerGoals, "goals").mockReturnValue([
    { id: "queued", managerId: "engine", title: "Queued documentation goal", state: "queued" },
    { id: "other", managerId: "another-engine", title: "Other project goal", state: "queued" },
    { id: "done", managerId: "engine", title: "Finished goal", state: "done" },
  ] as MonoManagerGoal[]);
  try {
    await act(async () => root.render(<MonoTeamActivity monoId="o" sessions={[session]} runs={runs} statuses={new Map()} onApproval={approve} onQuestion={vi.fn()} onQuestionInteraction={vi.fn()} />));
    expect(container.querySelector("[data-team-needs-count]")?.textContent).toBe(String(shared.length));
    expect(container.textContent).toContain("wrapped by untrusted rtk");
    for (const label of ["Allow", "Deny"]) {
      await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click());
      expect(approve).toHaveBeenLastCalledWith("worker", 42, label.toLowerCase());
    }
    expect(container.textContent).toContain("Work in progress");
    expect(container.textContent).toContain("Queued documentation goal");
    expect(container.textContent).toContain("Awaiting worker assignment");
    expect(container.textContent).not.toContain("Other project goal");
    expect(container.textContent).not.toContain("Finished goal");
    const manager = { ...newSession("claude", "/home"), id: "manager-chat" };
    const paused = [{ ...runs[0], projectManager: true, ownerSessionId: manager.id, status: "paused" as const, error: "Delivery interrupted" }];
    expect(teamDecisions(roster, [session, manager], paused, "o")).toHaveLength(2);
    expect(teamDecisions(roster, [session, manager], [{ ...paused[0], recovering: true }], "o")).toHaveLength(1);
    await act(async () => root.render(<MonoTeamActivity monoId="o" sessions={[session, manager]} runs={paused} statuses={new Map()} onApproval={approve} onQuestion={vi.fn()} onQuestionInteraction={vi.fn()} />));
    expect(container.querySelector("[data-team-needs-count]")?.textContent).toBe("2");
    expect(container.textContent).toContain("Delivery interrupted");
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Continue")!.click());
    expect(resume).toHaveBeenCalledExactlyOnceWith("engine");
  } finally { resume.mockRestore(); goals.mockRestore(); await act(async () => root.unmount()); localStorage.removeItem("monocode:mono-roster"); vi.unstubAllGlobals(); }
});
