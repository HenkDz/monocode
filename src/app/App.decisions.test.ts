// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { decisionAppSource, evaluateDecisionApp } from "../../tests/decisionAppSource";
import { appendUser } from "../integrations/harness/core/apply";
import { SessionStateStore } from "../features/sessions/model/sessionStateStore";
import { newSession, type Session, type QueuedMessage } from "../features/sessions/model/session";
import { MonoManagerGoals, type GoalLedger } from "../features/monos/model/monoManagerGoals";
import { managerRequestBinding, managerRequestBindingCurrent, assertManagerDelivery } from "../features/monos/model/managerAuthorizedWork";
import { type Mono, listMonos, findMono, monoForSession, isMonoSession } from "../features/monos/model/mono";
import { teamMessageKind, teamMessageRequiresReply } from "../features/monos/model/monoCrewEvents";
import { teamMessageRoute } from "../features/monos/model/monoOrg";
import { handleDecisionTeamMessage, runtimeDecisionHost, executeDecisionUi, reraiseUnreadableDecision, type DecisionRuntimeHost } from "../features/monos/model/monoDecisionRuntime";
import { assertDecisionQueueConsumer, assertDecisionDigestConsumer, staleDecisionDigestEvents, queueDecisionEvidence, decisionQueueId, decisionEvidenceText } from "../features/monos/model/monoDecisionDelivery";
import { retainedDecisionDelivery, StaleDecision, assertDecisionCurrent, isMonoDecisionEventId, decisionStopAt, isDecisionStopMarker, DecisionDeliveryPending } from "../features/monos/model/monoDecisions";
import { acceptManagerWakeQueue, addManagerWakeEvent, prepareManagerWake, reconcileManagerWake, acknowledgeManagerWake, ManagerWakeScheduler } from "../features/orchestration/model/managerWake";
import { Orchestrator } from "../features/orchestration/model/orchestration";
import type { OrchestrationRun } from "../features/orchestration/model/orchestrationState";
import { canDispatchQueuedHead, canSteerQueuedHead, queuedHead, dequeueQueuedMessage } from "../features/sessions/model/messageQueue";
import { selectDecisionView } from "../features/commandCenter/model/decisionView";
import { writeSession, readPersistedSession, upsertSession } from "../features/sessions/data/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const source = decisionAppSource();
const disks = new Map<string, unknown>();
let fail: ((command: string, args: Record<string, unknown>) => void) | undefined;
let afterRead: (() => void) | undefined;
const paged = new Set<string>();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
beforeEach(() => {
  localStorage.clear(); disks.clear(); paged.clear(); fail = undefined; afterRead = undefined;
  vi.mocked(invoke).mockImplementation(async (command, raw) => {
    const args = raw as Record<string, unknown>;
    fail?.(command, args);
    if (command === "control_load") return disks.has(String(args.leadId)) ? JSON.stringify(disks.get(String(args.leadId))) : null;
    if (command === "control_save") { disks.set(String(args.leadId), JSON.parse(String(args.state))); return; }
    if (command === "mono_session_upsert" || command === "session_upsert") {
      const next = clone(args.session as Session);
      const prior = disks.get(next.id) as Session | undefined;
      if (command === "mono_session_upsert") {
        let blocks = prior?.blocks ?? [];
        if (args.blocksChanged) {
          const start = args.appendOnly ? blocks.length : args.afterBlockId ? blocks.findIndex(block => block.id === args.afterBlockId) + 1
            : args.fromBlockId ? blocks.findIndex(block => block.id === args.fromBlockId) : 0;
          if (start < 0) throw Error("Missing retained transcript anchor");
          blocks = [...blocks.slice(0, start), ...next.blocks];
        }
        next.blocks = blocks;
      }
      disks.set(next.id, next); return { ...next, createdAt: 1, updatedAt: 1 };
    }
    if (command === "mono_session_get" || command === "session_get") {
      const result = clone(disks.get(String(args.sessionId)) ?? null) as Session | null;
      if (result && paged.has(result.id)) {
        result.blocks = result.blocks.slice(-1);
        result.monoTranscript = { before: 1, firstBlockId: result.blocks[0]?.id ?? null };
      }
      afterRead?.(); return result;
    }
    if (command === "mono_session_event_delivered") return (disks.get(String(args.sessionId)) as Session | undefined)?.blocks.some(block => block.internal && block.appRequestId === args.eventId && block.text === args.text) ?? false;
    throw Error(`Unexpected native boundary ${command}`);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

async function fixture() {
  const suffix = crypto.randomUUID();
  const roster: Mono[] = [
    { id: "boss", role: "orchestrator", projects: [], sessionId: `boss-${suffix}`, mascot: "owl", color: "blue" },
    { id: "manager", role: "manager", projects: ["C:/Project"], reportsTo: "boss", sessionId: `manager-${suffix}`, mascot: "cat", color: "blue" },
    { id: "worker", role: "member", projects: ["C:/Project"], reportsTo: "manager", mascot: "cat", color: "blue" },
  ];
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const manager = appendUser({ ...newSession("claude", "C:/Project"), id: roster[1].sessionId! }, "Implement the bounded parser change", []);
  const worker = appendUser({ ...newSession("claude", "C:/Project/worker"), id: `worker-${suffix}`, busy: true }, "The existing Manager dispatch assigned the parser task", [], { internal: true, appRequestId: "dispatch" });
  const boss = { ...newSession("claude", "C:/Project"), id: roster[0].sessionId! };
  const state = new SessionStateStore([manager, worker, boss]);
  await upsertSession(manager); await upsertSession(boss);
  const ledger = new MonoManagerGoals();
  const goal = await ledger.anchorManagerRequest(roster[1], { id: "C:/Project", folder: "C:/Project", name: "Project", managerId: "engine", managerMonoId: "manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] }, manager.blocks.at(-1)!);
  let run: OrchestrationRun = { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: manager.id, cwd: "C:/Project", status: "active", projectManager: true,
    allowedHarnesses: ["claude"], maxWorkers: 1, cli: "synthetic", requests: {}, continuations: 0,
    tasks: [{ id: "task", memberId: "worker", sessionId: worker.id, monoGoalId: goal.id, activeDispatchId: "dispatch", status: "running", title: "Parser", prompt: "Parser", harness: "claude", model: "synthetic", files: ["src"], scopes: [], dependsOn: [], accepted: false, delivered: false, result: "" }],
    dispatches: [{ id: "dispatch", taskId: "task", sessionId: worker.id, state: "running", stage: "turn_submitted", startedAt: 42, updatedAt: 42, workspace: { id: "worker-checkout", kind: "worktree", projectCwd: "C:/Project", checkoutCwd: "C:/Project/worker" } }] };
  disks.set("engine", clone(run));
  const engine = { snapshot: () => [run], run: (id: string) => id === "engine" ? run : undefined,
    actions: Promise.resolve(), sync: vi.fn(),
    commit: async (next: OrchestrationRun) => { run = { ...next, wakeState: reconcileManagerWake(next, run, Date.now()) }; disks.set("engine", clone(run)); },
    retireDecisionDigest: (id: string, receiptId: string, eventIds: readonly string[]) => Orchestrator.prototype.retireDecisionDigest.call(engine as unknown as Orchestrator, id, receiptId, eventIds),
    replace: (next: OrchestrationRun) => { run = next; disks.set("engine", clone(run)); },
    stopForSession: () => undefined,
    queueManagerMessage: vi.fn(async (_id, event) => { run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, event) }; disks.set("engine", clone(run)); }) };
  const turnGen = { current: new Map([[manager.id, 1], [worker.id, 1], [boss.id, 1]]) };
  const decisionRuntime = { current: null! as DecisionRuntimeHost };
  const scope: Record<string, unknown> = { decisionRuntime, monoManagerGoals: ledger, listMonos, findMono, sessionsRef: state.ref,
    setSessions: state.setState, turnGen, decisionOriginalBlocks: { current: new Map() }, setDecisionUnavailable: vi.fn(),
    habitRunMono: () => undefined, orchestrator: engine, invoke, writeSession, readPersistedSession, upsertSession,
    managerRequestBinding, managerRequestBindingCurrent, queueDecisionEvidence, retainedDecisionDelivery, decisionQueueId, decisionEvidenceText, isMonoSession,
    runtimeDecisionHost, assertDecisionDigestConsumer, staleDecisionDigestEvents, assertDecisionQueueConsumer, StaleDecision, assertDecisionCurrent, isMonoDecisionEventId, decisionStopAt, isDecisionStopMarker, DecisionDeliveryPending, dequeueQueuedMessage, queuedHead,
    getMonoGoalRecoveryBlocks: async () => { throw Error("Test unexpectedly bypassed its committed original user block"); },
    acceptManagerWakeQueue, flushSync: (fn: () => void) => fn(),
  };
  evaluateDecisionApp(source.host, scope);
  const route = async (actor: "worker" | "manager" | "boss", requestId: string, text: string) => {
    const actorSession = actor === "worker" ? worker.id : roster.find(mono => mono.id === actor)!.sessionId!;
    state.setState(sessions => sessions.map(session => session.id === actorSession ? { ...session, busy: true } : session));
    const current = state.ref.current.find(session => session.id === actorSession)!;
    return evaluateDecisionApp<Promise<unknown>>(`return (async () => { ${source.team} })();`, { ...scope,
      source: current, payload: { sessionId: current.id, requestId, action: "team.message", input: { memberId: actor === "worker" ? "manager" : actor === "manager" ? "boss" : "manager", text, kind: JSON.parse(text).type === "decision" ? "question" : "decision" } },
      workerMember: actor === "worker" ? roster[2] : undefined, peerRecipient: undefined, goalProgress: undefined, memberRun: run,
      monoForSession, teamMessageKind, teamMessageRequiresReply, teamMessageRoute, crewMessages: () => [], handleDecisionTeamMessage,
    });
  };
  const payload = { version: 1, type: "decision", question: "Which parser approach?", context: "Existing bounded task", impact: "low", operation: "work", options: [{ id: "reuse", label: "Reuse" }, { id: "change", label: "Change" }] };
  const ingest = () => route("worker", "question", JSON.stringify(payload));
  const act = (actor: "manager" | "boss", action: string, extra = {}, requestId = `act-${crypto.randomUUID()}`) => route(actor, requestId, JSON.stringify({ version: 1, type: "decision-action", action,
    decisionId: `${worker.id}:question`, expectedVersion: ledger.decisions("manager").find(decision => decision.id === `${worker.id}:question`)!.resolutionVersion, ...extra }));
  const accept = evaluateDecisionApp<(id: string, receipt: NonNullable<NonNullable<OrchestrationRun["wakeState"]>["receipt"]>) => Promise<boolean>>(source.accept, scope);
  const digest = async () => {
    run = { ...run, wakeState: prepareManagerWake(run, Date.now() + 1000) }; disks.set("engine", clone(run));
    state.setState(sessions => sessions.map(session => session.id === manager.id ? { ...session, busy: false } : session));
    const accepted = await accept(manager.id, run.wakeState!.receipt!);
    if (accepted) { run = { ...run, wakeState: acknowledgeManagerWake(run.wakeState!, run.wakeState!.receipt!.id, Date.now()) }; disks.set("engine", clone(run)); }
    return accepted;
  };
  return { state, ledger, engine, scope, goal, roster, worker, manager, boss, turnGen, decisionRuntime, ingest, act, route, digest, run: () => run };
}

function stopPort(f: Awaited<ReturnType<typeof fixture>>, overrides = {}) {
  return evaluateDecisionApp<(id: string, managed?: boolean, preserveQueue?: boolean) => Promise<unknown>>(source.stop, { ...f.scope,
    monoForSession, monoGoalOrigins: new Map(), remoteProjectFor: () => undefined, flushHarnessEvents: vi.fn(),
    usageRecoveryStopped: { current: new Set() }, sessionChildHarnesses: () => [], cancelHarnessTurn: vi.fn(), stopHarnessSession: vi.fn(),
    finishSessionTurn: async () => {}, sessionWorkCwd: (session: Session) => session.cwd,
    stopStreaming: (session: Session) => ({ ...session, busy: false }), isPreparingHandoff: () => false,
    notifyReviewChanged: vi.fn(), nudgeWorkspace: vi.fn(), notifyGitChanged: vi.fn(), nudgeWatchedFiles: vi.fn(), ...overrides,
  });
}

async function consumePort(f: Awaited<ReturnType<typeof fixture>>, sessionId: string) {
  const session = f.state.session(sessionId)!, head = queuedHead(session)!;
  const submit = vi.fn(async (id: string, text: string, _attachments, options) => {
    options.validateDecisionDelivery?.();
    const next = appendUser(dequeueQueuedMessage(f.state.session(id)!, head.id), text, [], { internal: true, appRequestId: options.appRequestId, monoDecision: options.monoDecision });
    await upsertSession(next); f.state.setState(sessions => sessions.map(session => session.id === id ? { ...next, busy: false } : session)); return true;
  });
  const consume = evaluateDecisionApp<() => Promise<void>>(source.consumer, { ...f.scope, session, next: head,
    scheduled: new Set([session.id]), queueDispatchingRef: { current: new Set([session.id]) }, codexStorageRecovery: { current: {} },
    canDispatchQueuedHead, canSteerQueuedHead, queuedHead, canSteerHarness: () => false, monoForSession, submitSession: submit, setQueueDispatchVersion: vi.fn() });
  await consume(); return { submit, head };
}

async function settleWithinSecond<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([pending.then(value => ({ settled: true as const, value })),
      new Promise<{ settled: false }>(resolve => { timer = setTimeout(() => resolve({ settled: false }), 1000); })]);
    expect(result.settled).toBe(true);
    if (!result.settled) throw Error("Serialized decision operation did not complete within the preserved 1000ms bound");
    return result.value;
  } finally { clearTimeout(timer); }
}

it("executes actual authenticated App ingress, CC5D coalescence/save-readback, answer queue and restart", async () => {
  const f = await fixture();
  await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" });
  await expect(f.route("worker", "question-two", JSON.stringify({ version: 1, type: "decision", question: "Which parser tests?", context: "Same original task", impact: "low", operation: "work", options: [{ id: "unit", label: "Unit" }, { id: "runtime", label: "Runtime" }] }))).resolves.toMatchObject({ delivery: "pending" });
  expect(f.state.session(f.manager.id)!.queuedMessages).toBeUndefined();
  expect((disks.get("mono-goals:manager") as GoalLedger).receipts.question.decision!.remaining).toHaveLength(1);
  await f.digest(); await f.ingest();
  expect(f.run().wakeState!.receipt!.eventIds).toHaveLength(2);
  expect(f.state.session(f.manager.id)!.queuedMessages).toHaveLength(1);
  await f.act("manager", "resolve", { optionId: "reuse" });
  await f.ledger.retireDecisionEvidence("manager", `${f.worker.id}:question`, 0);
  expect(f.ledger.decisions("manager").find(decision => decision.id === `${f.worker.id}:question`)!.deliveryState).toBe("current");
  const queued = f.state.session(f.worker.id)!.queuedMessages![0];
  expect(queued.monoDecision).toMatchObject({ recipientId: "worker", resolutionVersion: 1 });
  expect((await readPersistedSession(f.worker.id))!.queuedMessages![0]).toEqual(queued);
  const restored = new MonoManagerGoals(); await restored.hydrate("manager");
  expect(restored.decisions("manager").find(decision => decision.id === `${f.worker.id}:question`)).toMatchObject({ status: "decided", selectedOptionId: "reuse" });
  expect(restored.goals("manager")).toHaveLength(1);
  expect((disks.get("mono-goals:manager") as GoalLedger).receipts.question.decision!.remaining).toEqual([]);
});

it("keeps ordinary CC5D prerequisite decisions outside the V2 digest guard and retirement namespace", async () => {
  const f = await fixture();
  await f.engine.queueManagerMessage("engine", { id: "decision:report:dispatch-accept", kind: "decision", at: 1, text: "Accept this prerequisite to unlock queued work", requestId: "accept-prerequisite" });
  await expect(f.digest()).resolves.toBe(true);
  const session = f.state.session(f.manager.id)!, head = queuedHead(session)!;
  const validate = assertDecisionDigestConsumer(head, () => f.run(), () => [], runtimeDecisionHost("manager", { kind: "mono", id: "manager" }, "", undefined, f.decisionRuntime.current));
  expect(validate).not.toThrow();
  expect(isMonoDecisionEventId("decision:report:dispatch-accept")).toBe(false);
  expect(isMonoDecisionEventId("decision:worker:request:1:decision:0")).toBe(true);
  expect((await readPersistedSession(session.id))!.queuedMessages![0]).toEqual(head);
  expect(f.ledger.decisions("manager")).toEqual([]);
  f.engine.replace({ ...f.run(), ownerMonoId: undefined });
  const submit = vi.fn(async (_id: string, _text: string, _attachments: unknown, _options: { validateDecisionDelivery?: () => void }) => true);
  const consume = evaluateDecisionApp<() => Promise<void>>(source.consumer, { ...f.scope, session, next: head,
    scheduled: new Set([session.id]), queueDispatchingRef: { current: new Set([session.id]) },
    codexStorageRecovery: { current: {} }, canDispatchQueuedHead, canSteerQueuedHead, queuedHead,
    canSteerHarness: () => false, monoForSession, submitSession: submit, setQueueDispatchVersion: vi.fn() });
  await consume();
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][3].validateDecisionDelivery).toBeUndefined();
  submit.mockClear();
  f.engine.replace({ ...f.run(), wakeState: { ...f.run().wakeState!, receipt: { ...f.run().wakeState!.receipt!, body: "A different digest" } } });
  await consume();
  expect(submit).not.toHaveBeenCalled();
  expect(queuedHead(f.state.session(session.id)!)!.error).toContain("digest identity changed");
  expect(f.state.session(session.id)!.queueStatus).toBe("paused");
});

it.each(["completed", "stopped"])("actual App retires an unaccepted stale digest after %s and delivers its report plus the next wave", async scenario => {
  const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" });
  if (scenario === "stopped") {
    f.engine.replace({ ...f.run(), status: "paused" });
    const stopping = stopPort(f)(f.manager.id);
    expect(f.state.session(f.manager.id)!.busy).toBe(false);
    await stopping;
    expect(f.state.session(f.manager.id)!.queueStatus).not.toBe("paused");
    const submit = vi.fn();
    const continueEngine = Object.assign(f.engine, { host: {
      choices: () => [{ harness: "claude" }], beforeContinue: evaluateDecisionApp(source.beforeContinue, f.scope), submit,
    }, start: async () => { f.engine.replace({ ...f.run(), status: "active" }); } });
    await Orchestrator.prototype.continueManager.call(continueEngine as unknown as Orchestrator, "engine");
    expect(submit).toHaveBeenCalledOnce();
  }
  await f.engine.commit({ ...f.run(), tasks: f.run().tasks.map(task => ({ ...task, status: "completed", result: "Completed parser evidence", lastDispatchId: "dispatch", activeDispatchId: undefined })),
    dispatches: f.run().dispatches!.map(dispatch => ({ ...dispatch, state: "completed", finishedAt: Date.now() })) });
  await expect(f.digest()).resolves.toBe(false);
  expect(f.run().wakeState!.receipt!.retiredEventIds).toEqual([expect.stringContaining("question:1")]);
  await expect(f.digest()).resolves.toBe(true);
  expect(queuedHead(f.state.session(f.manager.id)!)!.text).toContain("Completed parser evidence".slice(0, 20));
  const first = await consumePort(f, f.manager.id); expect(first.submit).toHaveBeenCalledOnce();
  await f.engine.queueManagerMessage("engine", { id: "next-report", requestId: "next", kind: "report", at: Date.now(), text: "Next wave retained report" });
  await expect(f.digest()).resolves.toBe(true);
  expect(queuedHead(f.state.session(f.manager.id)!)!.text).toContain("Next wave retained report");
  const second = await consumePort(f, f.manager.id); expect(second.submit).toHaveBeenCalledOnce();
  expect(f.state.session(f.manager.id)!.queueStatus).not.toBe("paused");
});

it("checks an already consumed stale Manager digest first without reopening unrelated reports", async () => {
  const f = await fixture(); await f.ingest(); await f.digest(); await f.ingest();
  const consumedReceipt = f.run().wakeState!.receipt!;
  const first = await consumePort(f, f.manager.id);
  await f.engine.commit({ ...f.run(), tasks: f.run().tasks.map(task => ({ ...task, status: "completed", result: "Report retained once", lastDispatchId: "dispatch", activeDispatchId: undefined })),
    dispatches: f.run().dispatches!.map(dispatch => ({ ...dispatch, state: "completed", finishedAt: Date.now() })) });
  f.state.setState(sessions => sessions.map(session => session.id === f.manager.id ? { ...session, queuedMessages: [first.head] } : session));
  await upsertSession(f.state.session(f.manager.id)!);
  const hydrate = vi.spyOn(f.decisionRuntime.current, "hydrate");
  const accept = evaluateDecisionApp<(id: string, receipt: typeof consumedReceipt) => Promise<boolean>>(source.accept, f.scope);
  await expect(accept(f.manager.id, consumedReceipt)).resolves.toBe(true);
  expect(hydrate).not.toHaveBeenCalled();
  const retirement = vi.spyOn(f.engine, "retireDecisionDigest");
  const duplicate = await consumePort(f, f.manager.id);
  expect(duplicate.submit).not.toHaveBeenCalled(); expect(retirement).not.toHaveBeenCalled();
  expect((await readPersistedSession(f.manager.id))!.queuedMessages).toBeUndefined();
  expect(f.run().wakeState!.events.find(event => event.id === "report:dispatch")!.acknowledgedAt).toBeUndefined();
  await expect(f.digest()).resolves.toBe(true);
});

it("retries a failed Stop marker outside actual session writer ownership and consumes the unrelated report exactly once", async () => {
  const f = await fixture(); await f.ingest();
  await f.engine.commit({ ...f.run(), tasks: f.run().tasks.map(task => ({ ...task, status: "completed", result: "Report after stopped question", lastDispatchId: "dispatch", activeDispatchId: undefined })),
    dispatches: f.run().dispatches!.map(dispatch => ({ ...dispatch, state: "completed", finishedAt: Date.now() })) });
  fail = (command, args) => { if (command === "mono_session_upsert" && (args.session as Session).id === f.manager.id) throw Error("Stop marker save unavailable"); };
  await stopPort(f)(f.manager.id, true);
  await f.ledger.hydrate("manager");
  expect(f.ledger.isDecisionSessionRetiring(f.manager.id)).toBe(true);
  expect(decisionStopAt((disks.get(f.manager.id) as Session))).toBe(0);
  expect(f.state.session(f.manager.id)!.blocks.at(-1)!.text).toContain("retirement still needs saving");
  fail = undefined;
  const active = new Set<string>();
  const serialized: typeof writeSession = (id, operation) => {
    expect(active.has(id), "Stop retry must not enter an already held session writer").toBe(false);
    return writeSession(id, async save => {
      active.add(id);
      try { return await operation(save); } finally { active.delete(id); }
    });
  };
  f.scope.writeSession = serialized;
  const retireEvidence = f.ledger.retireDecisionEvidence.bind(f.ledger);
  vi.spyOn(f.ledger, "retireDecisionEvidence").mockImplementation((...args) => {
    expect(active.size, "Ledger delivery can wait on this writer, so retirement must run after release").toBe(0);
    return retireEvidence(...args);
  });
  evaluateDecisionApp(source.host, f.scope);
  f.engine.replace({ ...f.run(), wakeState: prepareManagerWake(f.run(), Date.now() + 1000) });
  const receipt = f.run().wakeState!.receipt!;
  const accept = evaluateDecisionApp<(id: string, item: typeof receipt) => Promise<boolean>>(source.accept, f.scope);
  await expect(settleWithinSecond(accept(f.manager.id, receipt))).resolves.toBe(false);
  expect(f.ledger.isDecisionSessionRetiring(f.manager.id)).toBe(false);
  expect((await readPersistedSession(f.manager.id))!.blocks.filter(isDecisionStopMarker)).toHaveLength(1);
  expect(f.run().wakeState!.receipt!.retiredEventIds).toHaveLength(1);
  expect(f.run().wakeState!.events.find(event => event.id === "report:dispatch")!.acknowledgedAt).toBeUndefined();
  await expect(f.digest()).resolves.toBe(true);
  const report = await consumePort(f, f.manager.id); expect(report.submit).toHaveBeenCalledOnce();
  f.state.setState(sessions => sessions.map(session => session.id === f.manager.id ? { ...session, queuedMessages: [report.head] } : session));
  await upsertSession(f.state.session(f.manager.id)!);
  const duplicate = await consumePort(f, f.manager.id); expect(duplicate.submit).not.toHaveBeenCalled();
  expect((await readPersistedSession(f.manager.id))!.blocks.filter(block => block.internal && block.appRequestId === report.head.appRequestId)).toHaveLength(1);
});

it.each([
  ["generation", "hydrate"], ["account", "hydrate"], ["home", "hydrate"], ["receipt", "hydrate"],
  ["original", "hydrate"], ["account", "reacquire"], ["receipt", "reacquire"], ["original", "reacquire"],
])("actual digest rechecks %s across %s before queue publication", async (mutation, phase) => {
  const f = await fixture(); await f.ingest();
  f.engine.replace({ ...f.run(), wakeState: prepareManagerWake(f.run(), Date.now() + 1000) });
  const receipt = f.run().wakeState!.receipt!;
  const change = () => {
    if (mutation === "generation") f.turnGen.current.set(f.manager.id, 2);
    else if (mutation === "account" || mutation === "home") f.state.setState(sessions => sessions.map(session => session.id === f.manager.id
      ? { ...session, ...(mutation === "account" ? { providerAccountId: "changed-account" } : { codexStorageHome: "synthetic-changed-home" }) } : session));
    else if (mutation === "receipt") f.engine.replace({ ...f.run(), wakeState: { ...f.run().wakeState!, receipt: { ...receipt, body: receipt.body + "changed" } } });
    else f.engine.replace({ ...f.run(), tasks: f.run().tasks.map(task => ({ ...task, status: "completed", activeDispatchId: undefined })),
      dispatches: f.run().dispatches!.map(dispatch => ({ ...dispatch, state: "completed" })) });
  };
  const hydrate = f.decisionRuntime.current.hydrate;
  f.decisionRuntime.current.hydrate = async () => {
    await hydrate();
    if (phase === "hydrate") change();
    else afterRead = () => { afterRead = undefined; change(); };
  };
  const accept = evaluateDecisionApp<(id: string, item: typeof receipt) => Promise<boolean>>(source.accept, f.scope);
  if (mutation === "original") await expect(accept(f.manager.id, receipt)).resolves.toBe(false);
  else await expect(accept(f.manager.id, receipt)).rejects.toThrow("changed");
  expect((await readPersistedSession(f.manager.id))!.queuedMessages).toBeUndefined();
  expect(f.state.session(f.manager.id)!.queuedMessages).toBeUndefined();
});

it("actual ledger cancellation and Orchestrator task cancellation finish managed App Stop before queued retirement", async () => {
  const f = await fixture(); await f.ingest();
  const stop = stopPort(f);
  const engine = f.engine as unknown as Orchestrator;
  Object.assign(f.engine, {
    host: { stop: (id: string) => stop(id, true) }, writeChecks: new Map(),
    patchTask: (id: string, taskId: string, patch: unknown) =>
      (Orchestrator.prototype as unknown as { patchTask(id: string, taskId: string, patch: unknown): Promise<void> }).patchTask.call(engine, id, taskId, patch),
    cleanupUnchangedWorker: async () => {}, pump: async () => {},
  });
  const host = {
    projects: async () => [{ id: f.goal.projectId, folder: "C:/Project", name: "Project", managerId: "engine", managerMonoId: "manager", managerExists: true,
      running: 1, needsDecision: 0, ready: 0, blocked: [], goals: [f.goal.id] }],
    deliver: async (_goal: unknown, _text: string, _receipt: string, cancel: boolean) => {
      expect(cancel).toBe(true);
      await Orchestrator.prototype.cancelTask.call(engine, "engine", "task");
    },
  } as Parameters<MonoManagerGoals["handle"]>[5];
  await settleWithinSecond(f.ledger.handle("manager", { kind: "user", messageId: f.goal.userMessageId }, "cancel-source-goal", "goals.cancel", { goalId: f.goal.id }, host));
  await f.ledger.hydrate("manager");
  expect(f.run().tasks[0].status).toBe("cancelled");
  expect(f.ledger.goals("manager")[0].state).toBe("cancelled");
  expect(f.ledger.decisions("manager")[0].deliveryState).toBe("stale");
  expect(f.ledger.isDecisionSessionRetiring(f.worker.id)).toBe(false);
  expect((await readPersistedSession(f.worker.id))!.blocks.filter(isDecisionStopMarker)).toHaveLength(1);
});

it("keeps unrelated pending questions from blocking an actual Manager answer and later receipt recovery", async () => {
  const f = await fixture(); await f.ingest(); await f.digest(); await f.ingest();
  const payload = { version: 1, type: "decision", question: "Another task question", impact: "low", context: "Same bounded goal", operation: "work", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] };
  await expect(f.route("worker", "second", JSON.stringify(payload))).resolves.toMatchObject({ delivery: "pending" });
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).resolves.toMatchObject({ status: "decided" });
  fail = (command, args) => { if (command === "mono_session_upsert" && (args.session as Session).id === f.boss.id) throw Error("Boss target temporarily unavailable"); };
  await expect(f.route("manager", "third", JSON.stringify(payload))).rejects.toThrow("Boss target temporarily unavailable");
  fail = undefined;
  const failures = await f.ledger.recoverDecisions("manager", runtimeDecisionHost("manager", { kind: "mono", id: "manager" }, "", undefined, f.decisionRuntime.current));
  expect(failures.map(item => item.requestId)).toEqual(["second"]);
  expect((disks.get("mono-goals:manager") as GoalLedger).receipts.third.decision!.remaining).toEqual([]);
  expect(queuedHead(f.state.session(f.boss.id)!)!.monoDecision!.decisionId).toBe(`${f.manager.id}:third`);
});

it.each([false, true])("loads dormant ledgers on managed Stop, surfaces failed retirement and remains stale after reload (paged=%s)", async paginated => {
  const f = await fixture();
  await f.route("manager", "manager-question", JSON.stringify({ version: 1, type: "decision", question: "Manager choice", impact: "med", context: "Original request", operation: "work", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] }));
  const dormant = new MonoManagerGoals();
  fail = (command, args) => { if (command === "control_save" && args.leadId === "mono-goals:manager") throw Error("retirement ledger unavailable"); };
  const stopping = stopPort(f, { monoManagerGoals: dormant })(f.manager.id, true);
  expect(f.state.session(f.manager.id)!.busy).toBe(false);
  await stopping;
  await dormant.hydrate("manager");
  expect(dormant.isDecisionSessionRetiring(f.manager.id)).toBe(true);
  expect(f.state.session(f.manager.id)!.blocks.at(-1)!.text).toContain("retirement still needs saving");
  const persisted = (await readPersistedSession(f.manager.id))!;
  expect(decisionStopAt(persisted)).toBeGreaterThan(0);
  const restored = new MonoManagerGoals(); await restored.hydrate("manager");
  expect(restored.decisions("manager")[0].deliveryState).toBe("current");
  if (paginated) {
    await upsertSession({ ...persisted, blocks: [...persisted.blocks, { id: "new-page-tail", role: "assistant", text: "Retained later transcript page" }] });
    paged.add(f.manager.id);
    f.scope.getMonoGoalRecoveryBlocks = async (id: string) => clone((disks.get(id) as Session).blocks);
  }
  const reloaded = (await readPersistedSession(f.manager.id))!;
  f.state.setState(sessions => sessions.map(session => session.id === f.manager.id ? reloaded : session));
  evaluateDecisionApp(source.host, { ...f.scope, monoManagerGoals: restored });
  await expect(f.decisionRuntime.current.hydrate()).rejects.toThrow("retirement ledger unavailable");
  expect(() => assertDecisionCurrent(restored.decisions("manager")[0], runtimeDecisionHost("manager", { kind: "mono", id: "boss" }, "", undefined, f.decisionRuntime.current))).toThrow();
  fail = undefined; await f.decisionRuntime.current.hydrate();
  const verified = new MonoManagerGoals(); await verified.hydrate("manager");
  expect(verified.decisions("manager")[0].deliveryState).toBe("stale");
  expect(restored.isDecisionSessionRetiring(f.manager.id)).toBe(false);
  expect(f.state.session(f.manager.id)!.queueStatus).not.toBe("paused");
});

it("actual goal-routed and Mission callbacks after Stop leave new Boss escalations consumable", async () => {
  const f = await fixture(); await stopPort(f)(f.boss.id);
  expect(f.state.session(f.boss.id)!.queueStatus).not.toBe("paused");
  const routed = vi.fn(async () => true), direct = vi.fn(async () => true);
  const submission = { ownerId: "boss", requestId: "new-routed-user-request", projectId: "C:/Project" };
  const goalForward = evaluateDecisionApp<(id: string, text: string, attachments: unknown[], submission: unknown) => Promise<boolean>>(source.goalForward,
    { submitMonoGoalRef: { current: routed } });
  await goalForward(f.boss.id, "New explicit goal", [], submission);
  const mission = evaluateDecisionApp<(text: string, submission?: unknown) => Promise<boolean>>(source.mission, { ...f.scope,
    submitMonoGoalRef: { current: routed }, submitSession: direct, ensureMonoSession: async () => f.state.session(f.boss.id),
    homeDir: "C:/synthetic", ensureOpenSession: vi.fn(), saveMonoPermissions: vi.fn(), newDefaultSession: vi.fn() });
  await mission("Mission routed goal", submission); await mission("Mission direct goal");
  expect(routed).toHaveBeenCalledWith(f.boss.id, "New explicit goal", [], submission);
  expect(routed).toHaveBeenCalledWith(f.boss.id, "Mission routed goal", [], submission);
  expect(direct).toHaveBeenCalledWith(f.boss.id, "Mission direct goal", []);
  await f.route("manager", "after-boss-send", JSON.stringify({ version: 1, type: "decision", question: "New Boss escalation", context: "Current Manager goal", impact: "med", operation: "work", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] }));
  expect(f.state.session(f.boss.id)!.queueStatus).not.toBe("paused");
  const consumed = await consumePort(f, f.boss.id); expect(consumed.submit).toHaveBeenCalledOnce();
});

it.each(["save", "readback"])("retains the actual App Manager outbox after a failed %s", async failure => {
  const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" });
  if (failure === "save") fail = command => { if (command === "mono_session_upsert") throw Error("synthetic disk failure"); };
  else afterRead = () => { const saved = disks.get(f.manager.id) as Session; if (saved) disks.set(f.manager.id, { ...saved, queuedMessages: [] }); };
  if (failure === "save") await expect(f.digest()).rejects.toThrow("synthetic disk failure");
  else { await f.digest(); disks.set(f.manager.id, { ...(disks.get(f.manager.id) as Session), queuedMessages: [] }); }
  await expect(f.ingest()).rejects.toThrow();
  expect((disks.get("mono-goals:manager") as GoalLedger).receipts.question.decision!.remaining).toHaveLength(1);
  expect(f.ledger.decisions("manager")[0].status).toBe("pending");
});

it.each([false, true])("reads the exact consumed Boss receipt outside the loaded page before acknowledging App ingress retry (corrupt: %s)", async corrupt => {
  const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" }); await f.digest(); await f.ingest();
  const command = JSON.stringify({ version: 1, type: "decision-action", action: "escalate", decisionId: `${f.worker.id}:question`, expectedVersion: 0 });
  fail = (command, args) => {
    if (command !== "control_save" || args.leadId !== "mono-goals:manager") return;
    const next = JSON.parse(String(args.state)) as GoalLedger;
    if (next.receipts["escalate-boss"]?.decision?.remaining.length === 0) throw Error("source acknowledgement failure");
  };
  await expect(f.route("manager", "escalate-boss", command)).rejects.toThrow("source acknowledgement failure");
  fail = undefined;
  const boss = f.state.session(f.boss.id)!, head = queuedHead(boss)!;
  let consumed = appendUser(dequeueQueuedMessage(boss, head.id), head.text, [], { internal: true, appRequestId: head.id,
    monoDecision: corrupt ? { ...head.monoDecision!, resolutionVersion: 999 } : head.monoDecision });
  consumed = { ...consumed, blocks: [...consumed.blocks, { id: "later-window", role: "system", text: "Later transcript window" }] };
  await upsertSession(consumed);
  paged.add(boss.id);
  const page = (await readPersistedSession(boss.id))!;
  expect(page.blocks.some(block => block.appRequestId === head.id)).toBe(false);
  f.state.setState(sessions => sessions.map(session => session.id === boss.id ? page : session));
  const history = vi.fn(async (id: string) => clone((disks.get(id) as Session).blocks));
  evaluateDecisionApp(source.host, { ...f.scope, getMonoGoalRecoveryBlocks: history });
  if (corrupt) await expect(f.route("manager", "escalate-boss", command)).rejects.toThrow("different evidence");
  else await f.route("manager", "escalate-boss", command);
  expect(history).toHaveBeenCalledWith(boss.id);
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("mono_session_event_delivered", { sessionId: boss.id, eventId: head.id, text: head.text });
  expect((disks.get(boss.id) as Session).queuedMessages).toBeUndefined();
  expect((disks.get("mono-goals:manager") as GoalLedger).receipts["escalate-boss"].decision!.remaining).toHaveLength(corrupt ? 1 : 0);
});

it("retires original authority durably on Stop so a same-engine replacement cannot revive it", async () => {
  const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" }); await f.digest(); await f.ingest();
  const stop = evaluateDecisionApp<(id: string, managed: boolean) => Promise<unknown>>(source.stop, { ...f.scope,
    monoForSession, monoGoalOrigins: new Map(), remoteProjectFor: () => undefined, flushHarnessEvents: vi.fn(),
    usageRecoveryStopped: { current: new Set() },
    sessionChildHarnesses: () => [], cancelHarnessTurn: vi.fn(), stopHarnessSession: vi.fn(),
    finishSessionTurn: async () => {}, sessionWorkCwd: (session: Session) => session.cwd,
    stopStreaming: (session: Session) => ({ ...session, busy: false }), isPreparingHandoff: () => false,
    notifyReviewChanged: vi.fn(), nudgeWorkspace: vi.fn(), notifyGitChanged: vi.fn(), nudgeWatchedFiles: vi.fn(),
  });
  await stop(f.worker.id, true);
  expect(f.state.session(f.worker.id)!.queueStatus).not.toBe("paused");
  f.engine.replace({ ...clone(f.run()), requests: { replacement: { signature: "new-run", result: true } } });
  const restored = new MonoManagerGoals(); await restored.hydrate("manager");
  expect(restored.decisions("manager")[0].deliveryState).toBe("stale");
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("retired");
  expect(f.state.session(f.worker.id)!.queuedMessages).toBeUndefined();
  expect(selectDecisionView(restored, f.roster, Date.now()).log[0].decision.deliveryState).toBe("stale");
  f.state.setState(sessions => sessions.map(session => session.id === f.worker.id ? { ...session, queueStatus: "paused" } : session));
  const send = evaluateDecisionApp<(id: string, text: string, attachments: unknown[], options?: unknown) => boolean>(source.send, { ...f.scope,
    workspaceNavigation: { isSwitching: () => false }, queuedHead, submitSession: () => true });
  send(f.worker.id, "Explicit Queue", [], { followUpBehavior: "queue" });
  expect(f.state.session(f.worker.id)!.queueStatus).toBe("paused");
  send(f.worker.id, "Explicit new request", []);
  expect(f.state.session(f.worker.id)!.queueStatus).toBe("active");
  await upsertSession(f.state.session(f.worker.id)!);
  const reloaded = (await readPersistedSession(f.worker.id))!;
  expect(reloaded.queueStatus).not.toBe("paused");
  expect(restored.decisions("manager")[0].deliveryState).toBe("stale");
  f.state.setState(sessions => sessions.map(session => session.id === f.worker.id ? { ...session, queueStatus: "paused" } : session));
  const resume = evaluateDecisionApp<(id: string) => void>(source.resume, { ...f.scope, queuedHead, monoForSession,
    onSubmit: vi.fn(), resumeMonoUsageLimit: vi.fn() });
  resume(f.worker.id);
  expect(f.state.session(f.worker.id)!.queueStatus).toBe("active");
  await upsertSession(f.state.session(f.worker.id)!);
  expect((await readPersistedSession(f.worker.id))!.queueStatus).not.toBe("paused");
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("retired");
});

it.each([false, true])("retires a stale actual App answer with a durable visible notice (failed save: %s)", async brokenSave => {
    const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" }); await f.digest(); await f.ingest();
    await f.act("manager", "resolve", { optionId: "reuse" });
    await f.ledger.retireDecisionSession(f.worker.id);
    f.state.setState(sessions => sessions.map(session => session.id === f.worker.id ? { ...session, busy: false } : session));
    const session = f.state.session(f.worker.id)!, head = queuedHead(session)!;
    const submit = vi.fn();
    if (brokenSave) fail = command => { if (command === "mono_session_upsert" || command === "session_upsert") throw Error("retirement disk failure"); };
    const consume = evaluateDecisionApp<() => Promise<void>>(source.consumer, { ...f.scope, session, next: head,
      scheduled: new Set([session.id]), queueDispatchingRef: { current: new Set([session.id]) },
      codexStorageRecovery: { current: {} }, canDispatchQueuedHead, canSteerQueuedHead, queuedHead,
      canSteerHarness: () => false, monoForSession, submitSession: submit, setQueueDispatchVersion: vi.fn() });
    await consume(); expect(submit).not.toHaveBeenCalled();
    if (brokenSave) {
      expect(f.state.session(session.id)!.queueStatus).toBe("paused");
      expect(queuedHead(f.state.session(session.id)!)!.error).toContain("retirement disk failure");
    } else {
      const restored = (await readPersistedSession(session.id))!;
      expect(restored.queuedMessages).toBeUndefined();
      expect(restored.blocks.at(-1)!.text).toContain("No work was resumed");
    }
});

it("actual App submission guards reject an account switch after awaited setup", async () => {
  const validate = vi.fn();
  const guards = evaluateDecisionApp<{ afterDecisionSetup<T>(value: Promise<T>): Promise<T> }>(source.guards, {
    options: { validateDecisionDelivery: validate }, assertManagerDelivery, sessionsRef: { current: [] }, sessionId: "synthetic",
    monoForSession: () => undefined, monoManagerGoals: new MonoManagerGoals(),
  });
  let release!: () => void;
  const pending = guards.afterDecisionSetup(new Promise<void>(resolve => { release = resolve; }));
  validate.mockImplementation(() => { throw Error("changed account binding"); }); release();
  await expect(pending).rejects.toThrow("changed account binding");
});

it("actual App owns the trusted UI callbacks, Decisions mount and stable notification event keys", () => {
  expect(source.source).toContain("<Decisions view={decisionView}");
  expect(source.source).toContain("decisionActions={decisionActions}");
  const current = { current: {} };
  const command = vi.fn(), reraise = vi.fn();
  const actions = evaluateDecisionApp<{ command: typeof command; reraise: typeof reraise }>(source.actions, {
    executeDecisionUi: command, reraiseUnreadableDecision: reraise, decisionRuntime: current,
    teamMap: { close: vi.fn() }, onSelectProject: vi.fn(),
  });
  const event = new Event("click"), value = { action: "autonomy", projectId: "C:/Project", value: "everything" };
  actions.command(event, "manager", "retry", value);
  expect(command).toHaveBeenCalledWith(event, "manager", "retry", value, current.current);
});

it.each(["generation", "account"])("actual App consumer refuses %s changes after asynchronous setup", async mutation => {
  const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" }); await f.digest(); await f.ingest();
  await f.act("manager", "resolve", { optionId: "reuse" });
  f.state.setState(sessions => sessions.map(session => session.id === f.worker.id ? { ...session, busy: false } : session));
  const session = f.state.session(f.worker.id)!, head = queuedHead(session)!;
  const published = vi.fn();
  const submit = vi.fn(async (_id, _text, _attachments, options) => {
    options.validateDecisionDelivery();
    await Promise.resolve();
    if (mutation === "generation") f.turnGen.current.set(session.id, 2);
    else f.state.setState(sessions => sessions.map(entry => entry.id === session.id ? { ...entry, providerAccountId: "other-account" } : entry));
    options.validateDecisionDelivery(); published(); return true;
  });
  const consume = evaluateDecisionApp<() => Promise<void>>(source.consumer, { ...f.scope,
    session, next: head, scheduled: new Set([session.id]), queueDispatchingRef: { current: new Set([session.id]) },
    codexStorageRecovery: { current: {} }, canDispatchQueuedHead, canSteerQueuedHead, queuedHead,
    canSteerHarness: () => false, monoForSession, submitSession: submit, setQueueDispatchVersion: vi.fn(),
  });
  await consume();
  expect(submit).toHaveBeenCalledOnce(); expect(published).not.toHaveBeenCalled();
  if (mutation === "account") {
    expect(f.state.session(session.id)!.queuedMessages).toBeUndefined();
    expect((await readPersistedSession(session.id))!.blocks.at(-1)!.text).toContain("No work was resumed");
    const ledger = new MonoManagerGoals(); await ledger.hydrate("manager");
    expect(ledger.decisions("manager")[0].deliveryState).toBe("stale");
  } else {
    expect(f.state.session(session.id)!.queuedMessages![0].error).toContain("changed");
    expect(f.state.session(session.id)!.queueStatus).toBe("paused");
  }
});

it("consumes the actual App answer once as persisted internal evidence and reloads its exact receipt", async () => {
  const f = await fixture(); await expect(f.ingest()).resolves.toMatchObject({ delivery: "pending" }); await f.digest(); await f.ingest();
  await f.act("manager", "resolve", { optionId: "reuse" });
  f.state.setState(sessions => sessions.map(session => session.id === f.worker.id ? { ...session, busy: false } : session));
  const session = f.state.session(f.worker.id)!, head = queuedHead(session)!;
  const submit = vi.fn(async (id: string, text: string, _attachments: unknown, options: { appRequestId: string; monoDecision: QueuedMessage["monoDecision"]; validateDecisionDelivery(): void }) => {
    options.validateDecisionDelivery();
    const next = appendUser(dequeueQueuedMessage(f.state.session(id)!, head.id), text, [], { internal: true, appRequestId: options.appRequestId, monoDecision: options.monoDecision });
    await upsertSession(next); f.state.setState(sessions => sessions.map(session => session.id === id ? next : session)); return true;
  });
  const scope = { ...f.scope, session, next: head, scheduled: new Set([session.id]), queueDispatchingRef: { current: new Set([session.id]) },
    codexStorageRecovery: { current: {} }, canDispatchQueuedHead, canSteerQueuedHead, queuedHead, canSteerHarness: () => false,
    monoForSession, submitSession: submit, setQueueDispatchVersion: vi.fn() };
  const consume = evaluateDecisionApp<() => Promise<void>>(source.consumer, scope);
  await consume(); await consume();
  expect(submit).toHaveBeenCalledOnce();
  f.state.setState(sessions => sessions.map(entry => entry.id === session.id ? { ...entry, busy: false, queuedMessages: [head] } : entry));
  await upsertSession(f.state.session(session.id)!);
  await consume();
  expect(submit).toHaveBeenCalledOnce();
  const restored = (await readPersistedSession(session.id))!;
  expect(restored.queuedMessages).toBeUndefined();
  expect(restored.blocks.filter(block => block.appRequestId === head.id)).toEqual([expect.objectContaining({ internal: true, monoDecision: head.monoDecision, text: head.text })]);
});
