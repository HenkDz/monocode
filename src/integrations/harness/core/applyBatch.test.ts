import { describe, expect, it, vi } from "vitest";
import {
  newSession,
  type Session,
} from "../../../features/sessions/model/session";
import { applyHarnessEvent, applyHarnessEvents } from "./apply";
import type { HarnessEvent } from "./types";

function content(session: Session) {
  return {
    ...session,
    blocks: session.blocks.map(({ id: _id, ...block }) => block),
  };
}

function conversation(): Session {
  return {
    ...newSession("codex", "/repo"),
    blocks: [
      { id: "user", role: "user", text: "Help" },
      { id: "reply", role: "assistant", text: "Hello", streaming: true },
    ],
  };
}

describe("batched harness events", () => {
  it("reuses every generated event identity and time on replay", () => {
    let at = 10_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => at++);
    try {
      const session = { ...conversation(), busy: true, blocks: [{ id: "user", role: "user" as const, text: "Run", startedAt: 100 }] };
      const events: HarnessEvent[] = [
        { type: "message.delta", text: "Answer" }, { type: "message.delta", text: "." },
        { type: "reasoning.delta", text: "Thought" },
        { type: "reasoning.delta", text: "Part", reasoning: { itemId: "r", partIndex: 0, channel: "summary" } },
        { type: "tool.started", callId: "first", title: "First" },
        { type: "tool.updated", callId: "second", title: "Second", status: "in_progress" },
        { type: "approval.requested", callId: "approval", requestId: 7, title: "Unmatched" },
        { type: "plan", key: "plan", text: "A plan" },
        { type: "tasks.updated", items: [{ text: "Task", status: "pending" }] },
        { type: "image.generated", itemId: "image", path: "/synthetic/image", name: "image", mimeType: "image/png", size: 1 },
        { type: "status", text: "Status" }, { type: "status", key: "key", text: "Keyed" },
        { type: "interjection", text: "Notice", customType: "review" },
        { type: "turn.compaction", phase: "started", id: "compaction" },
        { type: "turn.compaction", phase: "completed", id: "compaction" },
        { type: "session.error", message: "Synthetic failure" },
      ];
      const replay = new Map();
      const first = applyHarnessEvents(session, events, replay);
      const ids = first.blocks.map(block => block.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(first.blocks[0].durationMs).toBeGreaterThan(0);
      expect(first.blocks[0].turnMetrics?.firstTokenAt).toBeDefined();
      at += 1_000;
      expect(applyHarnessEvents(session, events, replay)).toEqual(first);
      expect(applyHarnessEvents(session, events, replay)).toEqual(first);
    } finally { clock.mockRestore(); }
  });

  it.each([false, true])("does not shift generated IDs when an earlier allocation changes, initiallyCreates=%s", initiallyCreates => {
    const base = { ...conversation(), blocks: [] as Session["blocks"] };
    const duplicate: Session["blocks"] = [{ id: "existing-status", role: "system", text: "Status" }];
    const original = { ...base, blocks: initiallyCreates ? [] : duplicate };
    const edited = { ...base, blocks: initiallyCreates ? duplicate : [] };
    const events: HarnessEvent[] = [{ type: "status", text: "Status" },
      { type: "tool.started", callId: "tool", title: "Tool" }, { type: "message.delta", text: "Answer" }];
    const replay = new Map();
    const first = applyHarnessEvents(original, events, replay);
    const rebased = applyHarnessEvents(edited, events, replay);
    expect(rebased.blocks.slice(1).map(block => block.id)).toEqual(first.blocks.slice(1).map(block => block.id));
    expect(new Set(rebased.blocks.map(block => block.id)).size).toBe(3);
    expect(applyHarnessEvents(edited, events, replay)).toEqual(rebased);
  });

  it("keeps interleaved provider reasoning parts and canonical snapshots separate", () => {
    const summary = { itemId: "r", partIndex: 0, channel: "summary" as const };
    const raw = { itemId: "r", partIndex: 0, channel: "raw" as const };
    const next = { ...summary, partIndex: 1 };
    const events: HarnessEvent[] = [
      { type: "reasoning.delta", reasoning: summary, text: "very " },
      { type: "reasoning.delta", reasoning: summary, text: "very " },
      { type: "reasoning.delta", reasoning: raw, text: "Raw body" },
      { type: "reasoning.delta", reasoning: next, text: "**Next heading**" },
      { type: "reasoning.delta", reasoning: summary, text: "good." },
      { type: "reasoning.delta", reasoning: summary, snapshot: true, text: "very very good." },
      { type: "reasoning.delta", reasoning: next, snapshot: true, text: "**Next heading**\n\nBody" },
      { type: "reasoning.completed", itemId: "r" },
      { type: "reasoning.delta", reasoning: summary, snapshot: true, text: "very very good." },
    ];
    const session = conversation();
    const batched = applyHarnessEvents(session, events);
    expect(content(batched)).toEqual(content(events.reduce(applyHarnessEvent, session)));
    expect(batched.blocks.filter(block => block.role === "reasoning").map(block => block.text)).toEqual([
      "very very good.", "Raw body", "**Next heading**\n\nBody",
    ]);
    expect(batched.blocks.filter(block => block.role === "reasoning").every(block => !block.streaming)).toBe(true);
  });

  it("preserves mixed snapshots, repeated tokens, whitespace and message boundaries", () => {
    const events: HarnessEvent[] = [
      { type: "message.delta", text: " " },
      { type: "message.delta", text: "Hello world" },
      { type: "message.delta", text: "Hello world" },
      { type: "message.delta", text: "\n" },
      { type: "message.delta", text: "\n" },
      { type: "status", text: "Working" },
      { type: "message.delta", text: "Next paragraph" },
      { type: "message.delta", text: "." },
      { type: "message.completed" },
      { type: "message.delta", text: "New message" },
      { type: "message.delta", text: "!" },
      { type: "reasoning.delta", text: "" },
      { type: "reasoning.delta", text: "Think" },
      { type: "reasoning.delta", text: "Think carefully" },
      { type: "reasoning.completed" },
      { type: "tool.started", callId: "read", title: "Read" },
      {
        type: "approval.requested",
        callId: "read",
        requestId: 1,
        title: "Read",
      },
      { type: "approval.resolved", requestId: 1, decision: "allow" },
      { type: "tool.updated", callId: "read", status: "completed" },
      { type: "message.delta", text: "Done" },
      { type: "message.delta", text: "." },
    ];
    const session = conversation();
    expect(content(applyHarnessEvents(session, events))).toEqual(
      content(events.reduce(applyHarnessEvent, session)),
    );
    expect(session.blocks[1].text).toBe("Hello");
  });

  it("does not treat combined token fragments as a snapshot of existing text", () => {
    const session = conversation();
    session.blocks[1].text = "abc";
    const events: HarnessEvent[] = [
      { type: "message.delta", text: "a" },
      { type: "message.delta", text: "bc" },
    ];
    expect(applyHarnessEvents(session, events).blocks[1].text).toBe("abcabc");
  });

  it("retains identity for empty reasoning and repeated full snapshots", () => {
    const session = conversation();
    expect(applyHarnessEvents(session, [])).toBe(session);
    expect(
      applyHarnessEvents(session, [
        { type: "reasoning.delta", text: "" },
        { type: "reasoning.delta", text: "" },
      ]),
    ).toBe(session);
    expect(
      applyHarnessEvents(session, [
        { type: "message.delta", text: "Hello" },
        { type: "message.delta", text: "Hello" },
      ]),
    ).toBe(session);
  });

  it("handles ten simultaneous long histories without cloning history blocks", () => {
    const events: HarnessEvent[] = Array.from({ length: 64 }, (_, index) => ({
      type: "message.delta",
      text: ` token-${index}`,
    }));
    for (let thread = 0; thread < 10; thread++) {
      const session = conversation();
      session.blocks = [
        ...Array.from({ length: 2_000 }, (_, index) => ({
          id: `history-${index}`,
          role: "user" as const,
          text: `History ${index}`,
        })),
        ...session.blocks,
      ];
      const next = applyHarnessEvents(session, events);
      expect(next).toEqual(events.reduce(applyHarnessEvent, session));
      for (let index = 0; index < 2_001; index++) {
        expect(next.blocks[index]).toBe(session.blocks[index]);
      }
    }
  });
});
