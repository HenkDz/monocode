import type { Mono } from "../../../monos/model/mono";
import type { MonoManagerGoal } from "../../../monos/model/monoManagerGoals";
import type { OrchestrationDispatch, OrchestrationRun, OrchestrationTask } from "../../../orchestration/model/orchestrationState";
import type { Block, Session } from "../../../sessions/model/session";
import type { GoalViewInput } from "../../model/goalView";

const start = Date.UTC(2026, 9, 11, 8);
const at = (seconds: number) => start + seconds * 1000;
const project = "C:/synthetic/cc7e-timeline";
const workspace = { id: "cc7e-synthetic", projectCwd: project, checkoutCwd: project, kind: "main" as const };
const turnModel = { harness: "codex" as const, id: "synthetic-model", name: "Synthetic model" };
const turn = (id: string, seconds: number, end?: number, extra: Partial<Block> = {}): Block => ({
  id, role: "user", text: "Synthetic recorded turn", startedAt: at(seconds), turnModel,
  ...(end == null ? {} : { durationMs: (end - seconds) * 1000 }),
  turnMetrics: { inputTokens: 4000, outputTokens: 300, modelCalls: 3,
    firstTokenAt: at(seconds + 10), ...(end == null ? {} : { endedAt: at(end) }) }, ...extra,
});
const session = (id: string, blocks: Block[], extra: Partial<Session> = {}): Session => ({
  id, harness: "codex", model: "synthetic-model", modelSettings: {}, runtimeMode: "supervised",
  title: `Synthetic ${id}`, cwd: project, blocks, ...extra,
});
const goal = (id: string, title: string, state: MonoManagerGoal["state"]): MonoManagerGoal => ({
  id, title, monoId: "grand", projectId: project, managerId: "engine", userMessageId: `origin-${id}`,
  requestId: `request-${id}`, state, prUrls: [], createdAt: start, updatedAt: at(1),
});
const roster: Mono[] = [
  { id: "grand", role: "orchestrator", name: "Grand Orch", mascot: "owl", color: "#7dd3fc", projects: [project], sessionId: "grand-chat" },
  { id: "manager", role: "manager", name: "Manager", reportsTo: "grand", mascot: "fox", color: "#d6a3ff", projects: [project], sessionId: "manager-chat", managerEngineId: "engine" },
  ...["Builder", "Reviewer", "Indexer", "Verifier"].map(name => ({
    id: name.toLowerCase(), role: "member" as const, name, reportsTo: "manager", mascot: "bear", color: "#9dd8bb", projects: [project],
  })),
];
const task = (id: string, goalId: string, name: string, status: OrchestrationTask["status"], extra: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id, monoGoalId: goalId, managerTurnBlockId: "manager-initial", memberId: name.toLowerCase(), memberName: name,
  sessionId: `${id}-chat`, title: id, harness: "codex", model: "synthetic-model", prompt: "Synthetic fixture only",
  files: [], scopes: [], dependsOn: [], status, accepted: status === "completed", result: "", delivered: status === "completed", ...extra,
});
const dispatch = (id: string, item: OrchestrationTask, seconds: number, extra: Partial<OrchestrationDispatch> = {}): OrchestrationDispatch => ({
  id, taskId: item.id, sessionId: item.sessionId, workspace, startedAt: at(seconds), updatedAt: at(seconds + 1),
  dispatchedAt: at(seconds), state: "completed", stage: "settled", ...extra,
});
const run = (tasks: OrchestrationTask[], dispatches: OrchestrationDispatch[], live: boolean): OrchestrationRun => ({
  version: 2, leadId: "engine", ownerSessionId: "manager-chat", ownerMonoId: "manager", cwd: project, workspace,
  status: live ? "active" : "finished", allowedHarnesses: ["codex"], maxWorkers: 3, projectManager: true,
  cli: "synthetic", tasks, dispatches, continuations: 0, requests: {},
});
const input = (item: MonoManagerGoal, tasks: OrchestrationTask[], dispatches: OrchestrationDispatch[], workers: Session[], managerTurns: Block[], now: number): GoalViewInput & { goalId: string } => ({
  goalId: item.id, goals: [item], roster, runs: [run(tasks, dispatches, item.state !== "done")],
  sessions: [session("grand-chat", [turn(item.userMessageId, 0, 20)]), session("manager-chat", managerTurns), ...workers], now: at(now),
});

function compactionQueue() {
  const item = goal("compaction-queue", "Four hours: compaction and a queued review", "blocked");
  const build = task("implementation", item.id, "Builder", "completed", { lastDispatchId: "build-1" });
  const review = task("queued-review", item.id, "Reviewer", "blocked", {
    activeDispatchId: "review-queued", reviewOf: { taskId: build.id, dispatchId: "build-1" },
  });
  const manager = turn("manager-initial", 30, undefined, { turnMetrics: { firstTokenAt: at(40), inputTokens: 4000, outputTokens: 300, modelCalls: 8,
    compactions: [{ id: "completed-compaction", startedAt: at(300), endedAt: at(420) }, { id: "active-compaction", startedAt: at(14280) }] } });
  const data = input(item, [build, review], [
    dispatch("build-1", build, 60, { turnStartedAt: at(70), turnBlockId: "build-turn", finishedAt: at(7200), reportedAt: at(7210) }),
    dispatch("review-queued", review, 13800, { state: "blocked", stage: "session_prepared" }),
  ], [session(build.sessionId, [turn("build-turn", 70, 7200)]),
    session(review.sessionId, [], { codexStorageError: "Synthetic storage preparation failed. The queued review cannot start." })], [manager], 14400);
  data.sessions = data.sessions.map(source => source.id === "manager-chat" ? { ...source, busy: true, compacting: true } : source);
  return data;
}

function twoReviews() {
  const item = goal("two-reviews", "Review 1 → fix → review 2, with exact attempts", "done");
  const build = task("implementation", item.id, "Builder", "completed", { lastDispatchId: "fix-2" });
  const review1 = task("review-one", item.id, "Reviewer", "completed", { lastDispatchId: "review-1",
    reviewOf: { taskId: build.id, dispatchId: "build-1" }, reviewVerdict: { decision: "changes", notes: "Synthetic corrections", dispatchId: "review-1" } });
  const review2 = task("review-two", item.id, "Reviewer", "completed", { lastDispatchId: "review-2",
    monoGoalId: undefined, reviewOf: { taskId: build.id, dispatchId: "fix-2" },
    reviewVerdict: { decision: "approve", notes: "Synthetic approval", dispatchId: "review-2" } });
  const first = dispatch("build-1", build, 60, { turnBlockId: "build-turn", turnStartedAt: at(70), finishedAt: at(1260), reportedAt: at(1270) });
  return input(item, [build, review1, review2], [
    dispatch("review-2", review2, 3900, { turnBlockId: "review-two-turn", turnStartedAt: at(3910), finishedAt: at(5000), reportedAt: at(5010) }),
    dispatch("fix-2", build, 2600, { turnBlockId: "fix-turn", turnStartedAt: at(2610), finishedAt: at(3800), reportedAt: at(3810) }),
    first, dispatch("review-1", review1, 1300, { turnBlockId: "review-one-turn", turnStartedAt: at(1310), finishedAt: at(2500), reportedAt: at(2510) }), first,
  ], [session(build.sessionId, [turn("fix-turn", 2610, 3800), turn("build-turn", 70, 1260)]),
    session(review1.sessionId, [turn("review-one-turn", 1310, 2500)]), session(review2.sessionId, [turn("review-two-turn", 3910, 5000)])],
  [turn("manager-initial", 30, 50), ...[1290, 2590, 3890].map(seconds => turn(`manager-${seconds}`, seconds, seconds + 5,
    { monoSource: { id: "grand", name: "Grand Orch", mascot: "owl", color: "#7dd3fc", goalId: item.id } }))], 6000);
}

function concurrency() {
  const item = goal("concurrency", "Concurrent workers share a wall clock", "running");
  const builder = task("build-index", item.id, "Builder", "completed", { lastDispatchId: "concurrent-build" });
  const indexer = task("index-workspaces", item.id, "Indexer", "completed", { lastDispatchId: "concurrent-index" });
  const verifier = task("verify-history", item.id, "Verifier", "running", { activeDispatchId: "concurrent-verify" });
  return input(item, [builder, indexer, verifier], [
    dispatch("concurrent-build", builder, 50, { turnBlockId: "build", turnStartedAt: at(60), finishedAt: at(1800), reportedAt: at(1810) }),
    dispatch("concurrent-index", indexer, 80, { turnBlockId: "index", turnStartedAt: at(90), finishedAt: at(2400), reportedAt: at(2410) }),
    dispatch("concurrent-verify", verifier, 100, { state: "running", stage: "turn_submitted", turnBlockId: "verify", turnStartedAt: at(110) }),
  ], [session(builder.sessionId, [turn("build", 60, 1800)]), session(indexer.sessionId, [turn("index", 90, 2400)]),
    session(verifier.sessionId, [turn("verify", 110), { id: "synthetic-tool", role: "tool", text: "Checking historical rows",
      tool: { title: "Checking historical rows", status: "running" } }], { busy: true })], [turn("manager-initial", 30, 45)], 3600);
}

function legacyUnknown() {
  const item = goal("legacy-unknown", "Restored gaps, interruptions and an unloaded retry", "running");
  const worker = task("restored-implementation", item.id, "Builder", "running", { activeDispatchId: "retry-2" });
  const review = task("legacy-review", item.id, "Reviewer", "queued", { monoGoalId: undefined,
    reviewOf: { taskId: worker.id, dispatchId: "legacy-1" } });
  return input(item, [worker, review], [
    dispatch("legacy-1", worker, 60, { state: "interrupted", stage: "turn_submitted", dispatchedAt: undefined,
      turnBlockId: "legacy-turn", turnStartedAt: undefined }),
    dispatch("retry-2", worker, 2400, { state: "running", stage: "turn_submitted", sessionId: "unloaded-retry", turnBlockId: "retry-turn",
      turnStartedAt: at(2410), turnMetrics: { firstTokenAt: at(2420), compactions: [{ id: "retry-compaction", startedAt: at(3000), endedAt: at(3060) }] } }),
  ], [session(worker.sessionId, [turn("legacy-turn", 70, undefined, { turnMetrics: {
    compactions: [{ id: "end-only", endedAt: at(100) }, { id: "start-only", startedAt: at(150) }],
  } }), { id: "legacy-interruption", role: "system", text: "Synthetic interrupted work", notice: "interrupt" }])],
  [{ id: "manager-initial", role: "user", text: "Legacy manager history without timing" }], 7200);
}

export const scenarios = {
  "compaction-queue": compactionQueue(),
  "two-reviews": twoReviews(),
  concurrency: concurrency(),
  "legacy-unknown": legacyUnknown(),
};
export type Scenario = keyof typeof scenarios;
