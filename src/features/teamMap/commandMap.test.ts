import { expect, it } from "vitest";
import { newSession } from "../sessions/model/session";
import type { Mono } from "../monos/model/mono";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";
import type { OrchestrationRun, OrchestrationTask } from "../orchestration/model/orchestrationState";
import { buildTeamMap } from "./model";
import { orbitProjects } from "./orbit";
import { goalProgress, mapText, projectGoals, projectMemberTask } from "./commandMap";

const roster: Mono[] = [
  { id: "manager", role: "manager", managerEngineId: "engine", managerProject: "/app", projects: ["/app"], mascot: "cat", color: "#aaa" },
  { id: "member", role: "member", reportsTo: "manager", projects: ["/app"], mascot: "cat", color: "#aaa" },
];
const project = orbitProjects(buildTeamMap({ roster, runs: [], sessions: [] }).nodes)[0];
const task = { id: "task", memberId: "member", sessionId: "new-worker", status: "queued", title: "Exact title", result: "", dependsOn: [], activeDispatchId: "new", lastDispatchId: "old" } as unknown as OrchestrationTask;
const run = { leadId: "engine", ownerMonoId: "manager", status: "paused", lastPauseReason: "User held this run", tasks: [task], dispatches: [
  { id: "old", taskId: "task", sessionId: "old-worker", state: "completed", startedAt: 1, updatedAt: 2, result: "OLD report" },
  { id: "new", taskId: "task", sessionId: "new-worker", state: "starting", startedAt: 3, updatedAt: 4 },
] } as unknown as OrchestrationRun;
const goal = { id: "goal", managerId: "engine", title: "Exact goal\nsource", state: "running", updatedAt: 2 } as MonoManagerGoal;

it("passes full parent pause context to canonical live state without mutating task or goal", () => {
  const original = JSON.stringify(run);
  const state = projectMemberTask(project, roster[1], [run], []);
  expect(state.state.liveState).toMatchObject({ status: "queued", reason: "paused", detail: "User held this run" });
  expect(state.dispatch?.id).toBe("new");
  expect(JSON.stringify(run)).toBe(original);
});

it("selects the member's owned run, never a foreign duplicate task or old dispatch", () => {
  const foreign = { ...run, leadId: "foreign", ownerMonoId: "other", tasks: [{ ...task, title: "WRONG", status: "running" }] } as OrchestrationRun;
  const worker = { ...newSession("codex", "/app"), id: "new-worker", busy: true };
  const result = projectMemberTask(project, roster[1], [foreign, run], [worker]);
  expect(result.task?.title).toBe("Exact title");
  expect(result.session?.id).toBe("new-worker");
  expect(result.history.map(entry => entry.dispatch.id)).toEqual(["new", "old"]);
  expect(result.state.status).toBe("working");
});

it("counts acceptance only for the current dispatch, keeps unknown progress explicit", () => {
  const accepted = { ...task, monoGoalId: "goal", accepted: true, acceptedDispatchId: "old" };
  expect(goalProgress(goal, [{ ...run, tasks: [accepted] }])).toEqual({ accepted: 0, total: 1, percent: 0 });
  expect(goalProgress(goal, [{ ...run, tasks: [{ ...accepted, acceptedDispatchId: "new" }] }])?.percent).toBe(100);
  expect(goalProgress(goal, [])).toBeUndefined();
  expect(goalProgress(undefined, [run])).toBeUndefined();
});

it("keeps exact full goal source and prefers active goals over completed history", () => {
  const old = { ...goal, id: "done", state: "done", updatedAt: 10 } as MonoManagerGoal;
  const archived = { ...goal, id: "archived", archived: true, updatedAt: 30 };
  const foreign = { ...goal, id: "foreign", managerId: "other", updatedAt: 40 };
  expect(projectGoals(project, [old, archived, foreign, goal]).map(entry => entry.id)).toEqual(["goal", "done"]);
  expect(goal.title).toBe("Exact goal\nsource");
  expect(mapText(goal.title)).toBe("Exact goal source");
  expect(mapText("x".repeat(2000))).toHaveLength(220);
});
