import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { sanitizeSessionForPersist } from "../../sessions/data/sessionStore";
import {
  appendSteerUser,
  appendUser,
  applyHarnessEvent,
  applyHarnessEvents,
  stopStreaming,
} from "../../../integrations/harness/core/apply";
import { mapCodexNotification } from "../../../integrations/harness/providers/codex/codexProtocol";
import { captureTurnEvent, isFirstTokenEvent } from "./turnMetrics";

let now = 1_000;
beforeEach(() => {
  now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

const turn = () =>
  appendUser(newSession("codex", "/fixture"), "Run the fixture");
const usage = (input: number, cached: number, output: number, total: number) =>
  mapCodexNotification("thread/tokenUsage/updated", {
    turnId: "turn-fixture",
    tokenUsage: {
      last: {
        inputTokens: input,
        cachedInputTokens: cached,
        outputTokens: output,
        totalTokens: input + output,
      },
      total: { totalTokens: total },
    },
  }).events;

describe("turn metrics capture", () => {
  it("times first received reasoning and the terminal turn without replacing the first token", () => {
    let session = turn();
    now = 1_200;
    session = applyHarnessEvent(session, {
      type: "reasoning.delta",
      text: "Thinking",
    });
    now = 1_600;
    session = applyHarnessEvent(session, {
      type: "message.delta",
      text: "Done",
    });
    session = stopStreaming(session, 2_000);
    expect(session.blocks[0]).toMatchObject({
      startedAt: 1_000,
      durationMs: 1_000,
      turnMetrics: { firstTokenAt: 1_200, endedAt: 2_000 },
    });
    expect(session.blocks[0].turnMetrics?.modelCalls).toBeUndefined();
  });

  it("captures the first token in coalesced delivery batches", () => {
    now = 1_100;
    const session = applyHarnessEvents(turn(), [
      { type: "message.delta", text: "First" },
      { type: "message.delta", text: " second" },
    ]);
    expect(session.blocks[0].turnMetrics?.firstTokenAt).toBe(1_100);
    expect(session.blocks[1].text).toBe("First second");
  });

  it("keeps metrics on the original turn across steers, drafts and queued outbox bubbles", () => {
    let session = appendSteerUser(turn(), "A follow-up");
    session = {
      ...session,
      blocks: [
        ...session.blocks,
        { id: "draft", role: "user", text: "Draft", draft: true },
        { id: "outbox", role: "user", text: "Queued", startedAt: 1_050 },
      ],
      queuedMessages: [
        { id: "q", blockId: "outbox", text: "Queued", attachments: [] },
      ],
    };
    session = applyHarnessEvents(session, usage(100, 80, 20, 120));
    expect(session.blocks[0].turnMetrics).toMatchObject({
      inputTokens: 100,
      modelCalls: 1,
    });
    expect(session.blocks.slice(1).every((block) => !block.turnMetrics)).toBe(
      true,
    );
  });

  it("accumulates distinct Codex usage snapshots and persists dedup receipts", () => {
    let session = applyHarnessEvents(turn(), usage(100, 80, 20, 120));
    session = sanitizeSessionForPersist(session);
    session = applyHarnessEvents(session, usage(100, 80, 20, 120));
    session = applyHarnessEvents(session, usage(200, 170, 40, 360));
    expect(session.blocks[0].turnMetrics).toMatchObject({
      inputTokens: 300,
      cacheReadTokens: 250,
      outputTokens: 60,
      modelCalls: 2,
    });
    expect(session.blocks[0].turnMetrics?.cacheHitPercent).toBeCloseTo(83.333);
    expect(session.context?.used).toBe(240);
  });

  it("rejects usage for a different provider turn", () => {
    const session = applyHarnessEvent(turn(), {
      type: "turn.started",
      providerTurnId: "other",
    });
    expect(
      applyHarnessEvents(session, usage(100, 80, 20, 120)).blocks[0]
        .turnMetrics,
    ).toBeUndefined();
  });

  it("records compaction lifecycle fixtures once and clears live activity when stopped", () => {
    let session = turn();
    const started = mapCodexNotification("item/started", {
      item: { id: "compact-1", type: "contextCompaction" },
    }).events[0];
    const ended = mapCodexNotification("item/completed", {
      item: { id: "compact-1", type: "contextCompaction" },
    }).events[0];
    session = captureTurnEvent(session, started, 1_100);
    session = captureTurnEvent(session, started, 1_200);
    expect(session.compacting).toBe(true);
    session = captureTurnEvent(session, ended, 1_500);
    session = captureTurnEvent(session, ended, 1_600);
    session = captureTurnEvent(
      session,
      mapCodexNotification("thread/compacted", {}).events[0],
      1_600,
    );
    expect(session.compacting).toBe(false);
    expect(session.blocks[0].turnMetrics?.compactions).toEqual([
      { id: "compact-1", startedAt: 1_100, endedAt: 1_500 },
    ]);
    session = captureTurnEvent(
      session,
      { type: "turn.compaction", phase: "started", id: "compact-2" },
      1_700,
    );
    expect(stopStreaming(session).compacting).toBe(false);
  });

  it("retains completion-only boundaries without inventing a start time", () => {
    const event = mapCodexNotification("thread/compacted", {}).events[0];
    const session = captureTurnEvent(turn(), event, 1_400);
    expect(session.blocks[0].turnMetrics?.compactions).toEqual([
      { endedAt: 1_400 },
    ]);
  });

  it("ignores empty output, tool output and invalid provider counts", () => {
    expect(isFirstTokenEvent({ type: "message.delta", text: "" })).toBe(false);
    expect(
      isFirstTokenEvent({
        type: "tool.updated",
        callId: "tool",
        detail: "output",
      }),
    ).toBe(false);
    expect(isFirstTokenEvent({ type: "plan", text: "Plan" })).toBe(true);
    const session = applyHarnessEvent(turn(), {
      type: "turn.metrics",
      inputTokens: NaN,
      outputTokens: -1,
      modelCalls: Infinity,
    });
    expect(session.blocks[0].turnMetrics).toEqual({});
  });

  it("stamps errors and keeps unavailable usage absent", () => {
    now = 1_400;
    const session = applyHarnessEvent(turn(), {
      type: "session.error",
      message: "Disconnected",
    });
    expect(session.blocks[0].turnMetrics).toEqual({ endedAt: 1_400 });
    expect(session.busy).toBe(false);
    expect(session.compacting).toBe(false);
  });
});
