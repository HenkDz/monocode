import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { snapshotMonoWorkerPermissions } from "../features/monos/model/monoRolePermissions";
import type { Session } from "../features/sessions/model/session";

const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function appFunction(name: string) {
  let found: ts.ArrowFunction | undefined;
  const walk = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name && ts.isArrowFunction(node.initializer)) found = node.initializer;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer) && ts.isArrowFunction(node.initializer.arguments[0])) found = node.initializer.arguments[0];
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!found) throw new Error(`Missing App function ${name}`);
  return found.getText(source);
}
function evaluate(name: string, context: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(`(${appFunction(name)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const session = (id: string, runtimeMode: Session["runtimeMode"], extra = {}): Session => ({ id, harness: "codex", model: "model", modelSettings: {}, cwd: "/repo", title: id, blocks: [], runtimeMode, ...extra });

it.each([{ readOnly: false, member: false }, { readOnly: true, member: false }, { readOnly: false, member: true }])("App resolves worker permissions after preparation (readOnly=$readOnly, member=$member)", async ({ readOnly, member }) => {
  const resident = session("resident", "auto", { runtimeModeSource: "role" });
  const sessionsRef = { current: [session("lead", "full-access"), ...(member ? [resident] : [])] };
  const upsertSession = vi.fn(async () => undefined);
  const create = evaluate("createWorker", {
    sessionsRef, upsertSession, ensureMonoSession: vi.fn(async () => resident), homeDir: vi.fn(), ensureOpenSession: vi.fn(), saveMonoPermissions: vi.fn(), sessionDefaults: {},
    orchestrationProjectCwd: () => "/repo", orchestrationCheckoutCwd: () => "/repo",
    workspaceIdentity: () => ({ id: "workspace", projectCwd: "/repo", checkoutCwd: "/repo", kind: "project" }),
    sameProjectPath: (a: string, b: string) => a === b, invoke: vi.fn(async () => "/scratch"),
    orchestrator: { checkoutNotice: () => undefined }, getSession: vi.fn(async () => {
      if (member) sessionsRef.current = sessionsRef.current.map(entry => entry.id === resident.id ? { ...entry, runtimeMode: "supervised", runtimeModeSource: "user", windowsSandbox: "elevated" } : entry);
      return undefined;
    }), findMono: () => ({ id: "member", role: "member", runtimeModeSource: "role" }),
    snapshotMonoWorkerPermissions, snapshotMonoWorkerEffort: () => ({ modelSettings: {}, effortSource: "role" }),
    newSession: (_harness: string, _cwd: string, _model: string, mode: Session["runtimeMode"]) => session("fresh", mode),
    setSessions: (next: Session[]) => { sessionsRef.current = next; },
  });
  const prepared = await create({ leadId: "lead" }, { id: "task", sessionId: "worker", memberId: member ? "member" : undefined, harness: "codex", model: "model", title: "Echo", workspacePolicy: "shared", readOnly });
  expect(prepared.runtimeMode).toBe(readOnly || member ? "supervised" : "auto");
  expect(prepared.runtimeModeSource).toBe(member ? "user" : "role");
  expect(prepared.windowsSandbox).toBe(member ? "elevated" : undefined);
  expect(sessionsRef.current.find(entry => entry.id === "worker")?.runtimeMode).toBe(prepared.runtimeMode);
  expect(sessionsRef.current[0].runtimeMode).toBe("full-access");
});

it("App records user/reset ownership and keeps read-only worker permissions unchanged", () => {
  const sessionsRef = { current: [session("member", "auto", { runtimeModeSource: "role" }), session("worker", "auto", { orchestrationLeadId: "lead" }), session("review", "supervised", { readOnly: true })] };
  const saveMonoRuntimeMode = vi.fn();
  const upsertSession = vi.fn(async () => undefined);
  const change = evaluate("onRuntimeModeChange", {
    sessionsRef, saveMonoRuntimeMode, upsertSession, Set, console,
    monoForSession: () => ({ id: "mono" }), monoPermissionSessionIds: () => ["member", "worker"],
    orchestrator: { snapshot: () => [] }, setSessions: (next: Session[]) => { sessionsRef.current = next; },
    updateHarnessRuntimeMode: vi.fn(async () => undefined),
  });
  change("member", "auto");
  expect(saveMonoRuntimeMode).toHaveBeenLastCalledWith("mono", "auto", "user");
  expect(sessionsRef.current[0].runtimeModeSource).toBe("user");
  change("member", "auto", "role");
  expect(saveMonoRuntimeMode).toHaveBeenLastCalledWith("mono", "auto", "role");
  expect(sessionsRef.current.slice(0, 2).every(entry => entry.runtimeModeSource === "role")).toBe(true);
  expect(sessionsRef.current[2].runtimeMode).toBe("supervised");
});
