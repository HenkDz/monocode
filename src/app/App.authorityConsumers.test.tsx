import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MonoRotation } from "../features/monos/model/monoRotation";
import type { Session } from "../features/sessions/model/session";

let stdout: ((line: string) => void) | undefined;
let sse: ((value: Record<string, unknown>) => void) | undefined;
let hold = false;
let providerFailure = false;
let version = "opencode 1.14.19";
let afterConfig: (() => void) | undefined;
let issued: string[] = [];
const harnessHttp = vi.fn(async (input: { url: string; method: string; body?: string }) => {
  const path = new URL(input.url).pathname;
  if (input.method === "POST" && path.endsWith("/session"))
    return { status: 200, body: JSON.stringify({ id: "session_1", directory: "/synthetic" }) };
  if (input.method === "GET" && path.endsWith("/message"))
    return { status: 200, body: "[]" };
  if (path.endsWith("/agent")) afterConfig?.();
  if (path.endsWith("/prompt_async") || path.endsWith("/prompt")) {
    const body = JSON.parse(input.body!);
    issued.push(body.text ?? body.parts.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n"));
    if (providerFailure) throw new Error("synthetic provider refused request");
    if (!hold) queueMicrotask(() => sse?.(version.includes("2.0")
      ? { type: "session.execution.succeeded", properties: { sessionID: "session_1" } }
      : { type: "session.status", properties: { sessionID: "session_1", status: { type: "idle" } } }));
  }
  return { status: 204, body: "" };
});
vi.mock("../integrations/harness/core/child", () => ({
  closeHarnessSse: vi.fn(async () => undefined),
  execChild: async (_command: string, args: string[]) => args[0] !== "service" ? version
    : args[1] === "get" ? "synthetic-secret" : "http://127.0.0.1:4096",
  freeHarnessPort: async () => 4096,
  harnessHttp,
  killChild: vi.fn(async () => undefined),
  openHarnessSse: async () => undefined,
  resolveOpenCodeBinary: async () => ({ path: "/synthetic/opencode" }),
  spawnChild: async () => stdout?.("opencode server listening on http://127.0.0.1:4096"),
  unwatchChild: () => undefined,
  watchChild: (_id: string, callback: (line: string) => void) => { stdout = callback; },
  watchSse: (_id: string, callback: (data: string) => void) => { sse = value => callback(JSON.stringify(value)); },
}));
const registry = await import("../integrations/harness/core/registry");
const opencode = await import("../integrations/harness/providers/opencode/opencode");
const { assertMonoRotationCurrent, forgetMonoRotation, loadMonoRotation, MONO_ROTATION_READ_ERROR, saveMonoRotation } = await import("../features/monos/model/monoRotation");
const { appendSteerUser } = await import("../integrations/harness/core/apply");
const { TurnNotReadyError } = await import("../integrations/harness/core/types");
const { requestOutgoingHandoff } = await import("../features/sessions/model/handoffTurn");
const { chooseHandoffBrief } = await import("../features/sessions/model/handoff");
const { newSession } = await import("../features/sessions/model/session");
const { selectAgentLiveState } = await import("../features/agents/model/agentLiveState");

// Exercise the production App seams without mounting unrelated native effects.
const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(app);
  if (!found) throw new Error("App authority consumer not found");
  return found;
}
const hostSteer = find(node => ts.isPropertyAssignment(node) && node.name.getText(app) === "steer" && node.getText(app).includes("appendSteerUser")) as ts.PropertyAssignment;
const pendingSwitch = find(node => ts.isIfStatement(node) && node.expression.getText(app) === "pendingSwitch" && node.getText(app).includes("requestOutgoingHandoff"));
function evaluate(source: string, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), ts.transpile(source, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}

const id = "authority-consumer";
const key = "monocode:mono-rotations";
const guidance = "Check only the synthetic parser tests.";
const receipt: MonoRotation = { at: 1, reason: "context", earlier: [], userRequests: [{ id: "scope", text: "Never publish; keep all results local." }] };
let sessionsRef: { current: Session[] };
let turnGen: { current: Map<string, number> };
let running: Promise<void> | undefined;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
    removeItem: (name: string) => storage.delete(name),
  });
  opencode.__openCodeTestReset();
  issued = [];
  hold = false;
  providerFailure = false;
  version = "opencode 1.14.19";
  afterConfig = undefined;
  running = undefined;
  turnGen = { current: new Map([[id, 1]]) };
  sessionsRef = { current: [{
    ...newSession("opencode", "/synthetic"), id,
    model: "opencode:synthetic/m1", busy: true, turnReady: true,
    blocks: [
      { id: "original-user", role: "user", text: "Verify parser", startedAt: 1000 },
      { id: "original-answer", role: "assistant", text: "Checking", streaming: true },
      { id: "original-tool", role: "tool", text: "Tests", streaming: true, tool: { callId: "tool", title: "npm test", status: "running" } },
    ],
  }] };
  expect(saveMonoRotation(id, receipt)).toBe(true);
  registry.registerHarness({
    id: "opencode", live: true,
    sendTurn: opencode.sendOpenCodeTurn, steerTurn: opencode.steerOpenCodeTurn,
    cancelTurn: opencode.cancelOpenCodeTurn, respondApproval: vi.fn(), respondQuestion: vi.fn(),
    stopSession: opencode.stopOpenCodeSession, forgetSession: opencode.forgetOpenCodeSession, bindSession: vi.fn(),
  });
});
afterEach(async () => {
  await opencode.stopOpenCodeSession(id);
  await running;
  opencode.__openCodeTestReset();
  forgetMonoRotation(id);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startOriginal() {
  hold = true;
  const accepted = vi.fn();
  running = opencode.sendOpenCodeTurn({
    sessionId: id, cwd: "/synthetic", model: "opencode:synthetic/m1", runtimeMode: "supervised", text: "Verify parser",
    onAccepted: accepted,
    onEvent: event => {
      if (event.type === "session.providerBound") sessionsRef.current[0].providerSessionId = event.providerSessionId;
    },
  });
  await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
  issued = [];
}
function steer(): (id: string, text: string) => Promise<void> {
  return evaluate(`return ${hostSteer.initializer.getText(app)};`, {
    loadMonoRotation, assertMonoRotationCurrent, TurnNotReadyError, turnGen, sessionsRef,
    flushHarnessEvents: vi.fn(), isLiveHarness: registry.isLiveHarness, canSteerHarness: registry.canSteerHarness,
    appendSteerUser, setSessions: vi.fn(), sessionWorkCwd: (session: Session) => session.cwd,
    steerHarnessTurn: registry.steerHarnessTurn,
  });
}
function handoff() {
  const forget = vi.fn();
  const complete = vi.fn();
  const result = evaluate(`return (async () => { let wrap; ${pendingSwitch.getText(app)} complete(wrap); })();`, {
    pendingSwitch: { from: "opencode", fromModel: "opencode:synthetic/m1", fromSettings: sessionsRef.current[0].modelSettings }, current: sessionsRef.current[0],
    assertMonoRotationCurrent, rotationReceipt: receipt, shouldAskOutgoingAgent: () => true,
    isLiveHarness: registry.isLiveHarness, requestOutgoingHandoff, sessionId: id, workCwd: "/synthetic", text: guidance,
    turnGen, gen: 1, TurnNotReadyError, sessionsRef, chooseHandoffBrief, forgetHarnessSession: forget, complete,
  }) as Promise<void>;
  return { result, forget, complete };
}
const changes = ["newer", "deleted", "unknown", "unreadable", "generation", "stop"] as const;
async function changeAuthority(change: typeof changes[number]) {
  if (change === "newer") expect(saveMonoRotation(id, { ...receipt, pendingBrief: "Newer restriction: never deploy.", pendingInputs: ["Never deploy."] })).toBe(true);
  if (change === "deleted") forgetMonoRotation(id);
  if (change === "unknown") localStorage.setItem(key, JSON.stringify({ [id]: { ...receipt, userRequests: [{ id: "scope", text: "Keep local.", futureAuthority: ["Never deploy."] }] } }, null, 3));
  if (change === "unreadable") localStorage.setItem(key, "{ unreadable saved authority");
  if (change === "generation") turnGen.current.set(id, 2);
  if (change === "stop") {
    turnGen.current.set(id, 2);
    await opencode.cancelOpenCodeTurn(id);
  }
}
function expectOriginal(original: Session) {
  const current = sessionsRef.current[0];
  expect(current.busy).toBe(original.busy);
  expect(current.turnReady).toBe(original.turnReady);
  expect(current.providerSessionId).toBe(original.providerSessionId);
  expect(current.blocks.slice(0, original.blocks.length)).toEqual(original.blocks);
  expect(selectAgentLiveState(current).status).toBe("running-tool");
}

it.each(changes)("host steer refuses late %s before actual registry/HTTP issuance and retains only its own draft", async change => {
  await startOriginal();
  const original = sessionsRef.current[0];
  const pending = steer()(id, guidance);
  let bytes: string | null = null;
  queueMicrotask(() => { void changeAuthority(change); bytes = localStorage.getItem(key); });
  await expect(pending).rejects.toThrow();
  expect(issued).toEqual([]);
  expect(localStorage.getItem(key)).toBe(bytes);
  expectOriginal(original);
  expect(sessionsRef.current[0].blocks.slice(-1)[0]).toMatchObject({ role: "user", text: guidance, draft: true });
});
it.each(["unknown", "unreadable"] as const)("host steer refuses initially %s authority before recording guidance", async change => {
  await startOriginal();
  await changeAuthority(change);
  const original = sessionsRef.current[0];
  const bytes = localStorage.getItem(key);
  await expect(steer()(id, guidance)).rejects.toThrow(MONO_ROTATION_READ_ERROR);
  expect(issued).toEqual([]);
  expect(sessionsRef.current[0]).toBe(original);
  expect(localStorage.getItem(key)).toBe(bytes);
});
it.each([false, true])("host steer records real guidance and preserves the original turn with provider failure=%s", async fail => {
  await startOriginal();
  const original = sessionsRef.current[0];
  providerFailure = fail;
  const pending = steer()(id, guidance);
  if (fail) await expect(pending).rejects.toThrow("synthetic provider refused request");
  else await pending;
  expect(issued).toEqual([guidance]);
  expectOriginal(original);
  expect(sessionsRef.current[0].blocks.slice(-1)[0]).toMatchObject({ role: "user", text: guidance });
  expect(sessionsRef.current[0].blocks.slice(-1)[0]?.draft).toBeUndefined();
  expect(loadMonoRotation(id)).toEqual(receipt);
});
it.each(changes)("outgoing recap refuses late %s before actual registry/HTTP issuance and cannot own the next dispatch", async change => {
  const original = sessionsRef.current[0];
  const pending = handoff();
  let bytes: string | null = null;
  queueMicrotask(() => { void changeAuthority(change); bytes = localStorage.getItem(key); });
  if (change === "generation" || change === "stop") await pending.result;
  else await expect(pending.result).rejects.toThrow(change === "unknown" || change === "unreadable" ? MONO_ROTATION_READ_ERROR : "carry changed");
  expect(issued).toEqual([]);
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(pending.forget).not.toHaveBeenCalled();
  expect(pending.complete).not.toHaveBeenCalled();
  expect(sessionsRef.current[0]).toBe(original);
});
it.each([false, true])("outgoing recap keeps accepted handoff/fallback ownership with provider failure=%s", async fail => {
  providerFailure = fail;
  const pending = handoff();
  await pending.result;
  expect(issued).toHaveLength(1);
  expect(issued[0]).toContain("Do not run git");
  expect(issued[0]).toContain(guidance);
  expect(pending.forget).toHaveBeenCalledExactlyOnceWith("opencode", id);
  expect(pending.complete).toHaveBeenCalledExactlyOnceWith({ from: "opencode", to: "opencode", text: chooseHandoffBrief("", sessionsRef.current[0], guidance) });
  expect(loadMonoRotation(id)).toEqual(receipt);
});

it.each(changes.flatMap(change => (["steer", "handoff"] as const).map(consumer => [consumer, change] as const)))("v2 %s refuses %s after awaited final model/agent configuration", async (consumer, change) => {
  version = "opencode 2.0.15";
  if (consumer === "steer") await startOriginal();
  const original = sessionsRef.current[0];
  original.modelSettings = { agent: "synthetic-agent" };
  let changed = false;
  let bytes: string | null = null;
  afterConfig = () => queueMicrotask(() => queueMicrotask(() => {
    void changeAuthority(change);
    changed = true;
    bytes = localStorage.getItem(key);
  }));
  const pending = consumer === "steer" ? { result: steer()(id, guidance) } : handoff();
  if (consumer === "handoff" && (change === "generation" || change === "stop")) await pending.result;
  else await expect(pending.result).rejects.toThrow();
  expect(changed).toBe(true);
  expect(issued).toEqual([]);
  expect(localStorage.getItem(key)).toBe(bytes);
  expectOriginal(original);
  if (consumer === "steer") expect(sessionsRef.current[0].blocks.slice(-1)[0]).toMatchObject({ text: guidance, draft: true });
  else expect(sessionsRef.current[0]).toBe(original);
});

it("outgoing helper retains supervised approval denial, question skipping and trimmed recap", async () => {
  const approval = vi.fn();
  const question = vi.fn();
  registry.registerHarness({ ...registry.getHarness("opencode")!,
    sendTurn: async input => {
      expect(input.runtimeMode).toBe("supervised");
      expect(input.validateDispatch).toBeUndefined();
      input.onEvent({ type: "approval.requested", requestId: 1, title: "Synthetic tool", command: "synthetic tool", cwd: "/synthetic" });
      input.onEvent({ type: "question.asked", requestId: 2, questions: [] });
      input.onEvent({ type: "message.delta", text: "  Keep the parser checks local.  " });
    }, respondApproval: approval, respondQuestion: question,
  });
  await expect(requestOutgoingHandoff({ harness: "opencode", sessionId: id, cwd: "/synthetic", model: "opencode:synthetic/m1", userRequest: guidance })).resolves.toBe("Keep the parser checks local.");
  expect(approval).toHaveBeenCalledExactlyOnceWith(id, 1, "deny");
  expect(question).toHaveBeenCalledExactlyOnceWith(id, 2, { kind: "skipped" });
});
it("outgoing helper retains its 45 second cancellation and deterministic fallback", async () => {
  vi.useFakeTimers();
  let reject: ((error: Error) => void) | undefined;
  const cancel = vi.fn(async () => { reject?.(new Error("synthetic timeout cancellation")); });
  registry.registerHarness({ ...registry.getHarness("opencode")!,
    sendTurn: () => new Promise<void>((_resolve, fail) => { reject = fail; }), cancelTurn: cancel,
  });
  const pending = requestOutgoingHandoff({ harness: "opencode", sessionId: id, cwd: "/synthetic", model: "opencode:synthetic/m1", userRequest: guidance });
  await vi.advanceTimersByTimeAsync(44_999);
  expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toBe("");
  expect(cancel).toHaveBeenCalledExactlyOnceWith(id);
});
