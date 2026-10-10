// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoTeamActivity } from "./MonoTeamActivity";
import { teamDecisions, orgDescendants } from "../model/monoTeamActivity";
import { newSession } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Mono } from "../model/mono";
import { monoManagerGoals, type MonoManagerGoal } from "../model/monoManagerGoals";
import { orchestrator } from "../../orchestration/model/orchestration";
import { activityTaskTitle, activityTaskEvent, teamActivityTasks } from "../model/monoTeamActivity";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";
import type { GitPr } from "../../../platform/tauri/fs";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
const roster: Mono[] = [
  { id: "o", role: "orchestrator", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "m", role: "manager", reportsTo: "o", sessionId: "manager-chat", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#abc" },
  { id: "b", role: "member", reportsTo: "m", projects: ["/app"], specialty: "Backend", name: "Backend", mascot: "cat", color: "#abc" },
];
it("groups descendant decisions once and routes inline approval to the worker session", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const session = { ...newSession("codex", "/app"), id: "worker", busy: true, blocks: [{ id: "a", role: "tool" as const, text: "Run guarded command", approval: { requestId: 42, autoApprovalReason: "wrapped by untrusted rtk, call the app CLI directly" } }] };
  const runs = [{ leadId: "engine", ownerMonoId: "m", cwd: "/app", tasks: [{ id: "t", title: "API", memberId: "b", sessionId: "worker", status: "running" }], dispatches: [] }] as unknown as OrchestrationRun[];
  expect([...orgDescendants(roster, "o")]).toEqual(["o", "m", "b"]);
  const shared = teamDecisions(roster, [session], runs);
  expect(shared).toHaveLength(1);
  expect(teamDecisions(roster, [{ ...session, blocks: [...session.blocks, { ...session.blocks[0], id: "duplicate" }] }], runs)).toHaveLength(1);
  expect(teamDecisions(roster, [session, session], runs)).toHaveLength(1);
  expect(teamDecisions(roster, [session], runs, "m")).toHaveLength(1);
  expect(teamDecisions(roster, [session], runs, "unrelated")).toHaveLength(0);
  const container = document.createElement("div"), root = createRoot(container), approve = vi.fn();
  const resume = vi.spyOn(orchestrator, "continueManager").mockResolvedValue();
  const goals = vi.spyOn(monoManagerGoals, "goals").mockReturnValue([
    { id: "queued", managerId: "engine", title: "Queued documentation goal", state: "queued" },
    { id: "other", managerId: "another-engine", title: "Other project goal", state: "queued" },
    { id: "done", managerId: "engine", title: "Finished goal", state: "done" },
  ] as MonoManagerGoal[]);
  try {
    await act(async () => root.render(<MonoTeamActivity monoId="o" sessions={[session]} runs={runs} statuses={new Map()} onApproval={approve} onQuestion={vi.fn()} onQuestionInteraction={vi.fn()} />));
    expect(container.querySelector("[data-team-needs-count]")?.textContent).toBe(String(shared.length));
    expect(container.textContent).toContain("wrapped by untrusted rtk");
    for (const label of ["Allow", "Deny"]) {
      await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click());
      expect(approve).toHaveBeenLastCalledWith("worker", 42, label.toLowerCase());
    }
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("Queued documentation goal");
    expect(container.textContent).toContain("Awaiting worker assignment");
    expect(container.textContent).not.toContain("Other project goal");
    expect(container.textContent).not.toContain("Finished goal");
    const manager = { ...newSession("claude", "/home"), id: "manager-chat" };
    const paused = [{ ...runs[0], projectManager: true, ownerSessionId: manager.id, status: "paused" as const, error: "Delivery interrupted" }];
    expect(teamDecisions(roster, [session, manager], paused, "o")).toHaveLength(2);
    expect(teamDecisions(roster, [session, manager], [{ ...paused[0], recovering: true }], "o")).toHaveLength(1);
    await act(async () => root.render(<MonoTeamActivity monoId="o" sessions={[session, manager]} runs={paused} statuses={new Map()} onApproval={approve} onQuestion={vi.fn()} onQuestionInteraction={vi.fn()} />));
    expect(container.querySelector("[data-team-needs-count]")?.textContent).toBe("2");
    expect(container.textContent).toContain("Delivery interrupted");
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Continue")!.click());
    expect(resume).toHaveBeenCalledExactlyOnceWith("engine");
  } finally { resume.mockRestore(); goals.mockRestore(); await act(async () => root.unmount()); localStorage.removeItem("monocode:mono-roster"); vi.unstubAllGlobals(); }
});

it("uses sidebar display names with path tooltips and places no-change completion under Finished", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  localStorage.setItem("monocode:tab-group:labels", JSON.stringify({ "/app": "Friendly App" }));
  const task = { id: "report", title: "Investigate", memberId: "b", sessionId: "report-worker", status: "completed", accepted: true, lastDispatchId: "report-dispatch", acceptedDispatchId: "report-dispatch", completionOutcome: "no-changes", prompt: "", result: "Findings" } as OrchestrationTask;
  const runs = [{ leadId: "engine", ownerMonoId: "m", cwd: "/app", projectName: "/app", tasks: [task], dispatches: [] }, { leadId: "other", ownerMonoId: "m", cwd: "C:/Projects/Other", tasks: [], dispatches: [] }] as unknown as OrchestrationRun[];
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MonoTeamActivity monoId="o" sessions={[]} runs={runs} statuses={new Map()} onApproval={vi.fn()} onQuestion={vi.fn()} onQuestionInteraction={vi.fn()} />));
    expect(host.querySelector('h3[title="/app"]')?.textContent).toBe("Friendly App");
    expect(host.querySelector('h3[title="C:/Projects/Other"]')).toBeNull();
    expect(host.querySelector('[data-team-section="Recently finished"] [data-team-task="report"]')).not.toBeNull();
    expect(host.textContent).toContain("Completed (no changes)");
    expect(host.querySelector('[data-team-section="Work in progress"]')).toBeNull();
  } finally { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals(); }
});

// A goal remains one group even when its tasks are in different states.
it("shows flat summary rows and counted keyboard tabs, and opens the ready card", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const prompt = Array.from(
    { length: 40 },
    (_, i) => `Instruction ${i + 1}`,
  ).join("\n");
  const base = {
    id: "ready",
    sessionId: "ready-worker",
    memberId: "b",
    monoGoalId: "shared-goal",
    title: prompt,
    prompt,
    status: "completed",
    accepted: true,
    lastDispatchId: "dispatch",
    acceptedDispatchId: "dispatch",
    prUrl: "https://github.com/org/repo/pull/6",
    result: "",
  } as OrchestrationTask;
  const ready = {
    ...newSession("codex", "/app"),
    id: base.sessionId,
    blocks: [
      {
        id: "tool",
        role: "tool" as const,
        text: "Verbose output",
        tool: { title: "Tests passed" },
      },
      { id: "private", role: "reasoning" as const, text: "Private reasoning" },
      { id: "user", role: "user" as const, text: prompt },
    ],
  };
  const runs = [
    {
      leadId: "engine",
      ownerMonoId: "m",
      ownerSessionId: "manager-chat",
      cwd: "/app",
      projectName: "App",
      tasks: [
        base,
        {
          ...base,
          id: "running",
          sessionId: "running-worker",
          title: "Build search",
          prompt: "A".repeat(240),
          status: "running",
          accepted: false,
        },
        {
          ...base,
          id: "cancelled",
          sessionId: "cancelled-worker",
          title: "Cancelled work",
          status: "cancelled",
        },
      ],
      dispatches: [{ id: "dispatch", startedAt: 1000, updatedAt: 11000 }],
    },
    {
      leadId: "another-run",
      ownerMonoId: "m",
      cwd: "/app",
      projectName: "App",
      tasks: [base],
      dispatches: [],
    },
  ] as unknown as OrchestrationRun[];
  const goals = vi.spyOn(monoManagerGoals, "goals").mockReturnValue([
    {
      id: "shared-goal",
      managerId: "engine",
      title: "Polish search experience\n" + prompt,
      state: "running",
    },
  ] as MonoManagerGoal[]);
  const open = vi.fn();
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <OrchestrationActions.Provider
          value={{
            update: vi.fn(),
            confirm: vi.fn(),
            retry: vi.fn(),
            open: vi.fn(),
            openManagerCard: open,
          }}
        >
          <MonoTeamActivity
            monoId="o"
            sessions={[ready]}
            runs={runs}
            statuses={new Map()}
            onApproval={vi.fn()}
            onQuestion={vi.fn()}
            onQuestionInteraction={vi.fn()}
          />
        </OrchestrationActions.Provider>,
      ),
    );
    expect(container.querySelectorAll("[data-team-project]")).toHaveLength(1);
    expect(container.querySelectorAll("[role=tab]")).toHaveLength(5);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    expect(tabs.map(tab => tab.textContent)).toEqual(["Needs you 0", "Working 1", "Ready 1", "Finished 1", "Feed 0"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true})));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true})));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[data-team-section="Work in progress"]')?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector('[data-team-section="Ready to merge"]')?.hasAttribute("hidden")).toBe(true);
    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", {key: "End", bubbles: true})));
    expect(tabs[4].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role=tabpanel]')?.getAttribute("aria-labelledby")).toBe(tabs[4].id);
    await act(async () => tabs[2].click());
    for (const [id, section] of [
      ["ready", "Ready to merge"],
      ["running", "Work in progress"],
      ["cancelled", "Recently finished"],
    ]) {
      expect(
        container.querySelectorAll(`[data-team-task="${id}"]`),
      ).toHaveLength(1);
      expect(
        container
          .querySelector(`[data-team-task="${id}"]`)
          ?.closest("[data-team-section]")
          ?.getAttribute("data-team-section"),
      ).toBe(section);
    }
    const task = container.querySelector('[data-team-task="ready"]')!;
    expect(task.querySelector("[data-task-title]")?.textContent).toBe(
      "Polish search experience",
    );
    expect(task.querySelector("[data-task-event]")?.textContent).toBe(
      "Tests passed",
    );
    expect(task.querySelector("svg")).not.toBeNull();
    expect(task.textContent).toContain("10s");
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("[data-task-prompt]")).toBeNull();
    expect(task.textContent).not.toContain(prompt);
    await act(async () => [...task.querySelectorAll("button")].find(button => button.textContent === "Open")!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("manager-chat", "ready");
  } finally {
    goals.mockRestore();
    await act(async () => root.unmount());
    localStorage.removeItem("monocode:mono-roster");
    vi.unstubAllGlobals();
  }
});

it("never uses the prompt as a title or latest event", () => {
  const task = {
    title: "",
    prompt: "Entire assignment\nDo this",
    result: "",
  } as OrchestrationTask;
  expect(activityTaskTitle(task, "Goal summary\nLong goal instructions")).toBe(
    "Goal summary",
  );
  expect(
    activityTaskTitle({ ...task, title: task.prompt }, "Goal summary"),
  ).toBe("Goal summary");
  expect(activityTaskTitle({ ...task, title: task.prompt })).toBe(
    "Untitled task",
  );
  expect(
    activityTaskTitle({ ...task, title: "Task title" }, "Goal summary"),
  ).toBe("Task title");
  expect(
    activityTaskEvent(task, {
      ...newSession("codex", "/app"),
      blocks: [
        { id: "old", role: "assistant", text: "Review complete\nLong report" },
        { id: "prompt", role: "assistant", text: task.prompt },
        { id: "reasoning", role: "reasoning", text: "Hidden thoughts" },
        {
          id: "internal",
          role: "assistant",
          text: "Internal update",
          internal: true,
        },
      ],
    }),
  ).toBe("Review complete");
});

it("classifies pending questions, approvals, review and closed PRs into mutually exclusive sections", () => {
  const base = {
    id: "t",
    title: "Task",
    prompt: "Instructions",
    sessionId: "worker",
    status: "completed",
    accepted: true,
    lastDispatchId: "dispatch",
    acceptedDispatchId: "dispatch",
    prUrl: "https://github.com/org/repo/pull/6",
    workspace: { checkoutCwd: "/app/worker", branch: "feature" },
  } as OrchestrationTask;
  const session = {
    ...newSession("codex", "/app"),
    id: "worker",
    pendingQuestion: { requestId: 1, questions: [] },
  };
  const run = {
    leadId: "engine",
    ownerMonoId: "m",
    cwd: "/app",
    tasks: [
      { ...base, memberId: "b" },
      { ...base, memberId: "b" },
    ],
  } as OrchestrationRun;
  const decisions = teamDecisions(roster, [session], [run], "o");
  expect(
    teamActivityTasks([run], new Map(), decisions).map((row) => row.section),
  ).toEqual(["Needs you"]);
  const approval = {
    ...session,
    pendingQuestion: undefined,
    blocks: [
      {
        id: "a",
        role: "tool" as const,
        text: "Permission",
        approval: { requestId: 2 },
      },
    ],
  };
  expect(
    teamActivityTasks(
      [run],
      new Map(),
      teamDecisions(roster, [approval], [run], "o"),
    )[0].section,
  ).toBe("Needs you");
  const statuses = new Map([
    [
      prStatusKey("/app/worker", "feature"),
      { url: base.prUrl, state: "open", isDraft: false } as GitPr,
    ],
  ]);
  expect(teamActivityTasks([run], statuses, [])[0].section).toBe(
    "Ready to merge",
  );
  for (const state of ["merged", "closed"] as const) {
    statuses.set(prStatusKey("/app/worker", "feature"), {
      url: base.prUrl,
      state,
    } as GitPr);
    expect(teamActivityTasks([run], statuses, [])[0].section).toBe(
      "Recently finished",
    );
  }
  for (const status of ["queued", "running", "completed"] as const) {
    expect(
      teamActivityTasks(
        [{ ...run, tasks: [{ ...base, status, accepted: false }] }],
        new Map(),
        [],
      )[0].section,
    ).toBe("Work in progress");
  }
  expect(
    teamActivityTasks(
      [{ ...run, tasks: [{ ...base, status: "cancelled" }] }],
      new Map(),
      [],
    )[0].section,
  ).toBe("Recently finished");
});
