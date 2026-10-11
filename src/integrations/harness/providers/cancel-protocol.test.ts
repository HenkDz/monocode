import { describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../core/types";

// CC1FR's protocol reproduction, asserting Stop prevents the prepared prompt.
const mock = vi.hoisted(() => ({
  listeners: new Map<string, (line: string) => void>(),
  events: new Map<string, (data: string) => void>(),
  writes: [] as Array<Record<string, any>>,
  cancelGate: undefined as Promise<void> | undefined,
  cancelPending: false,
  stdout: undefined as ((line: string) => void) | undefined,
}));
vi.mock("../core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/synthetic/codex" }),
  resolveClaudeBinary: async () => ({ path: "/synthetic/claude" }),
  resolvePiBinary: async () => ({ path: "/synthetic/pi" }),
  resolveOmpBinary: async () => ({ path: "/synthetic/omp" }),
  resolveOpenCodeBinary: async () => ({ path: "/synthetic/opencode" }),
  restoreMonoCodexAgentState: async () => undefined,
  spawnChild: async () => { mock.stdout?.("opencode server listening on http://127.0.0.1:4096"); },
  killChild: async (id: string) => { mock.listeners.delete(id); },
  unwatchChild: (id: string) => { mock.listeners.delete(id); },
  watchChild: (id: string, line: (line: string) => void) => { mock.listeners.set(id, line); mock.stdout = line; },
  execChild: async () => "opencode 1.14.19",
  freeHarnessPort: async () => 4096,
  openHarnessSse: async () => undefined,
  closeHarnessSse: async (id: string) => { mock.events.delete(id); },
  watchSse: (id: string, event: (data: string) => void) => { mock.events.set(id, event); },
  harnessHttp: async (input: { url: string; method: string; body?: string }) => {
    const path = new URL(input.url).pathname;
    mock.writes.push({ http: path, method: input.method, body: input.body });
    if (path.endsWith("/abort") && mock.cancelGate) {
      mock.cancelPending = true;
      await mock.cancelGate;
    }
    if (input.method === "GET" && path === "/session/fresh") return { status: 200, body: JSON.stringify({ id: "fresh", directory: "/synthetic" }) };
    if (input.method === "POST" && path === "/session") return { status: 200, body: JSON.stringify({ id: "fresh", directory: "/synthetic" }) };
    return { status: 204, body: "" };
  },
  writeChild: async (child: string, line: string) => {
    const message = JSON.parse(line);
    mock.writes.push(message);
    const deliver = (data: unknown) => mock.listeners.get(child)?.(JSON.stringify(data));
    if ((message.type === "abort" || message.request?.subtype === "interrupt") && mock.cancelGate) {
      mock.cancelPending = true;
      await mock.cancelGate;
    }
    queueMicrotask(() => {
      if (message.type === "control_request") {
        if (message.request?.subtype === "initialize") deliver({ type: "system", subtype: "init", session_id: "fresh" });
        deliver({ type: "control_response", response: { subtype: "success", request_id: message.request_id } });
      } else if (message.type && message.id) {
        deliver({ type: "response", id: message.id, command: message.type, success: true, data: message.type === "get_state" ? { sessionId: "fresh" } : {} });
      } else if (message.method && message.id != null) {
        deliver({ id: message.id, result: message.method === "thread/start" || message.method === "thread/resume" ? { thread: { id: "fresh" } }
          : message.method === "turn/start" ? { turn: { id: "turn-1" } } : {} });
      }
    });
  },
}));

import * as codex from "./codex/codex";
import * as claude from "./claude/claude";
import * as pi from "./pi/pi";
import * as omp from "./omp/omp";
import * as opencode from "./opencode/opencode";

const providers = [
  { id: "codex", send: codex.sendCodexTurn, cancel: codex.cancelCodexTurn, stop: codex.stopCodexSession },
  { id: "claude", send: claude.sendClaudeTurn, cancel: claude.cancelClaudeTurn, stop: claude.stopClaudeSession },
  { id: "pi", send: pi.sendPiTurn, cancel: pi.cancelPiTurn, stop: pi.stopPiSession },
  { id: "omp", send: omp.sendOmpTurn, cancel: omp.cancelOmpTurn, stop: omp.stopOmpSession },
  { id: "opencode", send: opencode.sendOpenCodeTurn, cancel: opencode.cancelOpenCodeTurn, stop: opencode.stopOpenCodeSession },
];
const prompts = () => mock.writes.filter(message => message.method === "turn/start" || message.type === "user" || message.type === "prompt" || message.http?.endsWith("/prompt_async"));
let sequence = 0;

describe.each(providers)("$id actual protocol preparation cancellation", provider => {
  const inputFor = (sessionId: string): SendTurnInput => ({
    sessionId, cwd: "/synthetic", model: provider.id === "opencode" ? "opencode:openrouter/test" : `${provider.id}:default`,
    runtimeMode: "supervised", text: "FULL FALLBACK", onEvent() {},
  });

  async function nextTurn(id: string) {
    const prepareText = vi.fn(async () => "VALID NEXT TURN");
    const onAccepted = vi.fn();
    const turn = provider.send({ ...inputFor(id), prepareText, onAccepted });
    try {
      await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
      expect(prepareText).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(1);
      expect(JSON.stringify(prompts()[0])).toContain("VALID NEXT TURN");
      const complete = provider.id === "codex"
        ? { method: "turn/completed", params: { threadId: "fresh", turn: { id: "turn-1", status: "completed" } } }
        : provider.id === "claude"
          ? { type: "result", subtype: "success", session_id: "fresh" }
          : { type: "agent_end", messages: [] };
      mock.listeners.get(id)?.(JSON.stringify(complete));
      mock.events.get(id)?.(JSON.stringify({ type: "session.status", properties: { sessionID: "fresh", status: { type: "idle" } } }));
      await turn;
    } finally { await provider.stop(id); await turn; }
  }

  it.each(["cancel", "stop"] as const)("does not submit or accept preparation after direct %s, then accepts a next turn", async action => {
    mock.writes.length = 0;
    const id = `protocol-${provider.id}-${++sequence}`;
    let release!: (text: string) => void;
    const prepareText = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const onAccepted = vi.fn();
    let done = false;
    const turn = provider.send({ ...inputFor(id), prepareText, onAccepted });
    const settled = turn.finally(() => { done = true; });
    try {
      await vi.waitFor(() => expect(prepareText).toHaveBeenCalledTimes(1));
      await provider[action](id);
      expect(prompts()).toHaveLength(0);
      release("PREPARED AFTER CANCEL");
      await vi.waitFor(() => {
        expect(prompts()).toHaveLength(0);
        expect(onAccepted).not.toHaveBeenCalled();
        expect(done).toBe(true);
      });
      await settled;
      await nextTurn(id);
    } finally { release?.("cleanup"); await provider.stop(id); await settled; }
  });

  it("does not submit or accept while UI Stop cancellation is pending, then accepts a next turn", async () => {
    mock.writes.length = 0;
    mock.cancelPending = false;
    const id = `protocol-ui-${provider.id}-${++sequence}`;
    let release!: (text: string) => void;
    let releaseCancel!: () => void;
    mock.cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
    const prepareText = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const onAccepted = vi.fn();
    let done = false;
    const turn = provider.send({ ...inputFor(id), prepareText, onAccepted });
    const settled = turn.finally(() => { done = true; });
    let stopping: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(prepareText).toHaveBeenCalledTimes(1));
      stopping = (async () => { try { await provider.cancel(id); } finally { await provider.stop(id); } })();
      // Codex has no turn ID to interrupt during preparation; its direct API is covered above.
      if (provider.id !== "codex") await vi.waitFor(() => expect(mock.cancelPending).toBe(true));
      release("PREPARED AFTER UI STOP REQUEST");
      await vi.waitFor(() => {
        expect(prompts()).toHaveLength(0);
        expect(onAccepted).not.toHaveBeenCalled();
        expect(done).toBe(true);
      });
      await settled;
      releaseCancel();
      await stopping;
      mock.cancelGate = undefined;
      expect(prompts()).toHaveLength(0);
      await nextTurn(id);
    } finally {
      release?.("cleanup"); releaseCancel(); mock.cancelGate = undefined;
      await stopping; await provider.stop(id); await settled;
    }
  });

  it("rejects a throwing hook before prompt serialization or acceptance", async () => {
    mock.writes.length = 0;
    const id = `protocol-throw-${provider.id}-${++sequence}`;
    const onAccepted = vi.fn();
    const prepareText = vi.fn(async () => { throw new Error("synthetic prep failure"); });
    try {
      await expect(provider.send({ ...inputFor(id), prepareText, onAccepted })).rejects.toThrow("synthetic prep failure");
      expect(prepareText).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(0);
      expect(onAccepted).not.toHaveBeenCalled();
    } finally { await provider.stop(id); }
  });
});
