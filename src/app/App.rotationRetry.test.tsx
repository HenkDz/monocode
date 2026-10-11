// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import {
  loadMonoRotation,
  MONO_ROTATION_READ_ERROR,
  planSessionRotation,
  saveMonoRotation,
  sessionRotationStatus,
  acceptMonoRotation,
} from "../features/monos/model/monoRotation";
import { applyHarnessEvent } from "../integrations/harness/core/apply";
import { bindTurnContextProfile } from "../integrations/harness/core/contextProfile";
import { newSession } from "../features/sessions/model/session";

// Use the actual App save and deferral guards without a native workspace.
const source = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function guard(text: string): string {
  let found: ts.IfStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.expression.getText(source).startsWith(text)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw Error(`App guard not found: ${text}`);
  return ts.transpile(found.getText(source), { target: ts.ScriptTarget.ES2022 });
}
const persist = new Function("monoRotation", "sessionId", "saveMonoRotation", guard("!saveMonoRotation("));
const rejectDeferred = new Function("MONO_ROTATION_READ_ERROR", "rotationStatus", "pendingRotation", "sessionId", "editedResend", "enqueueHarnessEvent", "flushHarnessEvents", "options", `const rotation = undefined; const monoRotation = rotationStatus?.plan; ${guard("rotation === null")}`).bind(null, MONO_ROTATION_READ_ERROR);
const editPreflight = `const savedRotation = loadMonoRotation(sessionId); ${guard("savedRotation === null")} ${guard("options?.resendEdited && savedRotation")}`;
const rejectPendingEdit = new Function("MONO_ROTATION_READ_ERROR", "sessionId", "loadMonoRotation", "enqueueHarnessEvent", "flushHarnessEvents", "options", editPreflight).bind(null, MONO_ROTATION_READ_ERROR);

beforeEach(() => localStorage.clear());

it("App persists restrictions from every unaccepted startup attempt", () => {
  const session = { id: "app-retry", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Implement the parser fix.")!;
  persist(first, session.id, saveMonoRotation);
  const fresh = { ...session, providerSessionId: undefined, context: undefined };
  const secondInput = "Retry the parser fix. Do not push or merge any branch.";
  const second = planSessionRotation(fresh, secondInput)!;
  persist(second, session.id, saveMonoRotation);
  expect(loadMonoRotation(session.id)?.pendingInputs).toContain(secondInput);
  const third = planSessionRotation(fresh, "Retry now.")!;
  expect(third.brief(session.id)).toContain(secondInput);
  expect(third.brief(session.id)).toContain("Implement the parser fix.");
});

it("App stops before detaching or starting if a retry cannot preserve all constraints", () => {
  const session = { id: "app-deferred", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Do not publish.")!;
  persist(first, session.id, saveMonoRotation);
  const status = sessionRotationStatus({ ...session, providerSessionId: undefined, context: undefined }, "x".repeat(8001));
  expect(status.deferredReason).toContain("constraints, scope or references too large");
  const events = vi.fn();
  const settled = vi.fn();
  expect(rejectDeferred(status, loadMonoRotation(session.id)?.pendingBrief, session.id, undefined, events, vi.fn(), { onSettled: settled })).toBe(false);
  expect(events).toHaveBeenCalledWith(session.id, { type: "session.error", message: status.deferredReason });
  expect(settled).toHaveBeenCalledWith({ status: "failed", text: "", error: status.deferredReason });
  expect(loadMonoRotation(session.id)?.pendingInput).toBe("Do not publish.");
  localStorage.clear();
  expect(rejectDeferred(status, undefined, session.id, undefined, events, vi.fn(), undefined)).toBeUndefined();
});

it("rejects oversized B before committing its user block so short C can retry A", () => {
  const session = { id: "app-correctable", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Keep the parser scope.")!;
  persist(first, session.id, saveMonoRotation);
  const fresh = { ...session, providerSessionId: undefined, context: undefined };
  const status = sessionRotationStatus(fresh, "x".repeat(8001));
  expect(rejectDeferred(status, loadMonoRotation(session.id)?.pendingBrief, session.id, undefined, vi.fn(), vi.fn(), undefined)).toBe(false);
  expect(fresh.blocks).toEqual([]);
  const third = sessionRotationStatus(fresh, "Retry").plan!;
  expect(third.brief(session.id)).toContain("Keep the parser scope.");
  expect(third.rotation.pendingInputs).toEqual(["Keep the parser scope.", "Retry"]);
  const rejection = source.text.indexOf("if (rotation === null");
  expect(rejection).toBeLessThan(source.text.indexOf("const gen =", rejection));
  expect(rejection).toBeLessThan(source.text.indexOf("flushSync(commitSubmittedTurn)", rejection));
});

it("refuses pending edited resends when a switch or other unsafe state prevents planning", () => {
  const edit = { reject: vi.fn() };
  const events = vi.fn();
  expect(rejectDeferred(undefined, "saved restrictions", "pending-switch", edit, events, vi.fn(), undefined)).toBe(false);
  expect(edit.reject).toHaveBeenCalledOnce();
  expect(events.mock.calls[0][1].message).toContain("Finish pending operations or decisions");
});

it.each(["preparation", "rewind"])("blocks pending edits before failed %s can stage replacement text, then reload retries only the original", failure => {
  const session = { id: "app-edit-carry", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  persist(planSessionRotation(session, "Do not publish.")!, session.id, saveMonoRotation);
  const stored = localStorage.getItem("monocode:mono-rotations");
  const rejected = vi.fn();
  const settled = vi.fn();
  const events = vi.fn();
  const options = { resendEdited: true, onResendRejected: rejected, onSettled: settled };
  const prepare = vi.fn(() => { if (failure === "preparation") throw Error("preparation failed"); });
  const rewind = vi.fn(() => { throw Error("rewind failed"); });
  const attempt = new Function("MONO_ROTATION_READ_ERROR", "sessionId", "loadMonoRotation", "enqueueHarnessEvent", "flushHarnessEvents", "options", "prepare", "rewind",
    `${editPreflight} prepare(); rewind();`).bind(null, MONO_ROTATION_READ_ERROR);
  expect(attempt(session.id, loadMonoRotation, events, vi.fn(), options, prepare, rewind)).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
  expect(rewind).not.toHaveBeenCalled();
  expect(rejected).toHaveBeenCalledWith({ providerRewound: false });
  expect(events).toHaveBeenCalledWith(session.id, { type: "status", text: "Retry the original first. Editing is available after it's accepted." });
  expect(settled).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  expect(localStorage.getItem("monocode:mono-rotations")).toBe(stored);
  localStorage.clear();
  localStorage.setItem("monocode:mono-rotations", stored!);
  const retry = planSessionRotation({ ...session, providerSessionId: undefined, context: undefined }, "Retry")!;
  expect(retry.rotation.pendingInputs).toEqual(["Do not publish.", "Retry"]);
  expect(retry.brief(session.id)).not.toContain("Use account B.");
  const preflight = source.text.indexOf("if (options?.resendEdited && savedRotation");
  expect(preflight).toBeLessThan(source.text.indexOf("codexStorageRecovery.current.prepare(", preflight));
  expect(preflight).toBeLessThan(source.text.indexOf("createEditedResendAttempt(current", preflight));
  expect(preflight).toBeLessThan(source.text.indexOf("await rewindHarnessLastTurn(", preflight));
  expect(source.text).not.toContain("if (editedResend && monoRotation");
});

it("allows existing edited resend preparation when no rotation carry is pending", () => {
  expect(rejectPendingEdit("accepted", loadMonoRotation, vi.fn(), vi.fn(), { resendEdited: true })).toBeUndefined();
});

it("actual App acceptance succeeds and surfaces a storage warning until durable clearing recovers", () => {
  vi.useFakeTimers();
  const session = { ...newSession("pi", "/synthetic"), id: "accepted-warning", busy: true,
    providerSessionId: "replacement", context: { used: 0, window: 1000 } };
  const monoRotation = { rotation: { at: 123, reason: "context" as const, earlier: [], pendingInput: "Original input." }, brief: () => "Original constraints." };
  const receipt = { ...monoRotation.rotation, pendingBrief: monoRotation.brief() };
  saveMonoRotation(session.id, receipt);
  const sessionsRef = { current: [session] };
  const acceptedContext = vi.fn();
  const scope = { sessionsRef, sessionId: session.id, monoRotation, rotationReceipt: receipt, acceptMonoRotation, editedResend: undefined,
    acceptEditedResend: vi.fn(), acceptMonoWorkingDirectoryMigration: vi.fn(), turnGen: { current: new Map([[session.id, 1]]) }, gen: 1,
    setSessions: vi.fn(), contextAccepted: acceptedContext };
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "onAccepted" && node.getText(source).includes("acceptMonoRotation")) callback = node.initializer;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  const accept = new Function(...Object.keys(scope), ts.transpile(`return ${callback!.getText(source)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  const storage = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.getItem(key),
    setItem: () => { throw Error("quota"); },
  });
  try {
    expect(() => accept()).not.toThrow();
    expect(acceptedContext).toHaveBeenCalledOnce();
    expect(sessionsRef.current[0].busy).toBe(true);
    expect(sessionsRef.current[0]).toHaveProperty("rotationWarning", expect.stringContaining("accepted"));
    expect(loadMonoRotation(session.id)?.pendingBrief).toBeUndefined();
    vi.unstubAllGlobals();
    vi.advanceTimersByTime(250);
    expect(sessionsRef.current[0]).toHaveProperty("rotationWarning", undefined);
    expect(JSON.parse(localStorage.getItem("monocode:mono-rotations")!)[session.id].pendingBrief).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("App stops when saving an updated retry carry fails", () => {
  const session = { id: "app-storage", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Do not publish.")!;
  persist(first, session.id, saveMonoRotation);
  const second = planSessionRotation(session, "Use only account B.")!;
  expect(() => persist(second, session.id, () => false)).toThrow("could not be saved");
});

it("the App save guard refuses a plan made before a newer restriction was saved", () => {
  const session = { id: "app-stale-save", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  persist(planSessionRotation(session, "Do not publish.")!, session.id, saveMonoRotation);
  const stale = planSessionRotation(session, "Retry")!;
  const newer = { ...loadMonoRotation(session.id)!, pendingInputs: ["Use only account B."] };
  expect(saveMonoRotation(session.id, newer)).toBe(true);
  expect(() => persist(stale, session.id, saveMonoRotation)).toThrow("could not be saved");
  expect(loadMonoRotation(session.id)).toEqual(newer);
});

it("actual App compaction clears initial oversized-input deferral without saving a pending carry", async () => {
  const previous = { ...newSession("codex", "/synthetic"), id: "compact-recovery", providerSessionId: "old",
    model: "codex:fixture", context: { used: 700_000, window: 1_000_000 },
    blocks: [{ id: "scope", role: "user" as const, text: "Keep the scope and do not push." }] };
  const input = "x".repeat(8001);
  expect(sessionRotationStatus(previous, input).plan).toBeUndefined();
  expect(loadMonoRotation(previous.id)).toBeUndefined();
  const sessionsRef = { current: [previous] };
  const scope = {
    sessionsRef, remoteProjectFor: () => undefined, remoteSessionActions: () => undefined,
    canCompactHarnessContext: () => true, HARNESS_TITLE: { codex: "Codex" }, applyHarnessEvent,
    syncDockBadge: vi.fn(), setSessions: vi.fn(), turnGen: { current: new Map<string, number>() },
    sessionWorkCwd: () => previous.cwd, bindTurnContextProfile,
    compactHarnessContext: async (input: { onEvent: (event: unknown) => void }) => input.onEvent({ type: "context", used: 0, window: 1_000_000 }),
    supportsProviderAccounts: () => false, selectedProviderAccountId: () => undefined,
    isMonoSession: () => true, operatorEnabledInThread: () => false, orchestrator: { run: () => undefined },
    monoSkillsForSession: () => ({ codexStore: "mono" as const, skillsRole: "manager", skillsPolicy: { mode: "role" as const } }),
    enqueueHarnessEvent: (_id: string, event: Parameters<typeof applyHarnessEvent>[1]) => { sessionsRef.current = [applyHarnessEvent(sessionsRef.current[0], event) as typeof previous]; },
    flushHarnessEvents: vi.fn(),
  };
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "onCompactContext")
      callback = (node.initializer as ts.CallExpression).arguments[0];
    else ts.forEachChild(node, visit);
  }
  visit(source);
  const compact = new Function(...Object.keys(scope), ts.transpile(`return ${callback!.getText(source)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  expect(compact(previous.id)).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sessionsRef.current[0].busy).toBe(false);
  expect(sessionsRef.current[0].context).toEqual({ used: 0, window: 1_000_000 });
  expect(sessionRotationStatus(sessionsRef.current[0], input)).toEqual({});
  expect(loadMonoRotation(previous.id)).toBeUndefined();
  expect(sessionsRef.current[0].blocks[0].text).toBe(previous.blocks[0].text);
});
