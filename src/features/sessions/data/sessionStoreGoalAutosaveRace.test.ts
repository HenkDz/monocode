import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { newSession, type Block, type Session } from "../model/session";
import { isMonoSession } from "../../monos/model/mono";
import { appendMonoGoalCard, appendMonoGoalOrigin, type MonoGoalSubmission } from "../../monos/model/monoGoalRouting";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
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

function exactUpdate(sessionsRef: { current: Session[] }, history?: Block[]) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("    const update = async (change: (session: Session) => Session) => {");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("    return submitMonoGoal(", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn update;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("sessionsRef", "setSessions", "sessionId", "writeSession",
    "history", "getMonoGoalRecoveryBlocks", "mergeMonoGoalRecoverySession", "monoGoalRecoveryLiveSession", code)(
    sessionsRef, () => {}, sessionsRef.current[0].id, writeSession,
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

function exactDeferredPersist(sessionsRef: { current: Session[] }, original: Session) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("  useEffect(() => {\n    const liveIds = new Set(sessions.map");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("  }, [persistSession, sessions]);", start) + "  }, [persistSession, sessions]);".length;
  const code = ts.transpileModule(app.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let timer!: () => void;
  const session = sessionsRef.current[0];
  const lastUserId = (entry: Session) => [...entry.blocks].reverse().find(block => block.role === "user")?.id;
  new Function("useEffect", "sessions", "tabsRef", "openSessionIds", "removingSessionIds", "switchingWorktrees",
    "observedSessions", "lastBoundProvider", "lastUserBlockId", "lastPersistedUserBlock", "shouldPersistSession",
    "persistSession", "pendingPersist", "lastPersisted", "window", code)(
    (effect: () => void) => effect(), [session], { current: [] }, () => new Set([session.id]),
    { current: new Set() }, { current: new Set() }, { current: new Map([[session.id, original]]) },
    { current: new Map() }, lastUserId, { current: new Map([[session.id, lastUserId(original)]]) }, shouldPersistSession,
    exactOrdinaryPersist(sessionsRef, original), { current: new Map() }, { current: new Map([[session.id, persistFingerprint(original)]]) },
    { setTimeout: (callback: () => void, delay: number) => { expect(delay).toBe(650); timer = callback; }, clearTimeout: () => {} },
  );
  expect(timer).toBeTypeOf("function");
  return () => timer();
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
  const ref = { current: [(await getSession(f.session.id))!] };
  const original = ref.current[0];
  if (writer === "deferred autosave") ref.current = [{ ...original, blocks: original.blocks.map((block, index) =>
    index === original.blocks.length - 1 ? { ...block, text: "Observed ordinary answer update" } : block) }];
  const update = exactUpdate(ref);
  const persistOrdinary = writer === "deferred autosave" ? exactDeferredPersist(ref, original) : exactOrdinaryPersist(ref, original);
  f.hold();
  const writing = update(session => appendMonoGoalOrigin(session, submission, goal.title));
  await vi.waitFor(() => expect(f.writes).toHaveLength(1));
  // Queue persistence is requested while the native origin write is still pending.
  const ordinary = writer === "new turn" ? { ...ref.current[0], blocks: [...ref.current[0].blocks,
    { id: "ordinary-later-user", role: "user" as const, text: "Continue ordinary chat" }] }
    : writer === "queue" ? { ...ref.current[0], queueStatus: "paused" as const,
      queuedMessages: [{ id: "ordinary-queued-message", text: "Ordinary queued chat", attachments: [] }] }
    : ref.current[0];
  ref.current = [ordinary];
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
