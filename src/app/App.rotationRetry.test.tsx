// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import {
  loadMonoRotation,
  planSessionRotation,
  saveMonoRotation,
  sessionRotationStatus,
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
const rejectDeferred = new Function("rotationStatus", "pendingRotation", "sessionId", "editedResend", "enqueueHarnessEvent", "flushHarnessEvents", "options", `const monoRotation = rotationStatus?.plan; ${guard("pendingRotation && !monoRotation")}`);
const persistEdited = new Function("editedResend", "monoRotation", "sessionId", "saveMonoRotation", "enqueueHarnessEvent", "flushHarnessEvents", "options", guard("editedResend && monoRotation"));

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
  const rejection = source.text.indexOf("if (pendingRotation && !monoRotation)");
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

it("saves an edited pending carry before rewind and refuses edits if storage fails", () => {
  const session = { id: "app-edit-carry", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Do not publish.")!;
  persist(first, session.id, saveMonoRotation);
  const before = loadMonoRotation(session.id);
  const replacement = planSessionRotation(session, "Use account B.")!;
  const edit = { reject: vi.fn() };
  expect(persistEdited(edit, replacement, session.id, () => false, vi.fn(), vi.fn(), undefined)).toBe(false);
  expect(edit.reject).toHaveBeenCalledOnce();
  expect(loadMonoRotation(session.id)).toEqual(before);
  expect(persistEdited(edit, replacement, session.id, saveMonoRotation, vi.fn(), vi.fn(), undefined)).toBeUndefined();
  expect(loadMonoRotation(session.id)?.pendingInputs).toContain("Use account B.");
  const preflight = source.text.indexOf("if (editedResend && monoRotation");
  expect(preflight).toBeLessThan(source.text.indexOf("await rewindHarnessLastTurn(", preflight));
});

it("App stops when saving an updated retry carry fails", () => {
  const session = { id: "app-storage", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Do not publish.")!;
  persist(first, session.id, saveMonoRotation);
  const second = planSessionRotation(session, "Use only account B.")!;
  expect(() => persist(second, session.id, () => false)).toThrow("could not be saved");
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
