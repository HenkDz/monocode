import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { sessionDraftBlock, type Session } from "../features/sessions/model/session";
import { launchedSessionState, type LaunchedSessionView } from "../features/monos/model/monoSpawnedSessions";

const source = ts.createSourceFile(
  "App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);
let send: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === "send"
    && ts.isArrowFunction(node.initializer) && node.initializer.parameters.length === 4)
    send = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);
if (!send) throw new Error("App session follow-up callback was not found");

function fixture() {
  const target: Session = {
    id: "worker", cwd: "/synthetic", title: "Worker", harness: "codex", model: "",
    modelSettings: {}, runtimeMode: "supervised", blocks: [],
  };
  const rememberSession = vi.fn();
  const submit = vi.fn(async () => true);
  // Exercise the private callback without booting the native workspace.
  const callback = new Function(
    "ensureOpenSessionRef", "canAccessProject", "orchestrator", "sessionsRef",
    "rememberSession", "sessionDraftBlock", "submitSessionRef",
    ts.transpile(`return (${send!.getText(source)});`, { target: ts.ScriptTarget.ES2022 }),
  )(
    { current: async () => target }, () => true, { run: () => undefined },
    { current: [target] }, rememberSession, sessionDraftBlock, { current: submit },
  ) as (id: string, prompt: string, requestId: string) => Promise<{ alreadySubmitted: boolean }>;
  return { target, rememberSession, submit, callback };
}

it.each(["queued", "sent", "new"])("remembers a %s follow-up without resubmitting accepted requests", async (path) => {
  const { target, rememberSession, submit, callback } = fixture();
  if (path === "queued") target.queuedMessages = [{ id: "queued", text: "Continue", attachments: [], appRequestId: "request" }];
  if (path === "sent") target.blocks = [{ id: "sent", role: "user", text: "Continue", appRequestId: "request" }];
  expect(await callback("worker", "Continue", "request")).toEqual({ alreadySubmitted: path !== "new" });
  expect(submit).toHaveBeenCalledTimes(path === "new" ? 1 : 0);
  expect(rememberSession).toHaveBeenCalledExactlyOnceWith({
    sessionId: "worker", cwd: "/synthetic", title: "Worker", harness: "codex", model: "",
  });
});

it.each(["queued", "sent", "draft"])("does not remember a rejected %s request", async (path) => {
  const { target, rememberSession, submit, callback } = fixture();
  if (path === "queued") target.queuedMessages = [{ id: "queued", text: "Other", attachments: [], appRequestId: "request" }];
  else target.blocks = [{ id: "sent", role: "user", text: path === "draft" ? "Continue" : "Other", appRequestId: "request", draft: path === "draft" }];
  await expect(callback("worker", "Continue", "request")).rejects.toThrow("Request ID");
  expect(submit).not.toHaveBeenCalled();
  expect(rememberSession).not.toHaveBeenCalled();
});

it("loads canonical saved states again after closing a launched session", () => {
  function variable(name: string) {
    let found: ts.VariableDeclaration | undefined;
    function find(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node;
      ts.forEachChild(node, find);
    }
    find(source);
    if (!found) throw new Error(`App variable ${name} was not found`);
    return new Function("monoLaunches", "sessions", "storedLaunchViews", "launchedSessionState",
      ts.transpile(`const ${found.getText(source)}; return ${name};`, { target: ts.ScriptTarget.ES2022 }));
  }
  const { target } = fixture();
  const launches = [{ sessionId: target.id, title: "Launch" }];
  const saved = new Map<string, LaunchedSessionView>([[target.id, {
    title: "Saved worker", state: launchedSessionState({ ...target, codexStorageError: "Repair storage" }),
  }]]);
  const fetchKey = variable("unopenedLaunchesKey");
  const viewKey = variable("monoLaunchesKey");
  expect(JSON.parse(viewKey(launches, [], saved, launchedSessionState))[0]).toEqual([
    target.id, { status: "blocked", reason: "storage", detail: "Repair storage" }, "Saved worker",
  ]);
  expect(JSON.parse(viewKey(launches, [], new Map(), launchedSessionState))[0][1]).toEqual({ status: "idle" });
  expect(JSON.parse(fetchKey(launches, [target], saved, launchedSessionState))).toEqual([]);
  expect(JSON.parse(fetchKey(launches, [], saved, launchedSessionState))).toEqual([target.id]);
});
