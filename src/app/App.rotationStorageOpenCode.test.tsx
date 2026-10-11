import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MonoRotation } from "../features/monos/model/monoRotation";
import type { Session } from "../features/sessions/model/session";
import type { HarnessEvent } from "../integrations/harness/core/types";

let onStdout: ((line: string) => void) | undefined;
let onSse: ((record: Record<string, unknown>) => void) | undefined;
let stored: unknown[] = [];
let texts: string[] = [];
let rejectCreate = false;
let rejectPrompt = true;
const harnessHttp = vi.fn(async (input: { url: string; method: string; body?: string }) => {
  const path = new URL(input.url).pathname;
  if (input.method === "POST" && path === "/session" && rejectCreate) {
    rejectCreate = false;
    throw Error("synthetic fresh session startup failure before binding");
  }
  if ((input.method === "POST" && path === "/session") || (input.method === "GET" && path === "/session/session_1"))
    return { status: 200, body: JSON.stringify({ id: "session_1", directory: "/repo" }) };
  if (input.method === "GET" && path.endsWith("/message"))
    return { status: 200, body: JSON.stringify(stored) };
  if (input.method === "POST" && path.endsWith("/prompt_async")) {
    const body = JSON.parse(input.body!);
    texts.push(body.parts.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n"));
    stored = [{ info: { id: "stored-attempt", sessionID: "session_1", role: "user", time: { created: 1 } }, parts: body.parts }];
    if (rejectPrompt) {
      rejectPrompt = false;
      throw Error("synthetic response lost after storing prompt");
    }
    queueMicrotask(() => onSse?.({ type: "session.status", properties: { sessionID: "session_1", status: { type: "idle" } } }));
  }
  if (input.method === "POST" && path.endsWith("/revert")) stored = [];
  return { status: 204, body: "" };
});
vi.mock("../integrations/harness/core/child", () => ({
  closeHarnessSse: vi.fn(async () => undefined),
  execChild: async () => "opencode 1.14.19",
  freeHarnessPort: async () => 4096,
  harnessHttp,
  killChild: vi.fn(async () => undefined),
  openHarnessSse: async () => undefined,
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  spawnChild: vi.fn(async () => { onStdout?.("opencode server listening on http://127.0.0.1:4096"); }),
  unwatchChild: () => undefined,
  watchChild: (_id: string, stdout: (line: string) => void) => { onStdout = stdout; },
  watchSse: (_id: string, event: (data: string) => void) => { onSse = value => event(JSON.stringify(value)); },
}));
const {
  __openCodeTestReset,
  forgetOpenCodeSession,
  rewindOpenCodeLastTurn,
  sendOpenCodeTurn,
  stopOpenCodeSession,
} = await import("../integrations/harness/providers/opencode/opencode");
const {
  acceptMonoRotation,
  forgetMonoRotation,
  loadMonoRotation,
  MONO_ROTATION_READ_ERROR,
  rotateProviderContext,
  saveMonoRotation,
  sessionRotationStatus,
} = await import("../features/monos/model/monoRotation");
const { assembleMonoPrompt } = await import("../features/monos/model/monoPrompt");
const { createEditedResendAttempt } = await import("../features/sessions/model/editLastTurn");
const { newSession } = await import("../features/sessions/model/session");
const { applyHarnessEvents } = await import("../integrations/harness/core/apply");
const { selectAgentLiveState } = await import("../features/agents/model/agentLiveState");
const { deliverQueuedFollowUp } = await import("../features/sessions/model/queuedFollowUp");
const { acknowledgeMonoMessage } = await import("../features/monos/model/monoMessaging");
const { displayAttachments } = await import("../features/sessions/model/attachments");
const { inboxAskPrompt } = await import("../features/inbox/model/inboxAsk");

// Run the real App guards and prompt carry without launching a native workspace.
const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(app);
  if (!found) throw Error("App rotation guard not found");
  return found;
}
const savedRotation = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(app) === "savedRotation");
const pendingEdit = findNode(node => ts.isIfStatement(node) && node.expression.getText(app).startsWith("options?.resendEdited && savedRotation"));
const preflightSource = app.text.slice(savedRotation.parent.parent.getStart(app), pendingEdit.end);
const preflight = new Function("sessionId", "options", "loadMonoRotation", "MONO_ROTATION_READ_ERROR", "enqueueHarnessEvent", "flushHarnessEvents", "proceed",
  ts.transpile(`${preflightSource}\nreturn proceed();`, { target: ts.ScriptTarget.ES2022 }));
const carrySource = findNode(node => ts.isIfStatement(node) && node.expression.getText(app) === "monoRotation" && node.getText(app).includes("appContext.push"));
const carry = new Function("monoRotation", "appContext", "sessionId", ts.transpile(carrySource.getText(app), { target: ts.ScriptTarget.ES2022 }));
const rewindPreparationAt = app.text.indexOf("const earlier = queuedHandoff", savedRotation.getStart(app));
const beforeRewind = findNode(node => ts.isIfStatement(node) && node.expression.getText(app) === "loadMonoRotation(sessionId) === null" && node.getStart(app) > rewindPreparationAt);
const afterPreparation = new Function("sessionId", "loadMonoRotation", "MONO_ROTATION_READ_ERROR", "rewind", "dispatch",
  ts.transpile(`return (async () => { ${beforeRewind.getText(app)} await rewind(); await dispatch(); })();`, { target: ts.ScriptTarget.ES2022 }));
const providerPreparation = findNode(node => ts.isPropertyAssignment(node) && node.name.getText(app) === "prepareText" && node.getText(app).includes("const preparedText")) as ts.PropertyAssignment;
const prepareForProvider = new Function("sessionId", "loadMonoRotation", "MONO_ROTATION_READ_ERROR", "prepareContext", "text",
  ts.transpile(`let contextProvider; const monoWorkingDirectoryMigrationPending = () => false; return ${providerPreparation.initializer.getText(app)};`, { target: ts.ScriptTarget.ES2022 }));
const sendTurn = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(app) === "sendTurn") as ts.VariableDeclaration;
const sendAfterContext = new Function("sessionId", "loadMonoRotation", "MONO_ROTATION_READ_ERROR", "prepareContext", "sendHarnessTurn",
  ts.transpile(`let contextProvider; return ${sendTurn.initializer!.getText(app)};`, { target: ts.ScriptTarget.ES2022 }));
const queuedSteer = findNode(node => ts.isCallExpression(node) && node.expression.getText(app) === "deliverQueuedFollowUp");
const directSteer = findNode(node => ts.isArrowFunction(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true &&
  ts.isBlock(node.body) && node.body.statements.some(statement => ts.isTryStatement(statement) && statement.getText(app).includes("await steerHarnessTurn") && statement.getText(app).includes("initialWorkCwd")));
const providerSwitch = findNode(node => ts.isIfStatement(node) && node.expression.getText(app) === "pendingSwitch" && node.getText(app).includes("requestOutgoingHandoff"));

const KEY = "monocode:mono-rotations";
const id = "rotation-storage-opencode";
const restriction = "Never read /synthetic/private; use only /synthetic/approved.";
const assignment = "Original assignment (verbatim): Verify the parser only in the retained checkout.";
const firstRequest = "Continue the parser task.";
const replacement = "Verify tests only.";
type RotationPlan = NonNullable<ReturnType<typeof sessionRotationStatus>["plan"]>;
type SubmitOptions = {
  resendEdited?: boolean;
  onResendRejected?: (recovery: { providerRewound: boolean }) => void;
  onSettled?: (result: unknown) => void;
};

function submit(options: SubmitOptions, proceed: () => Promise<void>) {
  const events = vi.fn();
  const flush = vi.fn();
  return { result: preflight(id, options, loadMonoRotation, MONO_ROTATION_READ_ERROR, events, flush, proceed), events, flush };
}

function originalSession(): Session {
  return {
    ...newSession("opencode", "/repo"), id,
    model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
    providerSessionId: "old", context: { used: 700, window: 1000 },
    orchestrationLeadId: "lead",
    blocks: [{ id: "scope", role: "user", text: restriction }, { id: "done", role: "assistant", text: "Checkpoint ready." }],
  };
}

function busySession(): Session {
  return {
    ...originalSession(), busy: true, turnReady: true,
    queuedMessages: [{ id: "queued-followup", blockId: "queued-bubble", text: "Check the parser tests next.", attachments: [] }],
    queueStatus: "active",
    blocks: [
      { id: "scope", role: "user", text: firstRequest, startedAt: 1000 },
      { id: "active-answer", role: "assistant", text: "Checking parser tests.", streaming: true },
      { id: "active-tool", role: "tool", text: "Running tests", streaming: true, tool: { callId: "active-tool", title: "npm test", status: "running" } },
      { id: "queued-bubble", role: "user", text: "Check the parser tests next." },
    ],
  };
}

function expectActiveTurn(retained: Session, active: Session) {
  expect(retained.busy).toBe(true);
  expect(retained.turnReady).toBe(true);
  expect(retained.providerSessionId).toBe(active.providerSessionId);
  expect(retained.blocks.find(block => block.id === "active-answer")).toEqual(active.blocks[1]);
  expect(retained.blocks.find(block => block.id === "active-tool")).toEqual(active.blocks[2]);
  expect(selectAgentLiveState(retained).status).toBe("running-tool");
}

function input(session: Session, bound = vi.fn()) {
  return {
    sessionId: id, cwd: session.cwd, model: session.model, runtimeMode: session.runtimeMode,
    onEvent: (event: HarnessEvent) => {
      if (event.type === "session.providerBound") {
        bound();
        session.providerSessionId = event.providerSessionId;
      }
    },
  };
}

function persist(plan: RotationPlan): MonoRotation {
  const receipt = { ...plan.rotation, pendingBrief: plan.rotation.pendingBrief ?? plan.brief(id) };
  expect(saveMonoRotation(id, receipt)).toBe(true);
  return receipt;
}

function prepare(plan: RotationPlan, text: string): string {
  const context: string[] = [];
  carry(plan, context, id);
  return assembleMonoPrompt(text, context, false, false);
}

function readFault(mode: string) {
  const getItem = localStorage.getItem.bind(localStorage);
  return vi.spyOn(localStorage, "getItem").mockImplementation(key => {
    if (key !== KEY) return getItem(key);
    if (mode === "throws") throw Error("synthetic storage read unavailable");
    return mode === "null" ? "null" : "{invalid-json";
  });
}

async function recover(session: Session) {
  const reloaded: Session = JSON.parse(JSON.stringify(session));
  const plan = sessionRotationStatus(reloaded, "Retry", assignment).plan!;
  expect(plan).toBeDefined();
  const receipt = persist(plan);
  const fresh = await rotateProviderContext(reloaded, () => forgetOpenCodeSession(id));
  const accepted = vi.fn(() => acceptMonoRotation(id, receipt.at, undefined, receipt));
  const prepared = vi.fn(async () => prepare(plan, "Retry"));
  rejectPrompt = false;
  const sent = submit({}, () => sendOpenCodeTurn({ ...input(fresh), text: "Retry", prepareText: prepared, onAccepted: accepted }));
  await sent.result;
  expect(prepared).toHaveBeenCalledOnce();
  expect(accepted).toHaveBeenCalledOnce();
  const delivered = texts[texts.length - 1];
  expect(delivered).toContain(restriction);
  expect(delivered).toContain(assignment);
  expect(delivered).toContain(firstRequest);
  expect(delivered).not.toContain(replacement);
  expect(loadMonoRotation(id)?.pendingBrief).toBeUndefined();
  const settled: MonoRotation = JSON.parse(localStorage.getItem(KEY)!)[id];
  expect(settled.pendingBrief).toBeUndefined();
  expect(settled.pendingInput).toBeUndefined();
  expect(settled.pendingInputs).toBeUndefined();
  expect(settled.userRequests).toEqual(receipt.userRequests);
  expect(createEditedResendAttempt({ ...fresh, busy: false })).not.toBeNull();
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  __openCodeTestReset();
  harnessHttp.mockClear();
  stored = []; texts = []; rejectPrompt = true; rejectCreate = false;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopOpenCodeSession(id);
  __openCodeTestReset();
  forgetMonoRotation(id);
  vi.unstubAllGlobals();
});

it.each(["throws", "invalid JSON", "null"])("blocks actual OpenCode Retry after fresh startup fails before binding when carry read %s, then recovers", async mode => {
  const original = originalSession();
  const first = sessionRotationStatus(original, firstRequest, assignment).plan!;
  persist(first);
  const durable = localStorage.getItem(KEY);
  const fresh = await rotateProviderContext(original, () => forgetOpenCodeSession(id));
  const bound = vi.fn();
  const accepted = vi.fn();
  rejectCreate = true;
  await expect(sendOpenCodeTurn({ ...input(fresh, bound), text: firstRequest, prepareText: async () => prepare(first, firstRequest), onAccepted: accepted })).rejects.toThrow("startup failure");
  expect(bound).not.toHaveBeenCalled();
  expect(accepted).not.toHaveBeenCalled();
  expect(texts).toEqual([]);
  fresh.blocks.push({ id: "failed-attempt", role: "user", text: firstRequest });
  fresh.busy = false;
  const read = readFault(mode);
  expect(loadMonoRotation(id)).toBeNull();
  expect(sessionRotationStatus(fresh, "Retry")).toEqual({ deferredReason: MONO_ROTATION_READ_ERROR });
  const prepared = vi.fn(async () => "Retry");
  const dispatched = vi.fn(() => sendOpenCodeTurn({ ...input(fresh), text: "Retry", prepareText: prepared, onAccepted: accepted }));
  const settled = vi.fn();
  const sent = submit({ onSettled: settled }, async () => { await prepared(); await dispatched(); });
  expect(sent.result).toBe(false);
  expect(prepared).not.toHaveBeenCalled();
  expect(dispatched).not.toHaveBeenCalled();
  expect(accepted).not.toHaveBeenCalled();
  expect(texts).toEqual([]);
  expect(sent.events).toHaveBeenCalledWith(id, { type: "session.error", message: MONO_ROTATION_READ_ERROR });
  expect(settled).toHaveBeenCalledWith({ status: "failed", text: "", error: MONO_ROTATION_READ_ERROR });
  read.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(durable);
  await recover(fresh);
});

it.each(["throws", "invalid JSON", "null"])("blocks edited OpenCode preparation and rewind after lost response and Stop when carry read %s, then recovers", async mode => {
  const original = originalSession();
  const first = sessionRotationStatus(original, firstRequest, assignment).plan!;
  persist(first);
  const durable = localStorage.getItem(KEY);
  const fresh = await rotateProviderContext(original, () => forgetOpenCodeSession(id));
  await expect(sendOpenCodeTurn({ ...input(fresh), text: firstRequest, prepareText: async () => prepare(first, firstRequest) })).rejects.toThrow("synthetic response lost");
  fresh.blocks.push({ id: "failed-attempt", role: "user", text: firstRequest });
  fresh.busy = false;
  await stopOpenCodeSession(id);
  expect(texts[0]).toContain(restriction);
  expect(stored).toHaveLength(1);
  const providerPrompt = JSON.stringify(stored);
  expect(createEditedResendAttempt(fresh)).toBeNull();
  const read = readFault(mode);
  expect(loadMonoRotation(id)).toBeNull();
  expect(createEditedResendAttempt(fresh)).toBeNull();
  const prepared = vi.fn(async () => replacement);
  const rewind = vi.fn(() => rewindOpenCodeLastTurn(input(fresh)));
  const accepted = vi.fn();
  const dispatched = vi.fn(() => sendOpenCodeTurn({ ...input(fresh), text: replacement, onAccepted: accepted }));
  const rejected = vi.fn();
  const settled = vi.fn();
  const sent = submit({ resendEdited: true, onResendRejected: rejected, onSettled: settled }, async () => {
    await prepared(); await rewind(); await dispatched();
  });
  expect(sent.result).toBe(false);
  expect(prepared).not.toHaveBeenCalled();
  expect(rewind).not.toHaveBeenCalled();
  expect(dispatched).not.toHaveBeenCalled();
  expect(accepted).not.toHaveBeenCalled();
  expect(rejected).toHaveBeenCalledWith({ providerRewound: false });
  expect(settled).toHaveBeenCalledWith({ status: "failed", text: "", error: MONO_ROTATION_READ_ERROR });
  expect(sent.events).toHaveBeenCalledWith(id, { type: "session.error", message: MONO_ROTATION_READ_ERROR });
  expect(harnessHttp.mock.calls.filter(([request]) => new URL(request.url).pathname.endsWith("/revert"))).toEqual([]);
  expect(JSON.stringify(stored)).toBe(providerPrompt);
  expect(texts).toHaveLength(1);
  read.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(durable);
  await recover(fresh);
});

it("stops an already prepared edit when storage fails during prompt preparation, before actual adapter rewind or dispatch", async () => {
  const original = originalSession();
  const first = sessionRotationStatus(original, firstRequest, assignment).plan!;
  const receipt = persist(first);
  const fresh = await rotateProviderContext(original, () => forgetOpenCodeSession(id));
  rejectPrompt = false;
  await sendOpenCodeTurn({ ...input(fresh), text: firstRequest, prepareText: async () => prepare(first, firstRequest), onAccepted: () => acceptMonoRotation(id, receipt.at, undefined, receipt) });
  fresh.blocks.push({ id: "accepted-attempt", role: "user", text: firstRequest });
  fresh.busy = false;
  const edited = createEditedResendAttempt(fresh)!;
  expect(edited).not.toBeNull();
  const providerPrompt = JSON.stringify(stored);
  const durable = localStorage.getItem(KEY);
  let read: ReturnType<typeof readFault> | undefined;
  const prepared = vi.fn(async () => {
    await Promise.resolve();
    read = readFault("throws");
    return replacement;
  });
  const rewind = vi.fn(() => rewindOpenCodeLastTurn(input(fresh)));
  const dispatched = vi.fn(() => sendOpenCodeTurn({ ...input(fresh), text: replacement, onAccepted: () => edited.markAccepted() }));
  const sent = submit({ resendEdited: true }, async () => {
    await prepared();
    await afterPreparation(id, loadMonoRotation, MONO_ROTATION_READ_ERROR, rewind, dispatched);
  });
  await expect(sent.result).rejects.toThrow(MONO_ROTATION_READ_ERROR);
  expect(prepared).toHaveBeenCalledOnce();
  expect(rewind).not.toHaveBeenCalled();
  expect(dispatched).not.toHaveBeenCalled();
  expect(edited.isAccepted()).toBe(false);
  expect(JSON.stringify(stored)).toBe(providerPrompt);
  expect(texts).toHaveLength(1);
  read!.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(durable);
});

it("actual OpenCode prompt preparation refuses an outage that begins while provider context is being prepared", async () => {
  const original = originalSession();
  const first = sessionRotationStatus(original, firstRequest, assignment).plan!;
  const receipt = persist(first);
  const fresh = await rotateProviderContext(original, () => forgetOpenCodeSession(id));
  const durable = localStorage.getItem(KEY);
  let read: ReturnType<typeof readFault> | undefined;
  const prepareContext = vi.fn(async () => {
    await Promise.resolve();
    read = readFault("throws");
    return prepare(first, firstRequest);
  });
  const preparedText = prepareForProvider(id, loadMonoRotation, MONO_ROTATION_READ_ERROR, prepareContext, firstRequest);
  const accepted = vi.fn(() => acceptMonoRotation(id, receipt.at, undefined, receipt));
  rejectPrompt = false;
  await expect(sendOpenCodeTurn({ ...input(fresh), text: firstRequest, prepareText: preparedText, onAccepted: accepted })).rejects.toThrow(MONO_ROTATION_READ_ERROR);
  expect(prepareContext).toHaveBeenCalledOnce();
  expect(accepted).not.toHaveBeenCalled();
  expect(texts).toEqual([]);
  expect(stored).toEqual([]);
  read!.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(durable);
  await recover(fresh);
});

it("actual App send callback stops before adapter dispatch if fallback context preparation loses readable storage", async () => {
  const original = originalSession();
  const first = sessionRotationStatus(original, firstRequest, assignment).plan!;
  persist(first);
  const fresh = await rotateProviderContext(original, () => forgetOpenCodeSession(id));
  const durable = localStorage.getItem(KEY);
  let read: ReturnType<typeof readFault> | undefined;
  const prepareContext = vi.fn(async () => {
    await Promise.resolve();
    read = readFault("throws");
    return prepare(first, firstRequest);
  });
  const dispatched = vi.fn(() => sendOpenCodeTurn({ ...input(fresh), text: firstRequest }));
  const send = sendAfterContext(id, loadMonoRotation, MONO_ROTATION_READ_ERROR, prepareContext, dispatched);
  const sent = submit({}, () => send(firstRequest, []));
  await expect(sent.result).rejects.toThrow(MONO_ROTATION_READ_ERROR);
  expect(prepareContext).toHaveBeenCalledOnce();
  expect(dispatched).not.toHaveBeenCalled();
  expect(texts).toEqual([]);
  read!.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(durable);
  await recover(fresh);
});

it("busy App preflight refuses a follow-up without stopping the current turn or pausing its existing queue", () => {
  const active = busySession();
  readFault("throws");
  const prepared = vi.fn(async () => replacement);
  const dispatched = vi.fn(async () => undefined);
  const proceed = vi.fn(async () => { await prepared(); await dispatched(); });
  const sent = submit({}, proceed);
  expect(sent.result).toBe(false);
  expect(proceed).not.toHaveBeenCalled();
  expect(prepared).not.toHaveBeenCalled();
  expect(dispatched).not.toHaveBeenCalled();
  const retained = applyHarnessEvents(active, sent.events.mock.calls.map(([_id, event]) => event as HarnessEvent));
  expectActiveTurn(retained, active);
  expect(retained.queuedMessages).toBe(active.queuedMessages);
  expect(retained.queueStatus).toBe("active");
  expect(selectAgentLiveState(retained)).toMatchObject({ status: "running-tool", detail: "npm test", warning: MONO_ROTATION_READ_ERROR });
});

it("actual queued follow-up callback refuses steering after preparation loses storage, retaining the active turn and failed payload", async () => {
  const active = busySession();
  const sessionsRef = { current: [active] };
  const preparePrompt = vi.fn(async () => {
    await Promise.resolve();
    readFault("throws");
    return replacement;
  });
  const steerHarnessTurn = vi.fn(async () => undefined);
  const scope = {
    deliverQueuedFollowUp, message: active.queuedMessages![0], sessionsRef, sessionId: id,
    turnGen: { current: new Map([[id, 1]]) }, gen: 1, upsertSession: vi.fn(async () => undefined),
    prepareAttachments: vi.fn(async () => []), attachments: [], preparePrompt, harnessText: replacement,
    current: active, initialWorkCwd: active.cwd, loadMonoRotation, MONO_ROTATION_READ_ERROR,
    steerHarnessTurn, inboxAskPrompt, rawCommand: false, acknowledgeMonoMessage,
    change: (update: (session: Session) => Session) => { sessionsRef.current = sessionsRef.current.map(update); },
    submittedText: replacement, displayAttachments, userTurnCards: () => undefined, noteCard: undefined,
    flushHarnessEvents: vi.fn(),
  };
  const sent = new Function(...Object.keys(scope), ts.transpile(`return ${queuedSteer.getText(app)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  expect(await sent).toBe(false);
  expect(preparePrompt).toHaveBeenCalledOnce();
  expect(steerHarnessTurn).not.toHaveBeenCalled();
  const retained = sessionsRef.current[0];
  expectActiveTurn(retained, active);
  expect(retained.queueStatus).toBe("paused");
  expect(retained.queuedMessages).toEqual([{ ...active.queuedMessages![0], error: MONO_ROTATION_READ_ERROR }]);
});

it("actual direct busy-steer callback refuses an outage during preparation without stopping the current turn", async () => {
  const active = busySession();
  const events: HarnessEvent[] = [];
  const preparePrompt = vi.fn(async () => {
    await Promise.resolve();
    readFault("throws");
    return replacement;
  });
  const steerHarnessTurn = vi.fn(async () => undefined);
  const scope = {
    prepareAttachments: vi.fn(async () => []), attachments: [], preparePrompt, harnessText: replacement,
    current: active, sessionId: id, initialWorkCwd: active.cwd, loadMonoRotation, MONO_ROTATION_READ_ERROR,
    steerHarnessTurn, inboxAskPrompt, rawCommand: false,
    enqueueHarnessEvent: (_id: string, event: HarnessEvent) => events.push(event), flushHarnessEvents: vi.fn(),
  };
  const send = new Function(...Object.keys(scope), ts.transpile(`return ${directSteer.getText(app)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  await send();
  expect(preparePrompt).toHaveBeenCalledOnce();
  expect(steerHarnessTurn).not.toHaveBeenCalled();
  expect(events).toEqual([{ type: "session.error", message: MONO_ROTATION_READ_ERROR }]);
  const retained = applyHarnessEvents(active, events);
  expectActiveTurn(retained, active);
  expect(retained.queuedMessages).toBe(active.queuedMessages);
  expect(retained.queueStatus).toBe("active");
  expect(selectAgentLiveState(retained)).toMatchObject({ status: "running-tool", warning: MONO_ROTATION_READ_ERROR });
});

it.each(["before handoff", "after handoff"])("actual provider-switch branch refuses unreadable storage %s before forgetting or dispatching", async mode => {
  const current = originalSession();
  const first = sessionRotationStatus(current, firstRequest, assignment).plan!;
  persist(first);
  const durable = localStorage.getItem(KEY);
  let read: ReturnType<typeof readFault> | undefined;
  if (mode === "before handoff") read = readFault("throws");
  const requestOutgoingHandoff = vi.fn(async () => {
    await Promise.resolve();
    read = readFault("throws");
    return "Retain parser scope.";
  });
  const forgetHarnessSession = vi.fn(() => forgetOpenCodeSession(id));
  const dispatch = vi.fn(() => sendOpenCodeTurn({ ...input(current), text: replacement }));
  const scope = {
    pendingSwitch: { from: "opencode", fromModel: current.model, fromSettings: current.modelSettings },
    loadMonoRotation, MONO_ROTATION_READ_ERROR, current, shouldAskOutgoingAgent: () => true,
    isLiveHarness: () => true, requestOutgoingHandoff, sessionId: id, workCwd: current.cwd, text: replacement,
    turnGen: { current: new Map([[id, 1]]) }, gen: 1, sessionsRef: { current: [current] },
    chooseHandoffBrief: (agentText: string) => agentText, forgetHarnessSession, dispatch,
  };
  const switched = new Function(...Object.keys(scope), ts.transpile(`return (async () => { let wrap; ${providerSwitch.getText(app)} await dispatch(); })();`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  await expect(switched).rejects.toThrow(MONO_ROTATION_READ_ERROR);
  expect(requestOutgoingHandoff).toHaveBeenCalledTimes(mode === "before handoff" ? 0 : 1);
  expect(forgetHarnessSession).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(texts).toEqual([]);
  expect(current.providerSessionId).toBe("old");
  read!.mockRestore();
  expect(localStorage.getItem(KEY)).toBe(durable);
});

it("keeps the actual App preflight before edited preparation, rewind and provider dispatch", () => {
  const preflightAt = savedRotation.getStart(app);
  for (const marker of ["createEditedResendAttempt(current", "await prepareAttachments(attachments)", "await rewindHarnessLastTurn(", "return sendHarnessTurn("])
    expect(app.text.indexOf(marker, preflightAt), marker).toBeGreaterThan(pendingEdit.end);
  expect(beforeRewind.getStart(app)).toBeLessThan(app.text.indexOf("await rewindHarnessLastTurn(", preflightAt));
});
