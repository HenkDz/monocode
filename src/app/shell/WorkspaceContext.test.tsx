// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mono } from "../../features/monos/model/mono";
import type { MonoManagerGoal } from "../../features/monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../../features/orchestration/model/orchestrationState";
import type { UsageDashboardSnapshot } from "../../features/providers/model/usageDashboard";
import type { Worktree } from "../../features/source-control/model/worktrees";
import {
  WorkspaceContextTabs,
  WorkspaceGoals,
  WorkspaceUsage,
  WorkspaceWorktree,
  WorkspaceWorktrees,
  WorkspaceChanges,
  type WorkspaceContextTab,
} from "./WorkspaceContext";

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  reveal: vi.fn(),
  refresh: vi.fn(),
  roster: [] as Mono[],
  goals: [] as MonoManagerGoal[],
  runs: [] as OrchestrationRun[],
  trees: [] as Worktree[],
  error: undefined as string | undefined,
}));
vi.mock("../../platform/tauri/fs", () => ({
  gitDiffIndex: mocks.index,
  revealPath: mocks.reveal,
  subscribeGitChanged: () => () => {},
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({
    data: { worktrees: mocks.trees },
    error: mocks.error,
    refresh: mocks.refresh,
  }),
}));
vi.mock("../../features/source-control/hooks/usePrStatus", () => ({
  usePrStatus: () => ({ pr: null }),
}));
vi.mock("../../features/source-control/model/pullRequests", () => ({
  usePullRequests: () => [],
  pullRequestLabel: () => "Unknown",
}));
vi.mock("../../features/source-control/ui/WorktreePrActions", () => ({
  WorktreePrActions: () => null,
}));
vi.mock("../../features/source-control/ui/ProjectWorktrees", () => ({
  WorktreeCreatePr: () =>
    createElement("div", { role: "dialog" }, "Existing create PR form"),
}));
vi.mock("../../features/source-control/ui/DeleteWorktreeDialog", () => ({
  DeleteWorktreeDialog: () =>
    createElement("div", { role: "dialog" }, "Existing deletion review"),
}));
vi.mock("../../features/monos/model/monoManagerGoals", () => ({
  monoManagerGoals: {
    subscribe: () => () => {},
    snapshot: () => 0,
    goals: () => mocks.goals,
    autonomy: () => "medium-and-up",
  },
}));
vi.mock("../../features/monos/model/mono", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/monos/model/mono")>()),
  listMonos: () => mocks.roster,
}));
vi.mock("../../features/orchestration/model/orchestration", () => ({
  orchestrator: { subscribe: () => () => {}, snapshot: () => mocks.runs },
}));

let host: HTMLDivElement, root: Root;
const tree = (path = "C:/repo/feature"): Worktree => ({
  path,
  branch: "feature",
  head: "abc",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.index
    .mockReset()
    .mockResolvedValue({
      files: [],
      additions: 0,
      deletions: 0,
      defaultBranch: "main",
      ahead: 2,
      behind: 1,
      upstream: "origin/feature",
    });
  mocks.reveal.mockReset();
  mocks.roster = [];
  mocks.goals = [];
  mocks.runs = [];
  mocks.trees = [tree()];
  mocks.error = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps Changes tied to the selected checkout, ignores stale reads, and opens its diff", async () => {
  let finishOld!: (value: unknown) => void;
  mocks.index.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const open = vi.fn();
  await act(async () => root.render(createElement(WorkspaceChanges, { path: "C:/repo/old", onOpen: open })));
  mocks.index.mockResolvedValueOnce({ files: [{ path: "C:/repo/current/current.ts", status: "added", additions: 17, deletions: 0 }] });
  await act(async () => root.render(createElement(WorkspaceChanges, { path: "C:/repo/current", onOpen: open })));
  expect(host.textContent).toContain("current.ts");
  await act(async () => finishOld({ files: [{ path: "C:/repo/old/foreign.ts", status: "modified", additions: 1, deletions: 1 }] }));
  expect(host.textContent).not.toContain("foreign.ts");
  act(() => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Open diff")!.click());
  expect(open).toHaveBeenCalledOnce();
  mocks.index.mockRejectedValueOnce(Error("Checkout unavailable"));
  await act(async () => root.render(createElement(WorkspaceChanges, { path: "C:/repo/missing", onOpen: open })));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Checkout unavailable");
});
const click = (text: string) =>
  act(() =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === text)!
      .click(),
  );
const renderTree = async (path = "C:/repo/feature", remove = vi.fn()) => {
  await act(async () =>
    root.render(
      createElement(WorkspaceWorktree, {
        project: "C:/repo",
        path,
        sessions: [],
        onOpen: vi.fn(),
        onChanges: vi.fn(),
        onRemove: remove,
      }),
    ),
  );
  return remove;
};

it("shows the real project autonomy without a contradictory Not configured placeholder", async () => {
  mocks.roster = [{ id: "manager", role: "manager", projects: ["C:/repo"], mascot: "cat", color: "blue" } as Mono];
  const actions = { autonomy: vi.fn(), outcome: vi.fn(), allow: vi.fn(), deny: vi.fn(), resolve: vi.fn(), activate: vi.fn() };
  await act(async () => root.render(createElement(WorkspaceGoals, { project: "C:/repo", sessions: [], onOpenMono: vi.fn(), decisionActions: actions as never })));
  expect(host.querySelector('[aria-label="Project decision autonomy"]')).not.toBeNull();
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Medium & up");
  expect(host.textContent).not.toContain("Not configured");
});

it("puts the worktree summary before compact actions and removes duplicate folder controls (CC-UX2)", async () => {
  await act(async () => root.render(createElement(WorkspaceWorktree, {
    project: "C:/repo", path: "C:/repo/feature", sessions: [], onOpen: vi.fn(), onChanges: vi.fn(), onRemove: vi.fn(), onRunScript: vi.fn(),
  })));
  expect(host.querySelector('[aria-label="Worktree quick actions"]')).not.toBeNull();
  expect(host.textContent).toContain("Open in File Explorer");
  expect(host.textContent).not.toContain("Open workspace"); expect(host.textContent).not.toContain("Open folder");
  expect(host.querySelector('section')?.firstElementChild?.tagName).toBe("H2");
});

it("opens the existing create/delete review UIs without performing any mutation, and labels unsupported updates", async () => {
  const remove = await renderTree();
  expect(host.textContent).toContain("2 / 1");
  expect(host.textContent).not.toContain("C:/repo");
  expect(
    [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Update from main",
    )?.disabled,
  ).toBe(true);
  click("Create PR");
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
    "Existing create PR form",
  );
  click("Archive worktree…");
  expect(host.textContent).toContain("Existing deletion review");
  expect(remove).not.toHaveBeenCalled();
  expect(mocks.reveal).not.toHaveBeenCalled();
});

it("ignores an old checkout read after selection moves and exposes a failed read as unavailable", async () => {
  let finish!: (value: unknown) => void;
  mocks.trees.push(tree("C:/repo/other"));
  mocks.index.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await renderTree();
  mocks.index.mockRejectedValueOnce(new Error("read failed"));
  await renderTree("C:/repo/other");
  await act(async () =>
    finish({ files: [], upstream: "old", ahead: 99, behind: 99 }),
  );
  expect(host.textContent).toContain("Could not refresh worktree details");
  expect(host.textContent).not.toContain("99 / 99");
});

it("routes worktree selection only through the callback and retains an honest empty state", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      createElement(WorkspaceWorktrees, {
        project: "C:/repo",
        onSelect: select,
      }),
    ),
  );
  click("feature");
  expect(select).toHaveBeenCalledExactlyOnceWith(mocks.trees[0]);
  mocks.trees = [];
  await act(async () =>
    root.render(
      createElement(WorkspaceWorktrees, {
        project: "C:/repo",
        onSelect: select,
      }),
    ),
  );
  expect(host.textContent).toContain("No worktrees yet");
  expect(mocks.index).not.toHaveBeenCalled();
});

it("keeps goals and tasks scoped to their project and does not invent autonomy or decision totals", async () => {
  mocks.goals = [
    { id: "g", title: "Ship chooser", projectId: "C:/repo", state: "running" },
    {
      id: "other",
      title: "Unrelated goal",
      projectId: "C:/other",
      state: "running",
    },
  ] as MonoManagerGoal[];
  mocks.runs = [
    { cwd: "C:/other", tasks: [{ id: "x", title: "Unrelated task" }] },
  ] as OrchestrationRun[];
  await act(async () =>
    root.render(
      createElement(WorkspaceGoals, {
        project: "C:/repo",
        sessions: [],
        onOpenMono: vi.fn(),
      }),
    ),
  );
  expect(host.textContent).toContain("Ship chooser");
  expect(host.textContent).not.toContain("Unrelated");
  expect(host.textContent).toContain("No recorded tasks");
  expect(host.textContent).toContain("Not configured");
  expect(host.textContent).toContain("Not recorded");
  expect(host.querySelector("progress")).toBeNull();
  expect(host.textContent).toContain("Usage unavailable");
});

it("uses a one-line task summary and keeps the original prompt, IDs and copy behind Show work", async () => {
  const prompt = "RAW TASK PROMPT\nFull scope and constraints";
  mocks.goals = [{ id: "goal", title: "Ship routing", projectId: "C:/repo", state: "running" }] as MonoManagerGoal[];
  mocks.runs = [{ version: 2, leadId: "engine", cwd: "C:/repo", status: "active", allowedHarnesses: ["claude"], maxWorkers: 1, cli: "mono", continuations: 0, requests: {},
    tasks: [{ id: "raw-task-id", monoGoalId: "goal", sessionId: "worker-chat", harness: "claude", model: "claude-sonnet", title: prompt, prompt, status: "queued", dependsOn: [], files: [], scopes: [], accepted: false, delivered: false, result: "RAW REPORT" }] }];
  const copy = vi.fn(async () => {}), next = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  await act(async () => root.render(createElement(WorkspaceGoals, { project: "C:/repo", sessions: [], onOpenMono: vi.fn(),
    goalAction: id => createElement("button", { onClick: () => next(id) }, "Manager paused — Continue") })));
  expect(host.querySelector('[data-task-summary]')?.textContent).toBe("Ship routing");
  expect(host.textContent).not.toContain("RAW TASK PROMPT"); expect(host.textContent).not.toContain("raw-task-id");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Show work"))!.click());
  expect(host.querySelector("pre")?.textContent).toContain(prompt); expect(host.textContent).toContain("raw-task-id");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Copy work")!.click());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining(prompt));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Manager paused — Continue")!.click());
  expect(next).toHaveBeenCalledExactlyOnceWith("goal");
  expect(host.querySelector("details")).toBeNull();
});

it("uses only a fresh single associated account for the mini meter, never an aggregate or stale quota", async () => {
  const snapshot: UsageDashboardSnapshot = {
    now: 1,
    unknownAssignments: [],
    groups: [
      {
        provider: "codex",
        label: "Codex",
        poolNote: "",
        accounts: [
          {
            key: "codex:a",
            provider: "codex",
            accountId: "a",
            label: "Studio",
            freshness: "fresh",
            assignments: [
              {
                monoId: "m",
                sessionId: "s",
                name: "Manager",
                kind: "home",
                state: "idle",
              },
            ],
            status: { tone: "ready", label: "Ready", detail: null },
            limits: { weekly: { usedPercent: 38 } } as never,
          },
        ],
      },
    ],
  };
  await act(async () =>
    root.render(
      createElement(WorkspaceUsage, {
        snapshot,
        monoIds: new Set(["m"]),
        compact: true,
      }),
    ),
  );
  expect(
    host.querySelector('[role="meter"]')?.getAttribute("aria-valuenow"),
  ).toBe("62");
  expect(host.querySelector('[role="meter"]')?.getAttribute("title")).toBe("Codex · Studio: 62% left");
  expect(host.querySelector('[role="meter"]')?.getAttribute("aria-label")).toBe("Codex Studio remaining");
  snapshot.groups[0].accounts[0].freshness = "stale";
  await act(async () =>
    root.render(
      createElement(WorkspaceUsage, {
        snapshot,
        monoIds: new Set(["m"]),
        compact: true,
      }),
    ),
  );
  expect(host.querySelector('[role="meter"]')).toBeNull();
});

it("moves context tabs by keyboard with focus and a separate close control", () => {
  const close = vi.fn();
  function Probe() {
    const [tab, setTab] = useState<WorkspaceContextTab>("goal");
    return createElement(WorkspaceContextTabs, {
      tab,
      onChange: setTab,
      onClose: close,
      children: "Content",
    });
  }
  act(() => root.render(createElement(Probe)));
  const list = host.querySelector('[role="tablist"]')!;
  act(() =>
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ),
  );
  expect(document.activeElement?.textContent).toBe("Worktree");
  expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
  act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement?.textContent).toBe("Activity");
  act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement?.textContent).toBe("Goal");
  expect(host.querySelector('[aria-label="Hide panel"]')).toBeNull();
  expect(close).not.toHaveBeenCalled(); // The unified titlebar Panel toggle owns closing.
});

it("retains each task's parent pause and dependency context", async () => {
  const { selectAgentLiveState, agentLiveStateTooltip } = await import("../../features/agents/model/agentLiveState");
  const paused = { cwd: "C:/repo", status: "paused", lastPauseReason: "Owner paused this run", tasks: [{ id: "queued", title: "Paused assignment", status: "queued" }] } as OrchestrationRun;
  const dependency = { cwd: "C:/repo", status: "active", tasks: [{ id: "dependency", title: "Separate run dependency", status: "queued", dependsOn: ["queued"] }] } as OrchestrationRun;
  mocks.runs = [paused, dependency];
  await act(async () => root.render(createElement(WorkspaceGoals, { project: "C:/repo", sessions: [], onOpenMono: vi.fn() })));
  const expected = selectAgentLiveState(undefined, { task: paused.tasks[0], tasks: paused.tasks, runStatus: paused.status, pauseReason: paused.lastPauseReason });
  expect(expected.reason).toBe("paused");
  expect(host.querySelector('[data-agent-state="queued"]')?.getAttribute("title")).toBe(agentLiveStateTooltip(expected));
  expect(host.textContent).toContain("Paused assignment");
  expect(host.querySelectorAll('[data-agent-state="queued"]')[1]?.getAttribute("title")).toContain("Waiting for task queued");
});

it("uses canonical newest checkout assignments and excludes another project", async () => {
  const workspace = { projectCwd: "C:/repo", checkoutCwd: "C:/repo/feature", kind: "worktree" };
  const oldTask = { id: "old", sessionId: "old-session", memberId: "old", memberName: "Old owner", status: "completed", accepted: true, workspace };
  const currentTask = { id: "current", sessionId: "current-session", memberId: "current", memberName: "Current owner", status: "running", workspace };
  const foreignTask = { ...currentTask, id: "foreign", sessionId: "foreign-session", memberName: "Foreign owner" };
  const run = (cwd: string, task: unknown, startedAt: number) => ({ cwd, projectManager: true, status: "active", tasks: [task], dispatches: [{ taskId: (task as any).id, sessionId: (task as any).sessionId, startedAt, workspace }] });
  mocks.runs = [run("C:/repo", oldTask, 10), run("C:/other", foreignTask, 100), run("C:/repo", currentTask, 30)] as OrchestrationRun[];
  const { worktreeTaskSessions } = await import("../../features/source-control/model/worktreeSessions");
  const { pathKey } = await import("../../shared/lib/paths");
  expect(worktreeTaskSessions("C:/repo", mocks.trees, mocks.runs).get(pathKey(workspace.checkoutCwd))?.[0].task).toBe(currentTask);
  await act(async () => root.render(createElement(WorkspaceWorktrees, { project: "C:/repo", onSelect: vi.fn() })));
  expect(host.querySelector('[data-agent-state="thinking"]')).not.toBeNull();
  expect(host.querySelector('[data-agent-state="done"]')).toBeNull();
  await renderTree();
  expect(host.textContent).toContain("Current owner");
  expect(host.textContent).not.toContain("Old owner");
  expect(host.textContent).not.toContain("Foreign owner");
});

it("retains historical dispatch checkout state when its task retries elsewhere", async () => {
  const workspace = { projectCwd: "C:/repo", checkoutCwd: "C:/repo/feature", kind: "worktree" };
  const retryWorkspace = { ...workspace, checkoutCwd: "C:/repo/retry" };
  const task = { id: "retry", sessionId: "new-worker", memberId: "member", memberName: "Assigned member", status: "running", workspace: retryWorkspace, accepted: false };
  mocks.trees.push(tree(retryWorkspace.checkoutCwd));
  mocks.runs = [{ cwd: "C:/repo", projectManager: true, status: "active", tasks: [task], dispatches: [
    { id: "old", taskId: task.id, sessionId: "old-worker", state: "completed", stage: "settled", startedAt: 10, workspace },
    { id: "new", taskId: task.id, sessionId: task.sessionId, state: "running", stage: "turn_submitted", startedAt: 20, workspace: retryWorkspace },
  ] }] as OrchestrationRun[];
  const { workbenchSessionTask } = await import("../../features/monos/model/monoNavigation");
  const { selectAgentLiveState, agentLiveStateTooltip } = await import("../../features/agents/model/agentLiveState");
  const historical = workbenchSessionTask(mocks.runs, "old-worker")!;
  expect(historical.historical).toBe(true);
  expect(historical.workspace?.checkoutCwd).toBe(workspace.checkoutCwd);
  const state = selectAgentLiveState(undefined, { task: historical, tasks: mocks.runs[0].tasks, runStatus: mocks.runs[0].status });
  await act(async () => root.render(createElement(WorkspaceWorktrees, { project: "C:/repo", onSelect: vi.fn() })));
  const rows = host.querySelectorAll('[data-sidebar-row]');
  expect(rows[0].querySelector('[data-agent-state]')?.getAttribute("title")).toBe(agentLiveStateTooltip(state));
  expect(rows[0].querySelector('[data-agent-state="thinking"]')).toBeNull();
  expect(rows[1].querySelector('[data-agent-state="thinking"]')).not.toBeNull();
});
