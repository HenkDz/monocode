import { expect, it } from "vitest";
import type { GitPr } from "../../platform/tauri/fs";
import type { OrchestrationRun, OrchestrationTask } from "../orchestration/model/orchestrationState";
import { newSession } from "../sessions/model/session";
import { prStatusKey } from "../source-control/hooks/usePrStatus";
import { buildTeamMap } from "./model";
import { orbitProjects } from "./orbit";
import { mapCamera, mapTaskState, mapTodaySentence, projectCamera, projectMapTasks, projectPoint, zoomCamera } from "./zoomMapModel";

const roster = [{ id: "manager", role: "manager" as const, managerEngineId: "engine", managerProject: "/app", projects: ["/app"], mascot: "cat", color: "#aaa" }];
const project = orbitProjects(buildTeamMap({ roster, runs: [], sessions: [] }).nodes)[0];
const task = { id: "task", sessionId: "old-worker", memberId: "mono", title: "Build feature", prompt: "Exact full assignment", result: "", status: "completed", accepted: true,
  activeDispatchId: "current", lastDispatchId: "current", acceptedDispatchId: "current", prUrl: "https://github.com/a/b/pull/1", reviewedHead: "abc", workspace: { checkoutCwd: "/app-wt", branch: "feature" } } as OrchestrationTask;
const pr: GitPr = { number: 1, title: "Feature", url: task.prUrl!, state: "open", headOid: "abc", baseRefName: "main", reviewDecision: "APPROVED", checksStatus: "success", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };

it("requires current accepted dispatch, reviewed head and verified approved checks for Ready to merge", () => {
  expect(mapTaskState(task, pr)).toBe("ready");
  expect(mapTaskState(task, { ...pr, checksStatus: "none" })).toBe("ready");
  for (const update of [{ checksStatus: "pending" }, { checksStatus: "failure" }, { checksStatus: "unknown" }, { reviewDecision: "REVIEW_REQUIRED" }, { reviewDecision: undefined }, { headOid: "new" }, { isDraft: true }, { url: "https://github.com/a/b/pull/2" }, { mergeable: "UNKNOWN" }, { mergeStateStatus: "DIRTY" }] as Partial<GitPr>[]) {
    expect(mapTaskState(task, { ...pr, ...update }), JSON.stringify(update)).toBe("review");
  }
  expect(mapTaskState(task)).toBe("review");
  for (const update of [{ accepted: false }, { acceptedDispatchId: "old" }, { activeDispatchId: "retry", status: "queued" }, { reviewedHead: "old" }, { delivery: { head: "abc", ci: "pending", conflicts: false, state: "watching" } }] as Partial<OrchestrationTask>[]) {
    expect(mapTaskState({ ...task, ...update }, pr)).not.toBe("ready");
  }
});

it("does not turn failed, cancelled, closed or unaccepted completion into Done", () => {
  for (const status of ["failed", "blocked", "interrupted", "cancelled"] as const) expect(mapTaskState({ ...task, status }, pr)).toBe(status);
  expect(mapTaskState({ ...task, accepted: false }, { ...pr, state: "merged" })).toBe("review");
  expect(mapTaskState(task, { ...pr, state: "merged" })).toBe("done");
  expect(mapTaskState(task, { ...pr, state: "closed" })).toBe("closed");
  expect(mapTaskState({ ...task, completionOutcome: "no-changes", prUrl: undefined })).toBe("done");
  expect(mapTaskState({ ...task, status: "running" }, pr)).toBe("working");
});

it("selects every owned task and the exact current dispatch session, excluding foreign owners/projects", () => {
  const run = { leadId: "engine", ownerMonoId: "manager", cwd: "/app", status: "active", tasks: [task, { ...task, id: "second", monoGoalId: undefined }], dispatches: [{ id: "current", taskId: task.id, sessionId: "new-worker" }] } as OrchestrationRun;
  const worker = { ...newSession("codex", "/app-wt"), id: "new-worker", busy: true };
  const statuses = new Map([[prStatusKey("/app-wt", task.prUrl), pr]]);
  const result = projectMapTasks(project, [{ ...run, ownerMonoId: "foreign" }, { ...run, cwd: "/other" }, run], [worker], statuses);
  expect(result).toHaveLength(2); expect(result[0].session).toBe(worker); expect(result[0].dispatch?.id).toBe("current");
  expect(result[0].state).toBe("ready"); expect(result[0].live.status).toBeDefined();
  expect(result[1].task.id).toBe("second");
  const stale = { ...newSession("codex", "/app"), id: "old-worker", busy: true };
  const unknown = projectMapTasks(project, [{ ...run, dispatches: [] }], [stale], statuses);
  expect(unknown[0].session).toBeUndefined();
});

it("caps fitted reading size and grows width instead of type on ultrawide screens", () => {
  const regular = projectCamera({ width: 1220, height: 740 }, projectPoint(0));
  const wide = projectCamera({ width: 3052, height: 1050 }, projectPoint(0));
  const narrow = projectCamera({ width: 390, height: 450 }, projectPoint(0));
  expect(regular.width).toBeGreaterThanOrEqual(1000); expect(wide.width).toBe(1800); expect(wide.camera.scale / 4).toBe(1.2);
  expect(narrow.width).toBe(1000); expect(narrow.camera.scale / 4).toBe(.8);
  expect(regular.camera.scale / 4).toBeGreaterThanOrEqual(.8);
});

it("keeps the pointer's world coordinate stable during partial zoom and fits arbitrary project rows", () => {
  const camera = mapCamera({ width: 1220, height: 740 }, 9);
  const next = zoomCamera(camera, 300, 250, camera.scale * .85);
  expect((300 - next.x) / next.scale).toBeCloseTo((300 - camera.x) / camera.scale);
  expect((250 - next.y) / next.scale).toBeCloseTo((250 - camera.y) / camera.scale);
  expect(projectPoint(8).y).toBeGreaterThan(projectPoint(4).y);
});

it("summarizes source events as plain actor sentences without inventing successful outcomes", () => {
  const event = { id: "event", at: 1, source: "manager", target: "member", label: "Review the feature", kind: "escalation" as const };
  expect(mapTodaySentence(event, [{ ...roster[0], name: "Mira" }])).toBe("Mira asked for help with Review the feature");
  expect(mapTodaySentence({ ...event, kind: "review", changes: true }, [{ ...roster[0], name: "Mira" }])).toBe("Mira requested changes to Review the feature");
});
