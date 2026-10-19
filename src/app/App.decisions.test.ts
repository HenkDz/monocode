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
import { assertDecisionQueueConsumer, assertDecisionDigestConsumer, queueDecisionEvidence, decisionQueueId, decisionEvidenceText } from "../features/monos/model/monoDecisionDelivery";
import { retainedDecisionDelivery, StaleDecision, assertDecisionCurrent } from "../features/monos/model/monoDecisions";
import { acceptManagerWakeQueue, addManagerWakeEvent, prepareManagerWake } from "../features/orchestration/model/managerWake";
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
      if (result && paged.has(result.id)) result.blocks = result.blocks.slice(-1);
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
    replace: (next: OrchestrationRun) => { run = next; disks.set("engine", clone(run)); },
    queueManagerMessage: vi.fn(async (_id, event) => { run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, event) }; disks.set("engine", clone(run)); }) };
  const turnGen = { current: new Map([[manager.id, 1], [worker.id, 1], [boss.id, 1]]) };
  const decisionRuntime = { current: null! as DecisionRuntimeHost };
  const scope: Record<string, unknown> = { decisionRuntime, monoManagerGoals: ledger, listMonos, findMono, sessionsRef: state.ref,
    setSessions: state.setState, turnGen, decisionOriginalBlocks: { current: new Map() }, setDecisionUnavailable: vi.fn(),
    habitRunMono: () => undefined, orchestrator: engine, invoke, writeSession, readPersistedSession,
    managerRequestBinding, managerRequestBindingCurrent, queueDecisionEvidence, retainedDecisionDelivery, decisionQueueId, decisionEvidenceText, isMonoSession,
    runtimeDecisionHost, assertDecisionDigestConsumer, assertDecisionQueueConsumer, StaleDecision, assertDecisionCurrent, dequeueQueuedMessage,
    getMonoGoalRecoveryBlocks: async () => { throw Error("Test unexpectedly bypassed its committed original user block"); },
    acceptManagerWakeQueue, flushSync: (fn: () => void) => fn(),
  };
  evaluateDecisionApp(source.host, scope);
  const route = async (actor: "worker" | "manager" | "boss", requestId: string, text: string) => {
    const actorSession = actor === "worker" ? worker.id : roster.find(mono => mono.id === actor)!.sessionId!;
    state.setState(sessions => sessions.map(session => session.id === actorSession ? { ...session, busy: true } : session));
    const current = state.ref.current.find(session => session.id === actorSession)!;
    return evaluateDecisionApp<Promise<unknown>>(`return (async () => { ${source.team} })();`, { ...scope,
      source: current, payload: { sessionId: current.id, requestId, action: "team.message", input: { memberId: actor === "worker" ? "manager" : actor === "manager" ? "boss" : "manager", text, kind: actor === "worker" ? "question" : "decision" } },
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
    return accept(manager.id, run.wakeState!.receipt!);
  };
  return { state, ledger, engine, scope, goal, roster, worker, manager, boss, turnGen, decisionRuntime, ingest, act, route, digest, run: () => run };
}

it("executes actual authenticated App ingress, CC5D coalescence/save-readback, answer queue and restart", async () => {
  const f = await fixture();
  await expect(f.ingest()).rejects.toThrow("Manager digest waits");
  await expect(f.route("worker", "question-two", JSON.stringify({ version: 1, type: "decision", question: "Which parser tests?", context: "Same original task", impact: "low", operation: "work", options: [{ id: "unit", label: "Unit" }, { id: "runtime", label: "Runtime" }] }))).rejects.toThrow("Manager digest waits");
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

it.each(["save", "readback"])("retains the actual App Manager outbox after a failed %s", async failure => {
  const f = await fixture(); await expect(f.ingest()).rejects.toThrow();
  if (failure === "save") fail = command => { if (command === "mono_session_upsert") throw Error("synthetic disk failure"); };
  else afterRead = () => { const saved = disks.get(f.manager.id) as Session; if (saved) disks.set(f.manager.id, { ...saved, queuedMessages: [] }); };
  if (failure === "save") await expect(f.digest()).rejects.toThrow("synthetic disk failure");
  else { await f.digest(); disks.set(f.manager.id, { ...(disks.get(f.manager.id) as Session), queuedMessages: [] }); }
  await expect(f.ingest()).rejects.toThrow();
  expect((disks.get("mono-goals:manager") as GoalLedger).receipts.question.decision!.remaining).toHaveLength(1);
  expect(f.ledger.decisions("manager")[0].status).toBe("pending");
});

it.each([false, true])("reads the exact consumed Boss receipt outside the loaded page before acknowledging App ingress retry (corrupt: %s)", async corrupt => {
  const f = await fixture(); await expect(f.ingest()).rejects.toThrow(); await f.digest(); await f.ingest();
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
  const f = await fixture(); await expect(f.ingest()).rejects.toThrow(); await f.digest(); await f.ingest();
  const stop = evaluateDecisionApp<(id: string, managed: boolean) => Promise<unknown>>(source.stop, { ...f.scope,
    monoForSession, monoGoalOrigins: new Map(), remoteProjectFor: () => undefined, flushHarnessEvents: vi.fn(),
    usageRecoveryStopped: { current: new Set() },
    sessionChildHarnesses: () => [], cancelHarnessTurn: vi.fn(), stopHarnessSession: vi.fn(),
    finishSessionTurn: async () => {}, sessionWorkCwd: (session: Session) => session.cwd,
    stopStreaming: (session: Session) => ({ ...session, busy: false }), isPreparingHandoff: () => false,
    notifyReviewChanged: vi.fn(), nudgeWorkspace: vi.fn(), notifyGitChanged: vi.fn(), nudgeWatchedFiles: vi.fn(),
  });
  await stop(f.worker.id, true);
  expect(f.state.session(f.worker.id)!.queueStatus).toBe("paused");
  f.engine.replace({ ...clone(f.run()), requests: { replacement: { signature: "new-run", result: true } } });
  const restored = new MonoManagerGoals(); await restored.hydrate("manager");
  expect(restored.decisions("manager")[0].deliveryState).toBe("stale");
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("retired");
  expect(f.state.session(f.worker.id)!.queuedMessages).toBeUndefined();
  expect(selectDecisionView(restored, f.roster, Date.now()).log[0].decision.deliveryState).toBe("stale");
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
    const f = await fixture(); await expect(f.ingest()).rejects.toThrow(); await f.digest(); await f.ingest();
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
  const f = await fixture(); await expect(f.ingest()).rejects.toThrow(); await f.digest(); await f.ingest();
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
  const f = await fixture(); await expect(f.ingest()).rejects.toThrow(); await f.digest(); await f.ingest();
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
