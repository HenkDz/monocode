import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../core/types";

const mock = vi.hoisted(() => ({
  listeners: new Map<string, (line: string) => void>(),
  sent: [] as { method: string; params: Record<string, unknown> }[],
  fail: new Set<string>(),
  nativeIds: new Map<string, string>(),
  pending: undefined as string | undefined,
  spawn: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("../../../features/monos/model/monoWorkingDirectoryMigration", () => ({
  monoWorkingDirectoryNeedsResume: (_id: string, nativeId: string | undefined) => nativeId != null && nativeId === mock.pending,
}));
vi.mock("../core/child", () => ({
  resolveCursorBinary: async () => ({ path: "/fake/cursor" }),
  resolveHermesBinary: async () => ({ path: "/fake/hermes" }),
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  resolveFxBinary: async () => ({ path: "/fake/fx" }),
  resolvePiBinary: async () => ({ path: "/fake/pi" }),
  resolveOmpBinary: async () => ({ path: "/fake/omp" }),
  resolveDevinBinary: async () => ({ path: "/fake/devin" }),
  resolveAntigravityBinary: async () => ({ path: "/fake/agy", args: [] }),
  spawnChild: mock.spawn,
  killChild: async (id: string) => { mock.listeners.delete(id); },
  unwatchChild: (id: string) => { mock.listeners.delete(id); },
  watchChild: (id: string, line: (line: string) => void) => { mock.listeners.set(id, line); },
  writeChild: async (id: string, line: string) => {
    const request = JSON.parse(line);
    mock.sent.push(request);
    if (request.type && request.id != null) {
      queueMicrotask(() => {
        mock.listeners.get(id)?.(JSON.stringify({ type: "response", id: request.id, command: request.type,
          success: !mock.fail.has(request.type),
          ...(mock.fail.has(request.type) ? { error: "resume failed" } : { data: request.type === "get_state" ? { sessionId: mock.nativeIds.get(id) } : {} }),
        }));
        if (request.type === "prompt") mock.listeners.get(id)?.(JSON.stringify({ type: "agent_end", messages: [] }));
      });
      return;
    }
    if (request.id == null || !request.method) return;
    queueMicrotask(() => {
      const result = ["session/new", "session/load", "session/resume"].includes(request.method)
        ? { sessionId: request.params.sessionId ?? "fresh", configOptions: [] }
        : request.method === "session/prompt" ? { stopReason: "end_turn" } : {};
      mock.listeners.get(id)?.(JSON.stringify({ jsonrpc: "2.0", id: request.id,
        ...(mock.fail.has(request.method) ? { error: { code: -32601, message: "resume failed" } } : { result }),
      }));
    });
  },
}));
vi.mock("./devin/devinAuth", () => ({ readDevinApiKey: async () => "synthetic-key" }));
vi.mock("./cursor/cursorStore", () => ({ readStoredCursorToolCalls: async () => [], readStoredCursorSubagentRuns: async () => ({ runs: [], revisions: {} }) }));

const cursor = await import("./cursor/cursor");
const hermes = await import("./hermes/hermes");
const grok = await import("./grok/grok");
const fx = await import("./fx/fx");
const devin = await import("./devin/devin");
const agy = await import("./antigravity/antigravity");
const pi = await import("./pi/pi");
const omp = await import("./omp/omp");
const providers = [
  { name: "Cursor", send: cursor.sendCursorTurn, bind: cursor.bindCursorSession, stop: cursor.stopCursorSession, forget: cursor.forgetCursorSession },
  { name: "Hermes", send: hermes.sendHermesTurn, bind: hermes.bindHermesSession, stop: hermes.stopHermesSession, forget: hermes.forgetHermesSession },
  { name: "Grok", send: grok.sendGrokTurn, bind: grok.bindGrokSession, stop: grok.stopGrokSession, forget: grok.forgetGrokSession },
  { name: "FX", send: fx.sendFxTurn, bind: fx.bindFxSession, stop: fx.stopFxSession, forget: fx.forgetFxSession },
  { name: "Devin", send: devin.sendDevinTurn, bind: devin.bindDevinSession, stop: devin.stopDevinSession, forget: devin.forgetDevinSession },
  { name: "Antigravity", send: agy.sendAntigravityTurn, bind: agy.bindAntigravitySession, stop: agy.stopAntigravitySession, forget: agy.forgetAntigravitySession },
  { name: "Pi", fork: true, send: pi.sendPiTurn, bind: pi.bindPiSession, stop: pi.stopPiSession, forget: pi.forgetPiSession },
  { name: "OMP", fork: true, send: omp.sendOmpTurn, bind: omp.bindOmpSession, stop: omp.stopOmpSession, forget: omp.forgetOmpSession },
];

describe.each(providers)("$name Mono working folder migration", provider => {
  const input: SendTurnInput = { sessionId: "mono-cwd", cwd: "/home", model: "", runtimeMode: "supervised", providerAccountId: "work", monoSession: true, text: "Continue", onEvent() {} };
  const forks = "fork" in provider && provider.fork;
  beforeEach(async () => {
    await provider.forget(input.sessionId); mock.sent.length = 0; mock.fail.clear(); mock.spawn.mockClear(); mock.pending = undefined;
    mock.spawn.mockImplementation(async (...args: unknown[]) => {
      const argv = args[2] as string[];
      mock.nativeIds.set(args[0] as string, argv.includes("--fork") ? "forked" : "fresh");
    });
  });
  afterEach(async () => { await provider.forget(input.sessionId); });

  it.each(["saved", "live", "parked"])("resumes the same %s conversation with the new cwd", async state => {
    const threadId = state === "saved" ? "saved" : "fresh";
    if (state === "saved") provider.bind(input.sessionId, threadId, input.cwd, "work");
    else {
      await provider.send(input);
      if (state === "parked") await provider.stop(input.sessionId);
      mock.sent.length = 0;
    }
    const events: HarnessEvent[] = [];
    await provider.send({ ...input, cwd: "/mono/workspace", onEvent: event => events.push(event) });
    if (forks) expect(mock.spawn.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining(["--fork", threadId]));
    else expect(mock.sent.find(request => ["session/load", "session/resume"].includes(request.method))?.params).toMatchObject({ sessionId: threadId, cwd: "/mono/workspace" });
    expect(mock.sent.some(request => request.method === "session/new")).toBe(false);
    expect(mock.spawn.mock.calls.at(-1)?.[3]).toBe(provider.name === "Antigravity" ? "/fake/" : "/mono/workspace");
    expect(events).toContainEqual({ type: "session.providerBound", providerSessionId: forks ? "forked" : threadId });
  });

  it.each(["ordinary", "other-account"])("does not reuse a %s conversation after its folder changes", async kind => {
    provider.bind(input.sessionId, "saved", input.cwd, "work");
    await provider.send({ ...input, cwd: "/mono/workspace", monoSession: kind !== "ordinary", providerAccountId: kind === "other-account" ? "other" : "work" });
    expect(mock.sent.some(request => ["session/load", "session/resume"].includes(request.method))).toBe(false);
    if (forks) expect(mock.spawn.mock.calls.at(-1)?.[2]).not.toContain("--fork");
    else expect(mock.sent.some(request => request.method === "session/new")).toBe(true);
  });

  it("resumes a migration after restart when the saved cwd already names the target folder", async () => {
    const cwd = "/mono/workspace";
    provider.bind(input.sessionId, "saved", cwd, "work");
    mock.pending = "saved";
    const events: HarnessEvent[] = [];
    await provider.send({ ...input, cwd, onEvent: event => events.push(event) });
    if (forks) expect(mock.spawn.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining(["--fork", "saved"]));
    else expect(mock.sent.find(request => ["session/load", "session/resume"].includes(request.method))?.params).toMatchObject({ sessionId: "saved", cwd });
    expect(events).toContainEqual({ type: "session.providerBound", providerSessionId: forks ? "forked" : "saved" });
    expect(mock.sent.some(request => request.method === "session/new")).toBe(false);
  });

  it("retains its saved binding when migration resume fails", async () => {
    provider.bind(input.sessionId, "saved", input.cwd, "work");
    mock.fail.add("session/load"); mock.fail.add("session/resume");
    mock.fail.add("get_state");
    await expect(provider.send({ ...input, cwd: "/mono/workspace" })).rejects.toThrow();
    expect(mock.sent.some(request => request.method === "session/new")).toBe(false);
    mock.fail.clear(); mock.sent.length = 0;
    await provider.send({ ...input, cwd: "/mono/workspace" });
    if (forks) expect(mock.spawn.mock.calls.at(-1)?.[2]).toEqual(expect.arrayContaining(["--fork", "saved"]));
    else expect(mock.sent.find(request => ["session/load", "session/resume"].includes(request.method))?.params).toMatchObject({ sessionId: "saved", cwd: "/mono/workspace" });
  });

  if (forks) it("rejects relocation before prompting when the fork's native identity is unavailable", async () => {
    provider.bind(input.sessionId, "saved", input.cwd, "work");
    mock.spawn.mockImplementation(async () => { mock.nativeIds.delete(input.sessionId); });
    await expect(provider.send({ ...input, cwd: "/mono/workspace" })).rejects.toThrow("relocated session");
    expect(mock.sent.some(request => (request as { type?: string }).type === "prompt")).toBe(false);
  });
});
