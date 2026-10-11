import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import type { OrchestrationDispatch, OrchestrationRun, OrchestrationTask } from "./orchestrationState";
import {
  acceptManagerWakeQueue, acknowledgeManagerWake, addManagerWakeEvent, canAcceptManagerWake,
  MANAGER_QUESTION_DELAY, MANAGER_WAKE_TIMEOUT, ManagerWakeScheduler, managerWakePlan,
  prepareManagerWake, reconcileManagerWake, type ManagerWakeEvent, type ManagerWakeReceipt,
} from "./managerWake";

const root = "C:/synthetic/manager-wake";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const task = (id: string, patch: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id, sessionId: `worker:${id}`, title: `Work ${id}`, harness: "codex", model: "codex:fixture",
  prompt: "Complete the scoped fixture", files: [`src/${id}.ts`], scopes: [`src/${id}.ts`],
  dependsOn: [], status: "running", accepted: false, result: "", delivered: false,
  activeDispatchId: `dispatch:${id}`, lastDispatchId: `dispatch:${id}`, ...patch,
});
const dispatch = (id: string, patch: Partial<OrchestrationDispatch> = {}): OrchestrationDispatch => ({
  id: `dispatch:${id}`, taskId: id, sessionId: `worker:${id}`,
  workspace: { id: `checkout:${id}`, projectCwd: root, checkoutCwd: `${root}/${id}`, kind: "worktree" },
  state: "running", stage: "turn_submitted", startedAt: Date.now(), updatedAt: Date.now(), ...patch,
});
const run = (patch: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  version: 2, leadId: "manager", ownerSessionId: "manager", ownerMonoId: "manager-mono",
  cwd: root, status: "active", allowedHarnesses: ["codex"], maxWorkers: 4,
  projectManager: true, projectName: "Synthetic project", cli: "fixture-cli",
  tasks: [], dispatches: [], continuations: 0, requests: {}, ...patch,
});
const event = (id: string, kind: ManagerWakeEvent["kind"] = "info"): ManagerWakeEvent => ({
  id, kind, at: Date.now(), text: `Evidence ${id}`, requestId: id,
});
function acceptChild(previous: OrchestrationRun, id: string): OrchestrationRun {
  const next = { ...previous, tasks: [...previous.tasks, task(id)], dispatches: [...(previous.dispatches ?? []), dispatch(id)] };
  return { ...next, wakeState: reconcileManagerWake(next, previous, Date.now()) };
}
function seal(previous: OrchestrationRun): OrchestrationRun {
  const next = { ...previous, managerTurnId: undefined };
  return { ...next, wakeState: reconcileManagerWake(next, previous, Date.now()) };
}
function complete(previous: OrchestrationRun, id: string, status: OrchestrationTask["status"] = "completed"): OrchestrationRun {
  const next: OrchestrationRun = {
    ...previous,
    tasks: previous.tasks.map(value => value.id === id ? { ...value, status, result: `Finished ${id}`, activeDispatchId: undefined } : value),
    dispatches: previous.dispatches?.map(value => value.taskId === id ? { ...value, state: status === "failed" ? "failed" : "completed", finishedAt: Date.now() } : value),
  };
  return { ...next, wakeState: reconcileManagerWake(next, previous, Date.now()) };
}
function scheduler(initial: OrchestrationRun) {
  let current = initial;
  let manager: Session = { ...newSession("codex", root), id: initial.leadId };
  const accepted = new Map<string, ManagerWakeReceipt>();
  const host = {
    run: (id: string) => id === current.leadId ? current : undefined,
    session: (id: string) => id === current.leadId ? manager : undefined,
    save: vi.fn(async (next: OrchestrationRun) => { current = next; }),
    accept: vi.fn(async (_id: string, receipt: ManagerWakeReceipt) => { accepted.set(receipt.id, clone(receipt)); return true; }),
    limit: vi.fn(async () => {}),
  };
  const wake = new ManagerWakeScheduler(host);
  return {
    host, wake, accepted,
    get run() { return current; },
    set run(value: OrchestrationRun) { current = value; },
    get session() { return manager; },
    set session(value: Session) { manager = value; },
    sync() { wake.sync(current); },
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("durable Manager wake waves", () => {
  it("keeps untracked legacy dispatches on their existing delivery path", () => {
    const previous = run();
    const next = { ...previous, tasks: [task("legacy", { managerTurnBlockId: "historical-block" })], dispatches: [dispatch("legacy")] };
    expect(reconcileManagerWake(next, previous, Date.now())).toBeUndefined();
  });
  it("seals a delayed launch against its recorded delegator turn after that turn has settled", () => {
    const previous = run({ tasks: [task("delayed", { status: "queued", activeDispatchId: undefined, lastDispatchId: undefined, managerWakeTurnId: "settled-turn" })] });
    const next = { ...previous, tasks: [task("delayed", { managerWakeTurnId: "settled-turn" })], dispatches: [dispatch("delayed")] };
    const wakeState = reconcileManagerWake(next, previous, Date.now());
    expect(wakeState?.waves[0]).toMatchObject({ turnId: "settled-turn", sealedAt: Date.now(), dispatchIds: ["dispatch:delayed"] });
    expect(managerWakePlan({ ...next, wakeState }, Date.now()).ready).toBe(false);
  });
  it.each([undefined, "dispatch:old"])("preserves legacy completion delivery when info first creates an outbox: %s", async dispatchId => {
    const previous = run({ tasks: [task("old", { status: "completed", activeDispatchId: undefined, lastDispatchId: dispatchId })],
      dispatches: dispatchId ? [dispatch("old", { state: "completed", stage: "settled" })] : [] });
    const next = { ...previous, wakeState: addManagerWakeEvent(undefined, event("info")) };
    const h = scheduler({ ...next, wakeState: reconcileManagerWake(next, previous, Date.now()) });
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.tasks[0].delivered).toBe(true);
    expect([...h.accepted.values()][0].eventIds).toContain(dispatchId ? `report:${dispatchId}` : "report:legacy:old");
  });
  it("holds an early completion until the delegator seals the wave and its siblings finish", async () => {
    const h = scheduler(acceptChild(run({ managerTurnId: "turn:launch" }), "first"));
    h.run = complete(h.run, "first");
    expect(managerWakePlan(h.run, Date.now()).ready).toBe(false);
    h.sync();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.host.accept).not.toHaveBeenCalled();
    h.run = acceptChild(h.run, "second");
    expect(h.run.wakeState?.waves).toHaveLength(1);
    h.run = seal(h.run);
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).not.toHaveBeenCalled();
    h.run = complete(h.run, "second");
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.wakeState?.events.every(value => value.acknowledgedAt != null)).toBe(true);
  });

  it("wakes exactly once for four staggered workers and links their full reports", async () => {
    let current = run({ managerTurnId: "turn:launch" });
    for (const id of ["one", "two", "three", "four"]) current = acceptChild(current, id);
    current.tasks[0].reportArtifactId = "artifact:one";
    const h = scheduler(seal(current));
    for (const id of ["one", "two", "three", "four"]) {
      await vi.advanceTimersByTimeAsync(1000);
      h.run = complete(h.run, id);
      h.sync();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.host.accept).toHaveBeenCalledTimes(id === "four" ? 1 : 0);
    }
    const receipt = [...h.accepted.values()][0];
    expect(receipt.eventIds).toHaveLength(4);
    expect(receipt.body).toContain("[Full report](/__monocode_artifact__/artifact:one)");
    expect(receipt.body).toContain('app sessions.conversation {"sessionId":"worker:two"}');
    expect(receipt.body).toContain("untrusted evidence");
    expect(h.run.tasks.every(value => value.delivered)).toBe(true);
    expect(h.run.continuations).toBe(1);
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(h.host.accept).toHaveBeenCalledOnce();
  });

  it("retains 20 information messages without starting a turn", async () => {
    const h = scheduler(run());
    for (let i = 0; i < 20; i++) {
      h.run = { ...h.run, wakeState: addManagerWakeEvent(h.run.wakeState, event(`info:${i}`)) };
      h.sync();
    }
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(h.host.accept).not.toHaveBeenCalled();
    expect(h.run.wakeState?.events).toHaveLength(20);
    expect(h.run.wakeState?.events.every(value => value.acknowledgedAt == null)).toBe(true);
  });

  it("coalesces questions within 250 ms while preserving their separate identities", async () => {
    const h = scheduler(run({ wakeState: addManagerWakeEvent(undefined, event("question:one", "question")) }));
    h.sync();
    await vi.advanceTimersByTimeAsync(200);
    h.run = { ...h.run, wakeState: addManagerWakeEvent(h.run.wakeState, event("question:two", "question")) };
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY - 201);
    expect(h.host.accept).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect([...h.accepted.values()][0].eventIds).toEqual(["question:one", "question:two"]);
  });

  it.each(["escalation", "failure", "approval", "decision"] as const)("delivers %s without the question delay", async kind => {
    const h = scheduler(seal(acceptChild(run({ managerTurnId: "turn:launch" }), "still-running")));
    h.run = { ...h.run, wakeState: addManagerWakeEvent(h.run.wakeState, event(`alert:${kind}`, kind)) };
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect([...h.accepted.values()][0].body).toContain(kind.toUpperCase());
    expect(h.run.tasks[0].status).toBe("running");
  });

  it("turns a failed worker into an immediate failure while its sibling continues", async () => {
    const h = scheduler(seal(acceptChild(acceptChild(run({ managerTurnId: "turn:launch" }), "failed"), "sibling")));
    h.run = complete(h.run, "failed", "failed");
    expect(h.run.wakeState?.events[0].kind).toBe("failure");
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.tasks[1].status).toBe("running");
  });

  it("persists one deadline from the last accepted child and emits exactly one timeout", async () => {
    let current = acceptChild(run({ managerTurnId: "turn:launch" }), "first");
    await vi.advanceTimersByTimeAsync(1000);
    current = acceptChild(current, "last");
    const acceptedAt = Date.now();
    const h = scheduler(seal(current));
    expect(h.run.wakeState?.waves[0].deadline).toBe(acceptedAt + MANAGER_WAKE_TIMEOUT);
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT - 1);
    expect(h.host.accept).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect([...h.accepted.values()][0].body).toContain("Still waiting for: first");
    expect(h.run.wakeState?.waves[0].timedOutAt).toBe(Date.now());
    expect(h.run.tasks.every(value => value.status === "running")).toBe(true);
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 3);
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
  });

  it("rearms the original wave deadline after a question digest without another external sync", async () => {
    const h = scheduler(seal(acceptChild(run({ managerTurnId: "turn:launch" }), "worker")));
    const deadline = h.run.wakeState!.waves[0].deadline;
    h.run = { ...h.run, wakeState: addManagerWakeEvent(h.run.wakeState, event("question", "question")) };
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect([...h.accepted.values()][0].body).toContain("QUESTION");
    expect(h.run.wakeState?.waves[0].deadline).toBe(deadline);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT - MANAGER_QUESTION_DELAY - 1);
    expect(h.host.accept).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host.accept).toHaveBeenCalledTimes(2);
    expect([...h.accepted.values()][1].body).toContain("TIMEOUT");
    expect(h.run.wakeState?.waves[0].timedOutAt).toBe(deadline);
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(h.host.accept).toHaveBeenCalledTimes(2);
  });

  it("restores the original deadline and pending questions from a persisted snapshot", async () => {
    const original = seal(acceptChild(run({ managerTurnId: "turn:launch" }), "worker"));
    const deadline = original.wakeState!.waves[0].deadline;
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT - 100);
    const h = scheduler(clone(original));
    h.sync();
    await vi.advanceTimersByTimeAsync(99);
    expect(h.host.accept).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.wakeState?.waves[0].deadline).toBe(deadline);
    const pending = run({ wakeState: addManagerWakeEvent(undefined, event("restored-question", "question")) });
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY);
    const restored = scheduler(clone(pending));
    restored.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(restored.host.accept).toHaveBeenCalledOnce();
  });

  it("replays an unacknowledged receipt with the same ID after reload", async () => {
    const pending = complete(seal(acceptChild(run({ managerTurnId: "turn:launch" }), "worker")), "worker");
    const prepared = { ...pending, wakeState: prepareManagerWake(pending, Date.now()) };
    const receipt = prepared.wakeState.receipt!;
    const h = scheduler(clone(prepared));
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledWith("manager", receipt);
    expect(h.run.wakeState?.receipt?.id).toBe(receipt.id);
    expect(h.run.wakeState?.receipt?.acknowledgedAt).toBe(Date.now());
  });

  it("keeps evidence pending when receipt persistence fails before target acceptance", async () => {
    const h = scheduler(run({ wakeState: addManagerWakeEvent(undefined, event("question", "question")) }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.host.save.mockRejectedValueOnce(Error("run storage unavailable"));
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY);
    expect(h.host.accept).not.toHaveBeenCalled();
    expect(h.run.wakeState?.events[0].acknowledgedAt).toBeUndefined();
    expect(errors).toHaveBeenCalledOnce();
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
  });

  it("replays a lost run receipt after durable target acceptance without another queued turn", async () => {
    const h = scheduler(run({ wakeState: addManagerWakeEvent(undefined, event("question", "question")) }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let durable: Session = clone(h.session);
    const saveTarget = vi.fn(async (next: Session) => { durable = clone(next); });
    const publishTarget = vi.fn((next: Session) => { h.session = next; });
    h.host.accept.mockImplementation(async (leadId, receipt) => acceptManagerWakeQueue(receipt, leadId, {
      session: () => h.session,
      delivered: async () => !!durable.queuedMessages?.some(value => value.id === receipt.id) || durable.blocks.some(value => value.appRequestId === receipt.id),
      save: saveTarget, publish: publishTarget,
    }));
    const saveRun = h.host.save.getMockImplementation()!;
    h.host.save.mockImplementationOnce(saveRun).mockRejectedValueOnce(Error("acknowledgement lost"));
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY);
    const receipt = h.run.wakeState!.receipt!;
    expect(errors).toHaveBeenCalledOnce();
    expect(receipt.acknowledgedAt).toBeUndefined();
    expect(h.run.wakeState?.events[0].acknowledgedAt).toBeUndefined();
    expect(h.session.queuedMessages).toHaveLength(1);
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    h.session = { ...h.session, queuedMessages: [], blocks: [{ id: "accepted-turn", role: "user", text: receipt.body, appRequestId: receipt.id }] };
    durable = clone(h.session);
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledTimes(2);
    expect(h.run.wakeState?.receipt?.id).toBe(receipt.id);
    expect(h.run.wakeState?.receipt?.acknowledgedAt).toBe(Date.now());
    expect(saveTarget).toHaveBeenCalledOnce();
    expect(publishTarget).toHaveBeenCalledOnce();
    expect(h.run.continuations).toBe(1);
  });

  it.each([
    { usageLimit: { message: "quota reached" } },
    { codexStorageError: "storage unavailable" },
    { codexStoragePreparing: true },
  ] as Partial<Session>[])("retains an overdue digest behind the Manager blocker %s", async blocker => {
    const h = scheduler(seal(acceptChild(run({ managerTurnId: "turn:launch" }), "worker")));
    h.session = { ...h.session, ...blocker };
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT);
    expect(h.host.accept).not.toHaveBeenCalled();
    expect(h.run.wakeState?.waves[0].timedOutAt).toBeUndefined();
    h.session = { ...newSession("codex", root), id: h.run.leadId };
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.wakeState?.waves[0].timedOutAt).toBe(Date.now());
  });

  it("retains the same receipt when durable target acceptance is refused", async () => {
    const h = scheduler(run({ wakeState: addManagerWakeEvent(undefined, event("decision", "decision")) }));
    h.host.accept.mockResolvedValueOnce(false);
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    const receipt = h.run.wakeState!.receipt!;
    expect(receipt.acknowledgedAt).toBeUndefined();
    expect(h.run.wakeState?.events[0].acknowledgedAt).toBeUndefined();
    expect(h.run.continuations).toBe(0);
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenLastCalledWith("manager", receipt);
    expect(h.run.continuations).toBe(1);
  });

  it("lets a user message win the race while a prepared digest stays pending", async () => {
    const h = scheduler(run({ wakeState: addManagerWakeEvent(undefined, event("decision", "decision")) }));
    h.host.save.mockImplementationOnce(async next => {
      h.run = next;
      h.session = { ...h.session, queuedMessages: [{ id: "user-first", text: "Change the scope", attachments: [] }] };
    });
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).not.toHaveBeenCalled();
    const receiptId = h.run.wakeState?.receipt?.id;
    expect(h.run.wakeState?.events[0].acknowledgedAt).toBeUndefined();
    h.session = { ...h.session, queuedMessages: [] };
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.wakeState?.receipt?.id).toBe(receiptId);
  });

  it.each(["stopped", "paused"] as const)("retires a cancelled or paused wave without a wake (%s)", async status => {
    const original = seal(acceptChild(run({ managerTurnId: "turn:launch" }), "worker"));
    const h = scheduler(original);
    h.sync();
    const next = { ...h.run, status };
    h.run = { ...next, wakeState: reconcileManagerWake(next, h.run, Date.now()) };
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(h.run.wakeState?.waves[0].retiredAt).toBe(10_000);
    expect(h.host.accept).not.toHaveBeenCalled();
  });

  it("leaves legacy runs alone until their next explicitly accepted dispatch", async () => {
    const legacy = run({ tasks: [task("legacy", { status: "completed", result: "Legacy report" })], dispatches: [dispatch("legacy", { state: "completed" })] });
    expect(reconcileManagerWake(legacy, undefined, Date.now())).toBeUndefined();
    expect(reconcileManagerWake(legacy, clone(legacy), Date.now())).toBeUndefined();
    const h = scheduler(legacy);
    h.sync();
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT * 2);
    expect(h.host.accept).not.toHaveBeenCalled();
    h.run = acceptChild({ ...legacy, managerTurnId: "turn:new" }, "new");
    expect(h.run.wakeState?.waves[0].dispatchIds).toEqual(["dispatch:new"]);
  });

  it("wakes for an acceptance prerequisite instead of waiting for a queued dependency", async () => {
    let current = seal(acceptChild(acceptChild(run({ managerTurnId: "turn:launch" }), "prerequisite"), "parallel"));
    current = { ...current, tasks: [...current.tasks, task("future", { status: "queued", dependsOn: ["prerequisite"], lastDispatchId: undefined, activeDispatchId: undefined })] };
    const h = scheduler(complete(current, "prerequisite"));
    expect(h.run.wakeState?.events[0].kind).toBe("decision");
    expect(h.run.wakeState?.events[0].text).toContain("accept this prerequisite");
    expect(h.run.wakeState?.waves[0].dispatchIds).not.toContain("dispatch:future");
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.accept).toHaveBeenCalledOnce();
    expect(h.run.tasks.find(value => value.id === "future")?.status).toBe("queued");
  });

  it("deduplicates stable events, rejects changed retries, and acknowledges only the accepted receipt", () => {
    const first = event("stable", "question");
    const state = addManagerWakeEvent(undefined, first);
    expect(addManagerWakeEvent(state, clone(first))).toBe(state);
    expect(() => addManagerWakeEvent(state, { ...first, kind: "decision" })).toThrow("different input");
    const prepared = prepareManagerWake(run({ wakeState: state }), Date.now() + MANAGER_QUESTION_DELAY);
    expect(acknowledgeManagerWake(prepared, "unknown-receipt", Date.now())).toBe(prepared);
    const receiptId = prepared.receipt!.id;
    const withLaterEvent = addManagerWakeEvent(prepared, event("later"));
    const acknowledged = acknowledgeManagerWake(withLaterEvent, receiptId, Date.now());
    expect(acknowledged.events[0].acknowledgedAt).toBe(Date.now());
    expect(acknowledged.events[1].acknowledgedAt).toBeUndefined();
    expect(acknowledgeManagerWake(acknowledged, receiptId, Date.now() + 1)).toBe(acknowledged);
  });

  it("does not replay a timeout or its acknowledged receipt after a stale async snapshot", async () => {
    let current = seal(acceptChild(run({ managerTurnId: "turn:launch" }), "worker"));
    current = { ...current, wakeState: addManagerWakeEvent(current.wakeState, event("held-info")) };
    await vi.advanceTimersByTimeAsync(MANAGER_WAKE_TIMEOUT);
    const prepared = { ...current, wakeState: prepareManagerWake(current, Date.now()) };
    const stale = clone(prepared);
    const receiptId = prepared.wakeState.receipt!.id;
    const acknowledged = { ...prepared, wakeState: acknowledgeManagerWake(prepared.wakeState, receiptId, Date.now()) };
    const restored = { ...stale, wakeState: reconcileManagerWake(stale, acknowledged, Date.now() + 1000) };
    expect(restored.wakeState?.receipt?.id).toBe(receiptId);
    expect(restored.wakeState?.receipt?.acknowledgedAt).toBe(Date.now());
    expect(restored.wakeState?.events[0].acknowledgedAt).toBe(Date.now());
    expect(restored.wakeState?.waves[0].timedOutAt).toBe(Date.now());
    expect(managerWakePlan(restored, Date.now() + MANAGER_WAKE_TIMEOUT)).toEqual({ ready: false, at: undefined, completed: [], timeouts: [] });
  });

  it("preserves later events, waves and a different pending receipt when an old snapshot commits", async () => {
    let original = run({ wakeState: addManagerWakeEvent(undefined, event("old-question", "question")) });
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY);
    const oldPrepared = prepareManagerWake(original, Date.now());
    original = { ...original, wakeState: acknowledgeManagerWake(oldPrepared, oldPrepared.receipt!.id, Date.now()) };
    const stale = clone(original);
    let latest = seal(acceptChild({ ...original, managerTurnId: "turn:new" }, "new-worker"));
    latest = { ...latest, wakeState: addManagerWakeEvent(latest.wakeState, event("new-info")) };
    latest = { ...latest, wakeState: addManagerWakeEvent(latest.wakeState, event("new-question", "question")) };
    await vi.advanceTimersByTimeAsync(MANAGER_QUESTION_DELAY);
    latest = { ...latest, wakeState: prepareManagerWake(latest, Date.now()) };
    const pending = latest.wakeState!.receipt!;
    expect(pending.id).not.toBe(stale.wakeState?.receipt?.id);
    const restored = reconcileManagerWake(stale, latest, Date.now())!;
    expect(restored.events.map(value => value.id)).toEqual(["old-question", "new-info", "new-question"]);
    expect(restored.events[0].acknowledgedAt).toBeDefined();
    expect(restored.events.slice(1).every(value => value.acknowledgedAt == null)).toBe(true);
    expect(restored.waves).toEqual(latest.wakeState?.waves);
    expect(restored.receipt).toEqual(pending);
    expect(restored.receipt?.eventIds).toEqual(["new-info", "new-question"]);
  });

  it("keeps a later accepted sibling and its deadline when the same wave is restored from a stale snapshot", async () => {
    const first = acceptChild(run({ managerTurnId: "turn:launch" }), "first");
    const stale = clone(first.wakeState);
    const oldDeadline = first.wakeState!.waves[0].deadline;
    await vi.advanceTimersByTimeAsync(1000);
    const latest = seal(acceptChild(first, "second"));
    const incoming = { ...latest, wakeState: stale };
    let restored: OrchestrationRun = { ...incoming, wakeState: reconcileManagerWake(incoming, latest, Date.now()) };
    expect(restored.wakeState?.waves).toHaveLength(1);
    expect(restored.wakeState?.waves[0].dispatchIds).toEqual(["dispatch:first", "dispatch:second"]);
    expect(restored.wakeState?.waves[0].deadline).toBe(Date.now() + MANAGER_WAKE_TIMEOUT);
    expect(restored.wakeState?.waves[0].sealedAt).toBe(Date.now());
    restored = complete(restored, "first");
    expect(managerWakePlan(restored, oldDeadline).ready).toBe(false);
    expect(managerWakePlan(restored, oldDeadline).timeouts).toEqual([]);
    expect(managerWakePlan(restored, oldDeadline).at).toBe(latest.wakeState!.waves[0].deadline);
    restored = complete(restored, "second");
    expect(managerWakePlan(restored, Date.now()).completed).toEqual([latest.wakeState!.waves[0].id]);
  });

  it("retains pending evidence when the automatic continuation limit is reached", async () => {
    const h = scheduler(run({ continuations: 20, wakeState: addManagerWakeEvent(undefined, event("failure", "failure")) }));
    h.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.host.limit).toHaveBeenCalledWith("manager");
    expect(h.host.accept).not.toHaveBeenCalled();
    expect(h.run.wakeState?.events[0].acknowledgedAt).toBeUndefined();
  });
});

describe("durable target queue acceptance", () => {
  const receipt = (): ManagerWakeReceipt => ({ id: "digest:stable", eventIds: ["event:one"], completedWaveIds: [], timeoutWaveIds: [], body: "Read the full report" });

  it("persists before publishing and keeps one turn on receipt replay", async () => {
    let current = newSession("codex", root);
    let durable: Session | undefined;
    const save = vi.fn(async (next: Session) => { expect(current.queuedMessages ?? []).toEqual([]); durable = clone(next); });
    const publish = vi.fn((next: Session) => { expect(durable?.queuedMessages).toEqual(next.queuedMessages); current = next; });
    const host = { session: () => current, delivered: async () => false, save, publish };
    expect(await acceptManagerWakeQueue(receipt(), "manager", host)).toBe(true);
    expect(current.queuedMessages).toEqual([{ id: "digest:stable", appRequestId: "digest:stable", text: "Read the full report", attachments: [], managerWake: { leadId: "manager", receiptId: "digest:stable" } }]);
    expect(await acceptManagerWakeQueue(receipt(), "manager", host)).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("rejects failed persistence without publishing a false receipt", async () => {
    const current = newSession("codex", root);
    const publish = vi.fn();
    const save = vi.fn(async () => { throw Error("target storage failed"); });
    await expect(acceptManagerWakeQueue(receipt(), "manager", { session: () => current, delivered: async () => false, save, publish })).rejects.toThrow("target storage failed");
    expect(publish).not.toHaveBeenCalled();
    expect(current.queuedMessages ?? []).toEqual([]);
  });

  it("rebases a user message received during persistence ahead of the digest", async () => {
    let current = newSession("codex", root);
    const user = { id: "user:first", text: "User request", attachments: [] };
    const save = vi.fn(async (_next: Session) => {});
    save.mockImplementationOnce(async () => { current = { ...current, queuedMessages: [user] }; });
    const publish = vi.fn((next: Session) => { current = next; });
    expect(await acceptManagerWakeQueue(receipt(), "manager", { session: () => current, delivered: async () => false, save, publish })).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledOnce();
    expect(current.queuedMessages?.map(value => value.id)).toEqual(["user:first", "digest:stable"]);
  });

  it("serializes two engine digests sharing one owner until the first durable queue is published", async () => {
    const existing = { id: "user:existing", appRequestId: "user:request", blockId: "user:block", text: "Existing request", attachments: [] };
    let current: Session = { ...newSession("codex", root), queuedMessages: [existing] };
    let durable: Session | undefined;
    let releaseFirst!: () => void;
    let signalFirst!: () => void;
    const firstSaved = new Promise<void>(resolve => { signalFirst = resolve; });
    const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
    const order: string[] = [];
    const delivered = vi.fn(async () => false);
    const save = vi.fn(async (next: Session) => {
      const id = next.queuedMessages!.at(-1)!.id;
      order.push(`save:${id}`);
      if (id === "digest:engine-one") { signalFirst(); await firstRelease; }
      durable = clone(next);
    });
    const publish = vi.fn((next: Session) => {
      expect(durable?.queuedMessages).toEqual(next.queuedMessages);
      current = next;
      order.push(`publish:${next.queuedMessages!.at(-1)!.id}`);
    });
    const host = { session: () => current, delivered, save, publish };
    const one = acceptManagerWakeQueue({ ...receipt(), id: "digest:engine-one", body: "Project one" }, "shared-owner", host);
    const two = acceptManagerWakeQueue({ ...receipt(), id: "digest:engine-two", body: "Project two" }, "shared-owner", host);
    await firstSaved;
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    expect(delivered).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(current.queuedMessages).toEqual([existing]);
    releaseFirst();
    expect(await one).toBe(true);
    expect(await two).toBe(true);
    expect(order).toEqual(["save:digest:engine-one", "publish:digest:engine-one", "save:digest:engine-two", "publish:digest:engine-two"]);
    expect(current.queuedMessages?.[0]).toBe(existing);
    expect(durable?.queuedMessages?.map(value => value.id)).toEqual(["user:existing", "digest:engine-one", "digest:engine-two"]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("recognizes durable acceptance after the queued turn has already left the queue", async () => {
    const current = newSession("codex", root);
    const save = vi.fn(async (_next: Session) => {});
    const publish = vi.fn();
    expect(await acceptManagerWakeQueue(receipt(), "manager", { session: () => current, delivered: async () => true, save, publish })).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not accept a missing Manager conversation", async () => {
    expect(canAcceptManagerWake(undefined)).toBe(false);
    const save = vi.fn(async (_next: Session) => {});
    const publish = vi.fn();
    expect(await acceptManagerWakeQueue(receipt(), "manager", { session: () => undefined, delivered: async () => false, save, publish })).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
