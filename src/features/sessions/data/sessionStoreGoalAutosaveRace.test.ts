import { SessionStateStore } from "../model/sessionStateStore";
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { pathKey } from "../../../shared/lib/paths";
import ts from "typescript";
import { newSession, type Block, type Session } from "../model/session";
import { isMonoSession } from "../../monos/model/mono";
import { appendMonoGoalCard, appendMonoGoalOrigin, type MonoGoalSubmission } from "../../monos/model/monoGoalRouting";
import { MonoManagerGoals, type MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import { archiveMonoConversation } from "../../monos/model/monoArchive";
import { canDispatchQueuedHead } from "../model/messageQueue";
import { getMonoGoalRecoveryBlocks, mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession } from "./monoGoalRecovery";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { getSession, upsertSession, flushSessionWrites, persistFingerprint, shouldPersistSession, writeSession } = await import("./sessionStore");
beforeEach(() => { invoke.mockReset(); });

const submission: MonoGoalSubmission = {
  ownerId: "grand", requestId: "review-request", userMessageId: "review-user",
  choice: { mode: "goal", override: "auto" }, projectId: "c:/synthetic/atlas",
  managerMonoId: "atlas-manager", reason: "Exact project name",
};
const goal: MonoManagerGoal = {
  id: "review-goal", monoId: "grand", projectId: "c:/synthetic/atlas", managerId: "atlas-engine",
  userMessageId: submission.userMessageId, requestId: submission.requestId,
  title: "Fix Atlas login", state: "queued", prUrls: [], createdAt: 1, updatedAt: 1,
};

function fixture(originPosition: "old" | "tail" | "absent", card = true) {
  const session = newSession("codex", "C:/synthetic/Atlas");
  const pending: Block[] = [
    { id: submission.userMessageId, role: "user", text: goal.title, monoGoalSubmission: submission },
    ...(card ? [{ id: `route-${submission.userMessageId}`, role: "assistant" as const, text: "Pending delivery" }] : []),
  ];
  const chat: Block[] = Array.from({ length: 10 }, (_, turn): Block[] => [
    { id: `chat-user-${turn}`, role: "user", text: `Ordinary chat ${turn}` },
    { id: `chat-answer-${turn}`, role: "assistant", text: `Synthetic answer ${turn}` },
  ]).flat();
  let disk = originPosition === "old" ? [...pending, ...chat]
    : originPosition === "tail" ? [...chat, ...pending] : chat;
  const writes: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let gateNext = false;
  function page(before: number | null = null) {
    const end = before ?? Number.MAX_SAFE_INTEGER;
    const starts = disk.flatMap((block, index) => index + 1 < end && block.role === "user" ? [index + 1] : []);
    const start = starts.slice(-10)[0] ?? end;
    return { blocks: structuredClone(disk.filter((_, index) => index + 1 >= start && index + 1 < end)),
      before: starts.length > 10 ? start : null, hasNewer: disk.length >= end };
  }
  invoke.mockImplementation(async (command, args) => {
    if (command === "session_get") {
      const latest = page();
      return { ...session, blocks: latest.blocks,
        monoTranscript: { before: latest.before, firstBlockId: latest.blocks[0]?.id ?? null } };
    }
    if (command === "mono_session_page") return page(args.before);
    if (command !== "mono_session_upsert") throw Error(`Unexpected native call ${command}`);
    writes.push(structuredClone(args));
    if (gateNext) { gateNext = false; await gate; }
    if (args.blocksChanged) {
      const anchorId = args.afterBlockId ?? args.fromBlockId;
      const anchorIndex = anchorId ? disk.findIndex(block => block.id === anchorId) : -1;
      if (anchorId && anchorIndex < 0) throw Error("Native transcript anchor missing");
      const index = args.appendOnly ? disk.length : args.afterBlockId ? anchorIndex + 1 : args.fromBlockId ? anchorIndex : 0;
      const next = [...disk.slice(0, index), ...structuredClone(args.session.blocks)];
      if (new Set(next.map(block => block.id)).size !== next.length)
        throw Error("UNIQUE constraint failed: mono_blocks.session_id, mono_blocks.block_id");
      disk = next;
    }
    return { ...args.session, createdAt: 1, updatedAt: 2 };
  });
  return { session, disk: () => disk, writes, hold: () => { gateNext = true; }, release };
}

function exactUpdate(sessionsRef: { current: Session[] }, history?: Block[], setSessions: SessionStateStore["setState"] = () => {}) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("    const update = async (change: (session: Session) => Session) => {");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("    return submitMonoGoal(", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn update;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("sessionsRef", "setSessions", "sessionId", "writeSession",
    "history", "getMonoGoalRecoveryBlocks", "mergeMonoGoalRecoverySession", "monoGoalRecoveryLiveSession", code)(
    sessionsRef, setSessions, sessionsRef.current[0].id, writeSession,
    history, getMonoGoalRecoveryBlocks, mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession,
  ) as (change: (session: Session) => Session) => Promise<void>;
}

function report(label: string, f: ReturnType<typeof fixture>, ref: { current: Session[] }) {
  console.log("CC5CG", label, JSON.stringify({
    disk: f.disk().map(block => ({ id: block.id, card: block.monoCard?.type })),
    memory: ref.current[0].blocks.map(block => ({ id: block.id, card: block.monoCard?.type })),
    writes: f.writes.map(write => ({ afterBlockId: write.afterBlockId, fromBlockId: write.fromBlockId,
      blocksChanged: write.blocksChanged, blocks: write.session.blocks.map((block: Block) => ({ id: block.id, card: block.monoCard?.type })) })),
  }));
}

function exactOrdinaryPersist(sessionsRef: { current: Session[] }, original: Session) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("  const persistSession = useCallback((session: Session | undefined) => {");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("\n  useEffect(() => {", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn persistSession;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("useCallback", "shouldPersistSession", "removingSessionIds", "switchingWorktrees",
    "persistFingerprint", "lastPersisted", "writeSession", "sessionsRef", "sidebarCwdRef", "setHistory", "mergeProjectHistorySummary", code)(
    (callback: unknown) => callback, shouldPersistSession, { current: new Set() }, { current: new Set() },
    persistFingerprint, { current: new Map([[original.id, persistFingerprint(original)]]) }, writeSession, sessionsRef,
    { current: "" }, () => {}, () => {},
  ) as (session: Session) => void;
}

function exactSessionWrite(sessionsRef: { current: Session[] }) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("  const upsertSession = useCallback((session: Session, change?:");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("  const persistSession = useCallback", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn upsertSession;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("useCallback", "writeSession", "sessionsRef", "setSessions", "isMonoSession", code)(
    (callback: unknown) => callback, writeSession, sessionsRef, () => {}, isMonoSession,
  ) as (session: Session, change?: (current: Session) => Session) => Promise<unknown>;
}

function exactDeferredPersist(sessionsRef: { current: Session[] }, original: Session, sessionState: SessionStateStore, hidden = false) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scheduling: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("const sessions = sessionState.snapshot()")) scheduling = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(scheduling).toBeDefined();
  const code = ts.transpileModule(scheduling!.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let timer!: () => void;
  let cleanup: (() => void) | undefined;
  const session = sessionsRef.current[0];
  const lastUserId = (entry: Session) => [...entry.blocks].reverse().find(block => block.role === "user")?.id;
  new Function("useEffect", "sessions", "tabsRef", "openSessionIds", "removingSessionIds", "switchingWorktrees",
    "observedSessions", "lastBoundProvider", "lastUserBlockId", "lastPersistedUserBlock", "shouldPersistSession",
    "persistSession", "pendingPersist", "lastPersisted", "window", "sessionState", code)(
    (effect: () => (() => void)) => { cleanup = effect(); }, [session], { current: [] }, () => new Set(hidden ? [] : [session.id]),
    { current: new Set() }, { current: new Set() }, { current: new Map([[session.id, original]]) },
    { current: new Map() }, lastUserId, { current: new Map([[session.id, lastUserId(original)]]) }, shouldPersistSession,
    exactOrdinaryPersist(sessionsRef, original), { current: new Map() }, { current: new Map([[session.id, persistFingerprint(original)]]) },
    { setTimeout: (callback: () => void, delay: number) => { expect(delay).toBe(650); timer = callback; }, clearTimeout: () => {} }, sessionState,
  );
  expect(timer).toBeTypeOf("function");
  return () => { timer(); cleanup?.(); };
}

it.each([true, false])("preserves card repair against concurrent ordinary save; prior pending card=%s", async card => {
  const f = fixture("tail", card);
  const ref = { current: [(await getSession(f.session.id))!] };
  const history = await getMonoGoalRecoveryBlocks(f.session.id);
  const update = exactUpdate(ref, history);
  f.hold();
  const repairing = update(session => appendMonoGoalCard(session, submission, goal));
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  // Harness/chat emits another ordinary user turn before repair publishes its card.
  const ordinary = { ...ref.current[0], blocks: [...ref.current[0].blocks,
    { id: "ordinary-later-user", role: "user" as const, text: "Continue ordinary chat" }] };
  ref.current = [ordinary];
  exactOrdinaryPersist(ref, ref.current[0])(ordinary);
  const saving = flushSessionWrites();
  f.release();
  await Promise.all([repairing, saving]);
  report(`card repair pending=${card}`, f, ref);
  expect(f.disk().find(block => block.id === `route-${submission.userMessageId}`)?.monoCard)
    .toEqual({ type: "dispatch", goalIds: [goal.id] });
  expect(f.disk().at(-1)?.id).toBe("ordinary-later-user");
});

it.each(["queue", "new turn", "deferred autosave"])("preserves a saved origin against concurrent %s persistence", async writer => {
  const f = fixture("absent");
  const store = new SessionStateStore([(await getSession(f.session.id))!]);
  const ref = store.ref;
  const original = ref.current[0];
  if (writer === "deferred autosave") store.setState([{ ...original, blocks: original.blocks.map((block, index) =>
    index === original.blocks.length - 1 ? { ...block, text: "Observed ordinary answer update" } : block) }]);
  const update = exactUpdate(ref, undefined, store.setState);
  const persistOrdinary = writer === "deferred autosave" ? exactDeferredPersist(ref, original, store) : exactOrdinaryPersist(ref, original);
  f.hold();
  const writing = update(session => appendMonoGoalOrigin(session, submission, goal.title));
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  // Queue persistence is requested while the native origin write is still pending.
  const ordinary = writer === "new turn" ? { ...ref.current[0], blocks: [...ref.current[0].blocks,
    { id: "ordinary-later-user", role: "user" as const, text: "Continue ordinary chat" }] }
    : writer === "queue" ? { ...ref.current[0], queueStatus: "paused" as const,
      queuedMessages: [{ id: "ordinary-queued-message", text: "Ordinary queued chat", attachments: [] }] }
    : ref.current[0];
  store.setState([ordinary]);
  persistOrdinary(ordinary);
  f.release();
  await Promise.all([writing, flushSessionWrites()]);
  report(`origin versus ${writer}`, f, ref);
  expect(f.disk().some(block => block.id === submission.userMessageId)).toBe(true);
  if (writer === "new turn") expect(f.disk().some(block => block.id === "ordinary-later-user")).toBe(true);
  if (writer === "queue") expect(f.writes.at(-1).session).toMatchObject({ queueStatus: "paused",
    queuedMessages: [{ id: "ordinary-queued-message", text: "Ordinary queued chat" }] });
  if (writer === "deferred autosave") expect(f.disk().find(block => block.id === "chat-answer-9")?.text)
    .toBe("Observed ordinary answer update");
});

it.each([false, true])("the direct App writer selects current Mono state before saving; intentional permission change=%s", async permissions => {
  const f = fixture("absent");
  const ref = { current: [(await getSession(f.session.id))!] };
  const previous = ref.current[0];
  f.hold();
  const writing = exactUpdate(ref)(session => appendMonoGoalOrigin(session, submission, goal.title));
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  const saving = exactSessionWrite(ref)(previous, permissions ? current => ({ ...current, runtimeMode: "full-access" }) : undefined);
  // A concurrent ordinary queue edit must survive both the origin publication and the permission change.
  ref.current = [{ ...ref.current[0], queuedMessages: [{ id: "concurrent-queue", text: "Keep queued chat", attachments: [] }] }];
  f.release();
  await Promise.all([writing, saving]);
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.writes.at(-1).session.queuedMessages).toMatchObject([{ id: "concurrent-queue", text: "Keep queued chat" }]);
  expect(ref.current[0].queuedMessages).toMatchObject([{ id: "concurrent-queue" }]);
  if (permissions) {
    expect(ref.current[0].runtimeMode).toBe("full-access");
    expect(f.writes.at(-1).session.runtimeMode).toBe("full-access");
  }
});

it("keeps an older card repaired when the later ordinary save starts after repair publication", async () => {
  const f = fixture("old");
  const ref = { current: [(await getSession(f.session.id))!] };
  const history = await getMonoGoalRecoveryBlocks(f.session.id);
  const update = exactUpdate(ref, history);
  await update(session => appendMonoGoalCard(session, submission, goal));
  const ordinary = { ...ref.current[0], blocks: [...ref.current[0].blocks,
    { id: "ordinary-after-user", role: "user" as const, text: "Chat after repair" }] };
  await upsertSession(ordinary);
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.disk().find(block => block.id === `route-${submission.userMessageId}`)?.monoCard?.type).toBe("dispatch");
  expect(f.disk().at(-1)?.id).toBe("ordinary-after-user");
});

it("rejects duplicate IDs spanning transcript pages before any repair writes", async () => {
  const f = fixture("old");
  const live = (await getSession(f.session.id))!;
  const history = await getMonoGoalRecoveryBlocks(f.session.id);
  const duplicate = { ...history[0] };
  const latest = history.slice(-20);
  invoke.mockImplementation(async command => {
    if (command !== "mono_session_page") throw Error("No writes allowed");
    return invoke.mock.calls.filter(call => call[0] === command).length % 2 === 1
      ? { blocks: [duplicate, ...latest], before: 3, hasNewer: false }
      : { blocks: [duplicate, history[1]], before: null, hasNewer: true };
  });
  invoke.mockClear();
  const duplicateHistory = await getMonoGoalRecoveryBlocks(live.id);
  expect(() => mergeMonoGoalRecoverySession(live, duplicateHistory)).toThrow("duplicate a historical message identity");
  expect(f.writes).toHaveLength(0);
});

it("repeated recovery leaves exactly one historical origin and one historical route card", async () => {
  const f = fixture("old");
  const ref = { current: [(await getSession(f.session.id))!] };
  for (let pass = 0; pass < 3; pass++) {
    const history = await getMonoGoalRecoveryBlocks(f.session.id);
    const update = exactUpdate(ref, history);
    await update(session => appendMonoGoalOrigin(session, submission, goal.title));
    await update(session => appendMonoGoalCard(session, submission, goal));
  }
  expect(f.writes).toHaveLength(1);
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.disk().filter(block => block.id === `route-${submission.userMessageId}`)).toHaveLength(1);
});

it("the App archive callback preserves an acknowledged goal delivered while cancellation waits", async () => {
  const f = fixture("absent");
  const ref = { current: [(await getSession(f.session.id))!] };
  const app = readFileSync("src/app/App.tsx", "utf8");
  const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let archive: ts.Expression | undefined;
  let delivery: ts.Expression | undefined;
  const deliveryStart = app.indexOf("    deliver: async (goal, message, receiptId, cancel)");
  const deliveryEnd = app.indexOf("  const goalRoutingForMono", deliveryStart);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "archiveProjectMonos") archive = node.arguments[2];
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "deliver" &&
        node.getStart(source) >= deliveryStart && node.end < deliveryEnd) delivery = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(archive).toBeDefined();
  expect(delivery).toBeDefined();
  const code = (expression: ts.Expression) => ts.transpileModule(`return ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let releaseHydrate!: () => void;
  let hydrationStarted = false;
  const hydrationGate = new Promise<void>(resolve => { releaseHydrate = resolve; });
  const manager = { id: "atlas-manager", role: "manager", projects: ["C:/synthetic/Atlas"],
    sessionId: f.session.id, reportsTo: "grand", archivedAt: undefined as number | undefined };
  const grand = { id: "grand", role: "orchestrator", projects: ["C:/synthetic/Atlas"] };
  const project = { id: goal.projectId, folder: "C:/synthetic/Atlas", name: "Atlas", managerId: goal.managerId,
    managerMonoId: manager.id, managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
  const engine = { run: () => ({ ownerMonoId: manager.id }), registerMonoEngine: () => {},
    hydrate: async () => { hydrationStarted = true; await hydrationGate; } };
  const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
  const deliver = new Function("findMono", "managerGoalHost", "listMonos", "projectKey", "remoteProjectFor", "orchestrator",
    "dedicatedMono", "ensureProjectManager", "sessionsRef", "adoptManagerMono", "assertDirectReport", "ensureMonoSession",
    "homeDir", "ensureOpenSession", "saveMonoPermissions", "newDefaultSession", "sessionDefaults", "setSessions",
    "monoEngineId", "monoLook", "upsertSession", "monoManagerGoals", "pathKey", code(delivery!))(
    (id: string) => id === grand.id ? grand : manager.archivedAt == null ? manager : undefined,
    { current: { projects: async () => [project] } }, () => [grand, manager], (text: string) => text.toLowerCase(),
    () => undefined, engine, () => manager, () => { throw Error("No Manager creation expected"); }, ref,
    () => manager, () => {}, async () => ref.current[0], "synthetic", () => ref.current[0], () => {}, () => {}, {}, () => {},
    async () => goal.managerId, () => ({ name: "Grand", mascot: "g", color: "#123456" }), exactSessionWrite(ref), ledger, pathKey,
  );
  const host = { mayDelegate: () => true, projects: async () => [{ ...project, managerExists: manager.archivedAt == null }],
    status: async () => ({}), ready: async () => [], deliver };
  const incoming = ledger.handle("grand", { kind: "user", messageId: submission.userMessageId }, "archive-request",
    "goals.assign", { projectId: goal.projectId, goal: "Synthetic original routed goal" }, host,
    { managerMonoId: manager.id, projectId: goal.projectId, managerId: goal.managerId, reason: "Exact project name",
      override: "auto", sourceUserMessageId: submission.userMessageId });
  await vi.waitFor(() => expect(hydrationStarted).toBe(true));
  manager.archivedAt = 1;
  let releaseCancel!: () => void;
  let cancelStarted = false;
  const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
  const stop = new Function("sessionsRef", "getSession", "turnGen", "sessionChildHarnesses", "cancelHarnessTurn",
    "archiveMonoConversation", "upsertSession", "persistSession", code(archive!))(
    ref, getSession, { current: new Map() }, () => ["codex"], async () => { cancelStarted = true; await cancelGate; },
    archiveMonoConversation, exactSessionWrite(ref), exactOrdinaryPersist(ref, ref.current[0]),
  );
  const stopping = stop(f.session.id);
  await vi.waitFor(() => expect(cancelStarted).toBe(true));
  releaseHydrate();
  await incoming;
  const receiptId = "mono-goal-grand-archive-request";
  expect(f.writes.at(-1).session.queuedMessages.some((message: { id: string }) => message.id === receiptId)).toBe(true);
  expect(ledger.deliveryPending("grand", "archive-request")).toBe(false);
  releaseCancel();
  await stopping;
  await flushSessionWrites();
  const beforeRecover = f.writes.length;
  manager.archivedAt = undefined;
  await ledger.recover("grand", host);
  expect(f.writes).toHaveLength(beforeRecover);
  console.log("CC5CH archive receipt", JSON.stringify({ writes: f.writes.length,
    queue: ref.current[0].queuedMessages?.map(message => message.id) ?? [],
    persistedQueue: f.writes.at(-1).session.queuedMessages?.map((message: { id: string }) => message.id) ?? [],
    queueStatus: ref.current[0].queueStatus, deliveryPending: ledger.deliveryPending("grand", "archive-request") }));
  for (const session of [ref.current[0], f.writes.at(-1).session]) {
    expect((session.queuedMessages ?? []).filter((message: { id: string }) => message.id === receiptId)).toHaveLength(1);
    expect(session.queueStatus).toBe("paused");
    expect(canDispatchQueuedHead(session)).toBe(false);
  }
  expect(ref.current[0]).toMatchObject({ busy: false, turnReady: false });
  expect(ledger.goals("grand")[0].state).toBe("queued");
});

it.each([false, true])("actual store observer autosave preserves acknowledged goal origin and answer bytes; hidden busy=%s", async hidden => {
  const f = fixture("absent");
  const original = (await getSession(f.session.id))!;
  const store = new SessionStateStore([original]);
  const latestText = "Observed ordinary answer update [] ;";
  store.setState(sessions => sessions.map(session => ({ ...session, busy: hidden,
    blocks: session.blocks.map(block => block.id === "chat-answer-9" ? { ...block, text: latestText } : block) })), true);
  const deferred = exactDeferredPersist(store.ref, original, store, hidden);
  f.hold();
  const savingOrigin = exactUpdate(store.ref, undefined, store.setState)(session => appendMonoGoalOrigin(session, submission, goal.title));
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  deferred();
  const savingOrdinary = flushSessionWrites();
  f.release();
  await Promise.all([savingOrigin, savingOrdinary]);
  await flushSessionWrites();
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.disk().find(block => block.id === "chat-answer-9")?.text).toBe(latestText);
  expect(store.session(original.id)?.blocks.filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(store.session(original.id)?.blocks.find(block => block.id === "chat-answer-9")?.text).toBe(latestText);
  expect(store.ref.current).toBe(store.snapshot());
});
