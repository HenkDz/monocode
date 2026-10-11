import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { MonoCodexStorageRecovery, isCodexStorageError, parseCodexStorageConflict, parseCodexStorageRecoveryConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings } from "../features/monos/model/monoCodexStorage";
import type { Session } from "../features/sessions/model/session";
import { codexStorageAccountId } from "../features/monos/model/monoCodexStorageIssues";

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
  return runInNewContext(output, { ...context, Error });
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
    sessionsRef, codexStorageRecovery: { current: recovery }, codexStorageAccountId,
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
    prepareMonoCodexStore: prepare, invoke: vi.fn(), acceptSubmission,
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
  const stop = vi.fn(async (_harness: string, _sessionId: string) => {}), prepare = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}), persist = vi.fn(async () => {}), saveMode = vi.fn();
  const invoke = vi.fn(async () => ({ configPath: "/synthetic/account/config.toml", backupPaths: ["/synthetic/account/config.backup", "/synthetic/private/config.backup"] }));
  const context = {
    sessionsRef, codexStorageRecovery: { current: recovery }, codexStorageAccountId, isCodexStorageError,
    parseCodexStorageConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings, IS_WIN: true,
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
  };
  const repair = evaluate(appCallback("onCodexStorageRepair").getText(app), context);
  return { ...context, repair, recovery, retry, peerRetry, otherRetry, stop, prepare, persist, saveMode };
}

it("switches the selected account only on explicit choice, stops idle servers and exposes both backups", async () => {
  const fixture = sandboxRepairFixture();
  expect(fixture.invoke).not.toHaveBeenCalled();
  await fixture.repair("clicked", "use_unelevated_sandbox");
  expect(fixture.stop.mock.calls).toEqual([["codex", "clicked"], ["codex", "peer"]]);
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_use_unelevated_sandbox", { providerAccountId: "account" });
  expect(fixture.stop.mock.invocationCallOrder[1]).toBeLessThan(fixture.invoke.mock.invocationCallOrder[0]);
  const clicked = fixture.sessionsRef.current.find(session => session.id === "clicked")!;
  expect(clicked.blocks[0].text).toContain("/synthetic/account/config.backup");
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
  await expect(fixture.repair("clicked", "use_mono_full_access")).rejects.toThrow("Codex storage needs repair");
  expect(fixture.prepare.mock.calls[0][0]).toMatchObject({ sandboxRequired: true });
  expect(fixture.retry).not.toHaveBeenCalled(); expect(fixture.recovery.hasPending("clicked")).toBe(true);
});

it("holds prompts and returns backup paths after a partial explicit account-config write fails", async () => {
  const fixture = sandboxRepairFixture();
  fixture.invoke.mockRejectedValueOnce(new Error("Private config is busy; backups preserved at /synthetic/account/config.backup, /synthetic/private/config.backup"));
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
