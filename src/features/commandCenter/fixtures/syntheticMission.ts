import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationDispatch, OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import type { Block, Session } from "../../sessions/model/session";

export const now = Date.UTC(2026, 9, 11, 12);
const project = "C:/synthetic/Atlas";
const workspace = { id: "synthetic-atlas", projectCwd: project, checkoutCwd: project, kind: "main" as const };
const turnModel = { harness: "codex" as const, id: "synthetic-model", name: "Synthetic model" };
const turn = (id: string, ago: number, input: number, output: number, durationMs?: number): Block => ({
  id, role: "user", text: "Synthetic fixture turn", startedAt: now - ago, durationMs, turnModel,
  turnMetrics: { inputTokens: input, outputTokens: output, cacheReadTokens: Math.floor(input * 0.9), modelCalls: 4,
    ...(durationMs == null ? {} : { endedAt: now - ago + durationMs }) },
});
const session = (id: string, blocks: Block[], extra: Partial<Session> = {}): Session => ({
  id, harness: "codex", model: "synthetic-model", modelSettings: {}, runtimeMode: "supervised",
  title: "Synthetic session", cwd: project, blocks, ...extra,
});
const goal = (id: string, title: string, state: MonoManagerGoal["state"], ago: number): MonoManagerGoal => ({
  id, monoId: "synthetic-grand", projectId: project, managerId: "synthetic-engine", userMessageId: `origin-${id}`,
  requestId: `request-${id}`, title, state, prUrls: [], createdAt: now - ago, updatedAt: now - (state === "done" ? 600_000 : 60_000),
});
export const goals = [
  goal("synthetic-goal-release", "Prepare the Atlas release with a reproducible database migration, replay evidence, complete review notes and a safe recovery path for interrupted work", "blocked", 1_944_000),
  goal("synthetic-goal-search", "Make project search fast and keep extremely long identifiers such as AtlasSearchIndexCompatibilityAcrossRestoredHistoricalWorkspaces readable on a narrow screen", "running", 1_260_000),
  goal("synthetic-goal-finished", "Document the release checks and handoff", "done", 7_200_000),
  { ...goal("synthetic-goal-cancelled", "Explore an earlier search design", "cancelled", 10_800_000), projectId: "C:/synthetic/Beacon", managerId: "synthetic-beacon-engine" },
];
export const roster: Mono[] = [
  { id: "synthetic-grand", role: "orchestrator", name: "Grand Orch", mascot: "owl", color: "#7dd3fc", projects: [project], sessionId: "synthetic-grand-chat" },
  { id: "synthetic-manager", role: "manager", reportsTo: "synthetic-grand", name: "Atlas Manager", mascot: "fox", color: "#d6a3ff", projects: [project], sessionId: "synthetic-manager-chat", managerEngineId: "synthetic-engine" },
  { id: "synthetic-builder", role: "member", reportsTo: "synthetic-manager", name: "Builder", mascot: "bear", color: "#9dd8bb", projects: [project] },
  { id: "synthetic-reviewer", role: "member", reportsTo: "synthetic-manager", name: "Reviewer", mascot: "cat", color: "#e8c547", projects: [project], reviewer: true },
  { id: "synthetic-searcher", role: "member", reportsTo: "synthetic-manager", name: "Search worker", mascot: "rabbit", color: "#9dd8bb", projects: [project] },
];
export const sessions: Session[] = [
  session("synthetic-grand-chat", goals.map(item => turn(item.userMessageId, now - item.createdAt, 4_000, 600, 20_000))),
  session("synthetic-manager-chat", [turn("synthetic-manager-turn", 1_900_000, 38_000, 3_100, 45_000)]),
  session("synthetic-builder-chat", [turn("synthetic-builder-turn", 1_800_000, 95_000, 8_500, 1_100_000)], { orchestrationLeadId: "synthetic-engine" }),
  session("synthetic-reviewer-chat", [], { orchestrationLeadId: "synthetic-engine", codexStorageError: "Synthetic storage preparation failed: the isolated review workspace could not be opened. Resolve the storage issue before this queued review can start; the implementation and original conversation remain available." }),
  session("synthetic-search-chat", [turn("synthetic-search-turn", 1_050_000, 62_000, 4_400),
    { id: "synthetic-search-tool", role: "tool", text: "Scanning project index", tool: { title: "Checking restored workspace search results and long identifiers", status: "running" } }],
    { busy: true, orchestrationLeadId: "synthetic-engine" }),
];
const task = (id: string, goalId: string, memberId: string, sessionId: string, title: string, status: OrchestrationTask["status"]): OrchestrationTask => ({
  id, monoGoalId: goalId, managerTurnBlockId: "synthetic-manager-turn", memberId,
  memberName: roster.find(member => member.id === memberId)?.name, sessionId, title, harness: "codex", model: "synthetic-model",
  prompt: "Synthetic fixture only", files: [], scopes: [], dependsOn: [], status,
  accepted: status === "completed", result: "", delivered: status === "completed", activeDispatchId: `dispatch-${id}`,
});
const tasks: OrchestrationTask[] = [
  task("synthetic-build", goals[0].id, "synthetic-builder", "synthetic-builder-chat", "Implement migration replay without rewriting historical movements", "completed"),
  { ...task("synthetic-review", goals[0].id, "synthetic-reviewer", "synthetic-reviewer-chat", "Review every database migration and recovery invariant before release", "blocked"), reviewOf: { taskId: "synthetic-build", dispatchId: "dispatch-synthetic-build" } },
  task("synthetic-search", goals[1].id, "synthetic-searcher", "synthetic-search-chat", "Validate search across restored historical workspaces and unusually long directory names", "running"),
];
const dispatch = (item: OrchestrationTask, startedAt: number, turnBlockId?: string): OrchestrationDispatch => ({
  id: `dispatch-${item.id}`, taskId: item.id, sessionId: item.sessionId, workspace,
  state: item.status === "completed" ? "completed" : item.status === "blocked" ? "blocked" : "running",
  stage: item.status === "blocked" ? "session_prepared" : "turn_submitted", startedAt, updatedAt: now - 60_000,
  dispatchedAt: startedAt, ...(turnBlockId ? { turnBlockId, turnStartedAt: startedAt + 10_000 } : {}),
  ...(item.status === "completed" ? { finishedAt: now - 700_000, reportedAt: now - 650_000, reportedTurnBlockId: "synthetic-manager-turn" } : {}),
});
export const runs: OrchestrationRun[] = [{
  version: 2, leadId: "synthetic-engine", ownerSessionId: "synthetic-manager-chat", ownerMonoId: "synthetic-manager", cwd: project,
  workspace, status: "active", allowedHarnesses: ["codex"], maxWorkers: 3, projectManager: true, projectName: "Atlas · synthetic fixture",
  cli: "synthetic", tasks, continuations: 0, requests: {}, dispatches: [
    dispatch(tasks[0], now - 1_810_000, "synthetic-builder-turn"),
    dispatch(tasks[1], now - 690_000),
    dispatch(tasks[2], now - 1_060_000, "synthetic-search-turn"),
  ],
}];
