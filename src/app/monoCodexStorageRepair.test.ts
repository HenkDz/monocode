import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { MonoCodexStorageRecovery, isCodexStorageError, parseCodexStorageConflict, parseCodexStorageRecoveryConflict } from "../features/monos/model/monoCodexStorage";
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
// Exercise App's guards and storage preflight; replace only the later provider transport.
const guardedSubmission = `(${submission.parameters.map(parameter => parameter.getText(app)).join(", ")}) => {
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
    isCodexStorageError, parseCodexStorageConflict,
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
