import { describe, expect, it } from "vitest";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationDispatch, OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import type { Block, Session } from "../../sessions/model/session";
import { goalElapsedLabel, goalTokenLabel, openGoalTarget, selectGoalViews } from "./goalView";

const turn = (id: string, inputTokens = 10, extra: Partial<Block> = {}): Block => ({ id, role: "user", text: "Task",
  startedAt: 100, durationMs: 50, turnModel: { harness: "codex", id: "test", name: "Test" },
  turnMetrics: { inputTokens, outputTokens: 5, cacheReadTokens: 8, endedAt: 150 }, ...extra });
const session = (id: string, blocks: Block[] = [], extra: Partial<Session> = {}): Session => ({ id, blocks, harness: "codex", model: "test",
  modelSettings: {}, runtimeMode: "supervised", title: "Test", cwd: "/repo", ...extra });
const goal = (id = "goal", extra: Partial<MonoManagerGoal> = {}): MonoManagerGoal => ({ id, monoId: "grand", managerId: "engine", projectId: "/repo",
  userMessageId: `origin-${id}`, requestId: id, title: "Goal", state: "running", prUrls: [], createdAt: 50, updatedAt: 100, ...extra });
const task = (id = "task", extra: Partial<OrchestrationTask> = {}): OrchestrationTask => ({ id, monoGoalId: "goal", managerTurnBlockId: "manager-turn",
  memberId: "member", memberName: "Builder", sessionId: "worker", title: "Build", harness: "codex", model: "test", prompt: "Build",
  files: [], scopes: [], dependsOn: [], status: "completed", accepted: true, result: "", delivered: true, ...extra });
const dispatch = (id = "dispatch", extra: Partial<OrchestrationDispatch> = {}): OrchestrationDispatch => ({ id, taskId: "task", sessionId: "worker",
  workspace: { id: "workspace", projectCwd: "/repo", checkoutCwd: "/repo", kind: "main" }, state: "completed", stage: "settled",
  startedAt: 80, dispatchedAt: 80, updatedAt: 150, finishedAt: 150, turnBlockId: "worker-turn", reportedTurnBlockId: "report", ...extra });
const run = (tasks = [task()], dispatches = [dispatch()], extra: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: "manager-chat", cwd: "/repo", status: "active", tasks, dispatches,
  allowedHarnesses: ["codex"], maxWorkers: 2, cli: "test", continuations: 0, requests: {}, ...extra });
const roster: Mono[] = [
  { id: "grand", role: "orchestrator", name: "Grand", sessionId: "grand-chat", mascot: "owl", color: "blue", projects: ["/repo"] },
  { id: "manager", role: "manager", name: "Manager", reportsTo: "grand", sessionId: "manager-chat", mascot: "fox", color: "blue", projects: ["/repo"] },
  { id: "member", role: "member", reportsTo: "manager", mascot: "cat", color: "blue", projects: ["/repo"] },
];
const sessions = [session("grand-chat", [turn("origin-goal")]), session("manager-chat", [turn("manager-turn"), turn("report")]), session("worker", [turn("worker-turn")])];
const project = (extra: Partial<Parameters<typeof selectGoalViews>[0]> = {}) => selectGoalViews({ goals: [goal()], roster, runs: [run()], sessions, now: 1000, ...extra });

describe("Mission control goal projection", () => {
  it("closes the goal view before resolving a worker request through existing lead routing", () => {
    const calls: string[] = [];
    const routes = { close: () => { calls.push("close"); }, request: (id: string) => { calls.push(`request:${id}`); },
      mono: (id: string) => { calls.push(`mono:${id}`); }, session: (id: string) => { calls.push(`session:${id}`); } };
    openGoalTarget({ requestSessionId: "worker" }, routes);
    expect(calls).toEqual(["close", "request:worker"]);
    calls.length = 0;
    openGoalTarget({ monoId: "grand" }, routes);
    openGoalTarget({ sessionId: "worker" }, routes);
    expect(calls).toEqual(["mono:grand", "session:worker"]);
    expect(() => openGoalTarget({}, routes)).toThrow("Conversation unavailable");
  });
  it("keeps simultaneous goals separate without summing overlapping shared sessions", () => {
    const result = project({ goals: [goal(), goal("second")], runs: [run([task(), task("second-task", { monoGoalId: "second", sessionId: "second-worker" })],
      [dispatch(), dispatch("second-dispatch", { taskId: "second-task", sessionId: "second-worker", turnBlockId: "second-turn" })])],
      sessions: [...sessions.map(s => s.id === "grand-chat" ? { ...s, blocks: [...s.blocks, turn("origin-second")] } : s), session("second-worker", [turn("second-turn", 20)])] });
    expect(result.live).toHaveLength(2);
    expect(result.live.map(view => view.metrics.inputTokens)).toEqual([40, 50]);
    expect(result.live[0].nodes.slice(0, 2).every(node => node.shared)).toBe(true);
    expect(result.live[0].nodes[1].metrics).toMatchObject({ inputTokens: 20, turns: 2 });
    expect(result.live[1].nodes[2].name).toBe("Builder");
  });

  it("does not accrue time on an old goal turn when a shared chat is working on another goal", () => {
    const old = turn("manager-turn", 10, { durationMs: undefined, turnMetrics: { inputTokens: 10, outputTokens: 5 } });
    const view = project({ sessions: [sessions[0], session("manager-chat", [old, turn("unrelated", 1000, { startedAt: 900, durationMs: undefined })], { busy: true }), sessions[2]] }).live[0];
    expect(view.nodes[1].metrics?.elapsedMs).toBe(0);
    expect(view.nodes[1].metrics?.partial).toBe(true);
    expect(view.nodes[1].metrics?.inputTokens).toBe(10);
  });

  it("shows the root's own canonical state without pretending it directly dispatched workers", () => {
    const view = project({ runs: [run([task("task", { status: "running" })])] }).live[0];
    expect(view.nodes[0].state?.status).toBe("idle");
    expect(view.nodes[0].activity).toContain("delegated to Manager");
    expect(view.nodes[1].state?.status).toBe("waiting-on-member");
  });

  it("makes an idle Manager wait on the blocked current goal worker and preserves its own work", () => {
    const queued = task("task", { status: "queued", accepted: false, memberName: "Reviewer" });
    const data = { runs: [run([queued])], sessions: [sessions[0], sessions[1], session("worker", [], { codexStorageError: "Repair storage" })] };
    expect(project(data).live[0].nodes[1].state).toMatchObject({ status: "waiting-on-member", waitingOn: "Reviewer", detail: "Reviewer blocked" });
    expect(project({ ...data, sessions: data.sessions.map(source => source.id === "manager-chat" ? { ...source, busy: true } : source) }).live[0].nodes[1].state?.status).toBe("thinking");
  });

  it("does not inherit reused worker blockers from completed, accepted or terminal-goal work", () => {
    const held = session("worker", [], { codexStorageError: "Old repair" });
    for (const completed of [task(), task("task", { status: "cancelled" })])
      expect(project({ runs: [run([completed])], sessions: [sessions[0], sessions[1], held] }).live[0].nodes[1].state?.status).not.toBe("waiting-on-member");
    const failed = task("task", { status: "failed", accepted: false, memberName: "Reviewer", error: "Connection lost" });
    const data = { runs: [run([failed])], sessions: [sessions[0], sessions[1], held] };
    expect(project(data).live[0].nodes[1].state?.detail).toBe("Reviewer failed");
    expect(project(data).live[0].nodes[2].state?.status).toBe("failed");
    expect(project({ ...data, goals: [goal("goal", { state: "done" })] }).finished[0].nodes[1].state?.status).not.toBe("waiting-on-member");
    expect(project({ ...data, runs: [run([failed], [], { status: "finished" })] }).live[0].nodes[1].state?.status).toBe("done");
  });

  it("preserves a Manager's durable-chat storage blocker over its busy engine session", () => {
    const view = project({ runs: [run(undefined, undefined, { ownerSessionId: "engine-chat" })], sessions: [
      sessions[0], session("manager-chat", [], { codexStorageError: "Repair required" }), session("engine-chat", [turn("manager-turn")], { busy: true }), sessions[2],
    ] }).live[0];
    expect(view.nodes[1].state).toMatchObject({ status: "blocked", reason: "storage", detail: "Repair required" });
    expect(view.nodes[1].target).toEqual({ monoId: "manager" });
    expect(view.nodes[1].metrics).toMatchObject({ inputTokens: 10 });
    expect(view.nodes[1].metricsLabel).toBe("Engine goal contribution");
  });

  it("opens an engine blocker at the engine and retains both recorded conversation contributions", () => {
    const view = project({ runs: [run(undefined, undefined, { ownerSessionId: "engine-chat" })], sessions: [sessions[0],
      session("manager-chat", [turn("report")]), session("engine-chat", [turn("manager-turn")], { codexStorageError: "Engine blocked" }), sessions[2]] }).live[0];
    expect(view.nodes[1].target).toEqual({ sessionId: "engine-chat" });
    expect(view.nodes[1].metrics?.inputTokens).toBe(10);
    expect(view.nodes[1].chatMetrics?.inputTokens).toBe(10);
  });

  it("recovers an origin session by its exact saved message when its roster entry is missing", () => {
    const root = project({ roster: roster.slice(1) }).live[0].nodes[0];
    expect(root.target).toEqual({ sessionId: "grand-chat" });
    expect(root.metrics?.inputTokens).toBe(10);
    expect(root.state?.status).toBe("idle");
  });

  it("retains chain nodes and unknown telemetry when roster and run links are missing", () => {
    const view = project({ roster: [], runs: [], sessions: [] }).live[0];
    expect(view.nodes).toHaveLength(2);
    expect(view.nodes[0].state).toBeUndefined();
    expect(view.nodes[1].target).toBeUndefined();
    expect(view.rosterIssue).toContain("unavailable");
    expect(goalTokenLabel(view.metrics)).toBe("Tokens unavailable");
  });

  it("terminates cyclic roster links while retaining saved goal identity", () => {
    const cyclic = roster.map(mono => mono.id === "grand" ? { ...mono, reportsTo: "manager" } : mono);
    expect(project({ roster: cyclic }).live[0].rosterIssue).toContain("Cyclic");
    expect(project({ roster: roster.map(mono => mono.id === "manager" ? { ...mono, reportsTo: "missing" } : mono) }).live[0].rosterIssue).toContain("Missing");
  });

  it("retains every retry and navigates to the exact latest worker session", () => {
    const view = project({ runs: [run([task("task", { status: "running", activeDispatchId: "retry" })], [dispatch(), dispatch("retry", {
      sessionId: "replacement", turnBlockId: "retry-turn", startedAt: 200, dispatchedAt: 200, state: "running", finishedAt: undefined,
    })])], sessions: [...sessions, session("replacement", [turn("retry-turn", 20)], { busy: true })] }).live[0];
    const worker = view.nodes[2];
    expect(worker.target).toEqual({ sessionId: "replacement" });
    expect(worker.attempts?.map(attempt => attempt.edge.id)).toEqual(["dispatch", "retry"]);
    expect(worker.elapsedMs).toBe(800);
    expect(worker.metrics).toMatchObject({ turns: 2, inputTokens: 30 });
  });

  it("joins legacy reviewer goals to their exact reviewed task and dispatch without mutating inputs", () => {
    const review = task("review", { monoGoalId: undefined, reviewOf: { taskId: "task", dispatchId: "dispatch" }, memberName: "Reviewer", sessionId: "reviewer" });
    const view = project({ runs: [run([task(), review], [dispatch(), dispatch("review-attempt", { taskId: "review", sessionId: "reviewer", turnBlockId: "review-turn" })])],
      sessions: [...sessions, session("reviewer", [turn("review-turn", 20)])] }).live[0];
    expect(view.nodes[3].review).toEqual({ taskId: "task", dispatchId: "dispatch", title: "Build", available: true });
    expect(view.metrics.inputTokens).toBe(60);
    expect(review.monoGoalId).toBeUndefined();
  });

  it("leaves cyclic reviewer ancestry unlinked and labels unavailable exact dispatch references", () => {
    const cycle = [task("a", { monoGoalId: undefined, reviewOf: { taskId: "b", dispatchId: "b-attempt" } }),
      task("b", { monoGoalId: undefined, reviewOf: { taskId: "a", dispatchId: "a-attempt" } })];
    expect(project({ runs: [run(cycle, [])] }).live[0].nodes).toHaveLength(2);
    const review = task("review", { reviewOf: { taskId: "task", dispatchId: "missing" } });
    expect(project({ runs: [run([task(), review])] }).live[0].nodes[3].review?.available).toBe(false);
  });

  it("deduplicates repeated turn/report references and uses normalized input without adding cache reads again", () => {
    const result = project({ runs: [run([task(), task("other", { sessionId: "worker" })], [dispatch(), dispatch("duplicate", { taskId: "other" })])] });
    expect(result.live[0].metrics).toMatchObject({ turns: 4, inputTokens: 40, outputTokens: 20, cacheReadTokens: 32 });
    expect(goalTokenLabel(result.live[0].metrics)).toBe("60 tokens");
  });

  it("shows unavailable historical elapsed and tokens rather than treating mutable updates as finish times", () => {
    const view = project({ goals: [goal("goal", { state: "done", updatedAt: 999 })], sessions: [], runs: [] }).finished[0];
    expect(view.wallElapsedMs).toBeUndefined();
    expect(goalElapsedLabel(view.wallElapsedMs)).toBe("unavailable");
    expect(goalTokenLabel(view.metrics)).toBe("Tokens unavailable");
  });

  it("keeps done, cancelled and archived goals in finished history", () => {
    const result = project({ goals: [goal(), goal("done", { state: "done" }), goal("cancelled", { state: "cancelled" }), goal("archived", { archived: true })] });
    expect(result.live.map(view => view.goal.id)).toEqual(["goal"]);
    expect(result.finished.map(view => view.goal.id)).toEqual(["done", "cancelled", "archived"]);
  });

  it("deduplicates a shared Manager request across goals and excludes lead-routed worker approvals", () => {
    const approval: Block = { id: "approval", role: "tool", text: "Needs approval", approval: { requestId: 1 } };
    const result = project({ goals: [goal(), goal("second")], sessions: [sessions[0], session("manager-chat", [approval]), session("worker", [approval]) ] });
    expect(result.attention).toHaveLength(1);
    expect(result.attention[0].target).toEqual({ monoId: "manager" });
    expect(result.live[0].nodes[2].state).toMatchObject({ status: "done" });
    const workerOnly = project({ sessions: [sessions[0], sessions[1], session("worker", [approval])], runs: [run([task("task", { status: "running" })])] });
    expect(workerOnly.live[0].nodes[2].state?.status).toBe("needs-you");
    expect(workerOnly.live[0].nodes[2].target).toEqual({ requestSessionId: "worker" });
    expect(workerOnly.attention).toHaveLength(0);
  });

  it("counts known worker storage blockers but not ordinary failures or dependency waits", () => {
    const result = project({ sessions: [...sessions.slice(0, 2), session("worker", [], { codexStorageError: "Storage failed" })],
      runs: [run([task("task", { status: "blocked" })])] });
    expect(result.attention).toHaveLength(1);
    expect(result.attention[0].target).toEqual({ sessionId: "worker" });
    expect(project({ runs: [run([task("task", { status: "failed", error: "Tests failed" })])] }).attention).toHaveLength(0);
    expect(project({ runs: [run([task("task", { status: "queued", dependsOn: ["missing"] })])] }).attention).toHaveLength(0);
  });

  it("retains an unabridged long title and distinguishes measured zero from unavailable counters", () => {
    const title = "VeryLongGoalIdentifier".repeat(40);
    expect(project({ goals: [goal("goal", { title })] }).live[0].goal.title).toBe(title);
    expect(goalTokenLabel({ turns: 1, elapsedMs: 0, partial: false, inputTokens: 0, outputTokens: 0 })).toBe("0 tokens");
    expect(goalTokenLabel({ turns: 1, elapsedMs: 0, partial: true, outputTokens: 5 })).toBe("5 tokens · partial");
    expect(goalElapsedLabel(0)).toBe("0m 0s");
    expect(goalElapsedLabel(3_661_000)).toBe("1h 1m");
  });
});
