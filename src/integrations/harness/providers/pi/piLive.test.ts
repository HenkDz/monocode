import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  resolveBinary: vi.fn(),
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
}));

vi.mock("../../core/child", () => ({
  killChild: mocks.killChild,
  resolveOmpBinary: vi.fn(),
  resolvePiBinary: mocks.resolveBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  writeChild: vi.fn(),
}));

vi.mock("./piClient", () => ({
  PiRpc: class {
    constructor(
      _sessionId: string,
      onFrame: (record: Record<string, unknown>) => void,
    ) {
      mocks.frames.push(onFrame);
    }

    request = mocks.request;
    close = mocks.close;
    pushLine = vi.fn();
  },
}));

import { compactPiContext, stopPiSession } from "./pi";
import type { HarnessEvent } from "../../core/types";
import { appendUser, applyHarnessEvents } from "../../core/apply";
import { newSession } from "../../../../features/sessions/model/session";

describe("Pi live session", () => {
  beforeEach(() => {
    mocks.close.mockReset();
    mocks.request.mockReset();
    mocks.resolveBinary.mockReset();
    mocks.spawnChild.mockReset();
    mocks.killChild.mockReset();
    mocks.frames.length = 0;
    mocks.resolveBinary.mockResolvedValue({ path: "/fake/pi" });
    mocks.spawnChild.mockResolvedValue(undefined);
    mocks.killChild.mockResolvedValue(undefined);
    mocks.request.mockImplementation(
      async (command: Record<string, unknown>) => {
        if (command.type === "get_state") {
          return {
            data: {
              sessionId: "pi_session",
              model: { contextWindow: 200_000 },
            },
          };
        }
        if (command.type === "compact") {
          return { data: { estimatedTokensAfter: 32_000 } };
        }
        return { data: {} };
      },
    );
  });

  it("publishes the resolved Pi default model for provider usage", async () => {
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state") return { data: {
        sessionId: "pi_default",
        model: { provider: "openai-codex", id: "gpt-5.4", contextWindow: 200_000 },
      } };
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-default", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event),
    });
    expect(events).toContainEqual({
      type: "session.configChanged", model: "pi:openai-codex/gpt-5.4",
    });
    await stopPiSession("pi-default");
  });

  it("does not publish an intermediate default when explicit model selection fails", async () => {
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state") return { data: {
        sessionId: "pi_explicit",
        model: { provider: "anthropic", id: "claude-sonnet-5", contextWindow: 200_000 },
      } };
      if (command.type === "set_model") throw new Error("Model unavailable");
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await expect(compactPiContext({
      sessionId: "pi-explicit", cwd: "/repo", model: "pi:openai-codex/gpt-5.4",
      runtimeMode: "supervised", onEvent: event => events.push(event),
    })).rejects.toThrow("Model unavailable");
    expect(events.filter(event => event.type === "session.configChanged")).toEqual([]);
    expect(mocks.request).toHaveBeenCalledWith({ type: "set_model", provider: "openai-codex", modelId: "gpt-5.4" });
    await stopPiSession("pi-explicit");
  });

  it("uses the compact RPC command and publishes the post-compact estimate", async () => {
    const events: HarnessEvent[] = [];

    await compactPiContext({
      sessionId: "pi-compact",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });

    expect(mocks.request).toHaveBeenCalledWith(
      { type: "compact" },
      30 * 60_000,
    );
    expect(events).toContainEqual({
      type: "context",
      used: 32_000,
      window: 200_000,
    });
    await stopPiSession("pi-compact");
  });

  it("normalizes compaction boundaries and completed model usage without counting partial updates", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({ sessionId: "pi-metrics", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    const frame = mocks.frames[0]!;
    frame({ type: "compaction_start" });
    frame({ type: "compaction_end" });
    frame({ type: "message_update", assistantMessageEvent: { partial: { usage: { input: 100, output: 10 } } } });
    frame({ type: "message_end", message: { role: "assistant", timestamp: 1_000,
      usage: { input: 100, output: 20, cacheRead: 80 } } });
    expect(events.filter(event => event.type === "turn.compaction")).toEqual([
      { type: "turn.compaction", phase: "started" }, { type: "turn.compaction", phase: "completed" },
    ]);
    expect(events.filter(event => event.type === "turn.metrics")).toEqual([
      { type: "turn.metrics", modelCallId: "pi:1000", inputTokens: 100, outputTokens: 20,
        cacheReadTokens: 80, cacheHitPercent: 80 / 180 * 100 },
    ]);
    await stopPiSession("pi-metrics");
  });

  it("accumulates two completed requests without replayed turn_end frames replacing usage", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({ sessionId: "pi-two-requests", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    const frame = mocks.frames[0]!;
    const first = { role: "assistant", id: "request-1", timestamp: 1_000,
      usage: { input: 100, output: 20, cacheRead: 80 } };
    const second = { role: "assistant", timestamp: 2_000,
      usage: { input: 200, output: 40, cacheRead: 170 } };
    for (const message of [first, second]) {
      frame({ type: "message_end", message });
      frame({ type: "turn_end", message });
    }
    frame({ type: "message_end", message: first });
    const session = applyHarnessEvents(
      appendUser(newSession("pi", "/repo"), "Run both requests"), events,
    );
    expect(events.filter(event => event.type === "turn.metrics")).toHaveLength(3);
    expect(session.blocks[0].turnMetrics).toMatchObject({
      inputTokens: 300, outputTokens: 60, cacheReadTokens: 250,
      modelCalls: 2, modelCallIds: ["request-1", "pi:2000"],
    });
    expect(session.blocks[0].turnMetrics?.cacheHitPercent).toBeCloseTo(250 / 550 * 100);
    expect(session.context?.used).toBe(200);
    await stopPiSession("pi-two-requests");
  });

  it("requires a completed identified assistant message for accounting while preserving context updates", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({ sessionId: "pi-usage-identity", cwd: "/repo", model: "pi:default",
      runtimeMode: "supervised", onEvent: event => events.push(event) });
    const frame = mocks.frames[0]!;
    const usage = { input: 100, output: 20, cacheRead: 80 };
    frame({ type: "message_start", message: { role: "assistant", id: "request", usage } });
    frame({ type: "message_end", message: { role: "assistant", usage } });
    frame({ type: "message_end", message: { role: "toolResult", id: "tool", usage } });
    frame({ type: "turn_end", usage });
    expect(events.filter(event => event.type === "turn.metrics")).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "context", used: 200, window: 200_000 });
    await stopPiSession("pi-usage-identity");
  });

  it("publishes readable Ponytail status and extension notifications", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-ansi",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    frame({
      type: "extension_ui_request",
      id: "ponytail-status",
      method: "setStatus",
      statusKey: "ponytail",
      statusText:
        "\u001b[38;5;241m○\u001b[39m \u001b[38;5;244mponytail:\u001b[39m \u001b[38;5;188m⚡ FULL\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "plugin-notify",
      method: "notify",
      message: "\u001b[32mPlugin ready\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "empty-status",
      method: "setStatus",
      statusText: "\u001b[0m",
    });
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", key: "ponytail", text: "○ ponytail: ⚡ FULL" },
      { type: "status", text: "Plugin ready" },
    ]);
    await stopPiSession("pi-ansi");
  });

  it("publishes animated extension status as one keyed slot", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-caveman",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    for (const [id, statusText] of [
      ["frame-1", "⠋ \u001b[2mcaveman level: \u001b[0mULTRA"],
      ["frame-2", "⠙ \u001b[2mcaveman level: \u001b[0mULTRA"],
      ["clear", ""],
    ]) {
      frame({
        type: "extension_ui_request",
        id,
        method: "setStatus",
        statusKey: "caveman",
        statusText,
      });
    }
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", key: "caveman", text: "⠋ caveman level: ULTRA" },
      { type: "status", key: "caveman", text: "⠙ caveman level: ULTRA" },
      { type: "status", key: "caveman", text: "" },
    ]);
    await stopPiSession("pi-caveman");
  });
});
