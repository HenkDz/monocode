import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import { workspaceIdentity, type OrchestrationDispatch, type OrchestrationRun, type OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { dispatchTurnSnapshot, selectAgentMetrics, selectDelegationEdges, selectGoalMetrics, selectTaskMetrics } from "./agentMetrics";

const turn = (id: string, startedAt: number, inputTokens = 10): Block => ({
  id, role: "user", text: "Task", startedAt, durationMs: 50,
  turnMetrics: { inputTokens, outputTokens: 5, cacheReadTokens: 8, modelCalls: 2,
    firstTokenAt: startedAt + 10, endedAt: startedAt + 50, compactions: [] },
});
const task: OrchestrationTask = { id: "task", sessionId: "worker", title: "Task", harness: "codex", model: "test",
  prompt: "Task", files: ["src"], scopes: ["/repo/src"], dependsOn: [], status: "completed", accepted: false, result: "", delivered: true,
  monoGoalId: "goal", managerTurnBlockId: "manager-turn" };
const dispatch = (id: string, startedAt: number, extra: Partial<OrchestrationDispatch> = {}): OrchestrationDispatch => ({
  id, taskId: task.id, sessionId: task.sessionId, workspace: workspaceIdentity("/repo", "/repo"),
  state: "completed", stage: "settled", startedAt, updatedAt: startedAt + 50, ...extra,
});
const goal: MonoManagerGoal = { id: "goal", monoId: "grand", managerId: "engine", projectId: "repo", userMessageId: "grand-turn",
  requestId: "request", title: "Goal", state: "running", prUrls: [], createdAt: 50, updatedAt: 50 };
const run = (tasks: OrchestrationTask[], dispatches: OrchestrationDispatch[]): OrchestrationRun => ({
  version: 2, leadId: "engine", ownerSessionId: "manager-session", ownerMonoId: "manager", cwd: "/repo", status: "active",
  allowedHarnesses: ["codex"], maxWorkers: 2, cli: "mono", continuations: 0, requests: {}, tasks, dispatches,
});

describe("agent metrics rollups", () => {
  it("does not freeze a running retry at an earlier attempt's finish", () => {
    const metrics = selectAgentMetrics({ id: "worker", busy: true, blocks: [turn("first", 100),
      { id: "retry", role: "user", text: "Retry", startedAt: 200 }] }, 300);
    expect(metrics.elapsedMs).toBe(150);
    expect(metrics.endedAt).toBeUndefined();
  });
  it("does not invent ongoing work for an inactive historical turn missing its end", () => {
    expect(selectAgentMetrics({ id: "worker", blocks: [
      { id: "interrupted", role: "user", text: "Old work", startedAt: 100 },
    ] }, 999_000)).toEqual({ turns: 1, startedAt: 100, elapsedMs: 0, partial: true });
  });
  it("retains unknown counters and ignores drafts and non-turn messages", () => {
    const metrics = selectAgentMetrics({ id: "worker", busy: true, blocks: [
      { id: "reply", role: "assistant", text: "Reply" },
      { ...turn("draft", 1), draft: true },
      { id: "unknown", role: "user", text: "Task", startedAt: 100 },
    ] }, 175);
    expect(metrics).toEqual({ turns: 1, startedAt: 100, elapsedMs: 75, partial: true });
    expect(metrics.inputTokens).toBeUndefined();
    expect(metrics.modelCalls).toBeUndefined();
    expect(metrics.compactions).toBeUndefined();
  });

  it("adds observed accounting and elapsed work without treating parallel work as wall time", () => {
    const compacted = turn("one", 100);
    compacted.turnMetrics!.compactions = [{ startedAt: 110, endedAt: 115 }];
    const metrics = selectAgentMetrics({ id: "worker", blocks: [compacted, turn("two", 200, 20)] }, 999);
    expect(metrics).toMatchObject({ turns: 2, elapsedMs: 100, startedAt: 100, firstTokenAt: 110, endedAt: 250,
      inputTokens: 30, outputTokens: 10, cacheReadTokens: 16, modelCalls: 4, compactions: 1, partial: false });
  });

  it("flags a sum as partial when some turn accounting is unavailable", () => {
    const metrics = selectAgentMetrics({ id: "worker", blocks: [turn("one", 100), { id: "missing", role: "user", text: "Task", startedAt: 200, durationMs: 20 }] });
    expect(metrics.inputTokens).toBe(10);
    expect(metrics.elapsedMs).toBe(70);
    expect(metrics.partial).toBe(true);
  });

  it("counts repeated user-turn references once", () => {
    const block = turn("same", 100);
    expect(selectAgentMetrics({ id: "worker", blocks: [block, block] })).toMatchObject({ turns: 1, inputTokens: 10 });
    const attempts = [dispatch("one", 100, { turnBlockId: "same", turnStartedAt: 100, turnMetrics: block.turnMetrics }),
      dispatch("duplicate", 101, { turnBlockId: "same", turnStartedAt: 100, turnMetrics: block.turnMetrics })];
    expect(selectTaskMetrics(task, attempts, [])).toMatchObject({ turns: 1, inputTokens: 10 });
  });

  it("keeps observed durations when historical start timestamps are unavailable", () => {
    const block = { ...turn("historical", 100), startedAt: undefined };
    expect(selectAgentMetrics({ id: "worker", blocks: [block] })).toMatchObject({ turns: 1, elapsedMs: 50, inputTokens: 10 });
  });

  it("includes retried and replaced workers and excludes unrelated turns in reused sessions", () => {
    const attempts = [dispatch("two", 300, { sessionId: "replacement", turnBlockId: "retry" }),
      dispatch("one", 100, { turnBlockId: "first" }),
      { ...dispatch("other", 200), taskId: "another-task", turnBlockId: "unrelated" }];
    const sessions = [{ id: "worker", blocks: [turn("first", 100), turn("unrelated", 200, 1000)] },
      { id: "replacement", blocks: [turn("retry", 300, 20)] }];
    expect(selectTaskMetrics(task, attempts, sessions)).toMatchObject({ turns: 2, elapsedMs: 100, inputTokens: 30, partial: false });
  });

  it("bounds older turns by attempt windows, including shuffled retries", () => {
    const attempts = [dispatch("two", 300), dispatch("one", 100, { finishedAt: 180 })];
    const sessions = [{ id: "worker", blocks: [turn("first", 100), turn("manual", 200, 1000), turn("retry", 300, 20)] }];
    expect(selectTaskMetrics(task, attempts, sessions)).toMatchObject({ turns: 2, inputTokens: 30 });
  });

  it("uses persisted snapshots for unloaded chats and preserves zero counters", () => {
    const attempt = dispatch("one", 100, { turnStartedAt: 110, finishedAt: 160, firstTokenAt: 120,
      durationMs: 50, turnMetrics: { inputTokens: 0, outputTokens: 0, modelCalls: 0, compactions: [] } });
    expect(selectTaskMetrics(task, [attempt], [])).toMatchObject({ turns: 1, elapsedMs: 50, inputTokens: 0, outputTokens: 0,
      modelCalls: 0, firstTokenAt: 120, endedAt: 160, compactions: 0, partial: false });
    expect(selectTaskMetrics(task, [dispatch("missing", 100)], [])).toMatchObject({ turns: 0, partial: true });
  });

  it("rolls up a goal through Grand, Manager, workers and review without duplicating shared Manager turns", () => {
    const review = { ...task, id: "review", sessionId: "reviewer", reviewOf: { taskId: "task", dispatchId: "one" } };
    const attempts = [dispatch("one", 200, { turnBlockId: "worker-turn", reportedTurnBlockId: "report-turn" }),
      { ...dispatch("review-one", 300, { turnBlockId: "review-turn", reportedTurnBlockId: "report-turn" }), taskId: "review", sessionId: "reviewer" }];
    const sessions = [{ id: "grand-session", blocks: [turn("grand-turn", 1)] },
      { id: "manager-session", blocks: [turn("manager-turn", 100), turn("report-turn", 400), turn("other-goal", 500, 1000)] },
      { id: "worker", blocks: [turn("worker-turn", 200)] }, { id: "reviewer", blocks: [turn("review-turn", 300)] }];
    expect(selectGoalMetrics(goal, [run([task, review], attempts)], sessions)).toMatchObject({ turns: 5, inputTokens: 50, modelCalls: 10, elapsedMs: 250 });
  });

  it("includes Manager goal messages before any worker was delegated", () => {
    const message = { ...turn("first-message", 100), monoSource: { id: "grand", name: "Grand", mascot: "G", color: "blue", goalId: "goal" } };
    expect(selectGoalMetrics(goal, [], [{ id: "manager-session", blocks: [message] }])).toMatchObject({ turns: 1, inputTokens: 10 });
  });

  it("marks goal totals partial when a linked Manager or originating turn is unloaded", () => {
    expect(selectGoalMetrics(goal, [run([task], [dispatch("one", 200, { turnBlockId: "worker-turn" })])],
      [{ id: "worker", blocks: [turn("worker-turn", 200)] }])).toMatchObject({ turns: 1, inputTokens: 10, partial: true });
  });
});

it("exposes delegation lifecycle timestamps and leaves legacy turn boundaries unknown", () => {
  const worker = dispatch("one", 100, { dispatchedAt: 100, turnStartedAt: 110, firstTokenAt: 120, finishedAt: 160, reportedAt: 180 });
  const edges = selectDelegationEdges([goal], [run([task], [worker, dispatch("old", 1)])], []);
  expect(edges[0]).toMatchObject({ id: "goal", goalId: "goal", managerId: "engine", managerMonoId: "manager", dispatchedAt: 50 });
  expect(edges[1]).toMatchObject({ id: "one", goalId: "goal", managerId: "engine", managerMonoId: "manager", managerSessionId: "manager-session",
    managerTurnBlockId: "manager-turn", taskId: "task", sessionId: "worker", dispatchedAt: 100,
    startedAt: 110, firstTokenAt: 120, finishedAt: 160, reportedAt: 180 });
  expect(edges[2].startedAt).toBeUndefined();
});

it("snapshots only the dispatch's exact turn", () => {
  const snapshot = dispatchTurnSnapshot(dispatch("one", 100, { turnBlockId: "first" }),
    { id: "worker", blocks: [turn("stale", 1, 1000), turn("first", 100), turn("later", 200, 2000)] });
  expect(snapshot).toMatchObject({ turnBlockId: "first", turnStartedAt: 100, durationMs: 50, firstTokenAt: 110, turnMetrics: { inputTokens: 10 } });
});
