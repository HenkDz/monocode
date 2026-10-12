// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { formatSessionTitle, HARNESS_LABEL, newSession, sessionDisplayTitle, sessionWorkCwd, type Block, type HarnessId, type Session } from "../../features/sessions/model/session";
import * as migration from "../../features/monos/model/monoWorkingDirectoryMigration";
import { assertMonoRotationCurrent, loadMonoRotation, MONO_ROTATION_READ_ERROR } from "../../features/monos/model/monoRotation";
import { sameProviderAccountId } from "../../features/providers/model/providerAccounts";
import { canResumeMonoAfterCwdChange } from "../../integrations/harness/providers/monoCwdResume";
import { buildPiSpawnArgs } from "../../integrations/harness/providers/pi/piProtocol";
import { PI_FLAVOR, OMP_FLAVOR } from "../../integrations/harness/providers/pi/piFlavor";
import { HarnessEventQueue } from "./harnessFlush";
import { applyHarnessEvents } from "../../integrations/harness/core/apply";
import { bindTurnContextProfile } from "../../integrations/harness/core/contextProfile";
import { dropContextWindow } from "../../features/sessions/model/contextUsage";
import { isPreparingHandoff, planComposerSwitch } from "../../features/sessions/model/handoff";
import { preferredModelSettings, resolveModel } from "../../features/sessions/model/models";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["withHarnessChoice", "sameSettings"].includes(node.name?.text ?? "")) {
    callbacks.set(node.name!.text, node.getText(app));
  }
  if (ts.isVariableDeclaration(node) && ["upsertSession", "persistSession", "onModelChange"].includes(node.name.getText(app)) &&
      node.initializer && ts.isCallExpression(node.initializer)) {
    callbacks.set(node.name.getText(app), node.initializer.arguments[0].getText(app));
  }
  if (ts.isObjectLiteralExpression(node) && node.properties.some(property =>
      ts.isPropertyAssignment(property) && property.name.getText(app) === "onAccepted" &&
      property.initializer.getText(app).includes("acceptMonoWorkingDirectoryMigration"))) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && ["prepareText", "onAccepted"].includes(property.name.getText(app)))
        callbacks.set(property.name.getText(app), property.initializer.getText(app));
    }
  }
  ts.forEachChild(node, visit);
}
visit(app);

function callback<T>(name: string, dependencies: Record<string, unknown>): T {
  const source = callbacks.get(name);
  expect(source, `App callback ${name}`).toBeDefined();
  const code = ts.transpileModule(`return (${source});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as T;
}

const lifecycleSource = ts.createSourceFile("appLifecycle.ts", readFileSync("src/app/model/appLifecycle.ts", "utf8"), ts.ScriptTarget.Latest, true);
const bindSource = lifecycleSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "bindResumedSessions")!;
const bindCode = ts.transpileModule(`${bindSource.getText(lifecycleSource).replace(/^export /, "")}\nreturn bindResumedSessions;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(ready => { resolve = ready; });
  return { promise, resolve };
}

async function settle() {
  for (let step = 0; step < 20; step++) await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function fixture(harness: HarnessId = "pi") {
  vi.resetModules();
  const store = await import("../../features/sessions/data/sessionStore");
  const history: Block = { id: "historical-user", role: "user", text: "Keep older history" };
  const original: Session = { ...newSession(harness, "/scratch/grand/workspace"), id: "chat", providerSessionId: "old-native",
    runtimeMode: "auto", runtimeModeSource: "user", readOnly: true, windowsSandbox: "unelevated",
    providerAccountId: "work", model: `${harness}:original`, blocks: [{ id: "visible-user", role: "user", text: "Relocate this conversation" }],
    monoTranscript: { before: 2, firstBlockId: "visible-user" },
    queuedMessages: [{ id: "queued", text: "Keep queued work", attachments: [] }], queueStatus: "paused" };
  let durable = structuredClone({ ...original, blocks: [history, ...original.blocks] });
  const sessionsRef = { current: [original] };
  const writes: any[] = [];
  let nextWrite: ReturnType<typeof deferred> | "reject" | "null" | undefined;
  invoke.mockImplementation(async (command, args) => {
    if (command === "mono_session_get" || command === "session_get") return structuredClone(durable);
    expect(command).toBe("mono_session_upsert");
    const saved = structuredClone(args);
    writes.push(saved);
    const pending = nextWrite;
    nextWrite = undefined;
    if (pending === "reject") throw Error("Disk full");
    if (pending === "null") return null;
    if (pending) await pending.promise;
    let blocks = durable.blocks;
    if (saved.blocksChanged) {
      const anchor = saved.afterBlockId ?? saved.fromBlockId;
      const index = anchor ? blocks.findIndex(block => block.id === anchor) : -1;
      if (anchor && index < 0) throw Error("Missing native transcript anchor");
      const start = saved.appendOnly ? blocks.length : saved.afterBlockId ? index + 1 : saved.fromBlockId ? index : 0;
      blocks = [...blocks.slice(0, start), ...saved.session.blocks];
    }
    durable = { ...saved.session, blocks };
    return { ...saved.session, createdAt: 1, updatedAt: 2 };
  });
  migration.rememberMonoWorkingDirectoryMigration(original.id, original.providerSessionId);
  const dependencies = { sessionsRef, writeSession: store.writeSession, isMonoSession: () => true, setSessions: vi.fn() };
  const upsert = callback<(session: Session, change?: (current: Session) => Session) => Promise<unknown>>("upsertSession", dependencies);
  const persist = callback<(session: Session) => void>("persistSession", {
    ...dependencies, shouldPersistSession: store.shouldPersistSession, removingSessionIds: { current: new Set() },
    switchingWorktrees: { current: new Set() }, persistFingerprint: store.persistFingerprint, lastPersisted: { current: new Map() },
    sidebarCwdRef: { current: "" }, setHistory: vi.fn(), mergeProjectHistorySummary: vi.fn(),
  });
  const prepareContext = vi.fn(async (text: string) => text);
  const rotationReceipt = loadMonoRotation(original.id);
  const prepare = (provider?: string) => callback<(provider?: string) => Promise<string>>("prepareText", {
    ...dependencies, ...migration, sameProviderAccountId, upsertSession: upsert, current: sessionsRef.current[0], sessionId: original.id,
    contextProvider: undefined, prepareContext, text: "First relocated turn", assertMonoRotationCurrent,
    rotationReceipt,
  })(provider);
  const accepted = callback<() => void>("onAccepted", {
    ...dependencies, ...migration, sessionId: original.id, gen: 1, turnGen: { current: new Map([[original.id, 1]]) },
    contextAccepted: undefined, monoRotation: undefined, editedResend: undefined,
  });
  const queue = new HarnessEventQueue(() => false, batches => {
    sessionsRef.current = sessionsRef.current.map(session => {
      const events = batches.get(session.id);
      return events ? applyHarnessEvents(session, events) : session;
    });
  });
  const bindProfile = bindTurnContextProfile(original);
  const withHarnessChoice = callback<(session: Session, harness: HarnessId, model: string, settings: Record<string, string>) => Session>("withHarnessChoice", {
    HARNESS_LABEL, formatSessionTitle, sessionDisplayTitle, dropContextWindow, sameSettings: callback("sameSettings", {}),
  });
  const chooseModel = callback<(id: string, harness: HarnessId, model: string) => void>("onModelChange", {
    sessionsRef, isPreparingHandoff, resolveModel, monoForSession: () => undefined,
    saveRecentModelChoice: vi.fn(), saveLastModelSettings: vi.fn(), preferredModelSettings,
    planComposerSwitch, withHarnessChoice, setSessions: vi.fn(),
  });
  const transport = vi.fn();
  async function send(provider?: string) {
    if (provider) queue.enqueue(original.id, bindProfile({ type: "session.providerBound", providerSessionId: provider }));
    const text = await prepare(provider);
    transport(text);
    accepted();
  }
  function restartBindings(snapshot = durable) {
    const bindings: unknown[][] = [];
    const bind = new Function("isLiveHarness", "sessionWorkCwd", "bindHarnessSession", bindCode)(
      () => true, sessionWorkCwd, (...args: unknown[]) => bindings.push(args),
    ) as (sessions: Session[]) => void;
    bind([snapshot]);
    return bindings;
  }
  function restart(snapshot = durable) {
    const bindings = restartBindings(snapshot);
    expect(bindings).toHaveLength(1);
    return { sessionId: bindings[0][2] as string, cwd: bindings[0][3] as string, providerAccountId: bindings[0][4] as string };
  }
  return { original, sessionsRef, writes, store, queue, prepare, prepareContext, send, transport, restart, restartBindings, persist, chooseModel,
    durable: () => durable, failNext: (kind: "reject" | "null") => { nextWrite = kind; },
    holdNext: () => { const gate = deferred(); nextWrite = gate; return gate; } };
}

it("refuses dispatch when rotation continuity becomes unreadable after relocation is saved", async () => {
  const f = await fixture();
  f.prepareContext.mockImplementation(async text => {
    localStorage.setItem("monocode:mono-rotations", "{broken");
    return text;
  });
  await expect(f.send("forked-native")).rejects.toThrow(MONO_ROTATION_READ_ERROR);
  expect(f.durable().providerSessionId).toBe("forked-native");
  expect(f.transport).not.toHaveBeenCalled();
  expect(migration.monoWorkingDirectoryMigrationPending(f.original.id)).toBe(true);
});

const providers = [
  ["pi", "forked-native"], ["omp", "forked-native"], ["opencode", "forked-native"],
  ["opencode", "old-native"], ["codex", "old-native"], ["claude", "old-native"],
] as const;

it.each(providers.flatMap(([harness, provider]) => [
  { harness, provider, window: "providerBound still queued" },
  { harness, provider, window: "ordinary save pending after flush" },
]))("keeps $harness native $provider durable across a crash with $window", async ({ harness, provider, window }) => {
  const f = await fixture(harness);
  await f.send(provider);
  let ordinary: ReturnType<typeof deferred> | undefined;
  try {
    if (window === "ordinary save pending after flush") {
      f.queue.flush();
      f.sessionsRef.current = [{ ...f.sessionsRef.current[0], title: "Accepted relocation" }];
      ordinary = f.holdNext();
      f.persist(f.sessionsRef.current[0]);
      await settle();
      expect(f.writes.at(-1).session.providerSessionId).toBe(provider);
    }
    // A crash retains only completed native writes and the migration receipt.
    const recovered = f.restart(structuredClone(f.durable()));
    expect(migration.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(false);
    expect(recovered).toEqual({ sessionId: provider, cwd: f.original.cwd, providerAccountId: "work" });
    const fork = canResumeMonoAfterCwdChange({ sessionId: "chat", cwd: f.original.cwd, monoSession: true, providerAccountId: "work" }, recovered);
    expect(fork).toBe(false);
    expect(buildPiSpawnArgs(PI_FLAVOR, { resume: recovered.sessionId, fork })).toEqual(["--mode", "rpc", "--session", provider]);
    expect(buildPiSpawnArgs(OMP_FLAVOR, { resume: recovered.sessionId, fork })).toEqual(["--mode", "rpc", "--resume", provider]);
    expect(f.transport).toHaveBeenCalledOnce();
  } finally {
    f.queue.cancelScheduled();
    ordinary?.resolve();
    await f.store.flushSessionWrites();
  }
});

it.each(["reject", "null"] as const)("blocks the first prompt and retains recovery when saving returns %s", async failure => {
  const f = await fixture();
  f.failNext(failure);
  try {
    await expect(f.send("forked-native")).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.prepareContext).not.toHaveBeenCalled();
    expect(f.durable().providerSessionId).toBe("old-native");
    expect(migration.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(true);
    const recovered = f.restart();
    expect(canResumeMonoAfterCwdChange({ sessionId: "chat", cwd: f.original.cwd, monoSession: true, providerAccountId: "work" }, recovered)).toBe(true);
  } finally { f.queue.cancelScheduled(); }
});

it("blocks the first prompt when its recovery receipt cannot be read", async () => {
  const f = await fixture();
  const read = vi.spyOn(localStorage, "getItem").mockImplementationOnce(() => { throw Error("Receipt unavailable"); });
  try {
    await expect(f.send("forked-native")).rejects.toThrow("Receipt unavailable");
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.durable().providerSessionId).toBe("old-native");
  } finally {
    read.mockRestore();
    f.queue.cancelScheduled();
  }
  expect(migration.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(true);
});

it("retries durability after a failed save even when the event queue has published the fork ID", async () => {
  const f = await fixture();
  f.failNext("reject");
  try {
    await expect(f.send("forked-native")).rejects.toThrow("Disk full");
    f.queue.flush();
    expect(f.sessionsRef.current[0].providerSessionId).toBe("forked-native");
    expect(f.durable().providerSessionId).toBe("old-native");
    await f.send("forked-native");
    expect(f.durable().providerSessionId).toBe("forked-native");
    expect(f.writes).toHaveLength(2);
    expect(f.transport).toHaveBeenCalledOnce();
    expect(migration.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(false);
  } finally { f.queue.cancelScheduled(); }
});

it.each((["harness", "account"] as const).flatMap(choice => [
  { choice, order: "flush before choice" }, { choice, order: "choice before flush" },
]))("keeps a changed $choice choice with $order while the native binding save is pending", async ({ choice, order }) => {
  const f = await fixture();
  const saving = f.holdNext();
  const sending = f.send("forked-native");
  await settle();
  if (order === "flush before choice") f.queue.flush();
  const changed: Session = { ...f.sessionsRef.current[0], providerSessionId: undefined,
    ...(choice === "harness" ? { harness: "claude", providerAccountId: undefined } : { providerAccountId: "other-work" }) };
  f.sessionsRef.current = [changed];
  saving.resolve();
  try {
    await expect(sending).rejects.toThrow("provider changed");
    f.queue.flush();
    expect(f.sessionsRef.current[0]).toEqual(changed);
    expect(f.transport).not.toHaveBeenCalled();
    expect(migration.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(true);
    f.persist(changed);
    await f.store.flushSessionWrites();
    expect(f.durable().harness).toBe(changed.harness);
    expect(f.durable().providerAccountId).toBe(changed.providerAccountId);
    expect(f.durable().providerSessionId).toBeUndefined();
    expect(f.restartBindings()).toEqual([]);
  } finally { f.queue.cancelScheduled(); }
});

it.each((["pi", "omp", "opencode"] as const).flatMap(harness => [
  { harness, order: "flush before choice" }, { harness, order: "choice before flush" },
]))("actual picker from $harness preserves its choice with $order through failure flush, save and restart", async ({ harness, order }) => {
  const f = await fixture(harness);
  const unrelated = { ...newSession("claude", "/other"), id: "unrelated", providerSessionId: "other-native" };
  f.sessionsRef.current = [{ ...f.original, busy: true }, unrelated];
  const saving = f.holdNext();
  const sending = f.send("forked-native").finally(() => f.queue.flush());
  await settle();
  if (order === "flush before choice") f.queue.flush();
  f.chooseModel("chat", "claude", "claude:sonnet");
  const chosen = f.sessionsRef.current[0];
  expect(chosen.providerSessionId).toBeUndefined();
  expect(chosen.pendingSwitch).toMatchObject({ from: harness, fromProviderAccountId: "work",
    fromProviderSessionId: order === "flush before choice" ? "forked-native" : "old-native" });
  saving.resolve();
  try {
    await expect(sending).rejects.toThrow("provider changed");
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.sessionsRef.current).toEqual([chosen, unrelated]);
    expect(migration.monoWorkingDirectoryMigrationPending("chat")).toBe(true);
    f.persist(f.sessionsRef.current[0]);
    await f.store.flushSessionWrites();
    const hydrated = await f.store.readPersistedSession("chat");
    expect(hydrated).toMatchObject({ harness: "claude",
      runtimeMode: "auto", runtimeModeSource: "user", readOnly: true, windowsSandbox: "unelevated",
      queueStatus: "paused", queuedMessages: f.original.queuedMessages,
      blocks: [{ id: "historical-user" }, ...f.original.blocks] });
    expect(hydrated?.providerSessionId).toBeUndefined();
    expect(f.restartBindings(hydrated!)).toEqual([]);
  } finally { f.queue.cancelScheduled(); }
});

it.each(["pi", "omp", "opencode"] as const)("actual %s model picker retains a same-account binding and latest controls", async harness => {
  const f = await fixture(harness);
  f.sessionsRef.current = [{ ...f.original, busy: true }];
  const saving = f.holdNext();
  const sending = f.send("forked-native");
  await settle();
  f.chooseModel("chat", harness, resolveModel(harness).id);
  f.sessionsRef.current = [{ ...f.sessionsRef.current[0], modelSettings: { effort: "high" }, runtimeMode: "full-access" }];
  const chosen = f.sessionsRef.current[0];
  saving.resolve();
  try {
    await sending;
    f.queue.flush();
    expect(f.sessionsRef.current[0]).toEqual({ ...chosen, providerSessionId: "forked-native" });
    f.persist(f.sessionsRef.current[0]);
    await f.store.flushSessionWrites();
    const hydrated = await f.store.readPersistedSession("chat");
    expect(hydrated).toMatchObject({ providerSessionId: "forked-native", model: chosen.model,
      modelSettings: chosen.modelSettings, runtimeMode: "full-access", readOnly: true, windowsSandbox: "unelevated",
      queuedMessages: f.original.queuedMessages, blocks: [{ id: "historical-user" }, ...f.original.blocks] });
    expect(f.restart(hydrated!)).toEqual({ sessionId: "forked-native", cwd: f.original.cwd, providerAccountId: "work" });
    expect(f.transport).toHaveBeenCalledOnce();
    expect(migration.monoWorkingDirectoryMigrationPending("chat")).toBe(false);
  } finally { f.queue.cancelScheduled(); }
});

it("waits behind ordinary persistence and saves the latest profile, transcript page and queue before prompting", async () => {
  const f = await fixture();
  const ordinary = f.holdNext();
  f.persist(f.original);
  await settle();
  expect(f.writes).toHaveLength(1);
  const sending = f.send("forked-native");
  await settle();
  try {
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.prepareContext).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(1);
    f.sessionsRef.current = [{ ...f.sessionsRef.current[0], model: "pi:latest-user-choice", runtimeMode: "full-access",
      blocks: [...f.original.blocks, { id: "concurrent-answer", role: "assistant", text: "Keep concurrent output" }],
      queuedMessages: [{ id: "concurrent-queue", text: "Keep latest queued work", attachments: [] }] }];
  } finally { ordinary.resolve(); }
  await sending;
  f.queue.cancelScheduled();
  expect(f.durable()).toMatchObject({ providerSessionId: "forked-native", model: "pi:latest-user-choice", runtimeMode: "full-access",
    queueStatus: "paused", queuedMessages: [{ id: "concurrent-queue" }],
    blocks: [{ id: "historical-user" }, { id: "visible-user" }, { id: "concurrent-answer" }] });
  expect(f.sessionsRef.current[0]).toMatchObject({ providerSessionId: "forked-native", model: "pi:latest-user-choice",
    monoTranscript: f.original.monoTranscript, queuedMessages: [{ id: "concurrent-queue" }] });
  expect(f.writes).toHaveLength(2);
  expect(f.transport).toHaveBeenCalledOnce();
});

it("saves same-ID relocations before prompting and stops adding binding writes after acceptance", async () => {
  const f = await fixture("codex");
  const saving = f.holdNext();
  const first = f.send("old-native");
  await settle();
  try {
    expect(f.writes).toHaveLength(1);
    expect(f.transport).not.toHaveBeenCalled();
    expect(migration.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(true);
  } finally { saving.resolve(); }
  await first;
  await f.send("old-native");
  f.queue.cancelScheduled();
  expect(f.writes).toHaveLength(1);
  expect(f.transport).toHaveBeenCalledTimes(2);
});
