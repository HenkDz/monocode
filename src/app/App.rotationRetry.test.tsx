// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it } from "vitest";
import {
  loadMonoRotation,
  planSessionRotation,
  saveMonoRotation,
  sessionRotationStatus,
} from "../features/monos/model/monoRotation";

// Use the actual App save and deferral guards without a native workspace.
const source = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function guard(text: string): string {
  let found: ts.IfStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes(text)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw Error(`App guard not found: ${text}`);
  return ts.transpile(found.getText(source), { target: ts.ScriptTarget.ES2022 });
}
const persist = new Function("monoRotation", "sessionId", "saveMonoRotation", guard("saveMonoRotation("));
const rejectDeferred = new Function("rotationStatus", "sessionId", "loadMonoRotation", guard("rotationStatus?.deferredReason"));

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
  expect(() => rejectDeferred(status, session.id, loadMonoRotation)).toThrow(status.deferredReason);
  expect(loadMonoRotation(session.id)?.pendingInput).toBe("Do not publish.");
  localStorage.clear();
  expect(() => rejectDeferred(status, session.id, loadMonoRotation)).not.toThrow();
});

it("App stops when saving an updated retry carry fails", () => {
  const session = { id: "app-storage", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Do not publish.")!;
  persist(first, session.id, saveMonoRotation);
  const second = planSessionRotation(session, "Use only account B.")!;
  expect(() => persist(second, session.id, () => false)).toThrow("could not be saved");
});
