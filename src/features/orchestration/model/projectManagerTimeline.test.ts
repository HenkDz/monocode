import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";
import {
  managerReviewTimeline,
  managerReviewTurn,
} from "./projectManagerTimeline";

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
