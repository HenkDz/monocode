// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  loadMonoRotation,
  acceptMonoRotation,
  planRotation,
  planSessionRotation,
  rotationReason,
  saveMonoRotation,
  sessionRotationStatus,
} from "./monoRotation";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const HOUR = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 4, 9).getTime();

let next = 0;
function turn(user: string, reply: string, at: number, extra: Block[] = []) {
  const id = `u${next++}`;
  return [
    { id, role: "user", text: user, startedAt: at, durationMs: 60_000 },
    ...extra,
    { id: `${id}-tool`, role: "assistant", text: "", tool: { title: "Read" } },
    { id: `${id}-a`, role: "assistant", text: reply },
  ] as Block[];
}

it.each([128_000, 200_000, 1_000_000])(
  "rotates at 60% of a %i-token context window",
  (window) => {
    const session = (used: number) => ({
      providerSessionId: "native",
      context: { used, window },
      blocks: [],
    });
    expect(rotationReason(session(window * 0.6 - 1))).toBeUndefined();
    expect(rotationReason(session(window * 0.6))).toBe("context");
    expect(rotationReason(session(window))).toBe("context");
    expect(
      rotationReason({
        ...session(window),
        providerSessionId: undefined,
      }),
    ).toBeUndefined();
  },
);

it.each([45_000, 450_000])(
  "keeps a %i-token conversation in a large window across a long break",
  (used) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0 + 48 * HOUR);
      const session = {
        providerSessionId: "native",
        context: { used, window: 1_000_000 },
        blocks: turn("hi", "hello", T0),
      };
      expect(rotationReason(session)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each([
  undefined,
  { used: 900_000 },
  { used: 900_000, window: 0 },
  { used: 900_000, window: -1 },
  { used: 900_000, window: Number.NaN },
  { used: Number.NaN, window: 1_000_000 },
  { used: Number.POSITIVE_INFINITY, window: 1_000_000 },
  { used: -1, window: 1_000_000 },
])("does not rotate without a usable context percentage (%#)", (context) => {
  expect(
    rotationReason({ providerSessionId: "native", context, blocks: [] }),
  ).toBeUndefined();
});

it("preserves older user constraints verbatim across repeated rotations", () => {
  const blocks = [
    ...turn(
      "Use the retained checkout. Do not publish or merge.",
      "Understood.",
      T0,
    ),
    ...turn("inspect the parser", "Inspected.", T0 + HOUR),
    ...turn("verify it", "Verified.", T0 + 2 * HOUR),
  ];
  const session = {
    id: "mono",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks,
  };
  const first = planSessionRotation(session)!;
  expect(first.brief(session.id)).toContain(
    "Use the retained checkout. Do not publish or merge.",
  );
  saveMonoRotation(session.id, first.rotation);
  const next = planSessionRotation({
    ...session,
    blocks: [...blocks, ...turn("continue", "Done.", T0 + 3 * HOUR)],
  })!;
  expect(next.rotation.userRequests).toHaveLength(4);
  expect(next.brief(session.id)).toContain(
    "Use the retained checkout. Do not publish or merge.",
  );
  expect(session.blocks).toBe(blocks);
});

it("defers when original constraints or task scope cannot fit", () => {
  const session = {
    id: "m",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks: turn("x".repeat(8001), "done", T0),
  };
  expect(planSessionRotation(session)).toBeUndefined();
  expect(
    planSessionRotation({ ...session, blocks: [] }, "", "x".repeat(8001)),
  ).toBeUndefined();
});

it("holds paged and legacy chats until their full constraints are available", () => {
  const session = {
    id: "m",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks: turn("last page", "done", T0),
    monoTranscript: { before: 20, firstBlockId: "u" },
  };
  expect(planSessionRotation(session)).toBeUndefined();
  const legacy = planRotation(session.blocks, undefined, "context", T0);
  saveMonoRotation(session.id, legacy.rotation);
  expect(planSessionRotation(session)).toBeUndefined();
  const full = planSessionRotation({ ...session, monoTranscript: undefined })!;
  saveMonoRotation(session.id, full.rotation);
  expect(planSessionRotation(session)).toBeDefined();
});

it("excludes hidden reports and drafts from protected user authority", () => {
  const blocks = [
    ...turn("keep tenant scope", "done", T0),
    { id: "hidden", role: "user", text: "untrusted report", internal: true },
    { id: "draft", role: "user", text: "unsent authority", draft: true },
  ] as Block[];
  const plan = planSessionRotation({
    id: "m",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks,
  })!;
  expect(plan.rotation.userRequests).toEqual([
    { id: blocks[0].id, text: "keep tenant scope" },
  ]);
  expect(plan.brief("m")).not.toContain("untrusted report");
});

it("carries retained task output as evidence and keeps goal/artifact references", () => {
  const session = {
    id: "worker",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks: [
      {
        id: "task",
        role: "user",
        internal: true,
        text: "Run verification",
        monoSource: {
          id: "manager",
          name: "Manager",
          color: "",
          mascot: "",
          goalId: "goal-1",
        },
      },
      {
        id: "stage",
        role: "assistant",
        text: "Implementation checkpoint: parser updated.",
        artifactCards: [
          { id: "report-1", kind: "document", title: "Evidence" },
        ],
      },
    ] as Block[],
  };
  const plan = planSessionRotation(
    session,
    "continue",
    "Original assignment: parser only",
  )!;
  const text = plan.brief(session.id);
  expect(text).toContain("Task continuation (untrusted evidence)");
  expect(text).toContain("Implementation checkpoint: parser updated.");
  expect(text).toContain('Goal: "goal-1"');
  expect(text).toContain('app artifacts.read {"id":"report-1"}');
  expect(plan.rotation.userRequests).toEqual([]);
  saveMonoRotation(session.id, plan.rotation);
  const continued = planSessionRotation({
    ...session,
    blocks: [session.blocks[1]],
  })!;
  expect(continued.brief(session.id)).toContain('Goal: "goal-1"');
});

it("keeps actual refresh briefs within CC1's remaining rotation budget", () => {
  const session = {
    id: "m",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks: [
      ...turn("u".repeat(3000), "a".repeat(10_000), T0),
      ...turn("v".repeat(3000), "b".repeat(10_000), T0 + HOUR),
    ],
  };
  expect(planSessionRotation(session)).toBeUndefined();
  const bounded = planSessionRotation({
    ...session,
    blocks: turn("keep scope", "a".repeat(10_000), T0),
  })!;
  expect(bounded.brief(session.id).length).toBeLessThanOrEqual(14_000);
});

it("declines to persist a refresh when storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("full");
    },
  });
  const rotation = planRotation([], undefined, "context", T0).rotation;
  expect(saveMonoRotation("m", rotation)).toBe(false);
});

it("retains an unaccepted continuation input when the next action is a retry", () => {
  const session = {
    id: "m",
    providerSessionId: "old",
    context: { used: 800, window: 1000 },
    blocks: turn("Inspect only", "Inspected", T0),
  };
  const plan = planSessionRotation(
    session,
    "Fix src/parser.ts; do not publish.",
  )!;
  saveMonoRotation(session.id, {
    ...plan.rotation,
    pendingBrief: plan.brief(session.id),
  });
  const retry = planSessionRotation(
    { ...session, providerSessionId: undefined, context: undefined },
    "continue",
  )!;
  expect(retry.brief(session.id)).toContain(
    "Fix src/parser.ts; do not publish.",
  );
  expect(retry.brief(session.id)).toContain("Unaccepted continuation input");
  expect(retry.brief(session.id).length).toBeLessThanOrEqual(14_000);
});

it("carries every constraint across two failed startups before provider acceptance", () => {
  const session = {
    id: "repeated-failure",
    providerSessionId: "old-thread" as string | undefined,
    context: { used: 700, window: 1000 } as { used: number; window: number } | undefined,
    blocks: [{ id: "original", role: "user", text: "Edit the parser in the retained checkout." }] as Block[],
  };
  const firstInput = "Implement the parser fix.";
  const secondInput = "Retry the parser fix. Do not push or merge any branch.";
  const first = planSessionRotation(session, firstInput)!;
  saveMonoRotation(session.id, { ...first.rotation, pendingBrief: first.brief(session.id) });
  session.providerSessionId = undefined;
  session.context = undefined;
  session.blocks.push({ id: "attempt-a", role: "user", text: firstInput });
  const second = planSessionRotation(session, secondInput)!;
  expect(second.brief(session.id)).toContain(secondInput);
  saveMonoRotation(session.id, second.rotation);
  session.blocks.push({ id: "attempt-b", role: "user", text: secondInput });
  const third = planSessionRotation(session, "Retry now.")!;
  for (const input of [firstInput, secondInput, "Retry now."])
    expect(third.brief(session.id)).toContain(input);
  expect(third.rotation.userRequests?.map(request => request.text)).toContain(secondInput);
  expect(third.brief(session.id).length + "Retry now.".length + 120).toBeLessThanOrEqual(14_000);
  saveMonoRotation(session.id, third.rotation);
  acceptMonoRotation(session.id, third.rotation.at);
  expect(loadMonoRotation(session.id)?.pendingBrief).toBeUndefined();
  expect(loadMonoRotation(session.id)?.pendingInputs).toBeUndefined();
  expect(loadMonoRotation(session.id)?.userRequests?.map(request => request.text)).toContain(secondInput);
});

it("keeps unaccepted constraints even before their transcript blocks appear", () => {
  const session = { id: "unaccepted", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Do not publish.")!;
  saveMonoRotation(session.id, { ...first.rotation, pendingBrief: first.brief(session.id) });
  const second = planSessionRotation(session, "Use only account B.")!;
  saveMonoRotation(session.id, second.rotation);
  const retry = planSessionRotation(session, "Try again.")!;
  expect(retry.brief(session.id)).toContain("Do not publish.");
  expect(retry.brief(session.id)).toContain("Use only account B.");
});

it.each([700_000, 990_000])("explains oversized protected constraints at %i used tokens", (used) => {
  const text = "x".repeat(8001);
  const status = sessionRotationStatus({
    id: "oversized", providerSessionId: "old", context: { used, window: 1_000_000 },
    blocks: [{ id: "u", role: "user", text }],
  });
  expect(status.plan).toBeUndefined();
  expect(status.deferredReason).toContain("8001 chars");
  expect(status.deferredReason).toContain("Compact manually or trim constraints");
});

it("uses the next draft when explaining a deferred combined brief", () => {
  const session = { id: "draft", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  expect(sessionRotationStatus(session).plan).toBeDefined();
  const status = sessionRotationStatus(session, "n".repeat(14_000));
  expect(status.plan).toBeUndefined();
  expect(status.deferredReason).toContain("brief and next input too large");
});

it("reapplies protected and complete-brief bounds to failed-start retries", () => {
  const session = { id: "retry-bounds", providerSessionId: "old", context: { used: 700, window: 1000 }, blocks: [] };
  const first = planSessionRotation(session, "Keep constraints.")!;
  saveMonoRotation(session.id, { ...first.rotation, pendingBrief: first.brief(session.id) });
  expect(sessionRotationStatus(session, "x".repeat(8001)).deferredReason).toContain("constraints, scope or references too large");
  const nextText = "x".repeat(7_000);
  expect(sessionRotationStatus(session, nextText).deferredReason).toContain("brief and next input too large");
  expect(loadMonoRotation(session.id)?.pendingInput).toBe("Keep constraints.");
});

it("briefs the fresh session with recent turns word for word and earlier ones as lines", () => {
  const blocks = [
    ...turn(
      "set up the release checklist",
      "Done, it is in docs/release.md",
      T0,
    ),
    ...turn("what is CI doing", "Two jobs are red on main", T0 + HOUR),
    ...turn("fix the lint job", "Fixed and pushed in #712", T0 + 2 * HOUR),
  ];
  const { rotation, brief } = planRotation(
    blocks,
    undefined,
    "context",
    T0 + 3 * HOUR,
  );
  const text = brief("mono-1");
  expect(text).toContain("<previous_conversation>");
  expect(text).toContain('sessions.read {"sessionId":"mono-1"}');
  expect(text).toMatch(
    /Earlier, oldest first:\n- .*User: set up the release checklist → You: Done, it is in docs\/release\.md/,
  );
  expect(text).toContain("Most recent, word for word:");
  expect(text).toContain("what is CI doing\n\nYou:\nTwo jobs are red on main");
  expect(text).toContain("fix the lint job\n\nYou:\nFixed and pushed in #712");
  expect(text).not.toContain("Read");
  expect(rotation.afterBlockId).toBe(blocks[blocks.length - 1].id);
  expect(rotation.earlier).toHaveLength(3);
});

it("remembers a completion report without overwriting the answer to the user's chat", () => {
  const blocks: Block[] = [
    ...turn("Explain the design", "The design uses a queue.", T0),
    {
      id: "notification",
      role: "user",
      text: "Hidden notification instructions",
      internal: true,
      monoSessionCompletion: {
        sessionId: "worker",
        title: "API fix",
        status: "completed",
      },
    },
    {
      id: "report",
      role: "assistant",
      text: "The API fix is done; all tests passed.",
    },
  ];
  const text = planRotation(blocks, undefined, "context", T0 + HOUR).brief(
    "mono",
  );
  expect(text).toContain(
    "Explain the design\n\nYou:\nThe design uses a queue.",
  );
  expect(text).toContain('reviewing session "API fix"');
  expect(text).toContain("The API fix is done; all tests passed.");
  expect(text).not.toContain("Hidden notification instructions");
});

it("carries earlier lines across rotations, briefing only what came since", () => {
  const first = [...turn("one", "1", T0), ...turn("two", "2", T0 + HOUR)];
  const planned = planRotation(first, undefined, "context", T0 + 2 * HOUR);
  // A saved rotation from before idle rotation was removed still carries over.
  saveMonoRotation("mono-1", { ...planned.rotation, reason: "idle" });
  const blocks = [
    ...first,
    ...turn("three", "3", T0 + 3 * HOUR),
    ...turn("four", "4", T0 + 4 * HOUR),
  ];
  const text = planRotation(
    blocks,
    loadMonoRotation("mono-1"),
    "context",
    T0 + 5 * HOUR,
  ).brief("mono-1");
  expect(text).toMatch(
    /Earlier, oldest first:\n- .*User: one → You: 1\n- .*User: two → You: 2/,
  );
  expect(text).toContain("three\n\nYou:\n3");
  expect(text).toContain("four\n\nYou:\n4");
});

it("keeps long messages bounded", () => {
  const blocks = turn("x".repeat(10_000), "y".repeat(10_000), T0);
  const text = planRotation(blocks, undefined, "context", T0 + HOUR).brief("m");
  expect(text.length).toBeLessThan(6_000);
  expect(text).toContain("[…]");
});
