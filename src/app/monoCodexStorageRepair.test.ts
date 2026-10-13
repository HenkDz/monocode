import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoCodexStorageRecovery, isCodexStorageError, parseCodexStorageConflict, parseCodexStorageRecoveryConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings, codexFullAccessRepairAllowed } from "../features/monos/model/monoCodexStorage";
import type { Session } from "../features/sessions/model/session";
import { codexStorageAccountId } from "../features/monos/model/monoCodexStorageIssues";
import { sessionWriteNeedsReconciliation, shouldPersistSession } from "../features/sessions/data/sessionStore";
import { selectCodexStorageHome } from "../features/monos/model/monoCodexHomes";
import { loadMonoRotation, MONO_ROTATION_READ_ERROR } from "../features/monos/model/monoRotation";
import { markHabitRun, clearHabitRun, habitRunMono } from "../features/monos/model/monoHabits";
import { submitWithSettlement } from "./model/managedSubmission";

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

const app = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function appCallback(name: string): ts.ArrowFunction {
  let callback: ts.ArrowFunction | undefined;
  function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === name && node.initializer &&
      ts.isCallExpression(node.initializer) && ts.isArrowFunction(node.initializer.arguments[0]))
      callback = node.initializer.arguments[0];
    ts.forEachChild(node, walk);
  }
  walk(app);
  if (!callback) throw new Error(`App callback missing: ${name}`);
  return callback;
}

function evaluate(source: string, context: Record<string, unknown>) {
  const output = ts.transpileModule(`(${source})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return runInNewContext(output, { turnGen: { current: new Map() }, ...context, Error });
}

it("reveals recovery storage for the held account without forwarding recovery paths", async () => {
  const sessionsRef = { current: [{ id: "recovery", cwd: "/synthetic/repo", providerAccountId: "new-account",
    codexStorageAccountId: "held-account", codexStorageError: `Codex storage needs repair: ${JSON.stringify({
      recovery: true, reason: "Both versions were preserved", paths: ["/untrusted/recovery/path"],
    })}` }] };
  const invoke = vi.fn();
  const reveal = evaluate(appCallback("onCodexStorageReveal").getText(app), {
    sessionsRef, parseCodexStorageConflict, parseCodexStorageRecoveryConflict, codexStorageAccountId,
    selectedProviderAccountId: () => "selected-account", invoke,
  });
  await reveal("recovery");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_store_reveal", {
    providerAccountId: "held-account", entry: ".monocode-recovery",
  });
  await expect(reveal("missing")).rejects.toThrow("The storage issue is no longer available.");
  expect(invoke).toHaveBeenCalledTimes(1);
});

const submission = appCallback("submitSession");
if (!ts.isBlock(submission.body)) throw new Error("App submission body missing");
const transportStart = submission.body.statements.findIndex(statement => ts.isExpressionStatement(statement) &&
  ts.isCallExpression(statement.expression) && statement.expression.expression.getText(app) === "flushHarnessEvents");
if (transportStart < 0) throw new Error("App submission preflight boundary missing");
// Working-folder preparation has its own tests; exercise the downstream storage guards.
const guardedSubmission = `(${submission.parameters.map(parameter => parameter.getText(app)).join(", ")}) => {
  options = { ...options, monoWorkingDirectoryPrepared: true };
  ${submission.body.statements.slice(0, transportStart).map(statement => statement.getText(app)).join("\n")}
  return acceptSubmission(sessionId, text, attachments);
}`;

it.each(["relink", "first replay"])("unblocks a late account member during %s before App's submission guard", async phase => {
  const error = "Codex storage needs repair: hooks conflict";
  const recovery = new MonoCodexStorageRecovery();
  const sessionsRef = { current: [
    { id: "first", harness: "codex", cwd: "/synthetic/repo", blocks: [], busy: false, codexStorageError: error, codexStoragePreparing: undefined, providerAccountId: "account" },
    { id: "second", harness: "codex", cwd: "/synthetic/repo", blocks: [], busy: true, codexStorageError: undefined, codexStoragePreparing: undefined, providerAccountId: "account" },
    { id: "other", harness: "codex", cwd: "/synthetic/repo", blocks: [], busy: false, codexStorageError: error, codexStoragePreparing: undefined, providerAccountId: "other-account" },
  ] };
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const prepare = vi.fn(async () => {
    if (phase === "relink" && prepare.mock.calls.length === 1) {
      entered();
      await gate;
    }
  });
  const sent: { sessionId: string; text: string; attachments: unknown[] }[] = [];
  const acceptSubmission = vi.fn(async (sessionId: string, text: string, attachments: unknown[]) => {
    expect(sessionsRef.current.find(session => session.id === sessionId)?.codexStorageError).toBeUndefined();
    sent.push({ sessionId, text, attachments });
    if (phase === "first replay" && sessionId === "first") {
      entered();
      await gate;
    }
    return true;
  });
  const context = {
    sessionWriteNeedsReconciliation,
    sessionsRef, codexStorageRecovery: { current: recovery }, codexStorageAccountId,
    loadMonoRotation, MONO_ROTATION_READ_ERROR,
    isCodexStorageError, parseCodexStorageConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings, IS_WIN: true,
    orchestrator: { forSession: () => undefined },
    monoSkillsForSession: () => ({ skillsRole: "manager", skillsPolicy: { mode: "role" } }),
    sessionWorkCwd: (session: { cwd: string }) => session.cwd,
    remoteProjectFor: () => undefined, selectedProviderAccountId: () => "account",
    queuedHead: () => undefined, monoForSession: () => ({ id: "mono" }), listMonos: () => [],
    isProjectManager: () => false, editedResends: { isActive: () => false },
    flushSync: (action: () => void) => action(),
    setSessions: (update: (sessions: typeof sessionsRef.current) => typeof sessionsRef.current) => {
      sessionsRef.current = update(sessionsRef.current);
    },
    setQueueDispatchVersion: vi.fn(), setCodexStorageRepaired: vi.fn(),
    prepareMonoCodexStore: prepare, adoptCodexStorageHome: async () => {}, invoke: vi.fn(), acceptSubmission,
    submitSessionRef: { current: undefined as unknown },
  };
  const submit = evaluate(guardedSubmission, context);
  context.submitSessionRef.current = submit;
  const attachments = [{ name: "brief.txt", path: "/synthetic/brief.txt" }];
  recovery.hold("first", () => submit("first", "First held prompt", attachments, { managed: true, codexStorageResuming: true }));
  recovery.hold("other", vi.fn());
  const repair = evaluate(appCallback("onCodexStorageRepair").getText(app), context);
  const first = repair("first");
  await waiting;
  sessionsRef.current = sessionsRef.current.map(session => session.id === "second"
    ? { ...session, busy: false, codexStorageError: error } : session);
  // The real App guard rejects B until repair clears its newly arrived error.
  expect(submit("second", "Second held prompt", attachments, { managed: true, codexStorageResuming: true })).toBe(false);
  recovery.hold("second", () => submit("second", "Second held prompt", attachments, { managed: true, codexStorageResuming: true }));
  const second = repair("second");
  release();
  const outcomes = await Promise.allSettled([first, second]);
  expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
  expect(sent).toEqual([
    { sessionId: "first", text: "First held prompt", attachments },
    { sessionId: "second", text: "Second held prompt", attachments },
  ]);
  for (const sessionId of ["first", "second"]) {
    expect(recovery.hasPending(sessionId)).toBe(false);
    expect(sessionsRef.current.find(session => session.id === sessionId)).toMatchObject({
      codexStorageError: undefined, codexStoragePreparing: undefined,
    });
  }
  expect(recovery.hasPending("other")).toBe(true);
  expect(sessionsRef.current.find(session => session.id === "other")?.codexStorageError).toBe(error);
  expect(recovery.isRepairingAccount("account")).toBe(false);
});

const sandboxDetail = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Sandbox machine account is disabled", setupCommand: "codex sandbox -P :workspace -- echo ready" })}`;
function sandboxRepairFixture(extra: Partial<Session> = {}) {
  const session = (id: string, accountId: string): Session => ({ id, harness: "codex", cwd: "/synthetic/repo", model: "synthetic", modelSettings: {},
    title: id, blocks: [], runtimeMode: "supervised", providerAccountId: accountId, codexStorageAccountId: accountId, codexStorageError: sandboxDetail });
  const sessionsRef = { current: [{ ...session("clicked", "account"), ...extra }, session("peer", "account"), session("other", "other-account")] };
  const recovery = new MonoCodexStorageRecovery();
  const retry = vi.fn<() => boolean | Promise<boolean>>(() => true), peerRetry = vi.fn(() => true), otherRetry = vi.fn(() => true);
  recovery.hold("clicked", retry); recovery.hold("peer", peerRetry); recovery.hold("other", otherRetry);
  const stop = vi.fn(async (_harness: string, _sessionId: string) => {}), prepare = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}), persist = vi.fn(async (session?: Session, change?: (session: Session) => Session) => {
    if (session && change) sessionsRef.current = sessionsRef.current.map(current => current.id === session.id ? change(current) : current);
    return {};
  }), saveMode = vi.fn();
  const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ configPath: "/synthetic/private/config.toml", backupPaths: ["/synthetic/private/config.backup"] }));
  const context = {
    sessionsRef, codexStorageRecovery: { current: recovery }, codexStorageAccountId, isCodexStorageError,
    parseCodexStorageConflict, parseCodexStorageRecoveryConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings, codexFullAccessRepairAllowed, IS_WIN: true,
    monoSkillsForSession: () => ({ skillsRole: "manager", skillsPolicy: { mode: "role" } }),
    sessionWorkCwd: (current: Session) => current.cwd, orchestrator: { forSession: () => undefined },
    remoteProjectFor: (cwd: string) => cwd.startsWith("remote:") ? {} : undefined,
    selectedProviderAccountId: () => "account", queuedHead: () => undefined,
    monoForSession: (id: string) => ({ id: `mono-${id}` }), saveMonoRuntimeMode: saveMode,
    stopHarnessSession: stop, upsertSession: persist, crypto: { randomUUID: () => "sandbox-choice-receipt" },
    flushSync: (action: () => void) => action(),
    setSessions: (update: (sessions: Session[]) => Session[]) => { sessionsRef.current = update(sessionsRef.current); },
    setQueueDispatchVersion: vi.fn(), setCodexStorageRepaired: vi.fn(), prepareMonoCodexStore: prepare,
    prepareCodexMonoContext: prepare, resolveCodexBinary: async () => ({ path: "/synthetic/codex.exe" }), invoke,
    checkMonoCodexSandbox: prepare,
    writeSession: async (_id: string, action: (save: (session: Session) => Promise<unknown>) => Promise<unknown>) => action(persist),
    onCodexStorageRepair: vi.fn(async () => {}),
    selectCodexStorageHome, shouldPersistSession, turnGen: { current: new Map<string, number>() },
    forgetHarnessSession: vi.fn(async () => {}), bindHarnessSession: vi.fn(),
    adoptCodexStorageHome: undefined as unknown as (session: Session, prepared: unknown) => Promise<void>,
  };
  context.adoptCodexStorageHome = evaluate(appCallback("adoptCodexStorageHome").getText(app), context);
  const repair = evaluate(appCallback("onCodexStorageRepair").getText(app), context);
  return { ...context, repair, recovery, retry, peerRetry, otherRetry, stop, prepare, persist, saveMode };
}

it.each([{ ephemeral: true }, { inboxAsk: {} }, {}])("prepares an unsaved owned conversation in memory (%j)", async extra => {
  const fixture = sandboxRepairFixture({ ...extra, codexStorageError: undefined } as Partial<Session>);
  fixture.persist.mockResolvedValueOnce(null as never);
  const prepared = { home: "/synthetic/original-mono", originalHome: "/synthetic/original-mono", threadId: null };
  await fixture.adoptCodexStorageHome(fixture.sessionsRef.current[0], prepared);
  expect(fixture.sessionsRef.current[0].codexStorageHome).toBe(prepared.home);
  expect(fixture.persist).not.toHaveBeenCalled();
});

it("offers explicit return after successful preparation of an already bound separate home", async () => {
  const fixture = sandboxRepairFixture({ blocks: [{ id: "u", role: "user", text: "Saved" }], codexStorageError: undefined });
  const returnChoice = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Return is available", paths: ["/synthetic/original-mono"], sourceBinding: {
    resolvedSourceHome: "/synthetic/original", boundSourceHome: "/synthetic/original", canBind: false, canReturn: true, sourceIdentity: "1:9",
  } })}`;
  await fixture.adoptCodexStorageHome(fixture.sessionsRef.current[0], { home: "/synthetic/separate", originalHome: "/synthetic/original-mono", threadId: null, returnChoice });
  expect((fixture.sessionsRef.current[0] as Session & { codexStorageReturnChoice?: string }).codexStorageReturnChoice).toBe(returnChoice);
  expect(fixture.sessionsRef.current[0].codexStorageError).toBeUndefined();
});

it.each(["habit", "owned-worker"])("continues actual App preparation for a fresh %s first send without persistence or a model call", async kind => {
  const fixture = sandboxRepairFixture({ ephemeral: kind === "habit", codexStorageError: undefined });
  const owner = { id: "owner", sessionId: "resident", projects: ["/synthetic/repo"] };
  if (kind === "habit") markHabitRun("clicked", owner.id);
  const accepted = vi.fn((_id, _text, _attachments, options) => {
    options?.onSettled?.({ status: "completed", text: "Synthetic acceptance only" });
    return true;
  });
  const context = { ...fixture, habitRunMono, findMono: () => owner, listMonos: () => [owner], monoForSession: () => undefined,
    orchestrator: { forSession: () => kind === "owned-worker" ? { ownerMonoId: owner.id } : undefined },
    sessionWriteNeedsReconciliation, loadMonoRotation, MONO_ROTATION_READ_ERROR,
    isProjectManager: () => false, editedResends: { isActive: () => false },
    acceptSubmission: (id: string, text: string, attachments: unknown[]) => accepted(id, text, attachments, settlement),
    submitSessionRef: { current: undefined as unknown }, submitWithSettlement,
  };
  const submit = evaluate(guardedSubmission, context);
  context.submitSessionRef.current = submit;
  fixture.prepare.mockResolvedValue({ home: "/synthetic/original-mono", originalHome: "/synthetic/original-mono", threadId: null } as never);
  let settlement: { onSettled?: (value: unknown) => void } = {};
  try {
    if (kind === "habit") {
      let run: ts.Node | undefined;
      const walk = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(app) === "useMonoHabits" && ts.isObjectLiteralExpression(node.arguments[0])) {
          run = node.arguments[0].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(app) === "run");
        }
        ts.forEachChild(node, walk);
      };
      walk(app);
      if (!run || !ts.isPropertyAssignment(run)) throw new Error("Actual habit submit adapter missing");
      const habitSubmit = evaluate(run.initializer.getText(app), { submitWithSettlement, submitSession: (id: string, text: string, attachments: unknown[], options: typeof settlement) => {
        settlement = options; return submit(id, text, attachments, options);
      } });
      await expect(habitSubmit("clicked", "/operator Exact synthetic habit")).resolves.toMatchObject({ status: "completed" });
    } else await expect(submit("clicked", "First owned worker prompt", [], { managed: true })).resolves.toBe(true);
    expect(accepted).toHaveBeenCalledOnce();
    expect(fixture.prepare).toHaveBeenCalledOnce();
    expect(fixture.persist).not.toHaveBeenCalled();
    expect(fixture.sessionsRef.current[0]).toMatchObject({ codexStorageHome: "/synthetic/original-mono" });
    expect(fixture.sessionsRef.current[0].blocks).toEqual([]);
  } finally { clearHabitRun("clicked"); }
});

it("refuses a persistable conversation whose home selection cannot be saved", async () => {
  const fixture = sandboxRepairFixture({ blocks: [{ id: "u", role: "user", text: "Stored prompt" }] });
  fixture.persist.mockResolvedValueOnce(null as never);
  await expect(fixture.adoptCodexStorageHome(fixture.sessionsRef.current[0], { home: "/synthetic/original-mono", originalHome: "/synthetic/original-mono", threadId: null })).rejects.toThrow("could not be saved");
  expect(fixture.sessionsRef.current[0].codexStorageHome).toBeUndefined();
  expect(fixture.bindHarnessSession).not.toHaveBeenCalled();
});

it.each([false, true])("preserves the displayed opaque map before saving current edits; stale record refusal=%s", async stale => {
  const expected = { sessionId: "clicked", identity: "row:created", fingerprint: "stored-record", cwd: "/synthetic/repo", providerAccountId: "account", home: "/synthetic/home" };
  const detail = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Edits are not saved", paths: [expected.home], homeThreads: expected })}`;
  const fixture = sandboxRepairFixture({ codexHomeThreadsUnresolved: true, codexHomeThreadsRecovery: expected, codexStorageError: detail,
    codexStorageHome: expected.home, title: "Unsaved title", providerSessionId: "current-thread", blocks: [{ id: "draft", role: "user", text: "Unsaved draft", draft: true }],
    queuedMessages: [{ id: "q", text: "Unsaved queued Plan", attachments: [], intent: "plan" }] });
  const original = structuredClone(fixture.sessionsRef.current[0]);
  if (stale) fixture.invoke.mockRejectedValueOnce(new Error("Stored record changed"));
  else fixture.invoke.mockResolvedValueOnce("/synthetic/preserved/model-settings.json");
  if (stale) {
    await expect(fixture.repair("clicked", "preserve_home_threads")).rejects.toThrow("record changed");
    expect(fixture.sessionsRef.current[0]).toEqual(original);expect(fixture.persist).not.toHaveBeenCalled();
  } else {
    await fixture.repair("clicked", "preserve_home_threads");
    expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("mono_session_preserve_home_threads", { expected });
    expect(fixture.invoke.mock.invocationCallOrder[0]).toBeLessThan(fixture.persist.mock.invocationCallOrder[0]);
    expect(fixture.sessionsRef.current[0]).toMatchObject({ title: original.title, providerSessionId: original.providerSessionId,
      queuedMessages: original.queuedMessages, codexHomeThreadsUnresolved: undefined });
    expect(fixture.sessionsRef.current[0].blocks[0]).toEqual(original.blocks[0]);
    expect(fixture.onCodexStorageRepair).toHaveBeenCalledExactlyOnceWith("clicked");
  }
});

it("archives incomplete metadata for the held account before retrying its preserved submissions", async () => {
  const metadata = { path: "/synthetic/private/.monocode-txn-id.json.pending", identity: "1:2", fingerprint: "hash" };
  const codexStorageError = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Incomplete metadata", paths: [metadata.path], metadata })}`;
  const fixture = sandboxRepairFixture({ codexStorageError });
  fixture.invoke.mockResolvedValueOnce("/synthetic/private/.monocode-preserved-transactions/metadata");
  await fixture.repair("clicked", "preserve_recovery_metadata");
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_store_preserve_recovery", { providerAccountId: "account", metadata });
  expect(fixture.invoke.mock.invocationCallOrder[0]).toBeLessThan(fixture.prepare.mock.invocationCallOrder[0]);
  expect(fixture.retry).toHaveBeenCalledOnce();
  expect(fixture.peerRetry).toHaveBeenCalledOnce();
  expect(fixture.otherRetry).not.toHaveBeenCalled();
  expect(fixture.stop).not.toHaveBeenCalled();
  expect(fixture.saveMode).not.toHaveBeenCalled();
  expect(fixture.sessionsRef.current.find(session => session.id === "clicked")?.blocks[0].text).toContain("/synthetic/private/.monocode-preserved-transactions/metadata");
});

it("holds recovery submissions when metadata is stale or archival fails", async () => {
  for (const hasMetadata of [false, true]) {
    const codexStorageError = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Incomplete metadata", paths: ["/synthetic/private/metadata"],
      ...(hasMetadata ? { metadata: { path: "/synthetic/private/metadata", identity: "1:2", fingerprint: "hash" } } : {}) })}`;
    const fixture = sandboxRepairFixture({ codexStorageError });
    fixture.invoke.mockRejectedValueOnce(new Error(codexStorageError));
    await expect(fixture.repair("clicked", "preserve_recovery_metadata")).rejects.toThrow();
    expect(fixture.prepare).not.toHaveBeenCalled();
    expect(fixture.retry).not.toHaveBeenCalled();
    expect(fixture.peerRetry).not.toHaveBeenCalled();
    expect(fixture.recovery.hasPending("clicked")).toBe(true);
    expect(fixture.invoke).toHaveBeenCalledTimes(Number(hasMetadata));
  }
});

it("switches the account's private Mono sandbox only on explicit choice, stops idle servers and exposes its backup", async () => {
  const fixture = sandboxRepairFixture();
  expect(fixture.invoke).not.toHaveBeenCalled();
  await fixture.repair("clicked", "use_unelevated_sandbox");
  expect(fixture.stop.mock.calls).toEqual([["codex", "clicked"], ["codex", "peer"]]);
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_use_unelevated_sandbox", { providerAccountId: "account" });
  expect(fixture.stop.mock.invocationCallOrder[1]).toBeLessThan(fixture.invoke.mock.invocationCallOrder[0]);
  const clicked = fixture.sessionsRef.current.find(session => session.id === "clicked")!;
  expect(clicked.blocks[0].text).toContain("Your own Codex config is unchanged");
  expect(clicked.blocks[0].text).not.toContain("/synthetic/account/");
  expect(clicked.blocks[0].text).toContain("/synthetic/private/config.backup");
  expect(clicked.runtimeMode).toBe("supervised");
  expect(fixture.retry).toHaveBeenCalledOnce();
  expect(fixture.peerRetry).toHaveBeenCalledOnce();
  expect(fixture.otherRetry).not.toHaveBeenCalled();
});

it("uses full access and resumes only the clicked Mono, leaving account peers held and restricted", async () => {
  const fixture = sandboxRepairFixture();
  await fixture.repair("clicked", "use_mono_full_access");
  expect(fixture.invoke).not.toHaveBeenCalled();
  expect(fixture.stop).toHaveBeenCalledExactlyOnceWith("codex", "clicked");
  expect(fixture.saveMode).toHaveBeenCalledExactlyOnceWith("mono-clicked", "full-access");
  expect(fixture.sessionsRef.current.find(session => session.id === "clicked")?.runtimeMode).toBe("full-access");
  expect(fixture.sessionsRef.current.find(session => session.id === "peer")).toMatchObject({ runtimeMode: "supervised", codexStorageError: sandboxDetail });
  expect(fixture.prepare.mock.calls[0][0]).toMatchObject({ sandboxRequired: false, sessionId: "clicked", path: "/synthetic/codex.exe" });
  expect(fixture.retry).toHaveBeenCalledOnce();
  expect(fixture.peerRetry).not.toHaveBeenCalled();
  expect(fixture.recovery.hasPending("peer")).toBe(true);
});

it("rejects an account switch while a peer turn is running without changing config or replaying prompts", async () => {
  const fixture = sandboxRepairFixture();
  fixture.sessionsRef.current = fixture.sessionsRef.current.map(session => session.id === "peer" ? { ...session, busy: true } : session);
  await expect(fixture.repair("clicked", "use_unelevated_sandbox")).rejects.toThrow("current turns");
  expect(fixture.invoke).not.toHaveBeenCalled(); expect(fixture.stop).not.toHaveBeenCalled();
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.peerRetry).not.toHaveBeenCalled();
  expect(fixture.recovery.hasPending("clicked")).toBe(true);
  expect(fixture.sessionsRef.current.find(session => session.id === "clicked")?.codexStorageError).toBe(sandboxDetail);
});

it("rejects full-access escalation for read-only investigations", async () => {
  const fixture = sandboxRepairFixture({ readOnly: true });
  await expect(fixture.repair("clicked", "use_mono_full_access")).rejects.toThrow("filesystem restrictions");
  expect(fixture.stop).not.toHaveBeenCalled(); expect(fixture.invoke).not.toHaveBeenCalled();
  expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.retry).not.toHaveBeenCalled();
});

it("keeps a held Plan restricted after an explicit Mono full-access choice", async () => {
  const fixture = sandboxRepairFixture({ queuedMessages: [{ id: "plan", text: "Plan", attachments: [], intent: "plan" }] });
  fixture.prepare.mockRejectedValueOnce(new Error(sandboxDetail));
  await expect(fixture.repair("clicked", "use_mono_full_access")).rejects.toThrow("Plan and orchestrate");
  expect(codexSandboxRepairSettings(fixture.sessionsRef.current[0], true, false)).toMatchObject({ sandboxRequired: true });
  expect(fixture.prepare).not.toHaveBeenCalled();
  expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  expect(fixture.sessionsRef.current[0].runtimeMode).toBe("supervised");
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.recovery.hasPending("clicked")).toBe(true);
});

it.each(["plan", "orchestrate"] as const)("checks the actual held %s ahead of an ordinary queued prompt", async intent => {
  const fixture = sandboxRepairFixture({ blocks: [{ id: "held", role: "user", text: "Exact held prompt", intent }],
    queuedMessages: [{ id: "ordinary", text: "Next ordinary prompt", attachments: [] }],
    ...{ codexStorageHeld: { intent } } });
  await expect(fixture.repair("clicked", "use_mono_full_access")).rejects.toThrow("Plan and orchestrate");
  expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled(); expect(fixture.retry).not.toHaveBeenCalled();
  expect(fixture.sessionsRef.current[0].queuedMessages?.[0].text).toBe("Next ordinary prompt");
  expect(fixture.recovery.hasPending("clicked")).toBe(true);
});

it("uses an ordinary held prompt ahead of a queued Plan", async () => {
  const fixture = sandboxRepairFixture({ blocks: [{ id: "held", role: "user", text: "Exact ordinary prompt" }],
    queuedMessages: [{ id: "plan", text: "Next Plan", attachments: [], intent: "plan" }],
    ...{ codexStorageHeld: {} } });
  await fixture.repair("clicked", "use_mono_full_access");
  expect(fixture.retry).toHaveBeenCalledOnce();
  expect(fixture.saveMode).toHaveBeenCalledExactlyOnceWith("mono-clicked", "full-access");
  expect(fixture.sessionsRef.current[0].queuedMessages?.[0].intent).toBe("plan");
});

it("does not persist full access when the readiness check fails", async () => {
  const fixture = sandboxRepairFixture();
  fixture.prepare.mockRejectedValueOnce(new Error(sandboxDetail));
  await expect(fixture.repair("clicked", "use_mono_full_access")).rejects.toThrow("Codex storage needs repair");
  expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  expect(fixture.sessionsRef.current[0]).toMatchObject({ runtimeMode: "supervised", codexStorageError: expect.stringContaining(sandboxDetail) });
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.peerRetry).not.toHaveBeenCalled();
  expect(fixture.recovery.hasPending("clicked")).toBe(true);
});

it("directs an explicit Elevated Mono to Permissions without reporting repair success", async () => {
  const fixture = sandboxRepairFixture({ windowsSandbox: "elevated" });
  await expect(fixture.repair("clicked", "use_unelevated_sandbox")).rejects.toThrow("In Permissions");
  expect(fixture.invoke).not.toHaveBeenCalled(); expect(fixture.prepare).not.toHaveBeenCalled();
  expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  expect(fixture.sessionsRef.current[0].blocks).toEqual([]);
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.recovery.hasPending("clicked")).toBe(true);
});

it("does not post a private repair success before readiness succeeds", async () => {
  const fixture = sandboxRepairFixture();
  fixture.prepare.mockRejectedValueOnce(new Error(sandboxDetail));
  await expect(fixture.repair("clicked", "use_unelevated_sandbox")).rejects.toThrow("Codex storage needs repair");
  expect(fixture.sessionsRef.current[0].blocks).toEqual([]);
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.peerRetry).not.toHaveBeenCalled();
});

it("confirms a legacy original source only for the held idle account", async () => {
  const sourceBinding = { resolvedSourceHome: "/synthetic/original", boundSourceHome: null, canBind: true };
  const codexStorageError = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Choose original source", paths: ["/synthetic/private"], sourceBinding })}`;
  const fixture = sandboxRepairFixture({ codexStorageError });
  await fixture.repair("clicked", "bind_selected_source");
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_store_bind_source", { providerAccountId: "account", sourceHome: sourceBinding.resolvedSourceHome });
  expect(fixture.stop.mock.calls).toEqual([["codex", "clicked"], ["codex", "peer"]]);
  expect(fixture.retry).toHaveBeenCalledOnce(); expect(fixture.otherRetry).not.toHaveBeenCalled();
  expect(fixture.saveMode).not.toHaveBeenCalled();
});

it("separates the selected source before retrying and detaches the original source thread without changing held or queued content", async () => {
  const sourceBinding = { resolvedSourceHome: "/synthetic/selected", boundSourceHome: "/synthetic/original", canBind: false, canSeparate: true, sourceIdentity: "1:2" };
  const codexStorageError = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Choose source", paths: ["/synthetic/private"], sourceBinding })}`;
  const fixture = sandboxRepairFixture({ codexStorageError, providerSessionId: "original-thread", codexStorageHome: "/synthetic/original-mono",
    blocks: [{ id: "held", role: "user", text: "Held source retry" }], queuedMessages: [{ id: "next", text: "Next queued", attachments: [], intent: "plan" }], codexStorageHeld: {} });
  const before = structuredClone(fixture.sessionsRef.current[0]);
  fixture.sessionsRef.current[1] = { ...fixture.sessionsRef.current[1], providerSessionId: "peer-original", codexStorageHome: "/synthetic/original-mono" };
  fixture.sessionsRef.current[2] = { ...fixture.sessionsRef.current[2], providerSessionId: "other-original", codexStorageHome: "/synthetic/other-mono" };
  const peers = structuredClone(fixture.sessionsRef.current.slice(1));
  fixture.invoke.mockResolvedValueOnce("/synthetic/separate-mono");
  fixture.prepare.mockResolvedValueOnce({ home: "/synthetic/separate-mono", originalHome: "/synthetic/original-mono", threadId: null } as never);
  await fixture.repair("clicked", "separate_selected_source");
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_store_separate_source", { providerAccountId: "account", sourceHome: sourceBinding.resolvedSourceHome, sourceIdentity: "1:2" });
  expect(fixture.prepare).toHaveBeenCalledExactlyOnceWith("account", "original-thread", expect.objectContaining({ expectedMonoHome: "/synthetic/original-mono", providerSessionIdByHome: {} }));
  expect(fixture.retry).toHaveBeenCalledOnce();
  expect(fixture.sessionsRef.current[0].blocks).toEqual(before.blocks);
  expect(fixture.sessionsRef.current[0].queuedMessages).toEqual(before.queuedMessages);
  expect(fixture.sessionsRef.current[0].providerSessionId).toBeUndefined();
  expect(fixture.sessionsRef.current[0].codexStorageHome).toBe("/synthetic/separate-mono");
  expect(fixture.sessionsRef.current[0].providerSessionIdByHome).toEqual({ "/synthetic/original-mono": "original-thread" });
  expect(fixture.sessionsRef.current.slice(1)).toEqual(peers);
  expect(fixture.saveMode).not.toHaveBeenCalled();
});

it("refuses a separate home while a managed peer is active", async () => {
  const sourceBinding = { resolvedSourceHome: "/synthetic/selected", boundSourceHome: "/synthetic/original", canBind: false, canSeparate: true, sourceIdentity: "1:2" };
  const fixture = sandboxRepairFixture({ codexStorageError: `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Choose source", paths: ["/synthetic/private"], sourceBinding })}` });
  fixture.sessionsRef.current[1].busy = true;
  await expect(fixture.repair("clicked", "separate_selected_source")).rejects.toThrow("current turns");
  expect(fixture.invoke).not.toHaveBeenCalled(); expect(fixture.retry).not.toHaveBeenCalled();
  expect(fixture.persist).not.toHaveBeenCalled(); expect(fixture.recovery.hasPending("clicked")).toBe(true);
});

it.each(["generation", "account", "permissions"])("refuses a stale source choice after stop changes %s", async field => {
  const sourceBinding = { resolvedSourceHome: "/synthetic/selected", boundSourceHome: "/synthetic/original", canBind: false, canSeparate: true, sourceIdentity: "1:2" };
  const fixture = sandboxRepairFixture({ providerSessionId: "original-thread", codexStorageHome: "/synthetic/original-mono", codexStorageError: `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Choose source", paths: ["/synthetic/private"], sourceBinding })}` });
  fixture.stop.mockImplementationOnce(async () => {
    if (field === "generation") fixture.turnGen.current.set("clicked", 1);
    else fixture.sessionsRef.current[0] = { ...fixture.sessionsRef.current[0], ...(field === "account" ? { providerAccountId: "changed" } : { readOnly: true }) };
  });
  await expect(fixture.repair("clicked", "separate_selected_source")).rejects.toThrow("changed");
  expect(fixture.invoke).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.recovery.hasPending("clicked")).toBe(true);
  expect(fixture.sessionsRef.current[0].providerSessionId).toBe("original-thread");
});

it("reattaches the recreated original behind its displayed physical identity and resumes its saved thread", async () => {
  const sourceBinding = { resolvedSourceHome: "/synthetic/original", boundSourceHome: "/synthetic/original", canBind: false, canSeparate: true, canReturn: true, sourceIdentity: "1:9" };
  const fixture = sandboxRepairFixture({ providerSessionId: "other-thread", codexStorageHome: "/synthetic/other-mono", providerSessionIdByHome: { "/synthetic/original-mono": "original-thread" },
    codexStorageError: `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Recreated source", paths: ["/synthetic/private"], sourceBinding })}` });
  fixture.prepare.mockResolvedValueOnce({ home: "/synthetic/original-mono", originalHome: "/synthetic/original-mono", threadId: "original-thread" } as never);
  await fixture.repair("clicked", "reattach_original_source");
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_store_reattach_source", { providerAccountId: "account", sourceHome: "/synthetic/original", sourceIdentity: "1:9" });
  expect(fixture.sessionsRef.current[0].providerSessionId).toBe("original-thread");
  expect(fixture.sessionsRef.current[0].providerSessionIdByHome).toEqual({ "/synthetic/original-mono": "original-thread", "/synthetic/other-mono": "other-thread" });
  expect(fixture.peerRetry).not.toHaveBeenCalled(); expect(fixture.otherRetry).not.toHaveBeenCalled();
});

it("holds prompts and returns the private backup path after an explicit Mono-config write fails", async () => {
  const fixture = sandboxRepairFixture();
  fixture.invoke.mockRejectedValueOnce(new Error("Private config is busy; backup preserved at /synthetic/private/config.backup"));
  await expect(fixture.repair("clicked", "use_unelevated_sandbox")).rejects.toThrow("/synthetic/private/config.backup");
  expect(fixture.prepare).not.toHaveBeenCalled(); expect(fixture.retry).not.toHaveBeenCalled();
  expect(fixture.peerRetry).not.toHaveBeenCalled(); expect(fixture.recovery.hasPending("clicked")).toBe(true);
  expect(fixture.sessionsRef.current.find(session => session.id === "clicked")?.codexStorageError).toBe(sandboxDetail);
});

it("retains a failed full-access retry without resuming any account peer", async () => {
  const fixture = sandboxRepairFixture();
  fixture.retry.mockRejectedValueOnce(new Error("Transport unavailable"));
  await expect(fixture.repair("clicked", "use_mono_full_access")).rejects.toThrow("Transport unavailable");
  expect(fixture.recovery.hasPending("clicked")).toBe(true);
  expect(fixture.peerRetry).not.toHaveBeenCalled(); expect(fixture.otherRetry).not.toHaveBeenCalled();
});
