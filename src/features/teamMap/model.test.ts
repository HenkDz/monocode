// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { Mono } from "../monos/model/mono";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";
import type { OrchestrationRun, OrchestrationTask } from "../orchestration/model/orchestrationState";
import { newSession } from "../sessions/model/session";
import {
  buildTeamMap, teamMapEvents, teamMapEventAnimation, teamMapEventEdges,
  teamMapKeyboardNode, teamMapMatches, TEAM_MAP_NODE_WIDTH, TEAM_MAP_NODE_HEIGHT,
} from "./model";

const mono = (id: string, role?: Mono["role"], reportsTo?: string, project = "/app"): Mono => ({
  id, name: id, role, reportsTo, projects: [project], mascot: "cat", color: "#aaaaaa",
  ...(role === "manager" ? { managerProject: project } : {}),
});
const roster = [mono("orchestrator", "orchestrator"), mono("app", "manager", "orchestrator"),
  mono("site", "manager", "orchestrator", "/site"), mono("backend", "member", "app"),
  mono("reviewer", "member", "app"), mono("design", "member", "site", "/site"), mono("plain")];
const task = (overrides: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id: "task", memberId: "backend", sessionId: "worker", title: "Check routing", prompt: "Check routing",
  harness: "codex", model: "test-model", files: [], scopes: [], dependsOn: [], status: "running",
  accepted: false, delivered: false, result: "", ...overrides,
});
const run = (tasks: OrchestrationTask[] = [task()], overrides: Partial<OrchestrationRun> = {}) => ({
  version: 2, leadId: "engine", ownerMonoId: "app", cwd: "/app", status: "active",
  allowedHarnesses: ["codex"], maxWorkers: 2, tasks, dispatches: [], ...overrides,
}) as OrchestrationRun;
const input = { roster, runs: [], sessions: [] };

it("lays out a top-down org, retains plain Monos and gives every card its own space", () => {
  const map = buildTeamMap(input), byId = new Map(map.nodes.map(node => [node.id, node]));
  expect(map.nodes.map(node => node.id)).toEqual(["orchestrator", "app", "backend", "reviewer", "site", "design", "plain"]);
  expect(map.nodes.map(node => node.id).sort()).toEqual(roster.map(node => node.id).sort());
  expect(map.edges.map(edge => edge.id).sort()).toEqual([
    "orchestrator->app", "orchestrator->site", "app->backend", "app->reviewer", "site->design",
  ].sort());
  expect(byId.get("plain")?.parentId).toBeUndefined();
  for (const edge of map.edges) expect(byId.get(edge.target)!.y).toBeGreaterThan(byId.get(edge.source)!.y);
  for (const a of map.nodes) for (const b of map.nodes.filter(node => node.id !== a.id && node.y === a.y))
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(TEAM_MAP_NODE_WIDTH);
  for (const node of map.nodes) {
    expect(node.x + TEAM_MAP_NODE_WIDTH).toBeLessThanOrEqual(map.width);
    expect(node.y + TEAM_MAP_NODE_HEIGHT).toBeLessThanOrEqual(map.height);
  }
});

it("keeps broken relationships visible, excludes archived Monos and breaks cycles", () => {
  const malformed = [mono("first", "manager", "second"), mono("second", "manager", "first"),
    mono("orphan", "member", "missing"), mono("self", "member", "self"), { ...mono("old"), archivedAt: 1 }];
  const map = buildTeamMap({ ...input, roster: malformed });
  expect(map.nodes.map(node => node.id).sort()).toEqual(["first", "second", "orphan", "self"].sort());
  expect(map.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  expect(map.edges).toHaveLength(1);
  expect(buildTeamMap({ ...input, roster: [] }).nodes).toEqual([]);
});

it("filters project branches with ancestor context and collapses descendants with a live summary", () => {
  const scoped = buildTeamMap({ ...input, project: "/site" });
  expect(scoped.nodes.map(node => node.id).sort()).toEqual(["orchestrator", "site", "design"].sort());
  const collapsed = buildTeamMap({ ...input, runs: [run()], collapsed: new Set(["app"]) });
  expect(collapsed.nodes.some(node => node.id === "backend" || node.id === "reviewer")).toBe(false);
  expect(collapsed.nodes.find(node => node.id === "app")).toMatchObject({ hiddenCount: 2, summary: "2 teammates · 1 working" });
  expect(collapsed.edges.some(edge => edge.target === "backend")).toBe(false);
  const node = buildTeamMap({ ...input, runs: [run([task({ status: "blocked" })])] }).nodes.find(node => node.id === "backend")!;
  expect(teamMapMatches(node, true, "/app")).toBe(true);
  expect(teamMapMatches(node, true, "/site")).toBe(false);
  expect(teamMapMatches({ ...node, status: "working" }, true)).toBe(false);
  expect(teamMapMatches(node, false)).toBe(true);
});

it("scopes a Manager's map and retains only its team events plus boundary goal assignment", () => {
  const scoped = buildTeamMap({ ...input, scope: "app" });
  expect(scoped.nodes.map(node => node.id).sort()).toEqual(["app", "backend", "reviewer"].sort());
  expect(scoped.nodes.find(node => node.id === "app")?.parentId).toBeUndefined();
  const goal = { id: "goal", monoId: "orchestrator", managerId: "app", title: "Build app", state: "queued", createdAt: 1, updatedAt: 1 } as MonoManagerGoal;
  const messages = [
    { id: "app-report", managerId: "app", senderId: "backend", recipientId: "app", topic: "Report", text: "Done", at: 2 },
    { id: "site-report", managerId: "site", senderId: "design", recipientId: "site", topic: "Report", text: "Done", at: 3 },
  ];
  const events = teamMapEvents({ ...input, scope: "app", messages, goals: [goal] });
  expect(events.map(event => event.id)).toEqual(["goal:goal:start", "app-report"]);
  expect(events.find(event => event.id === "app-report")?.kind).toBe("report");
  expect(teamMapEvents({ ...input, project: "/site", messages, goals: [goal] }).map(event => event.id)).toEqual(["site-report"]);
});

it("resolves persisted goal engine keys before a run exists and returns completed goals through the run owner", () => {
  const engineId = "mono-engine-app";
  const queued = { id: "engine-goal", monoId: "orchestrator", managerId: engineId, title: "Stored assignment",
    state: "queued", createdAt: 10, updatedAt: 10 } as MonoManagerGoal;
  const savedRoster = roster.map(node => node.id === "app" ? { ...node, managerEngineId: engineId } : node);
  const beforeRun = teamMapEvents({ ...input, roster: savedRoster, goals: [queued] });
  expect(beforeRun).toEqual([{ id: "goal:engine-goal:start", at: 10, source: "orchestrator", target: "app", label: "Stored assignment", kind: "dispatch" }]);
  const done = { ...queued, state: "done" as const, updatedAt: 20 };
  const completed = teamMapEvents({ ...input, runs: [run([], { leadId: engineId, ownerMonoId: "app" })], goals: [done] });
  expect(completed).toHaveLength(2);
  expect(completed[0]).toMatchObject({ source: "orchestrator", target: "app", kind: "dispatch" });
  expect(completed[1]).toMatchObject({ id: "goal:engine-goal:done:20", source: "app", target: "orchestrator", kind: "report" });
  const scoped = teamMapEvents({ ...input, scope: "app", roster: savedRoster, goals: [done] });
  expect(scoped.map(event => event.kind)).toEqual(["dispatch", "report"]);
  expect(teamMapEventEdges(completed[1], buildTeamMap(input).edges)).toEqual(["orchestrator->app"]);
  expect(teamMapEventAnimation(completed[1], false).direction).toBe("up");
  expect(teamMapEvents({ ...input, goals: [queued] })).toEqual([]);
});

it("uses shared availability and task titles, with PR readiness only when idle and current", () => {
  const ready = task({ status: "completed", accepted: true, prUrl: "https://github.com/example/repo/pull/12",
    lastDispatchId: "dispatch", acceptedDispatchId: "dispatch", result: "Verified routing" });
  const nodes = (tasks: OrchestrationTask[], sessions = [] as ReturnType<typeof newSession>[]) =>
    buildTeamMap({ ...input, runs: [run(tasks)], sessions }).nodes;
  expect(nodes([ready]).find(node => node.id === "backend")).toMatchObject({ status: "pr-ready", lastReport: "Verified routing" });
  expect(nodes([{ ...ready, acceptedDispatchId: "old-dispatch" }]).find(node => node.id === "backend")?.status).toBe("idle");
  expect(nodes([{ ...ready, delivery: { head: "abc", ci: "pending", conflicts: false, state: "watching" } }]).find(node => node.id === "backend")?.status).toBe("idle");
  const running = task({ id: "new-task", title: "Current routing task" });
  expect(nodes([ready, running]).find(node => node.id === "backend")).toMatchObject({ status: "working", title: "Current routing task", model: "test-model" });
  expect(buildTeamMap({ ...input, runs: [run([running])] }).edges.find(edge => edge.id === "orchestrator->app")?.label).toBe("Current routing task");
  const approval = { ...newSession("codex", "/app"), id: "worker", busy: true,
    blocks: [{ id: "approval", role: "tool" as const, text: "Permission", approval: { requestId: 42 } }] };
  const attention = nodes([running], [approval]);
  for (const id of ["backend", "app", "orchestrator"]) expect(attention.find(node => node.id === id)?.status).toBe("needs-you");
  expect(nodes([task({ id: "old", status: "failed" }), task({ status: "completed" })]).find(node => node.id === "backend")?.status).toBe("idle");
});

it("uses clear coordination labels before assignment while actual task titles take priority over tool commands", () => {
  const rawCommand = "powershell -NoProfile -Command C:/Users/nooro/Temp/dispatch.ps1";
  const busyRoster = roster.map(node => ({ ...node, sessionId: `${node.id}-chat` }));
  const sessions = busyRoster.map(node => ({ ...newSession("codex", node.projects[0]), id: node.sessionId!, busy: true,
    blocks: [{ id: `${node.id}-tool`, role: "tool" as const, text: "", tool: { title: rawCommand } }] }));
  const pending = buildTeamMap({ ...input, roster: busyRoster, sessions }).nodes;
  for (const [id, title] of [["orchestrator", "Coordinating projects"], ["app", "Coordinating the team"], ["backend", "Working in chat"], ["plain", "Working in chat"]]) {
    expect(pending.find(node => node.id === id)).toMatchObject({ status: "working", title });
    expect(pending.find(node => node.id === id)?.title).not.toContain(rawCommand);
  }
  const assigned = buildTeamMap({ ...input, roster: busyRoster, sessions, runs: [run([task({ title: "Verify project routing" })])] }).nodes;
  for (const id of ["orchestrator", "app", "backend"])
    expect(assigned.find(node => node.id === id)?.title).toBe("Verify project routing");
});

it("keeps work flowing upward, sends eligible queued work downward and stops at attention or completion", () => {
  const edges = (entry: OrchestrationTask, sessions = [] as ReturnType<typeof newSession>[]) =>
    buildTeamMap({ ...input, runs: [run([entry])], sessions }).edges;
  for (const status of ["running", "cancelling"] as const)
    expect(edges(task({ status })).filter(edge => edge.flow).map(edge => [edge.id, edge.flow])).toEqual([
      ["orchestrator->app", "up"], ["app->backend", "up"],
    ]);
  expect(edges(task({ status: "queued" })).filter(edge => edge.flow).map(edge => [edge.id, edge.flow])).toEqual([
    ["orchestrator->app", "down"], ["app->backend", "down"],
  ]);
  for (const status of ["blocked", "failed", "interrupted", "completed", "cancelled"] as const)
    expect(edges(task({ status })).filter(edge => edge.flow)).toEqual([]);
  const approval = { ...newSession("codex", "/app"), id: "worker", busy: true,
    blocks: [{ id: "approval", role: "tool" as const, text: "Approval", approval: { requestId: 7 } }] };
  for (const status of ["queued", "running"] as const)
    expect(edges(task({ status }), [approval]).filter(edge => edge.flow)).toEqual([]);
  const ready = task({ status: "completed", accepted: true, prUrl: "https://github.com/example/repo/pull/12",
    lastDispatchId: "dispatch", acceptedDispatchId: "dispatch" });
  expect(edges(ready).filter(edge => edge.flow)).toEqual([]);
});

it("preserves the working reporting chain despite blocked siblings and prioritizes the active task label", () => {
  const historical = task({ id: "historical", status: "completed", title: "Historical completed work" });
  const blocked = task({ id: "blocked", memberId: "reviewer", sessionId: "reviewer-worker", status: "blocked" });
  const current = task({ id: "current", title: "Current worker task" });
  const map = buildTeamMap({ ...input, runs: [run([historical, blocked, current])] });
  expect(map.nodes.find(node => node.id === "app")?.status).toBe("needs-you");
  for (const id of ["orchestrator->app", "app->backend"])
    expect(map.edges.find(edge => edge.id === id)).toMatchObject({ flow: "up", label: "Current worker task" });
  expect(map.edges.find(edge => edge.id === "app->reviewer")?.flow).toBeUndefined();
  const worker = { ...newSession("codex", "/app"), id: "worker", busy: true };
  const stillBusy = buildTeamMap({ ...input, runs: [run([historical])], sessions: [worker] });
  expect(stillBusy.edges.filter(edge => edge.flow).map(edge => edge.id)).toEqual(["orchestrator->app", "app->backend"]);
});

it("retains collapsed upstream flow, scopes visible reporting edges and stops archived work", () => {
  const working = { ...input, runs: [run()] };
  const collapsed = buildTeamMap({ ...working, collapsed: new Set(["app"]) });
  expect(collapsed.edges.filter(edge => edge.flow).map(edge => edge.id)).toEqual(["orchestrator->app"]);
  expect(collapsed.edges.find(edge => edge.id === "orchestrator->app")?.flow).toBe("up");
  expect(buildTeamMap({ ...working, scope: "app" }).edges.filter(edge => edge.flow).map(edge => edge.id)).toEqual(["app->backend"]);
  expect(buildTeamMap({ ...working, project: "/site" }).edges.filter(edge => edge.flow)).toEqual([]);
  for (const id of ["backend", "app"])
    expect(buildTeamMap({ ...working, roster: roster.map(node => node.id === id ? { ...node, archivedAt: 1 } : node) }).edges.filter(edge => edge.flow)).toEqual([]);
});

it("maps actual dispatch, report, review and goal events to direction and reduced-motion indicators", () => {
  const dispatch = { id: "dispatch", taskId: "task", sessionId: "worker", state: "completed", stage: "settled", startedAt: 10, updatedAt: 20 } as OrchestrationRun["dispatches"][number];
  const reviewed = task({ id: "review", memberId: "reviewer", status: "completed", reviewOf: { taskId: "task", dispatchId: "dispatch" },
    reviewVerdict: { decision: "changes", notes: "Fix routing", dispatchId: "review-dispatch" } });
  const reviewDispatch = { ...dispatch, id: "review-dispatch", taskId: "review", startedAt: 25, updatedAt: 30 };
  const goal = { id: "goal", monoId: "orchestrator", managerId: "app", title: "Build app", state: "done", createdAt: 1, updatedAt: 40 } as MonoManagerGoal;
  const events = teamMapEvents({ ...input, runs: [run([task({ status: "completed", prReadyAt: 22 }), reviewed], { dispatches: [dispatch, reviewDispatch] })],
    goals: [goal], messages: [{ id: "escalate", managerId: "app", senderId: "backend", recipientId: "app", topic: "Escalation", text: "Need input", at: 35 }] });
  expect(events.find(event => event.id === "dispatch:start")).toMatchObject({ source: "app", target: "backend", kind: "dispatch" });
  expect(events.find(event => event.id === "dispatch:end")).toMatchObject({ source: "backend", target: "app", kind: "report" });
  expect(events.find(event => event.id === "task:pr")?.kind).toBe("pr");
  expect(events.find(event => event.id === "escalate")?.kind).toBe("escalation");
  expect(events.find(event => event.id === "goal:goal:start")).toMatchObject({ source: "orchestrator", target: "app", kind: "dispatch" });
  const review = events.find(event => event.kind === "review")!;
  expect(review).toMatchObject({ source: "reviewer", target: "backend", changes: true });
  const changedVerdict = { ...reviewed, reviewVerdict: { ...reviewed.reviewVerdict!, decision: "approve" as const, headOid: "new-head" } };
  const approved = teamMapEvents({ ...input, runs: [run([task(), changedVerdict], { dispatches: [dispatch, reviewDispatch] })] }).find(event => event.kind === "review")!;
  expect(approved.id).not.toBe(review.id);
  expect(approved.at).toBe(reviewDispatch.updatedAt);
  expect(teamMapEventAnimation(approved, false).dashed).toBe(false);
  expect(teamMapEventAnimation(review, false)).toEqual({ animated: true, dashed: true, direction: "across" });
  expect(teamMapEventAnimation(review, true)).toEqual({ animated: false, dashed: true, direction: "across" });
  expect(teamMapEventAnimation(events.find(event => event.kind === "dispatch")!, false).direction).toBe("down");
  expect(teamMapEventAnimation(events.find(event => event.kind === "report")!, true)).toMatchObject({ animated: false, direction: "up" });
  expect(events.map(event => event.at)).toEqual([...events.map(event => event.at)].sort((a, b) => a - b));
  expect(teamMapEventEdges(review, buildTeamMap(input).edges)).toEqual(["app->reviewer", "app->backend"]);
  expect(teamMapEventEdges({ ...review, target: "plain" }, buildTeamMap(input).edges)).toEqual([]);
});

it("does not synthesize reports for unfinished dispatches or archived recipients", () => {
  const dispatch = { id: "active", taskId: "task", state: "running", startedAt: 1, updatedAt: 2 } as OrchestrationRun["dispatches"][number];
  expect(teamMapEvents({ ...input, runs: [run([task()], { dispatches: [dispatch] })] }).map(event => event.kind)).toEqual(["dispatch"]);
  expect(teamMapEvents({ ...input, roster: roster.map(node => node.id === "backend" ? { ...node, archivedAt: 1 } : node),
    runs: [run([task()], { dispatches: [dispatch] })] })).toEqual([]);
});

it("moves keyboard focus in the requested direction and leaves it at boundaries", () => {
  const nodes = [{ id: "root", x: 100, y: 0 }, { id: "left", x: 0, y: 200 }, { id: "right", x: 200, y: 200 }];
  expect(teamMapKeyboardNode(nodes, "root", "ArrowDown")).toBe("left");
  expect(teamMapKeyboardNode(nodes, "left", "ArrowRight")).toBe("right");
  expect(teamMapKeyboardNode(nodes, "right", "ArrowUp")).toBe("root");
  expect(teamMapKeyboardNode(nodes, "root", "ArrowUp")).toBe("root");
  expect(teamMapKeyboardNode(nodes, "left", "Enter")).toBe("left");
  expect(teamMapKeyboardNode(nodes, "missing", "ArrowDown")).toBe("root");
  expect(teamMapKeyboardNode([], "missing", "ArrowDown")).toBe("missing");
});
