// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Orchestrator, orchestrator, workspaceIdentity, type ControlOutcome, type OrchestrationHost, type OrchestrationRun } from "../../orchestration/model/orchestration";
import { selectTaskMetrics } from "../../agents/model/agentMetrics";
import { newSession } from "../../sessions/model/session";
import { cardSession } from "../model/monoCards";
import type { Mono } from "../model/mono";
import { MemberWorkLog } from "./MemberWorkLog";

vi.mock("../../source-control/hooks/usePrStatus", () => ({ usePrStatusCache: () => new Map() }));
vi.mock("../model/monoCards", () => ({ cardSession: vi.fn(), openCardSession: vi.fn(), subscribeCardSessions: () => () => {} }));

const member = { id: "member", role: "member", projects: ["/repo"] } as Mono;

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(cardSession).mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function fixture() {
  let saved: OrchestrationRun | undefined;
  const store = {
    save: async (run: OrchestrationRun) => { saved = structuredClone(run); },
    load: async () => structuredClone(saved ?? null),
    enable: async () => "mono",
    disable: async () => {},
    attachOwner: async () => {},
    scopes: async (cwd: string, files: string[]) => files.map(file => `${cwd}/${file}`),
    resolvePath: async (path: string) => path,
  };
  const manager = new Orchestrator(store);
  const lead = { ...newSession("codex", "/repo"), id: "lead" };
  const sessions = [lead];
  let complete!: (outcome: ControlOutcome) => void;
  const host: OrchestrationHost = {
    session: id => sessions.find(session => session.id === id),
    sessions: () => sessions,
    choices: () => [{ harness: "codex", models: [{ id: "test", name: "Test" }] }],
    createWorker: vi.fn(async (_run, task) => {
      sessions.push({ ...newSession("codex", "/repo"), id: task.sessionId });
      return { workspace: workspaceIdentity("/repo", "/worker") };
    }),
    submit: vi.fn((id, _text, done) => {
      const session = sessions.find(session => session.id === id)!;
      session.busy = true;
      complete = outcome => { session.busy = false; done(outcome); };
    }),
    stop: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    respondApproval: vi.fn(),
    answerQuestion: vi.fn(),
  };
  manager.bind(host);
  await manager.start(lead.id, ["codex"], 1);
  lead.busy = true;
  const delegate = () => manager.handle(lead.id, "request", "delegate", {
    title: "Task", prompt: "Implement", harness: "codex", model: "test", files: ["src"], member: member.id,
    memberName: "Builder", memberMascot: "cat", memberColor: "#abc", monoGoalId: "original-goal",
  });
  return { manager, host, sessions, store, delegate, saved: () => saved!, complete: (outcome: ControlOutcome) => complete(outcome) };
}

async function render(run: OrchestrationRun) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([run]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<MemberWorkLog member={member} />));
  return { host, root, metrics: () => host.querySelector<HTMLElement>("[data-task-metrics]")! };
}

it("keeps actual accepted preparation and settled preparation failure without a conversation clock", async () => {
  let now = 100;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = await fixture();
  let fail!: (error: Error) => void;
  vi.mocked(f.host.createWorker).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  await f.delegate();
  await vi.waitFor(() => expect(f.host.createWorker).toHaveBeenCalledOnce());
  const accepted = structuredClone(f.saved());
  expect(accepted.tasks[0].status).toBe("running");
  expect(accepted.dispatches![0]).toMatchObject({ state: "starting", stage: "accepted", startedAt: 100, dispatchedAt: 100 });
  expect(accepted.dispatches![0].turnStartedAt).toBeUndefined();
  now = 60_100;
  const view = await render(accepted);
  try {
    expect(view.metrics().textContent).toBe("Conversation not started · Tokens unavailable · Thinking");
    now = 3100;
    fail(new Error("Preparation failed"));
    await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("settled"));
    const settled = f.saved();
    expect(settled.dispatches![0]).toMatchObject({ state: "failed", startedAt: 100, dispatchedAt: 100, finishedAt: 3100 });
    expect(settled.dispatches![0].turnStartedAt).toBeUndefined();
    vi.mocked(orchestrator.snapshot).mockReturnValue([settled]);
    await act(async () => view.root.render(<MemberWorkLog member={member} />));
    expect(view.metrics().textContent).toBe("Conversation not started · Tokens unavailable · Failed");
    expect(f.host.submit).not.toHaveBeenCalled();
  } finally { await act(async () => view.root.unmount()); }
});

it.each([0, 5000])("retains an actually observed start at zero and completed duration %i through saved dispatches", async durationMs => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const f = await fixture();
  await f.delegate();
  await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("turn_submitted"));
  const task = f.saved().tasks[0], worker = f.sessions.find(session => session.id === task.sessionId)!;
  worker.blocks.push({ id: "observed-turn", role: "user", text: "Task", startedAt: 0,
    turnModel: { harness: "codex", id: "test", name: "Test" } });
  now = 1000;
  f.manager.observe(worker.id, { type: "turn.started", providerTurnId: "turn" });
  await vi.waitFor(() => expect(f.saved().dispatches![0].turnStartedAt).toBe(0));
  const view = await render(f.saved());
  try {
    expect(view.metrics().textContent).toBe("1s · Tokens unavailable · Thinking");
    worker.blocks[0] = { ...worker.blocks[0], durationMs, turnMetrics: { endedAt: durationMs, inputTokens: 1000, cacheReadTokens: 900, outputTokens: 0 } };
    now = durationMs + 30_000;
    f.complete({ status: "completed", text: "Done" });
    await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("settled"));
    expect(f.saved().dispatches![0]).toMatchObject({ turnStartedAt: 0, durationMs, finishedAt: now });
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    await restored.hydrate("lead");
    vi.mocked(orchestrator.snapshot).mockReturnValue(restored.snapshot());
    await act(async () => view.root.render(<MemberWorkLog member={member} />));
    expect(selectTaskMetrics(task, restored.run("lead")!.dispatches!, []).elapsedMs).toBe(durationMs);
    expect(view.metrics().textContent).toBe(`${durationMs ? "5s" : "1s"} · 1,000 in / 900 cached / 0 out tokens · Waiting review`);
    expect(view.metrics().title).toContain("Total input (including cache) 1,000");
    expect(view.metrics().title).toContain("Cached 900");
  } finally { await act(async () => view.root.unmount()); }
});

it.each(["failed", "start_unknown"] as const)("keeps a persisted legacy %s attempt without a turn start unavailable after hydration", async state => {
  const f = await fixture();
  await f.delegate();
  await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("turn_submitted"));
  f.complete({ status: "failed", text: "", error: "No turn was recorded" });
  await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("settled"));
  const legacy = structuredClone(f.saved());
  delete legacy.dispatches![0].dispatchedAt;
  delete legacy.dispatches![0].finishedAt;
  legacy.dispatches![0].state = state;
  legacy.dispatches![0].turnMetrics = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  legacy.dispatches![0].inputTokenConvention = "includes-cache-read";
  await f.store.save(legacy);
  const restored = new Orchestrator(f.store);
  restored.bind(f.host);
  await restored.hydrate("lead");
  const view = await render(restored.run("lead")!);
  try {
    expect(restored.run("lead")!.dispatches![0].turnStartedAt).toBeUndefined();
    expect(view.metrics().textContent).toMatch(/^Elapsed unavailable · 0 in \/ 0 cached \/ 0 out tokens/);
    expect(view.metrics().title).toContain("Total input (including cache) 0");
  } finally { await act(async () => view.root.unmount()); }
});

it.each([false, true])("does not reuse an earlier goal's clock for a new accepted dispatch (reused session: %s)", async reuseSession => {
  const f = await fixture();
  await f.delegate();
  await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("turn_submitted"));
  f.complete({ status: "completed", text: "Done" });
  await vi.waitFor(() => expect(f.saved().dispatches![0].stage).toBe("settled"));
  const run = structuredClone(f.saved()), task = run.tasks[0], old = run.dispatches![0];
  Object.assign(old, { turnStartedAt: 0, durationMs: 5000, finishedAt: 5000, turnMetrics: { inputTokens: 100, cacheReadTokens: 90, outputTokens: 10 }, inputTokenConvention: "includes-cache-read" });
  const sessionId = reuseSession ? task.sessionId : "replacement-worker";
  run.dispatches!.push({ ...old, id: "new-attempt", sessionId, state: "starting", stage: "accepted", startedAt: 60_000, dispatchedAt: 60_000,
    updatedAt: 60_000, turnStartedAt: undefined, finishedAt: undefined, durationMs: undefined, turnMetrics: undefined });
  Object.assign(task, { monoGoalId: "new-goal", sessionId, status: "running", activeDispatchId: "new-attempt" });
  const totals = selectTaskMetrics(task, run.dispatches!, []);
  vi.mocked(cardSession).mockImplementation(id => id === sessionId ? { id, taskMetrics: { [task.id]: totals } } as ReturnType<typeof cardSession> : undefined);
  const view = await render(run);
  try {
    expect(view.metrics().textContent).toBe("Elapsed unavailable · 100 in / 90 cached / 10 out tokens · Thinking");
    expect(task.monoGoalId).toBe("new-goal");
    expect(task.sessionId).toBe(sessionId);
    expect(run.dispatches![1].turnStartedAt).toBeUndefined();
  } finally { await act(async () => view.root.unmount()); }
});
