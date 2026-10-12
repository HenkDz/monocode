import { expect, it } from "vitest";
import { activityKind, memberActivityEvents } from "./memberActivity";
import type { Block } from "../../sessions/model/session";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";

const task = {
  id: "task",
  memberId: "reviewer",
  title: "Review native state",
  status: "completed",
  result: "Checked",
} as OrchestrationTask;
const block = (role: Block["role"], extra: Partial<Block> = {}): Block => ({
  id: role,
  role,
  text: "Visible text",
  ...extra,
});

it("classifies meaningful messages, results, tools and errors while excluding private prompts and thinking", () => {
  expect(activityKind(block("user"))).toBe("messages");
  expect(activityKind(block("assistant"))).toBe("results");
  expect(
    activityKind(
      block("tool", { tool: { kind: "shell", status: "completed" } }),
    ),
  ).toBe("tools");
  expect(
    activityKind(block("tool", { tool: { kind: "shell", status: "failed" } })),
  ).toBe("errors");
  expect(activityKind(block("system", { notice: "error" }))).toBe("errors");
  expect(activityKind(block("user", { internal: true }))).toBeUndefined();
  expect(activityKind(block("user", { draft: true }))).toBeUndefined();
  expect(activityKind(block("reasoning"))).toBeUndefined();
  expect(activityKind(block("system"))).toBeUndefined();
  expect(
    activityKind(
      block("user", {
        text: "<monocode_context>Private protocol</monocode_context>",
      }),
    ),
  ).toBeUndefined();
});

it("joins dispatch assignments and outcomes with source-ordered transcript steps without claiming step clocks", () => {
  const runs = [
    {
      leadId: "manager",
      tasks: [task, { ...task, id: "other", memberId: "other" }],
      dispatches: [
        {
          id: "dispatch",
          taskId: task.id,
          state: "completed",
          startedAt: 10,
          finishedAt: 30,
        },
      ],
    },
  ] as OrchestrationRun[];
  const blocks = [
    block("user", { startedAt: 20 }),
    block("tool", { tool: { kind: "shell", status: "completed" } }),
    block("assistant"),
  ];
  const events = memberActivityEvents(runs, "reviewer", blocks);
  expect(events.map((event) => event.id)).toEqual([
    "task:manager:task:assignment",
    "block:user",
    "block:tool",
    "block:assistant",
    "dispatch:manager:dispatch:outcome",
  ]);
  expect(events.map((event) => event.kind)).toEqual([
    "assignments",
    "messages",
    "tools",
    "results",
    "results",
  ]);
  expect(events[2].at).toBeUndefined();
  expect(events[2].orderAt).toBe(20);
  expect(events[4].at).toBe(30);
});

it("retains failed attempts and unknown completion times without using mutable update times", () => {
  const runs = [
    {
      leadId: "manager",
      tasks: [task],
      dispatches: [
        {
          id: "failed",
          taskId: task.id,
          state: "failed",
          startedAt: 10,
          updatedAt: 90,
          error: "Private Mono storage is only supported for Codex app-server",
        },
        {
          id: "completed",
          taskId: task.id,
          state: "completed",
          startedAt: 20,
          finishedAt: 40,
        },
      ],
    },
  ] as OrchestrationRun[];
  const events = memberActivityEvents(runs, "reviewer", []);
  const failure = events.find((event) => event.kind === "errors")!;
  expect(failure.id).toBe("dispatch:manager:failed:outcome");
  expect(failure.at).toBeUndefined();
  expect(failure.error).toContain("Private Mono storage");
  expect(events.filter((event) => event.kind === "results")).toHaveLength(1);
  expect(
    memberActivityEvents(
      [{ tasks: [task], dispatches: [] }] as unknown as OrchestrationRun[],
      "reviewer",
      [],
    ).map((event) => event.at),
  ).toEqual([undefined, undefined]);
});

it("keeps equal task and dispatch identities separate across their owning Managers", () => {
  const runs = ["manager-a", "manager-b"].map((leadId) => ({
    leadId,
    tasks: [{ ...task }],
    dispatches: [
      {
        id: "dispatch",
        taskId: task.id,
        state: "completed",
        startedAt: 10,
        finishedAt: 30,
      },
    ],
  })) as OrchestrationRun[];
  const events = memberActivityEvents(runs, "reviewer", []);
  expect(new Set(events.map((event) => event.id)).size).toBe(4);
  expect(events.map((event) => event.id)).toEqual([
    "task:manager-a:task:assignment",
    "task:manager-b:task:assignment",
    "dispatch:manager-a:dispatch:outcome",
    "dispatch:manager-b:dispatch:outcome",
  ]);
});

it("keeps the current failed snapshot when only an older completed attempt has a recorded outcome", () => {
  const runs = [
    {
      leadId: "manager",
      tasks: [
        {
          ...task,
          status: "failed",
          lastDispatchId: "new",
          error: "Transport disconnected",
        },
      ],
      dispatches: [
        {
          id: "old",
          taskId: task.id,
          state: "completed",
          startedAt: 10,
          finishedAt: 20,
        },
      ],
    },
  ] as OrchestrationRun[];
  expect(
    memberActivityEvents(runs, "reviewer", []).find(
      (event) => event.id === "task:manager:task:outcome",
    )?.error,
  ).toBe("Transport disconnected");
});

it("labels assignments with the recorded member name and keeps task titles separate from outcomes", () => {
  const events = memberActivityEvents(
    [
      {
        leadId: "manager",
        tasks: [{ ...task, memberName: "Reviewer" }],
        dispatches: [
          {
            id: "done",
            taskId: task.id,
            state: "completed",
            startedAt: 10,
            finishedAt: 20,
          },
        ],
      },
    ] as OrchestrationRun[],
    "reviewer",
    [],
  );
  expect(events.map((event) => event.label)).toEqual([
    "Assigned to Reviewer",
    "Finished",
  ]);
  expect(events.map((event) => event.task?.title)).toEqual([
    task.title,
    task.title,
  ]);
  expect(
    memberActivityEvents(
      [
        { leadId: "manager", tasks: [task], dispatches: [] },
      ] as unknown as OrchestrationRun[],
      "reviewer",
      [],
    )[0].label,
  ).toBe("Assigned to member");
});

it.each(["queued", "workspace_prepared", "session_prepared"])(
  "labels a failed %s attempt as stopped before starting only with a recorded preparation stage",
  (stage) => {
    const events = memberActivityEvents(
      [
        {
          leadId: "manager",
          tasks: [task],
          dispatches: [
            {
              id: "failed",
              taskId: task.id,
              state: "failed",
              stage,
              startedAt: 10,
            },
          ],
        },
      ] as OrchestrationRun[],
      "reviewer",
      [],
    );
    expect(events.find((event) => event.kind === "errors")?.label).toBe(
      "Stopped before starting",
    );
  },
);

it.each([
  { stage: "submitted" },
  { stage: "settled" },
  {},
  { stage: "session_prepared", turnStartedAt: 0 },
])(
  "keeps failure start boundaries unknown or recorded without inventing a launch failure for %s",
  (boundaries) => {
    const events = memberActivityEvents(
      [
        {
          leadId: "manager",
          tasks: [task],
          dispatches: [
            {
              id: "failed",
              taskId: task.id,
              state: "failed",
              startedAt: 10,
              ...boundaries,
            },
          ],
        },
      ] as OrchestrationRun[],
      "reviewer",
      [],
    );
    expect(events.find((event) => event.kind === "errors")?.label).toBe(
      "Stopped",
    );
  },
);
