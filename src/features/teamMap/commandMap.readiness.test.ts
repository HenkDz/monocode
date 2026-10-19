import { expect, it } from "vitest";
import type { Mono } from "../monos/model/mono";
import { memberMonoState } from "../monos/model/monoNavigation";
import { newSession } from "../sessions/model/session";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";
import { buildTeamMap } from "./model";
import { orbitProjects } from "./orbit";
import { goalProgress, mapOwnState, projectGoals, projectMemberTask } from "./commandMap";

const manager: Mono = { id: "manager", role: "manager", managerEngineId: "engine", managerProject: "C:/App", projects: ["C:/App"], mascot: "cat", color: "#aaa" };
const member: Mono = { ...manager, id: "member", role: "member", reportsTo: "manager", sessionId: "chat" };
const project = orbitProjects(buildTeamMap({ roster: [manager, member], runs: [], sessions: [] }).nodes)[0];
const run = { ownerMonoId: "manager", leadId: "engine", cwd: "c:\\APP", status: "active", tasks: [
  { id: "task", memberId: "member", sessionId: "stale-worker", activeDispatchId: "new", title: "Newest task", status: "queued", dependsOn: [], result: "" },
], dispatches: [{ id: "new", taskId: "task", sessionId: "new-worker", startedAt: 3, state: "starting" }] } as unknown as OrchestrationRun;

it("rejects conflicting explicit owners and foreign projects even with the same engine", () => {
  const foreignOwner = { ...run, ownerMonoId: "foreign" };
  const foreignProject = { ...run, cwd: "C:/Other" };
  expect(projectMemberTask(project, member, [foreignOwner, foreignProject, run], []).owned).toEqual([run]);
  const goal = { id: "goal", managerId: "engine", projectId: "C:/Other", updatedAt: 1 } as MonoManagerGoal;
  expect(projectGoals(project, [goal])).toEqual([]);
  expect(projectGoals(project, [{ ...goal, projectId: "c:\\APP" }])).toHaveLength(1);
});

it("uses accepted newest-dispatch task ordering and the dispatch session over a stale task session", () => {
  const older = { ...run.tasks[0], id: "older", title: "Older task" };
  const owned = { ...run, tasks: [run.tasks[0], older], dispatches: [...run.dispatches!, { ...run.dispatches![0], id: "old", taskId: "older", startedAt: 1 }] };
  const worker = { ...newSession("codex", "C:/App"), id: "new-worker", busy: true };
  const result = projectMemberTask(project, member, [owned], [worker]);
  expect(result.task?.title).toBe("Newest task");
  expect(result.session?.id).toBe("new-worker");
  expect(result.state.status).toBe("working");
});

it("keeps a worker blocker above a busy durable chat using canonical state", () => {
  const worker = { ...newSession("codex", "C:/App"), id: "new-worker", codexStorageError: "Synthetic unavailable evidence" };
  const chat = { ...newSession("codex", "C:/App"), id: "chat", busy: true };
  expect(projectMemberTask(project, member, [run], [worker, chat]).state.liveState).toMatchObject({ status: "blocked", reason: "storage" });
});

it("keeps the durable question above a failed worker exactly as accepted navigation does", () => {
  const failed = { ...run, tasks: [{ ...run.tasks[0], sessionId: "new-worker", status: "failed", error: "Worker failed" }] } as OrchestrationRun;
  const chat = { ...newSession("codex", "C:/App"), id: "chat", pendingQuestion: { requestId: 1, title: "Choose the API contract", questions: [] } };
  const expected = memberMonoState([failed], member.id, [chat], member.sessionId);
  expect(expected).toMatchObject({ status: "needs-you", activity: "Choose the API contract", liveState: { reason: "decision" } });
  expect(projectMemberTask(project, member, [failed], [chat]).state).toEqual(expected);
  const busy = { ...chat, pendingQuestion: undefined, busy: true };
  expect(projectMemberTask(project, member, [failed], [busy]).state).toEqual(memberMonoState([failed], member.id, [busy], member.sessionId));
  expect(projectMemberTask(project, member, [failed], [busy]).state.activity).toBe("Worker failed");
});

it.each([
  { ownerMonoId: "other-manager", cwd: "C:/App" },
  { ownerMonoId: "manager", cwd: "C:/Other" },
  { ownerMonoId: "other-manager", cwd: "C:/Other" },
])("excludes conflicting progress with scope %j just like member selection", conflict => {
  const goal = { id: "goal", managerId: "engine", projectId: "C:/App" } as MonoManagerGoal;
  const owned = { ...run, tasks: [{ ...run.tasks[0], monoGoalId: goal.id }] };
  const foreign = { ...owned, ...conflict, tasks: [{ ...owned.tasks[0], accepted: true, acceptedDispatchId: "new" }] };
  expect(projectMemberTask(project, member, [foreign, owned], []).owned).toEqual([owned]);
  expect(goalProgress(project, goal, [foreign, owned])).toEqual({ accepted: 0, total: 1, percent: 0 });
  expect(goalProgress(project, goal, [foreign])).toBeUndefined();
  const legacy = { ...owned, ownerMonoId: undefined, tasks: foreign.tasks };
  expect(goalProgress(project, goal, [legacy])).toEqual({ accepted: 1, total: 1, percent: 100 });
  expect(goalProgress(project, goal, [{ ...legacy, leadId: "other-engine" }])).toBeUndefined();
  expect(goalProgress(project, goal, [{ ...legacy, tasks: [{ ...legacy.tasks[0], acceptedDispatchId: "old" }] }])?.accepted).toBe(0);
});

it("keeps manager own activity separate from descendant work and preserves pause detail", () => {
  expect(mapOwnState(manager, [run], []).status).toBe("idle");
  expect(mapOwnState(manager, [{ ...run, status: "paused", lastPauseReason: "Owner pause" }], []).liveState).toMatchObject({ status: "needs-you", detail: "Owner pause" });
});
