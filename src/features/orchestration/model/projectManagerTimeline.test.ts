// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";
import {
  focusManagerReview,
  managerReviewTimeline,
  managerReviewTurn,
} from "./projectManagerTimeline";

it.each([1, 0.75, 1.25])(
  "centers only the owning transcript at scale %s",
  (scale) => {
    const shell = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.className = "agent-transcript";
    const card = document.createElement("section");
    card.id = "manager-review-scroll";
    card.tabIndex = -1;
    shell.append(scroller);
    scroller.append(card);
    document.body.append(shell);
    Object.defineProperties(scroller, {
      offsetHeight: { value: 504 },
      clientHeight: { value: 500 },
      clientTop: { value: 2 },
    });
    scroller.scrollTop = 40;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 100 * scale,
      height: 504 * scale,
    } as DOMRect);
    vi.spyOn(card, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: (100 + 2 + 800 - scroller.scrollTop) * scale,
          height: 200 * scale,
        }) as DOMRect,
    );
    const scroll = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    try {
      focusManagerReview("scroll");
      expect(scroller.scrollTop).toBeCloseTo(650);
      expect(document.activeElement).toBe(card);
      focusManagerReview("scroll");
      expect(scroller.scrollTop).toBeCloseTo(650);
      expect(scroll).not.toHaveBeenCalled();
      expect(shell.scrollTop).toBe(0);
      expect(document.body.scrollTop).toBe(0);
      expect(document.documentElement.scrollTop).toBe(0);
      shell.append(card);
      focusManagerReview("scroll");
      focusManagerReview("missing");
      expect(shell.scrollTop).toBe(0);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      shell.remove();
      vi.restoreAllMocks();
    }
  },
);

const blocks: Block[] = [
  { id: "first", role: "user", text: "First assignment", startedAt: 100 },
  { id: "answer", role: "assistant", text: "PR ready" },
  { id: "next", role: "user", text: "Next assignment", startedAt: 500 },
];
const task = {
  id: "task",
  accepted: true,
  prUrl: "https://github.com/example/repo/pull/1",
  prReadyAt: 300,
} as OrchestrationTask;
const run = {
  id: "run",
  tasks: [task],
  dispatches: [{ id: "dispatch", updatedAt: 300 }],
} as OrchestrationRun;

it("anchors ready cards to their persisted turn or historical acceptance time", () => {
  expect(managerReviewTurn(run, task, blocks)).toBe("first");
  expect(
    managerReviewTurn(
      run,
      { ...task, prReadyTurnId: "first", prReadyAt: 800 },
      blocks,
    ),
  ).toBe("first");
  expect(
    managerReviewTurn(
      run,
      { ...task, prReadyAt: undefined, acceptedDispatchId: "dispatch" },
      blocks,
    ),
  ).toBe("first");
  expect(
    managerReviewTurn(run, { ...task, prReadyAt: undefined }, blocks),
  ).toBe("first");
  expect(managerReviewTurn(run, task, [])).toBeUndefined();
});

it("deduplicates task cards and retains their original group across new work and lifecycle changes", () => {
  const nextTask = { ...task, id: "next-task", prReadyTurnId: "next" };
  const unfinished = {
    ...task,
    id: "unfinished",
    accepted: false,
    prReadyAt: undefined,
    prUrl: undefined,
  };
  const timeline = managerReviewTimeline(
    [{ ...run, tasks: [task, nextTask, unfinished] }, run],
    blocks,
  );
  expect([...timeline.keys()]).toEqual(["first", "next"]);
  expect(
    timeline
      .get("first")
      ?.flatMap((group) => group.tasks.map((task) => task.id)),
  ).toEqual(["task"]);
  expect(timeline.get("next")?.[0].tasks).toEqual([nextTask]);
  const sentBack = {
    ...run,
    tasks: [{ ...task, accepted: false, status: "running" as const }],
  };
  expect(
    managerReviewTimeline([sentBack], blocks).get("first")?.[0].tasks,
  ).toEqual(sentBack.tasks);
  const legacySentBack = {
    ...run,
    tasks: [
      {
        ...task,
        accepted: false,
        prReadyAt: undefined,
        acceptedDispatchId: "dispatch",
      },
    ],
  };
  expect(
    managerReviewTimeline([legacySentBack], blocks).get("first")?.[0].tasks,
  ).toEqual(legacySentBack.tasks);
});
