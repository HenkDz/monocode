import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { Orchestrator, type ControlOutcome, type OrchestrationHost, type OrchestrationRun, type OrchestrationTask } from "./orchestration";
import { acceptManagerWakeQueue, MANAGER_QUESTION_DELAY, MANAGER_WAKE_TIMEOUT, type ManagerWakeReceipt } from "./managerWake";

const root = "C:/synthetic/manager-wake-integration";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function setup() {
  const saved = new Map<string, OrchestrationRun>();
  const sessions = new Map<string, Session>();
  const durableSessions = new Map<string, Session>();
  const completions = new Map<string, (outcome: ControlOutcome) => void>();
  const accepted = new Map<string, ManagerWakeReceipt>();
  const lead = { ...newSession("codex", root), id: "manager-chat" };
  sessions.set(lead.id, lead);
  durableSessions.set(lead.id, clone(lead));
  const store = {
    save: vi.fn(async (run: OrchestrationRun) => { saved.set(run.leadId, clone(run)); }),
    load: vi.fn(async (id: string) => saved.has(id) ? clone(saved.get(id)!) : null),
    enable: vi.fn(async () => "synthetic-monocode"),
    disable: vi.fn(async () => {}),
    attachOwner: vi.fn(async () => {}),
    scopes: vi.fn(async (cwd: string, files: string[]) => files.map(file => file === "." ? cwd : `${cwd}/${file}`)),
    resolvePath: vi.fn(async (path: string) => path),
  };
  const saveTarget = vi.fn(async (next: Session) => { durableSessions.set(next.id, clone(next)); });
  const publishTarget = vi.fn((next: Session) => { sessions.set(next.id, next); });
  const host: OrchestrationHost = {
    session: id => sessions.get(id),
    sessions: () => [...sessions.values()],
    choices: () => [{ harness: "codex", models: [{ id: "codex:fixture", name: "Fixture" }] }],
    createWorker: vi.fn(async (run, task) => {
      sessions.set(task.sessionId, { ...newSession(task.harness, run.cwd), id: task.sessionId });
      return { scratchDir: `${root}/scratch/${task.id}`, workspace: {
        id: `checkout:${task.id}`, projectCwd: root, checkoutCwd: `${root}/workers/${task.id}`, kind: "worktree" as const,
      } };
    }),
    integrateWorker: vi.fn(async () => ({ files: [], alreadyApplied: 0 })),
    cleanupWorker: vi.fn(async () => true),
    submit: vi.fn((id, _text, done) => {
      const current = sessions.get(id)!;
      sessions.set(id, { ...current, busy: true });
      completions.set(id, outcome => { sessions.set(id, { ...sessions.get(id)!, busy: false }); done(outcome); });
    }),
    stop: vi.fn(async id => { const current = sessions.get(id); if (current) sessions.set(id, { ...current, busy: false }); }),
    steer: vi.fn(async () => {}),
    respondApproval: vi.fn(),
    answerQuestion: vi.fn(),
    acceptManagerDigest: vi.fn(async (id, receipt) => {
      const ok = await acceptManagerWakeQueue(receipt, "engine", {
        session: () => sessions.get(id),
        delivered: async () => {
          const durable = durableSessions.get(id);
          return !!durable?.queuedMessages?.some(message => message.id === receipt.id)
            || !!durable?.blocks.some(block => block.appRequestId === receipt.id);
        },
        save: saveTarget,
        publish: publishTarget,
      });
      if (ok) accepted.set(receipt.id, clone(receipt));
      return ok;
    }),
  };
  let manager = new Orchestrator(store);
  manager.bind(host);
  let request = 0;
  const run = () => manager.run("engine")!;
  const currentLead = () => sessions.get(lead.id)!;
  const patchLead = (patch: Partial<Session>) => sessions.set(lead.id, { ...currentLead(), ...patch });
  const start = async () => {
    manager.registerMonoEngine("engine", lead.id, "manager-mono", root);
    await manager.start("engine", ["codex"], 4, undefined, true);
  };
  const begin = async () => {
    const turn = await manager.beginManagerTurn("engine", true);
    patchLead({ busy: true });
    return turn;
  };
  const end = async (turn: string | undefined) => {
    patchLead({ busy: false });
    await manager.endManagerTurn("engine", turn, { status: "completed", text: "Delegated" });
    await vi.advanceTimersByTimeAsync(0);
  };
  const delegate = async (scope: string, extra: Record<string, unknown> = {}) => {
    await manager.handle("engine", `delegate:${++request}`, "delegate", {
      title: `Work ${scope}`, prompt: `Investigate ${scope}`, harness: "codex", model: "codex:fixture", files: [scope], ...extra,
    });
    await vi.advanceTimersByTimeAsync(0);
    return run().tasks.at(-1)!;
  };
  const complete = async (task: OrchestrationTask, status: ControlOutcome["status"] = "completed") => {
    expect(completions.has(task.sessionId)).toBe(true);
    completions.get(task.sessionId)!({ status, text: `Report for ${task.title}`, ...(status === "failed" ? { error: "Worker failed" } : {}) });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(run().tasks.find(entry => entry.id === task.id)?.status).toBe(status));
    await vi.advanceTimersByTimeAsync(0);
  };
  const message = (id: string, kind: "info" | "question" | "decision" | "escalation" = "info") =>
    manager.queueManagerMessage("engine", { id, kind, at: Date.now(), text: `Message ${id}`, requestId: id });
  const reload = async () => {
    vi.clearAllTimers();
    manager = new Orchestrator(store);
    manager.bind(host);
    await manager.hydrate("engine");
    await vi.advanceTimersByTimeAsync(0);
  };
  return { store, host, sessions, durableSessions, completions, saved, accepted, saveTarget, publishTarget,
    run, currentLead, patchLead, start, begin, end, delegate, complete, message, reload,
    get manager() { return manager; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Manager wake engine integration", () => {
  it("holds a pre-seal completion and queues one durable digest for four staggered workers", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const first = await f.delegate("one");
    await f.complete(first);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    expect(f.run().wakeState?.waves[0].sealedAt).toBeUndefined();
    const remaining = [];
    for (const scope of ["two", "three", "four"]) remaining.push(await f.delegate(scope));
    expect(f.run().wakeState?.waves).toHaveLength(1);
    expect(f.run().wakeState?.waves[0].dispatchIds).toHaveLength(4);
    await f.end(turn);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    for (const [index, task] of remaining.entries()) {
      await vi.advanceTimersByTimeAsync(1000);
      await f.complete(task);
      expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(index === remaining.length - 1 ? 1 : 0);
    }
    const receipt = [...f.accepted.values()][0];
    expect(receipt.eventIds).toHaveLength(4);
    expect(receipt.body).toContain(`app sessions.conversation {"sessionId":"${first.sessionId}"}`);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledWith("manager-chat", expect.objectContaining({ id: receipt.id }));
    expect(f.currentLead().queuedMessages).toHaveLength(1);
    expect(f.durableSessions.get("manager-chat")?.queuedMessages?.[0]).toMatchObject({ id: receipt.id, managerWake: { leadId: "engine", receiptId: receipt.id } });
    expect(f.saveTarget).toHaveBeenCalledOnce();
    expect(f.publishTarget).toHaveBeenCalledOnce();
    expect(f.saved.get("engine")?.wakeState?.events.every(event => event.acknowledgedAt != null)).toBe(true);
    expect(f.run().tasks.every(task => task.delivered)).toBe(true);
    expect(f.run().continuations).toBe(1);
    expect(vi.mocked(f.host.submit).mock.calls.filter(([id]) => id === "manager-chat")).toHaveLength(0);
    expect(f.run().dispatches?.every(dispatch => dispatch.reportedAt == null)).toBe(true);
    f.patchLead({ busy: true, queuedMessages: [], blocks: [{ id: "digest-turn", role: "user", text: receipt.body, startedAt: Date.now(), appRequestId: receipt.id }] });
    f.manager.observe("manager-chat", { type: "turn.started" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.saved.get("engine")?.dispatches?.every(dispatch => dispatch.reportedAt === Date.now() && dispatch.reportedTurnBlockId === "digest-turn")).toBe(true);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
  });

  it("retains 20 info messages without a digest or model submission", async () => {
    const f = setup();
    await f.start();
    for (let i = 0; i < 20; i++) await f.message(`info:${i}`);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    expect(f.host.submit).not.toHaveBeenCalled();
    expect(f.saved.get("engine")?.wakeState?.events).toHaveLength(20);
    expect(f.run().wakeState?.events.every(event => event.acknowledgedAt == null)).toBe(true);
  });

  it("coalesces Manager-bound questions through the durable engine outbox", async () => {
    const f = setup();
    await f.start();
    await f.message("question:one", "question");
    await vi.advanceTimersByTimeAsync(200);
    await f.message("question:two", "question");
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY - 201);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].eventIds).toEqual(["question:one", "question:two"]);
  });

  it("wakes immediately for a failed child while its sibling continues", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const failed = await f.delegate("failed");
    const sibling = await f.delegate("sibling");
    await f.end(turn);
    await f.complete(failed, "failed");
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("FAILURE");
    expect(f.run().tasks.find(task => task.id === sibling.id)?.status).toBe("running");
  });

  it("wakes immediately for an escalation with workers still running", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    await f.delegate("running");
    await f.end(turn);
    await f.message("escalation", "escalation");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("ESCALATION");
  });

  it("treats an unaccepted prerequisite as a decision instead of waiting for its sibling", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const prerequisite = await f.delegate("prerequisite");
    const sibling = await f.delegate("sibling");
    const dependent = await f.delegate("dependent", { dependsOn: [prerequisite.id] });
    await f.end(turn);
    await f.complete(prerequisite);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("DECISION");
    expect([...f.accepted.values()][0].body).toContain("accept this prerequisite");
    expect(f.run().tasks.find(task => task.id === sibling.id)?.status).toBe("running");
    expect(f.run().tasks.find(task => task.id === dependent.id)?.status).toBe("queued");
  });

  it("captures a pending worker approval and delivers it without the question delay", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const worker = await f.delegate("approval");
    await f.end(turn);
    const session = f.sessions.get(worker.sessionId)!;
    f.sessions.set(worker.sessionId, { ...session, blocks: [{ id: "approval", role: "tool", text: "", tool: { title: "Review action" }, approval: { requestId: 42 } }] });
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("APPROVAL");
    expect(f.run().wakeState?.events[0]).toMatchObject({ kind: "approval", requestId: "42", taskId: worker.id });
    expect(f.host.respondApproval).not.toHaveBeenCalled();
  });

  it.each([{ codexStorageError: "Storage unavailable" }, { usageLimit: {} }] as Partial<Session>[])("keeps completed reports pending behind a Manager blocker %s", async blocker => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const worker = await f.delegate("blocked");
    f.patchLead(blocker);
    await f.end(turn);
    await f.complete(worker);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeUndefined();
    f.patchLead({ codexStorageError: undefined, usageLimit: undefined });
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect(f.saved.get("engine")?.wakeState?.events[0].acknowledgedAt).toBe(Date.now());
  });

  it("persists exactly one timeout from the last accepted child without stopping workers", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    await f.delegate("first");
    await vi.advanceTimersByTimeAsync(1000);
    await f.delegate("last");
    const deadline = f.run().wakeState!.waves[0].deadline;
    await f.end(turn);
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("TIMEOUT");
    expect(f.saved.get("engine")?.wakeState?.waves[0].timedOutAt).toBe(deadline);
    expect(f.run().tasks.every(task => task.status === "running")).toBe(true);
    f.patchLead({ queuedMessages: [] });
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
  });

  it("retains a failed target acceptance receipt and retries the same digest", async () => {
    const f = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    f.saveTarget.mockRejectedValueOnce(Error("Target storage unavailable"));
    await f.message("decision", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = f.run().wakeState!.receipt!;
    expect(receipt.acknowledgedAt).toBeUndefined();
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeUndefined();
    expect(f.currentLead().queuedMessages ?? []).toHaveLength(0);
    expect(errors).toHaveBeenCalledOnce();
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    expect(f.run().wakeState?.receipt?.id).toBe(receipt.id);
    expect(f.saved.get("engine")?.wakeState?.receipt?.acknowledgedAt).toBe(Date.now());
    expect(f.currentLead().queuedMessages).toHaveLength(1);
  });

  it("replays a lost run acknowledgement after reload without queuing the accepted digest twice", async () => {
    const f = setup();
    await f.start();
    await f.message("decision", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = f.run().wakeState!.receipt!;
    const lost = clone(f.saved.get("engine")!);
    lost.wakeState!.receipt!.acknowledgedAt = undefined;
    lost.wakeState!.events.forEach(event => { event.acknowledgedAt = undefined; });
    lost.continuations = 0;
    f.saved.set("engine", lost);
    f.patchLead({ queuedMessages: [], blocks: [{ id: "accepted", role: "user", text: receipt.body, appRequestId: receipt.id }] });
    f.durableSessions.set("manager-chat", clone(f.currentLead()));
    await f.reload();
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    expect(f.run().wakeState?.receipt?.id).toBe(receipt.id);
    expect(f.saved.get("engine")?.wakeState?.receipt?.acknowledgedAt).toBe(Date.now());
    expect(f.run().continuations).toBe(1);
    expect(f.saveTarget).toHaveBeenCalledOnce();
    expect(f.publishTarget).toHaveBeenCalledOnce();
  });

  it("rebases durable digest acceptance when a user turn and queued follow-up win the save race", async () => {
    const f = setup();
    await f.start();
    let release!: () => void;
    let started!: () => void;
    const saving = new Promise<void>(resolve => { started = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const save = f.saveTarget.getMockImplementation()!;
    f.saveTarget.mockImplementationOnce(async next => { started(); await released; await save(next); });
    await f.message("decision", "decision");
    await vi.advanceTimersByTimeAsync(0);
    await saving;
    f.patchLead({ busy: true, blocks: [{ id: "user-turn", role: "user", text: "New instructions", startedAt: Date.now() }],
      queuedMessages: [{ id: "user-follow-up", text: "Keep my follow-up", attachments: [] }] });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.currentLead().busy).toBe(true);
    expect(f.currentLead().blocks[0].id).toBe("user-turn");
    expect(f.currentLead().queuedMessages?.map(message => message.id)).toEqual(["user-follow-up", f.run().wakeState!.receipt!.id]);
    expect(f.durableSessions.get("manager-chat")?.queuedMessages?.map(message => message.id)).toEqual(f.currentLead().queuedMessages?.map(message => message.id));
    expect(f.saveTarget).toHaveBeenCalledTimes(2);
    expect(f.publishTarget).toHaveBeenCalledOnce();
    expect(f.saved.get("engine")?.wakeState?.events[0].acknowledgedAt).toBeDefined();
    expect(f.host.submit).not.toHaveBeenCalled();
  });

  it("restores the original sealed-wave timeout when active workers resume after reload", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    await f.delegate("restart");
    await f.end(turn);
    const deadline = f.run().wakeState!.waves[0].deadline;
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT - 1000);
    await f.reload();
    await vi.waitFor(() => expect(f.run().tasks[0].status).toBe("running"));
    expect(f.run().wakeState?.waves.filter(wave => wave.retiredAt == null && wave.completedAt == null).map(wave => wave.deadline)).toContain(deadline);
    await vi.advanceTimersByTimeAsync(Math.max(0, deadline - Date.now()));
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("TIMEOUT");
  });

  it("retires a wave when every child is cancelled without delivering a completion wake", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const first = await f.delegate("cancel-one");
    const second = await f.delegate("cancel-two");
    await f.end(turn);
    await f.manager.cancelTask("engine", first.id);
    await f.manager.cancelTask("engine", second.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run().tasks.every(task => task.status === "cancelled")).toBe(true);
    expect(f.saved.get("engine")?.wakeState?.waves.every(wave => wave.retiredAt != null)).toBe(true);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    expect(f.currentLead().queuedMessages ?? []).toHaveLength(0);
  });

  it("keeps a completed-wave receipt frozen when a late child is accepted", async () => {
    const f = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    const first = await f.delegate("before-receipt");
    f.saveTarget.mockRejectedValueOnce(Error("Target storage unavailable"));
    await f.complete(first);
    const receipt = clone(f.run().wakeState!.receipt!);
    expect(receipt.completedWaveIds).toHaveLength(1);
    expect(errors).toHaveBeenCalledOnce();
    f.patchLead({ codexStorageError: "Hold target acceptance" });
    const late = await f.delegate("after-receipt");
    expect(f.run().wakeState?.receipt).toEqual(receipt);
    expect(f.run().wakeState?.waves).toHaveLength(2);
    const lateWave = f.run().wakeState!.waves.find(wave => wave.dispatchIds.includes(late.activeDispatchId!))!;
    expect(receipt.completedWaveIds).not.toContain(lateWave.id);
    expect(f.run().wakeState!.waves.find(wave => receipt.completedWaveIds.includes(wave.id))!.dispatchIds).toEqual([first.activeDispatchId]);
    f.patchLead({ codexStorageError: undefined });
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run().wakeState?.receipt?.id).toBe(receipt.id);
    expect(f.run().tasks.find(task => task.id === late.id)?.delivered).toBe(true);
    expect(f.run().tasks.find(task => task.id === late.id)?.status).toBe("running");
    expect([...f.accepted.values()][0].eventIds).toEqual(receipt.eventIds);
  });

  it("records digest report delivery only when its own accepted turn starts", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const worker = await f.delegate("delivery-timing");
    await f.end(turn);
    await f.complete(worker);
    const receipt = f.run().wakeState!.receipt!;
    f.patchLead({ busy: true, blocks: [{ id: "user-turn", role: "user", text: "User instructions", startedAt: Date.now() }] });
    f.manager.observe("manager-chat", { type: "turn.started" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run().dispatches?.[0].reportedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    f.patchLead({ queuedMessages: [], blocks: [...f.currentLead().blocks, { id: "digest-turn", role: "user", text: receipt.body, appRequestId: receipt.id, startedAt: Date.now() }] });
    f.manager.observe("manager-chat", { type: "turn.started" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.saved.get("engine")?.dispatches?.[0]).toMatchObject({ reportedAt: Date.now(), reportedTurnBlockId: "digest-turn" });
  });

  it("keeps legacy project runs on their original report submission path", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const worker = await f.delegate("legacy");
    await f.complete(worker);
    const legacy = clone(f.saved.get("engine")!);
    delete legacy.wakeState;
    delete legacy.managerTurnId;
    legacy.version = 1;
    f.saved.set("engine", legacy);
    f.patchLead({ busy: false });
    await f.reload();
    expect(f.run().wakeState).toBeUndefined();
    expect(f.host.acceptManagerDigest).not.toHaveBeenCalled();
    expect(vi.mocked(f.host.submit).mock.calls.filter(([id]) => id === "manager-chat")).toHaveLength(1);
    expect(f.run().tasks[0].delivered).toBe(true);
    expect(turn).toBeDefined();
  });
});
