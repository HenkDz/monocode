import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { selectAgentLiveState } from "../../agents/model/agentLiveState";
import { Orchestrator, type ControlOutcome, type OrchestrationHost, type OrchestrationRun, type OrchestrationTask } from "./orchestration";
import {
  acceptManagerWakeQueue, acknowledgeManagerWake, addManagerWakeEvent, MANAGER_WAKE_TIMEOUT,
  managerWakePlan, prepareManagerWake, reconcileManagerWake, type ManagerWakeReceipt,
} from "./managerWake";

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
  const lookupTarget = vi.fn(async (receipt: ManagerWakeReceipt) => {
    const durable = durableSessions.get(lead.id);
    return !!durable?.queuedMessages?.some(message => message.id === receipt.id)
      || !!durable?.blocks.some(block => block.appRequestId === receipt.id);
  });
  const loadTarget = vi.fn(async () => durableSessions.get(lead.id) ? clone(durableSessions.get(lead.id)!) : undefined);
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
        delivered: () => lookupTarget(receipt),
        load: loadTarget,
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
  return { store, host, sessions, durableSessions, completions, saved, accepted, saveTarget, lookupTarget, loadTarget, publishTarget,
    run, currentLead, patchLead, start, begin, end, delegate, complete, message, reload,
    get manager() { return manager; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Manager wake recovery regressions", () => {
  it("wakes for a dependency added after its prerequisite completed early", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const prerequisite = await f.delegate("fast-prerequisite");
    const sibling = await f.delegate("long-sibling");
    await f.complete(prerequisite);
    const dependent = await f.delegate("dependent", { dependsOn: [prerequisite.id] });
    await f.end(turn);
    expect(f.run().tasks.find(task => task.id === sibling.id)?.status).toBe("running");
    expect(f.run().tasks.find(task => task.id === dependent.id)?.status).toBe("queued");
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect([...f.accepted.values()][0].body).toContain("DECISION");
  });

  it.each([false, true])("releases completed held reports after Continue, restart=%s", async restart => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const worker = await f.delegate("completed-before-manager-failure");
    await f.complete(worker);
    f.patchLead({ busy: false });
    await f.manager.endManagerTurn("engine", turn, { status: "failed", text: "", error: "Synthetic Manager failure" });
    expect(f.run().status).toBe("paused");
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeUndefined();
    if (restart) await f.reload();
    await f.manager.continueManager("engine");
    f.completions.get("manager-chat")!({ status: "completed", text: "Continued" });
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    expect(f.run().tasks.find(task => task.id === worker.id)?.delivered).toBe(true);
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeDefined();
  });

  it("retries a transient target save failure without a separate external sync", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    f.saveTarget.mockRejectedValueOnce(Error("Synthetic transient target save failure"));
    await f.message("action-needs-delivery", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = clone(f.run().wakeState!.receipt!);
    expect(receipt.acknowledgedAt).toBeUndefined();
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(999);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    expect([...f.accepted.values()]).toEqual([receipt]);
    expect(f.run().wakeState?.receipt).toMatchObject({ ...receipt, acknowledgedAt: Date.now() });
    expect(f.currentLead().queuedMessages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
  });

  it("retries an archived receipt lookup failure without changing the frozen receipt", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    f.lookupTarget.mockRejectedValueOnce(Error("Synthetic archived receipt lookup failure"));
    await f.message("lookup-needs-delivery", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = clone(f.run().wakeState!.receipt!);
    expect(f.saveTarget).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    expect([...f.accepted.values()]).toEqual([receipt]);
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeDefined();
  });

  it("restores the same failed receipt and pending event after restart", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    f.saveTarget.mockRejectedValueOnce(Error("Synthetic target save failure before restart"));
    await f.message("restart-needs-delivery", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = clone(f.saved.get("engine")!.wakeState!.receipt!);
    expect(f.saved.get("engine")!.wakeState!.events[0].acknowledgedAt).toBeUndefined();
    await f.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    expect([...f.accepted.values()]).toEqual([receipt]);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    expect(f.currentLead().queuedMessages).toHaveLength(1);
    expect(f.saved.get("engine")?.wakeState?.receipt?.id).toBe(receipt.id);
    expect(f.saved.get("engine")?.wakeState?.events[0].acknowledgedAt).toBeDefined();
  });

  it("caps the retry interval at one minute while preserving the original receipt", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    f.saveTarget.mockRejectedValue(Error("Synthetic target still unavailable"));
    await f.message("bounded-retries", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = clone(f.run().wakeState!.receipt!);
    await vi.advanceTimersByTimeAsync(63_000);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(8);
    expect(f.run().wakeState?.receipt).toEqual(receipt);
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("backs off persistent save failures, exposes a recoverable blocker and clears it after delivery", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.start();
    const save = f.saveTarget.getMockImplementation()!;
    f.saveTarget.mockRejectedValue(Error("Synthetic target unavailable"));
    await f.message("persistent-needs-delivery", "decision");
    await vi.advanceTimersByTimeAsync(0);
    const receipt = clone(f.run().wakeState!.receipt!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(3);
    expect(f.run().wakeState?.events[0].acknowledgedAt).toBeUndefined();
    expect(selectAgentLiveState(f.currentLead(), { wakeStates: [f.run().wakeState!] })).toMatchObject({ status: "blocked", reason: "storage" });
    expect(f.run().wakeState?.receipt).toEqual(receipt);
    f.saveTarget.mockImplementation(save);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.host.acceptManagerDigest).toHaveBeenCalledTimes(4);
    expect([...f.accepted.values()]).toEqual([receipt]);
    expect(selectAgentLiveState({ ...f.currentLead(), queuedMessages: [] }, { wakeStates: [f.run().wakeState!] }).status).not.toBe("blocked");
  });

  it.each([false, true])("keeps the report and receipt immutable for a late prerequisite decision, acknowledged=%s", async acknowledged => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const prerequisite = await f.delegate("frozen-prerequisite");
    await f.delegate("long-sibling");
    await f.complete(prerequisite);
    await f.end(turn);
    let previous = clone(f.run());
    previous.wakeState = addManagerWakeEvent(previous.wakeState, {
      id: "freeze-report", kind: "decision", at: Date.now(), text: "Separate action freezes the report receipt",
    });
    previous.wakeState = prepareManagerWake(previous, Date.now());
    const frozen = clone(previous.wakeState.receipt!);
    if (acknowledged) previous = { ...previous,
      wakeState: acknowledgeManagerWake(previous.wakeState, frozen.id, Date.now()),
      tasks: previous.tasks.map(task => task.id === prerequisite.id ? { ...task, delivered: true } : task),
    };
    const before = clone(previous.wakeState!.receipt!);
    const dependent: OrchestrationTask = { ...prerequisite, id: "late-dependent", sessionId: "late-dependent-chat",
      title: "Late dependency", status: "queued", result: "", dependsOn: [prerequisite.id],
      activeDispatchId: undefined, lastDispatchId: undefined,
    };
    let next = { ...previous, tasks: [...previous.tasks, dependent] };
    next = { ...next, wakeState: reconcileManagerWake(next, previous, Date.now()) };
    expect(next.wakeState?.receipt).toEqual(before);
    expect(next.wakeState?.events.find(event => event.id.startsWith("report:"))?.kind).toBe("report");
    const decisions = next.wakeState!.events.filter(event => event.kind === "decision" && event.taskId === prerequisite.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].acknowledgedAt).toBeUndefined();
    const repeated = { ...next, wakeState: reconcileManagerWake(next, next, Date.now()) };
    expect(repeated.wakeState?.events).toEqual(next.wakeState?.events);
    if (!acknowledged) next = { ...next, wakeState: acknowledgeManagerWake(next.wakeState!, frozen.id, Date.now()) };
    expect(managerWakePlan(next, Date.now()).ready).toBe(true);
    const followUp = prepareManagerWake(next, Date.now());
    expect(followUp.receipt?.eventIds).toEqual([decisions[0].id]);
    expect(followUp.receipt?.body).toContain("DECISION");
    expect(followUp.receipt?.id).not.toBe(frozen.id);
    const delivered = { ...next, wakeState: acknowledgeManagerWake(followUp, followUp.receipt!.id, Date.now()),
      tasks: next.tasks.map(task => task.id === prerequisite.id ? { ...task, accepted: true } : task),
    };
    const afterAcceptance = { ...delivered, wakeState: reconcileManagerWake(delivered, delivered, Date.now()) };
    expect(managerWakePlan(afterAcceptance, Date.now()).ready).toBe(false);
    expect(afterAcceptance.wakeState?.events.filter(event => event.kind === "decision" && event.taskId === prerequisite.id)).toHaveLength(1);
  });

  it("keeps a newer prerequisite decision when a stale report snapshot is reconciled", async () => {
    const f = setup();
    await f.start();
    const turn = await f.begin();
    const prerequisite = await f.delegate("stale-prerequisite");
    await f.delegate("long-sibling");
    await f.complete(prerequisite);
    await f.end(turn);
    const older = clone(f.run());
    const dependent: OrchestrationTask = { ...prerequisite, id: "late-dependent", sessionId: "late-dependent-chat",
      title: "Late dependency", status: "queued", result: "", dependsOn: [prerequisite.id],
      activeDispatchId: undefined, lastDispatchId: undefined,
    };
    let latest = { ...older, tasks: [...older.tasks, dependent] };
    latest = { ...latest, wakeState: reconcileManagerWake(latest, older, Date.now()) };
    const decision = clone(latest.wakeState!.events[0]);
    expect(decision.kind).toBe("decision");
    const stale = { ...latest, wakeState: older.wakeState,
      tasks: latest.tasks.map(task => task.id === dependent.id ? { ...task, status: "cancelled" as const } : task),
    };
    expect(reconcileManagerWake(stale, latest, Date.now())?.events[0]).toEqual(decision);
  });
});
