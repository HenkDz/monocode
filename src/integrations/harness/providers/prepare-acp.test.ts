import { describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../core/types";
import { assertMonoRotationCurrent, saveMonoRotation, type MonoRotation } from "../../../features/monos/model/monoRotation";

// Ported from CC1FR's prepare-acp.test.ts; only the child transport is synthetic.
const mock = vi.hoisted(() => ({
  listeners: new Map<string, (line: string) => void>(),
  writes: [] as {
    child: string;
    method?: string;
    id?: number;
    params?: { prompt?: unknown[] };
  }[],
  failRestore: false,
  setupId: "fresh",
  cancelGate: undefined as Promise<void> | undefined,
  rejectSteer: undefined as (() => void) | undefined,
}));

vi.mock("../core/child", () => ({
  resolveCursorBinary: async () => ({ path: "/synthetic/cursor" }),
  resolveDevinBinary: async () => ({ path: "/synthetic/devin" }),
  resolveFxBinary: async () => ({ path: "/synthetic/fx" }),
  resolveGrokBinary: async () => ({ path: "/synthetic/grok" }),
  resolveHermesBinary: async () => ({ path: "/synthetic/hermes" }),
  resolveAntigravityBinary: async () => ({ path: "/synthetic/agy", args: [] }),
  spawnChild: async () => undefined,
  killChild: async (id: string) => { mock.listeners.delete(id); },
  unwatchChild: (id: string) => { mock.listeners.delete(id); },
  watchChild: (id: string, line: (line: string) => void) => { mock.listeners.set(id, line); },
  execChild: async () => "Logged in.\n  Credentials path: /synthetic/credentials.toml\n",
  readHarnessTextFile: async () => { throw new Error("No synthetic file"); },
  writeChild: async (child: string, line: string) => {
    const message = JSON.parse(line);
    mock.writes.push({ child, ...message });
    if (message.method === "session/steer" && mock.rejectSteer) {
      mock.rejectSteer();
      throw new Error("synthetic first steer write failure");
    }
    if (message.method === "session/cancel" && mock.cancelGate) return mock.cancelGate;
    if (message.id == null || !message.method) return;
    queueMicrotask(() => {
      const method = message.method;
      const restore = method === "session/load" || method === "session/resume";
      if (restore && mock.failRestore) {
        mock.listeners.get(child)?.(JSON.stringify({ jsonrpc: "2.0", id: message.id,
          error: { code: -32601, message: "unknown session" } }));
        return;
      }
      const result = method === "initialize"
        ? { protocolVersion: 1, authMethods: [{ id: "cached_token" }], _meta: { defaultAuthMethodId: "cached_token" } }
        : method === "session/new" || restore
          ? { sessionId: mock.setupId, models: { currentModelId: "m1" }, configOptions: [
              { id: "model", category: "model", currentValue: "m1", options: [{ value: "m1", name: "Synthetic" }] },
              { id: "mode", category: "mode", currentValue: "ask" },
            ] }
          : method === "session/prompt" ? { stopReason: "end_turn" } : {};
      mock.listeners.get(child)?.(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  },
}));
vi.mock("../../../platform/tauri/fs", () => ({ homeDir: async () => "/synthetic" }));
vi.mock("./cursor/cursorStore", () => ({
  readStoredCursorToolCalls: async () => [], readStoredCursorSubagentRuns: async () => [],
}));

const cursor = await import("./cursor/cursor");
const devin = await import("./devin/devin");
const fx = await import("./fx/fx");
const grok = await import("./grok/grok");
const hermes = await import("./hermes/hermes");
const agy = await import("./antigravity/antigravity");

const providers = [
  { id: "cursor", send: cursor.sendCursorTurn, bind: cursor.bindCursorSession, forget: cursor.forgetCursorSession, cancel: cursor.cancelCursorTurn, stop: cursor.stopCursorSession, attachments: true, accepts: true },
  { id: "devin", send: devin.sendDevinTurn, bind: devin.bindDevinSession, forget: devin.forgetDevinSession, cancel: devin.cancelDevinTurn, stop: devin.stopDevinSession, attachments: true, accepts: false },
  { id: "fx", send: fx.sendFxTurn, bind: fx.bindFxSession, forget: fx.forgetFxSession, cancel: fx.cancelFxTurn, stop: fx.stopFxSession, attachments: false, accepts: false },
  { id: "grok", send: grok.sendGrokTurn, bind: grok.bindGrokSession, forget: grok.forgetGrokSession, cancel: grok.cancelGrokTurn, stop: grok.stopGrokSession, attachments: true, accepts: false },
  { id: "hermes", send: hermes.sendHermesTurn, bind: hermes.bindHermesSession, forget: hermes.forgetHermesSession, cancel: hermes.cancelHermesTurn, stop: hermes.stopHermesSession, attachments: true, accepts: true },
  { id: "antigravity", send: agy.sendAntigravityTurn, bind: agy.bindAntigravitySession, forget: agy.forgetAntigravitySession, cancel: agy.cancelAntigravityTurn, stop: agy.stopAntigravitySession, attachments: true, accepts: false },
];
let sequence = 0;

it("Cursor revalidates before its awaited steer fallback and retains the newer receipt", async () => {
  const id = `cursor-fallback-${++sequence}`;
  mock.writes.length = 0;
  mock.failRestore = false;
  mock.setupId = "fresh";
  const bytes = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => bytes.get(key) ?? null, setItem: (key: string, value: string) => bytes.set(key, value) });
  const receipt: MonoRotation = { at: 1, reason: "context", earlier: [], userRequests: [{ id: "scope", text: "Parser only." }] };
  expect(saveMonoRotation(id, receipt)).toBe(true);
  const newer = { ...receipt, userRequests: [...receipt.userRequests!, { id: "restriction", text: "Never publish." }] };
  const base = input(providers[0], id);
  try {
    await cursor.sendCursorTurn(base);
    const validateDispatch = vi.fn(() => assertMonoRotationCurrent(id, receipt));
    await cursor.steerCursorTurn({ ...base, text: "Valid follow up", validateDispatch });
    expect(validateDispatch).toHaveBeenCalledOnce();
    mock.writes.length = 0;
    mock.rejectSteer = () => { expect(saveMonoRotation(id, newer)).toBe(true); };
    await expect(cursor.steerCursorTurn({ ...base, text: "Follow up", validateDispatch })).rejects.toThrow("carry changed");
    expect(validateDispatch).toHaveBeenCalledTimes(3);
    expect(mock.writes.map(message => message.method)).toEqual(["session/steer"]);
    expect(JSON.parse(bytes.get("monocode:mono-rotations")!)[id]).toEqual(newer);
  } finally { mock.rejectSteer = undefined; await cursor.forgetCursorSession(id); vi.unstubAllGlobals(); }
});

it.each([
  { id: "devin", steer: devin.steerDevinTurn }, { id: "fx", steer: fx.steerFxTurn },
  { id: "grok", steer: grok.steerGrokTurn },
  { id: "antigravity", steer: agy.steerAntigravityTurn },
])("$id retains its explicit unsupported steer refusal", async provider => {
  mock.writes.length = 0;
  await expect(provider.steer({ sessionId: "unsupported", cwd: "/synthetic", model: `${provider.id}:m1`, text: "Follow up", validateDispatch: () => { throw new Error("Must not dispatch"); } })).rejects.toThrow("does not support steering an in-flight turn");
  expect(mock.writes).toHaveLength(0);
});

it.each([
  { provider: providers[0], steer: cursor.steerCursorTurn },
  { provider: providers[4], steer: hermes.steerHermesTurn },
])("$provider.id validates supported steering at the existing ACP session", async ({ provider, steer }) => {
  const id = `steer-${provider.id}-${++sequence}`;
  mock.writes.length = 0; mock.failRestore = false; mock.setupId = "fresh";
  const base = input(provider, id);
  try {
    await provider.send(base);
    const count = mock.writes.length;
    const validateDispatch = vi.fn(() => { throw new Error("newer protected receipt"); });
    await expect(steer({ ...base, text: "Follow up", validateDispatch })).rejects.toThrow("newer protected receipt");
    expect(validateDispatch).toHaveBeenCalledOnce();
    expect(mock.writes).toHaveLength(count);
    const valid = vi.fn();
    await steer({ ...base, text: "Follow up", validateDispatch: valid });
    expect(valid).toHaveBeenCalledOnce();
    expect(mock.writes).toHaveLength(count + 1);
    expect(mock.writes.at(-1)).toMatchObject({ params: { sessionId: "fresh" } });
  } finally { await provider.forget(id); }
});
const image = { id: "image", name: "synthetic.png", mimeType: "image/png", kind: "image" as const, size: 3, data: "YWJj" };
const input = (provider: (typeof providers)[number], id: string) => ({
  sessionId: id, cwd: "/synthetic", model: `${provider.id}:m1`, runtimeMode: "supervised" as const,
  text: "FULL FALLBACK", attachments: provider.attachments ? [image] : [],
  onEvent: vi.fn<SendTurnInput["onEvent"]>(), onAccepted: vi.fn(),
});
const prompts = () => mock.writes.filter(message => message.method === "session/prompt");

describe.each(providers)("$id preparation with a synthetic ACP child", provider => {
  it.each(["newer", "deleted", "unreadable", "stopped"])("refuses %s authority after the final preparation microtask, before transport", async change => {
    mock.writes.length = 0;
    mock.failRestore = false;
    mock.setupId = "fresh";
    const id = `authority-${provider.id}-${++sequence}`;
    const bytes = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => bytes.get(key) ?? null, setItem: (key: string, value: string) => bytes.set(key, value) });
    const receipt: MonoRotation = { at: 1, reason: "context", earlier: [], userRequests: [{ id: "scope", text: "Parser only." }] };
    expect(saveMonoRotation(id, receipt)).toBe(true);
    let generation = 1;
    let changedBytes: string | undefined;
    const prepareText = async () => {
      queueMicrotask(() => queueMicrotask(() => {
        if (change === "newer") expect(saveMonoRotation(id, { ...receipt, userRequests: [...receipt.userRequests!, { id: "new", text: "Never publish." }] })).toBe(true);
        else if (change === "deleted") bytes.clear();
        else if (change === "unreadable") bytes.set("monocode:mono-rotations", "{unknown");
        else generation++;
        changedBytes = bytes.get("monocode:mono-rotations");
      }));
      await Promise.resolve();
      assertMonoRotationCurrent(id, receipt);
      return "Parser only.";
    };
    const validateDispatch = vi.fn(() => {
      if (generation !== 1) throw new Error("stopped generation");
      assertMonoRotationCurrent(id, receipt);
    });
    const base = input(provider, id);
    try {
      await expect(provider.send({ ...base, prepareText, validateDispatch })).rejects.toThrow();
      expect(validateDispatch).toHaveBeenCalledOnce();
      expect(prompts()).toHaveLength(0);
      expect(base.onAccepted).not.toHaveBeenCalled();
      expect(bytes.get("monocode:mono-rotations")).toBe(changedBytes);
    } finally { await provider.forget(id); vi.unstubAllGlobals(); }
  });
  it.each([false, true])("prepares once before serialization, retained=%s, and keeps attachments", async retained => {
    const id = `hook-${provider.id}-${++sequence}`;
    mock.writes.length = 0;
    mock.failRestore = !retained;
    mock.setupId = retained ? "old" : "fresh";
    provider.bind(id, "old", "/synthetic");
    const prepareText = vi.fn(async (confirmed?: string) => {
      expect(prompts()).toHaveLength(0);
      expect(confirmed).toBe(retained ? "old" : "fresh");
      return retained ? "OMITTED CONTEXT" : "FULL REBUILT CONTEXT";
    });
    try {
      await provider.send({ ...input(provider, id), prepareText });
      expect(prepareText).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(1);
      const blocks = prompts()[0].params!.prompt!;
      expect(blocks[0]).toEqual({ type: "text", text: retained ? "OMITTED CONTEXT" : "FULL REBUILT CONTEXT" });
      expect(JSON.stringify(blocks)).not.toContain("FULL FALLBACK");
      if (provider.attachments) expect(blocks).toContainEqual({ type: "image", mimeType: image.mimeType, data: image.data });
    } finally { await provider.forget(id); }
  });

  it("propagates preparation failure without prompt or acceptance", async () => {
    const id = `throw-${provider.id}-${++sequence}`;
    mock.writes.length = 0;
    mock.failRestore = false;
    mock.setupId = "fresh";
    const base = input(provider, id);
    const prepareText = vi.fn(async () => { throw new Error("synthetic preparation failure"); });
    try {
      await expect(provider.send({ ...base, prepareText })).rejects.toThrow("synthetic preparation failure");
      expect(prepareText).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(0);
      expect(base.onAccepted).not.toHaveBeenCalled();
    } finally { await provider.forget(id); }
  });

  it.each(["cancel", "ui-stop", "stop"] as const)("%s during deferred preparation skips submission and allows the next turn", async action => {
    const id = `${action}-${provider.id}-${++sequence}`;
    mock.writes.length = 0;
    mock.failRestore = false;
    mock.setupId = "fresh";
    let releaseText!: (text: string) => void;
    let releaseCancel!: () => void;
    mock.cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
    const base = input(provider, id);
    const prepareText = vi.fn(() => new Promise<string>(resolve => { releaseText = resolve; }));
    const turn = provider.send({ ...base, prepareText });
    const settled = turn.then(() => true, () => false);
    let stopping: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(prepareText).toHaveBeenCalledTimes(1));
      if (action === "stop") {
        stopping = provider.stop(id);
      } else {
        stopping = (async () => {
          try { await provider.cancel(id); }
          finally { if (action === "ui-stop") await provider.stop(id); }
        })();
        expect(mock.writes.at(-1)?.method).toBe("session/cancel");
      }
      const writesAtStop = mock.writes.length;
      releaseText("PROMPT AFTER STOP REQUEST");
      expect(await settled).toBe(true);
      expect(mock.writes).toHaveLength(writesAtStop);
      expect(prompts()).toHaveLength(0);
      expect(base.onAccepted).not.toHaveBeenCalled();
      expect(base.onEvent.mock.calls.flat().some(event => event.type === "message.completed")).toBe(false);
      releaseCancel();
      await stopping;
      mock.cancelGate = undefined;

      const next = input(provider, id);
      const prepareNext = vi.fn(async () => "VALID NEXT TURN");
      await provider.send({ ...next, prepareText: prepareNext });
      expect(prepareNext).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(1);
      expect(prompts()[0].params!.prompt![0]).toEqual({ type: "text", text: "VALID NEXT TURN" });
      if (provider.accepts) expect(next.onAccepted).toHaveBeenCalledTimes(1);
      expect(next.onEvent.mock.calls.flat().some(event => event.type === "message.completed")).toBe(true);
    } finally {
      releaseText?.("CLEANUP");
      releaseCancel();
      mock.cancelGate = undefined;
      await stopping;
      await provider.forget(id);
      await settled;
    }
  });
});
