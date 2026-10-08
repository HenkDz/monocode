// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { crewFeed, MonoOrgActivity } from "./MonoOrgActivity";
import type { Mono } from "../model/mono";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { newSession } from "../../sessions/model/session";
import { crewMessages, recordCrewDecision } from "../model/monoCrewEvents";
import { activityToolTitle } from "../model/monoTeamActivity";

it("rolls descendant chat work and decisions through the org even without worker tasks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const roster = [
    {
      id: "orchestrator",
      role: "orchestrator",
      name: "Orchestrator",
      projects: ["/app"],
      mascot: "cat",
      color: "#abc",
    },
    {
      id: "manager",
      role: "manager",
      name: "Manager",
      reportsTo: "orchestrator",
      sessionId: "manager-chat",
      projects: ["/app"],
      mascot: "cat",
      color: "#abc",
    },
  ] as Mono[];
  const session = {
    ...newSession("codex", "/app"),
    id: "manager-chat",
    busy: true,
  };
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MonoOrgActivity
          rootId="orchestrator"
          roster={roster}
          runs={[]}
          sessions={[session]}
          now={1}
        />,
      ),
    );
    const row = () =>
      container.querySelector('[data-org-member="orchestrator"]')!
        .firstElementChild!.textContent;
    expect(row()).toContain("Working");
    expect(row()).toContain("1 working");
    await act(async () =>
      root.render(
        <MonoOrgActivity
          rootId="orchestrator"
          roster={roster}
          runs={[]}
          sessions={[
            {
              ...session,
              pendingQuestion: {
                requestId: 1,
                title: "Decision",
                questions: [],
              },
            },
          ]}
          now={2}
        />,
      ),
    );
    expect(row()).toContain("Needs you");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("summarizes native teammate tool steps without showing command arguments", () => {
  expect(
    activityToolTitle(
      "C:/MonoCode/monocode.exe app team.message --input C:/Temp/question.json",
    ),
  ).toBe("Asking a teammate");
  expect(activityToolTitle("Reading routing source")).toBe(
    "Reading routing source",
  );
  expect(activityToolTitle("rtk rg --files src")).toBe(
    "Searching project files",
  );
  expect(activityToolTitle("git diff --stat")).toBe(
    "Inspecting repository changes",
  );
  expect(activityToolTitle("node work/r10-live/check.mjs")).toBe(
    "Running a Node command",
  );
});

it("stores user decisions once and includes stored handoffs in the feed", () => {
  localStorage.setItem(
    "monocode:mono-roster",
    JSON.stringify([
      {
        id: "manager",
        role: "manager",
        projects: ["/app"],
        mascot: "cat",
        color: "#abc",
        sessionId: "manager-chat",
      },
    ]),
  );
  const runs = [
    {
      ownerMonoId: "manager",
      tasks: [
        {
          id: "task",
          memberName: "Backend",
          title: "Fix routing",
          prompt: "Fix routing implementation",
          sessionId: "worker",
          handoffNote: "Reviewer requested a routing guard",
        },
      ],
      dispatches: [
        {
          id: "dispatch",
          taskId: "task",
          startedAt: 10,
          updatedAt: 20,
          state: "running",
        },
      ],
    },
  ] as OrchestrationRun[];
  recordCrewDecision(
    runs,
    "worker",
    "decision-1",
    "answered the team's question",
  );
  recordCrewDecision(
    runs,
    "worker",
    "decision-1",
    "answered the team's question",
  );
  expect(
    crewMessages().filter((event) => event.id === "decision-1"),
  ).toHaveLength(1);
  expect(
    crewMessages().find((event) => event.id === "decision-1")?.summary,
  ).toContain("You answered the team's question");
  expect(
    crewFeed([], runs).find((event) => event.id === "task:handoff")?.text,
  ).toContain("Reviewer requested a routing guard");
  localStorage.removeItem("monocode:mono-roster");
  localStorage.removeItem("monocode:crew-messages");
});

it("retains review events whose verdict identifies the implementation dispatch", () => {
  const task = {
    id: "review",
    memberName: "Reviewer",
    title: "Routing review",
    prompt: "Review the change",
    reviewVerdict: { dispatchId: "implementation", decision: "approve" },
  };
  const run = {
    tasks: [task],
    dispatches: [
      {
        id: "review-dispatch",
        taskId: "review",
        startedAt: 10,
        updatedAt: 20,
        state: "completed",
      },
    ],
  } as unknown as OrchestrationRun;
  const feed = crewFeed([], [run, run]);
  expect(feed.filter((event) => event.text.includes("approved"))).toEqual([
    {
      id: "review:review:implementation",
      at: 20,
      memberId: undefined,
      text: "Reviewer approved Routing review",
    },
  ]);
});

it("shows hierarchy, live worker steps and a chronological feed from stored dispatches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const roster = [
    {
      id: "manager",
      role: "manager",
      name: "Manager",
      projects: ["/app"],
      mascot: "cat",
      color: "#abc",
    },
    {
      id: "backend",
      role: "member",
      reportsTo: "manager",
      name: "Backend",
      projects: ["/app"],
      mascot: "cat",
      color: "#abc",
    },
  ] as Mono[];
  const runs = [
    {
      ownerMonoId: "manager",
      tasks: [
        {
          id: "task",
          memberId: "backend",
          sessionId: "worker",
          title: "Fix routing",
          prompt: "Fix the API routing",
          status: "running",
          activeDispatchId: "dispatch",
        },
      ],
      dispatches: [
        {
          id: "dispatch",
          taskId: "task",
          startedAt: 1000,
          updatedAt: 2000,
          state: "running",
        },
      ],
    },
  ] as OrchestrationRun[];
  const worker = {
    ...newSession("codex", "/app"),
    id: "worker",
    busy: true,
    blocks: [
      {
        id: "step",
        role: "tool" as const,
        text: "",
        tool: { title: "Reading routes" },
      },
    ],
  } as ReturnType<typeof newSession>;
  expect(crewFeed(roster, runs).map((event) => event.text)).toEqual([
    "Backend picked up Fix routing",
  ]);
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MonoOrgActivity
          rootId="manager"
          roster={roster}
          runs={runs}
          sessions={[worker]}
          now={6000}
        />,
      ),
    );
    expect(
      container.querySelector(
        '[data-org-member="manager"] [data-org-member="backend"]',
      ),
    ).toBeTruthy();
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("Now doing: Reading routes");
    expect(container.textContent).toContain("Backend picked up Fix routing");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
