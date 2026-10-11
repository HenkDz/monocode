import { describe, expect, it } from "vitest";
import type { Block, HarnessId } from "../../sessions/model/session";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import { workspaceIdentity, type OrchestrationDispatch, type OrchestrationRun, type OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { dispatchTurnSnapshot, selectAgentMetrics, selectDelegationEdges, selectGoalMetrics, selectTaskMetrics } from "./agentMetrics";

const turn = (id: string, startedAt: number, inputTokens = 10): Block => ({
  id, role: "user", text: "Task", startedAt, durationMs: 50,
  turnModel: { harness: "codex", id: "test", name: "Test" },
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
    ] }, 999_000)).toEqual({ turns: 1, startedAt: 100, elapsedMs: 0, inputTokenConvention: "total-including-cache", partial: true });
  });
  it("retains unknown counters and ignores drafts and non-turn messages", () => {
    const metrics = selectAgentMetrics({ id: "worker", busy: true, blocks: [
      { id: "reply", role: "assistant", text: "Reply" },
      { ...turn("draft", 1), draft: true },
      { id: "unknown", role: "user", text: "Task", startedAt: 100 },
    ] }, 175);
    expect(metrics).toEqual({ turns: 1, startedAt: 100, elapsedMs: 75, inputTokenConvention: "total-including-cache", partial: true });
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
    const attempts = [dispatch("one", 100, { turnBlockId: "same", turnStartedAt: 100, turnMetrics: block.turnMetrics, turnModel: block.turnModel }),
      dispatch("duplicate", 101, { turnBlockId: "same", turnStartedAt: 100, turnMetrics: block.turnMetrics, turnModel: block.turnModel })];
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
      durationMs: 50, inputTokenConvention: "includes-cache-read", turnMetrics: { inputTokens: 0, outputTokens: 0, modelCalls: 0, compactions: [] } });
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

  it("normalizes mixed-provider agent, task and goal input using each saved turn's harness", () => {
    const manager = turn("grand-turn", 100, 100);
    manager.turnMetrics!.cacheReadTokens = 80;
    const worker = turn("worker-turn", 200, 20);
    worker.turnModel = { harness: "claude", id: "claude-test", name: "Claude test" };
    worker.turnMetrics!.cacheReadTokens = 80;
    const replacedSession = { id: "worker", harness: "codex" as const, blocks: [manager, worker] };
    const expected = { inputTokens: 200, cacheReadTokens: 160, inputTokenConvention: "total-including-cache", partial: false };
    expect(selectAgentMetrics(replacedSession)).toMatchObject(expected);
    expect(selectTaskMetrics(task, [], [replacedSession])).toMatchObject(expected);
    const linkedTask = { ...task, managerTurnBlockId: manager.id };
    expect(selectGoalMetrics(goal, [run([linkedTask], [dispatch("one", 200, { turnBlockId: worker.id })])],
      [{ id: "grand-session", blocks: [manager] }, { ...replacedSession, blocks: [worker] }])).toMatchObject(expected);
    expect(manager.turnMetrics!.inputTokens).toBe(100);
    expect(worker.turnMetrics!.inputTokens).toBe(20);
  });

  it.each<HarnessId>(["codex", "claude", "pi", "omp", "opencode", "fx", "grok", "cursor", "hermes", "antigravity", "devin"])(
    "includes cache writes in normalized %s input without changing raw counters", harness => {
      const block = turn("one", 100, 100);
      block.turnModel!.harness = harness;
      block.turnMetrics!.cacheReadTokens = 80;
      block.turnMetrics!.cacheWriteTokens = 10;
      expect(selectAgentMetrics({ id: "worker", blocks: [block] })).toMatchObject({
        inputTokens: harness === "codex" ? 110 : 190, cacheReadTokens: 80, cacheWriteTokens: 10, partial: false,
      });
      expect(block.turnMetrics!.inputTokens).toBe(100);
    },
  );

  it.each<HarnessId>(["codex", "claude"])("retains %s snapshot provenance after unloading and worker replacement", harness => {
    const block = turn("worker-turn", 200, 100);
    block.turnModel!.harness = harness;
    block.turnMetrics!.cacheReadTokens = 80;
    block.turnMetrics!.cacheWriteTokens = 10;
    const attempt = dispatch("one", 200, { turnBlockId: block.id });
    const session = { id: "worker", harness: "opencode" as const, blocks: [block] };
    const loaded = selectTaskMetrics(task, [attempt], [session]);
    const snapshot = dispatchTurnSnapshot(attempt, session);
    expect(snapshot).toMatchObject({ turnModel: block.turnModel,
      inputTokenConvention: harness === "codex" ? "includes-cache-read" : "excludes-cache",
      turnMetrics: { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 10 } });
    const persisted = JSON.parse(JSON.stringify({ ...attempt, ...snapshot })) as OrchestrationDispatch;
    const replacement = { ...task, harness: "pi" as const, sessionId: "replacement", managerTurnBlockId: "grand-turn" };
    const unloaded = selectTaskMetrics(replacement, [persisted], []);
    expect(unloaded).toEqual(loaded);
    expect(unloaded).toMatchObject({ inputTokens: harness === "codex" ? 110 : 190, partial: false });
    const manager = turn("grand-turn", 100, 100);
    expect(selectGoalMetrics(goal, [run([replacement], [persisted])], [{ id: "grand-session", blocks: [manager] }])).toMatchObject({
      inputTokens: harness === "codex" ? 210 : 290, inputTokenConvention: "total-including-cache", partial: false,
    });
  });

  it("includes cache-only input when observed uncached input is zero", () => {
    const block = turn("cached", 100, 0);
    block.turnModel!.harness = "claude";
    block.turnMetrics!.cacheReadTokens = 80;
    block.turnMetrics!.cacheWriteTokens = 10;
    expect(selectAgentMetrics({ id: "worker", blocks: [block] })).toMatchObject({ inputTokens: 90, partial: false });
    expect(block.turnMetrics!.inputTokens).toBe(0);
  });

  it("leaves legacy input unknown when neither the turn nor snapshot retained its convention", () => {
    const block = { ...turn("legacy", 100, 20), turnModel: undefined };
    const metrics = selectAgentMetrics({ id: "worker", blocks: [block] });
    expect(metrics).toMatchObject({ turns: 1, outputTokens: 5, cacheReadTokens: 8, partial: true });
    expect(metrics.inputTokens).toBeUndefined();
    const attempt = dispatch("one", 100, { turnBlockId: block.id, turnStartedAt: 100,
      durationMs: block.durationMs, turnMetrics: block.turnMetrics });
    expect(selectTaskMetrics({ ...task, harness: "claude" }, [attempt], [])).toEqual(metrics);
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
  expect(snapshot).toMatchObject({ turnBlockId: "first", turnStartedAt: 100, durationMs: 50, firstTokenAt: 110,
    turnModel: { harness: "codex" }, inputTokenConvention: "includes-cache-read", turnMetrics: { inputTokens: 10 } });
});
