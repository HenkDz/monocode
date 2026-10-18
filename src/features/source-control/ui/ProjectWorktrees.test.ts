// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Storage } from "happy-dom";
import { ProjectWorktrees } from "./ProjectWorktrees";
import { ProjectRail } from "../../../app/shell/ProjectRail";
import { ProjectManagerRow } from "../../orchestration/ui/ProjectManagerRow";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { setWorktreeFocus, worktreeFocus } from "../model/worktreeFocus";
import type { Worktree, WorktreeCreationOptions } from "../model/worktrees";
let creationOptions: WorktreeCreationOptions;
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../projects/model/projectGroups";
import { savePinnedProjects } from "../../projects/model/recents";
import { pathKey } from "../../../shared/lib/paths";
import { copyText } from "../../../platform/tauri/clipboard";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { recordPullRequest } from "../model/pullRequests";
import { OrchestrationWorkers } from "../../orchestration/ui/OrchestrationActions";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import {
  orchestrator,
  type OrchestrationRun,
} from "../../orchestration/model/orchestration";
import {
  gitPrStatus,
  gitPrList,
  gitPrStatusByUrl,
  revealPath,
  notifyGitChanged,
  type GitPr,
} from "../../../platform/tauri/fs";

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitPrStatus: vi.fn(async () => null),
  gitPrList: vi.fn(),
  gitPrStatusByUrl: vi.fn(),
  revealPath: vi.fn(async () => {}),
}));
vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: vi.fn(async () => {}),
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: () => true,
}));

vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: vi.fn(),
}));
vi.mock("./CreateWorktreeDialog", () => ({
  CreateWorktreeDialog: ({
    onCreated,
  }: {
    onCreated: (tree: Worktree, options: WorktreeCreationOptions) => void;
  }) =>
    createElement(
      "button",
      {
        onClick: () => onCreated(tree("/trees/new", "new"), creationOptions),
        "aria-label": "Confirm creation",
      },
      "Create",
    ),
}));
vi.mock("../hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));

const tree = (path: string, branch: string, isMain = false): Worktree => ({
  path,
  branch,
  isMain,
  head: "abc1234",
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
});
const session = (id: string, worktreeCwd?: string): SessionSummary => ({
  id,
  cwd: "/repo",
  worktreeCwd,
  title: id,
  harness: "pi",
  model: "",
  runtimeMode: "supervised",
  createdAt: 1,
  updatedAt: 1,
});
const refresh = vi.fn(async () => true);
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof ProjectWorktrees>;
const button = (label: string) => {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.getAttribute("aria-label") === label);
  expect(found, label).toBeDefined();
  return found!;
};
const render = async () => {
  await act(async () => root.render(createElement(ProjectWorktrees, props)));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", new Storage());
  localStorage.clear();
  setWorktreeFocus("/repo", undefined);
  refresh.mockClear();
  vi.mocked(gitPrStatus).mockReset().mockResolvedValue(null);
  vi.mocked(gitPrList).mockReset().mockImplementation(async (cwd) => {
    const pr = await gitPrStatus(cwd);
    return pr ? [pr] : [];
  });
  vi.mocked(gitPrStatusByUrl).mockReset().mockImplementation((cwd) => gitPrStatus(cwd));
  creationOptions = { keepOpen: false };
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [
        tree("/repo", "main", true),
        tree("/trees/a", "feature-a"),
        tree("/trees/b", "feature-b"),
      ],
      defaultRoot: "/trees",
    },
    refresh,
  });
  props = {
    project: "/repo",
    currentProject: "/another",
    enabled: true,
    history: [
      session("main-chat"),
      session("a-chat", "/trees/a"),
      session("b-chat", "/trees/b"),
    ],
    openSessions: [session("blank", "/trees/a")],
    busySessionIds: new Set(["a-chat"]),
    approvalSessionIds: new Set(["b-chat"]),
    unseenFinishedIds: new Set(),
    liveAgents: [],
    onLoadHistory: vi.fn(async () => true),
    onSelectWorktree: vi.fn(),
    onNewSession: vi.fn(),
    onSelectSession: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens an unloaded task worker from its worktree row without creating a blank session", async () => {
  const runs = [{ cwd: "/repo", projectManager: true, ownerMonoId: "manager", tasks: [{
    id: "audit", title: "Audit smoke test", sessionId: "persisted-worker", memberName: "Native Core", harness: "pi", model: "", status: "running",
    workspace: { projectCwd: "/repo", checkoutCwd: "/trees/a", kind: "worktree", branch: "feature-a" },
  }] }] as OrchestrationRun[];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  props.renderManager = () => createElement("span", null, "Manager");
  props.history = [];
  props.openSessions = [];
  try {
    await render();
    await act(async () => button("Toggle Task worktrees").click());
    expect(container.querySelector('[aria-label="Task worktrees"] [data-worktree="/trees/a"]')).not.toBeNull();
    expect(container.querySelector('[data-worktree-session="persisted-worker"]')).toBeNull();
    expect(container.querySelector('[data-worktree="/trees/a"] [role="status"]')?.getAttribute("aria-label"))
      .toBe("Native Core is working here; your changes may conflict");
    await act(async () => button("New session in Audit smoke test").click());
    expect(props.onNewSession).toHaveBeenCalledOnce();
    vi.mocked(props.onNewSession).mockClear();
    await act(async () => button("Open worktree Audit smoke test").click());
    expect(props.onSelectSession).toHaveBeenCalledExactlyOnceWith("persisted-worker", { project: "/repo", tree: expect.objectContaining({ path: "/trees/a" }) });
    expect(props.onSelectWorktree).not.toHaveBeenCalled();
    expect(props.onNewSession).not.toHaveBeenCalled();
  } finally { snapshot.mockRestore(); }
});

it("opens the latest dispatch and lists earlier workers alongside sessions marked as yours", async () => {
  const workspace = { projectCwd: "/repo", checkoutCwd: "/trees/a", kind: "worktree", branch: "feature-a" };
  const runs = [{ cwd: "/repo", projectManager: true, ownerMonoId: "manager", tasks: [{
    id: "audit", title: "Audit", sessionId: "latest-worker", harness: "pi", model: "", status: "running", workspace,
  }], dispatches: [
    { taskId: "audit", sessionId: "old-worker", workspace, startedAt: 10 },
    { taskId: "audit", sessionId: "latest-worker", workspace, startedAt: 30 },
    { taskId: "audit", sessionId: "middle-worker", workspace, startedAt: 20 },
  ] }] as OrchestrationRun[];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  props.renderManager = () => createElement("span", null, "Manager");
  props.history = [session("your-chat", "/trees/a")];
  props.openSessions = [];
  try {
    await render();
    await act(async () => button("Toggle Task worktrees").click());
    const row = container.querySelector('[data-worktree="/trees/a"]')!;
    expect([...row.querySelectorAll("[data-worktree-session]")].map(item => item.getAttribute("data-worktree-session"))).toEqual(["latest-worker", "middle-worker", "old-worker", "your-chat"]);
    expect(row.querySelector('[data-worktree-session="your-chat"]')?.textContent).toMatch(/yours/i);
    await act(async () => (row.querySelector('[data-worktree-session="latest-worker"] button') as HTMLButtonElement).click());
    expect(props.onSelectSession).toHaveBeenLastCalledWith("latest-worker", { project: "/repo", tree: expect.objectContaining({ path: "/trees/a" }) });
    await act(async () => (row.querySelector('[data-worktree-session="your-chat"] button') as HTMLButtonElement).click());
    expect(props.onSelectSession).toHaveBeenLastCalledWith("your-chat", { project: "/repo", tree: expect.objectContaining({ path: "/trees/a" }) });
    expect(props.onSelectWorktree).not.toHaveBeenCalled();
  } finally { snapshot.mockRestore(); }
});

it("keeps the primary checkout's identity and actions when a cancelled task has an earlier dispatch there", async () => {
  const workspace = { projectCwd: "/repo", checkoutCwd: "/trees/a", kind: "worktree", branch: "feature-a" };
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{
    cwd: "/repo", projectManager: true, tasks: [{
      id: "docs", title: "Document acceptance", sessionId: "worker", status: "cancelled", workspace,
    }], dispatches: [
      { taskId: "docs", sessionId: "earlier-worker", startedAt: 1, stage: "settled", workspace: { ...workspace, checkoutCwd: "/repo", kind: "main", branch: "main" } },
    ],
  }] as OrchestrationRun[]);
  props.renderManager = vi.fn(() => createElement("span", null, "Manager"));
  try {
    await render();
    expect(container.querySelector('[aria-label="Your worktrees"] [data-worktree="/repo"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Task worktrees"] [data-worktree="/repo"]')).toBeNull();
    expect(button("Open worktree main").textContent).toContain("primary");
    expect(button("Open worktree main").title).not.toContain("Cancelled");
    expect(props.renderManager).toHaveBeenLastCalledWith(true, expect.any(Function), 1);
    expect(button("Toggle Task worktrees").textContent).toContain("0 active");
    expect(button("Toggle Task worktrees").title).toBe("0 active · 1 finished");
    const expandedBefore = button("Open worktree main").getAttribute("aria-expanded");
    await act(async () => button("Open worktree main").click());
    expect(button("Open worktree main").getAttribute("aria-expanded")).not.toBe(expandedBefore);
    expect(props.onSelectWorktree).not.toHaveBeenCalled();
    expect(props.onSelectSession).not.toHaveBeenCalled();
    await act(async () => button("Actions for main").click());
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Review in Manager");
  } finally { snapshot.mockRestore(); }
});

it.each([undefined, "https://example.com/other-task", "https://example.com/owned-task"])(
  "scopes a cancelled task's PR icon and shortcut to its PR URL: %s", async (prUrl) => {
    const checkout = tree(`/task-pr/${prUrl?.split("/").at(-1) ?? "missing"}`, "docs");
    vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees: [checkout], defaultRoot: "/task-pr" }, refresh });
    const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{
      cwd: "/repo", projectManager: true, tasks: [{
        id: "docs", title: "Document acceptance", sessionId: "worker", status: "cancelled", prUrl,
        workspace: { checkoutCwd: checkout.path, branch: checkout.branch },
      }],
    }] as OrchestrationRun[]);
    const pr: GitPr = { number: 77, title: "Owned change", url: "https://example.com/owned-task", state: "open" };
    vi.mocked(gitPrStatus).mockImplementation(async cwd => cwd === checkout.path ? pr : null);
    props.renderManager = () => createElement("span", null, "Manager");
    try {
      await render();
      const icon = button("Open worktree Document acceptance").querySelector('[role="img"]')!;
      const matches = prUrl === pr.url;
      expect(icon.getAttribute("aria-label")).toBe(matches ? "1 open PR" : "No open PR");
      expect(container.querySelector('[aria-label="Open pull request for Document acceptance"]') !== null).toBe(matches);
      expect(button("Open worktree Document acceptance").title).toContain("Cancelled");
    } finally { snapshot.mockRestore(); }
  },
);

it.each([
  ["success", "MERGEABLE", "PR ready"],
  ["failure", "MERGEABLE", "checks failing"],
  ["success", "CONFLICTING", "merge conflicts"],
] as const)("deduplicates readiness while keeping forge problems visible: %s / %s", async (checksStatus, mergeable, label) => {
  const checkout = tree(`/task-readiness/${checksStatus}-${mergeable}`, "validate");
  vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees: [checkout], defaultRoot: "/task-readiness" }, refresh });
  const pr: GitPr = {
    number: 78, title: "Task change", url: "https://example.com/ready-task", state: "open",
    checksStatus, mergeable, mergeStateStatus: "CLEAN",
  };
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{
    cwd: "/repo", projectManager: true, tasks: [{
      id: "validate", title: "Validate the complete PR acceptance document", sessionId: "worker", status: "completed",
      accepted: true, lastDispatchId: "d", acceptedDispatchId: "d", prUrl: pr.url,
      workspace: { checkoutCwd: checkout.path, branch: checkout.branch },
    }],
  }] as OrchestrationRun[]);
  vi.mocked(gitPrList).mockImplementation(async cwd => cwd === checkout.path ? [
    { ...pr, number: 79, title: "Unrelated change", url: "https://example.com/unrelated" }, pr,
  ] : []);
  props.renderManager = () => createElement("span", null, "Manager");
  try {
    await render();
    const row = container.querySelector(`[data-worktree="${checkout.path}"]`)!;
    const icon = row.querySelector('[role="img"]')!;
    expect(icon.getAttribute("aria-label")).toBe(label);
    expect(icon.getAttribute("title")).not.toContain("Unrelated change");
    expect(icon.textContent).toBe(label === "PR ready" ? "" : label);
    expect(row.querySelector('[data-worktree-metadata]')?.textContent).toBe("PR ready");
    expect((row.querySelector('[aria-label^="Open pull request"]') as HTMLButtonElement).title).toContain(pr.url);
    expect(button("Open worktree Validate the complete PR acceptance document").querySelector('[class*="line-clamp-2"]')).not.toBeNull();
    expect(row.firstElementChild?.className).toContain("h-10");
  } finally { snapshot.mockRestore(); }
});

it.each([1, 2])("lists %i user sessions with a clickable teammate indicator and user-only progress", async (count) => {
  const runs = [{ cwd: "/repo", projectManager: true, ownerMonoId: "manager", tasks: [{
    id: "native", sessionId: "native-worker", title: "Review GPUI", harness: "pi", model: "", memberId: "native", memberName: "Native Core", memberMascot: "fox", status: "running", readOnly: true, workspacePolicy: "shared",
    workspace: { projectCwd: "/repo", checkoutCwd: "/trees/a", kind: "worktree", branch: "feature-a" },
  }] }] as OrchestrationRun[];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  props.renderManager = () => createElement("span", null, "Manager");
  props.history = [session("native-worker", "/trees/a"), ...Array.from({ length: count }, (_, index) => session(`your-${index}`, "/trees/a"))];
  props.openSessions = [];
  props.activeSessionId = "your-0";
  props.busySessionIds = new Set(["native-worker", "your-0"]);
  props.approvalSessionIds = new Set();
  try {
    await render();
    const row = container.querySelector('[aria-label="Your worktrees"] [data-worktree="/trees/a"]')!;
    expect(row).not.toBeNull();
    expect(row.querySelectorAll("[data-worktree-session]")).toHaveLength(count);
    expect(row.querySelector('[data-worktree-session="native-worker"]')).toBeNull();
    expect(row.querySelector('[data-worktree-session="your-0"] button')?.getAttribute("aria-current")).toBe("true");
    expect(row.className).not.toContain("bg-selection");
    expect(button("Open worktree feature-a").title).toContain("1 working");
    expect(button("Open worktree feature-a").title).not.toContain("2 working");
    expect(row.textContent).toContain("Native Core working here");
    expect(row.querySelector('[role="status"]')).toBeNull();
    const indicator = [...row.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.includes("Native Core working here"))!;
    expect(indicator).toBeDefined();
    await act(async () => indicator.click());
    expect(props.onSelectSession).toHaveBeenCalledExactlyOnceWith("native-worker", { project: "/repo", tree: expect.objectContaining({ path: "/trees/a" }) });
  } finally { snapshot.mockRestore(); }
});

it("counts teammates once per member and opens each member's session from its mascot", async () => {
  const workspace = { projectCwd: "/repo", checkoutCwd: "/trees/a", kind: "worktree", branch: "feature-a" };
  const tasks = [
    { id: "native-one", sessionId: "native-one", title: "Native first", harness: "pi", model: "", memberId: "native", memberName: "Native Core", status: "running", readOnly: true, workspacePolicy: "shared", workspace },
    { id: "native-two", sessionId: "native-two", title: "Native second", harness: "pi", model: "", memberId: "native", memberName: "Native Core", status: "running", readOnly: true, workspacePolicy: "shared", workspace },
    { id: "review", sessionId: "review-worker", title: "Review", harness: "pi", model: "", memberId: "review", memberName: "Reviewer", status: "running", readOnly: true, workspacePolicy: "shared", workspace },
  ];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{ cwd: "/repo", projectManager: true, ownerMonoId: "manager", tasks }] as OrchestrationRun[]);
  props.renderManager = () => createElement("span", null, "Manager");
  props.history = [];
  props.openSessions = [];
  try {
    await render();
    const indicator = container.querySelector('[data-worktree="/trees/a"] [data-worktree-team]')!;
    expect(indicator.textContent).toContain("2 teammates here");
    expect(indicator.querySelectorAll('[aria-label^="Open "]')).toHaveLength(2);
    await act(async () => button("Open Reviewer's session").click());
    expect(props.onSelectSession).toHaveBeenLastCalledWith("review-worker", { project: "/repo", tree: expect.objectContaining({ path: "/trees/a" }) });
    expect(container.querySelector('[data-worktree="/trees/a"] [data-worktree-session]')).toBeNull();
    expect(button("Open worktree feature-a").title).toContain("0 sessions");
  } finally { snapshot.mockRestore(); }
});

it("keeps a checkout with an unloaded teammate beyond paging and the active-only filter", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: Array.from({ length: 7 }, (_, index) => tree(`/trees/${index}`, `feature-${index}`)), defaultRoot: "/trees" }, refresh,
  });
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{ cwd: "/repo", projectManager: true, ownerMonoId: "manager", tasks: [{
    id: "native", sessionId: "native-worker", title: "Native", harness: "pi", model: "", memberId: "native", memberName: "Native Core", status: "running", readOnly: true, workspacePolicy: "shared",
    workspace: { projectCwd: "/repo", checkoutCwd: "/trees/6", kind: "worktree", branch: "feature-6" },
  }] }] as OrchestrationRun[]);
  props.renderManager = () => createElement("span", null, "Manager");
  props.history = [];
  props.openSessions = [];
  props.busySessionIds = new Set();
  props.approvalSessionIds = new Set();
  try {
    await render();
    expect(container.querySelectorAll("[data-worktree]")).toHaveLength(6);
    expect(container.querySelector('[data-worktree="/trees/6"] [data-worktree-team]')?.textContent).toContain("Native Core working here");
    await act(async () => {
      localStorage.setItem("monocode.activeWorktrees:/repo", "1");
      window.dispatchEvent(new Event("storage"));
    });
    expect(container.querySelectorAll("[data-worktree]")).toHaveLength(1);
    expect(container.querySelector('[data-worktree="/trees/6"] [data-worktree-team]')).not.toBeNull();
  } finally { snapshot.mockRestore(); }
});

it("keeps a read-only shared linked checkout in Your worktrees and its enforced fallback in Task worktrees", async () => {
  const tasks = [
    { id: "report", title: "Report", harness: "pi", model: "", sessionId: "report-worker", status: "running", readOnly: true, workspacePolicy: "shared", workspace: { kind: "worktree", checkoutCwd: "/trees/a", branch: "feature-a" } },
    { id: "fallback", title: "Fallback", harness: "pi", model: "", sessionId: "fallback-worker", status: "running", readOnly: true, readOnlyFallback: "Harness cannot enforce read-only", workspacePolicy: "isolated-child", workspace: { kind: "worktree", checkoutCwd: "/trees/b", branch: "feature-b" } },
  ];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{ leadId: "manager", cwd: "/repo", projectManager: true, tasks }] as unknown as OrchestrationRun[]);
  props.renderManager = () => createElement("span", null, "Manager");
  try {
    await render();
    const your = container.querySelector('[role="group"][aria-label="Your worktrees"]')!;
    const queue = container.querySelector('[role="group"][aria-label="Task worktrees"]')!;
    expect(your.querySelector('[data-worktree="/trees/a"]')).not.toBeNull();
    expect(queue.querySelector('[data-worktree="/trees/a"]')).toBeNull();
    expect(queue.querySelector('[data-worktree="/trees/b"]')).not.toBeNull();
    expect(button("Toggle Task worktrees").textContent).toContain("Task worktrees · 1");
  } finally { snapshot.mockRestore(); }
});

it("labels peer user worktrees, scopes the guide to collapsed task worktrees, and shows Finished outcomes", async () => {
  const worktrees = [
    tree("/repo", "main", true),
    ...["running", "ready", "blocked", "merged", "closed", "cancelled"].map((id) =>
      ({ ...tree(`/queue/${id}`, id), unpushed: id === "closed" ? 2 : 0, dirty: id === "closed" }),
    ),
  ];
  const tasks = worktrees.slice(1).map((tree) => ({
    id: tree.branch,
    title: tree.branch,
    sessionId: `s-${tree.branch}`,
    status:
      tree.branch === "cancelled" ? "cancelled" : tree.branch === "running"
        ? "running"
        : tree.branch === "blocked"
          ? "failed"
          : "completed",
    accepted: ["ready", "merged", "closed"].includes(tree.branch!),
    lastDispatchId: "d",
    acceptedDispatchId: "d",
    prUrl: `https://example.com/${tree.branch}`,
    workspace: { checkoutCwd: tree.path, branch: tree.branch },
  }));
  const runs = [
    { leadId: "manager", cwd: "/repo", projectManager: true, tasks },
  ] as OrchestrationRun[];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.mocked(useProjectDiffStats).mockReturnValue({ files: 1, additions: 21, deletions: 0, untracked: 1 });
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees, defaultRoot: "/queue" },
    refresh,
  });
  vi.mocked(gitPrStatus).mockImplementation(async (path) => ({
    number: 1,
    title: path,
    url: `https://example.com/${path.split("/").at(-1)}`,
    state: path.endsWith("merged") ? "merged" : path.endsWith("closed") ? "closed" : "open",
  }));
  props.renderManager = (expanded, toggle) =>
    createElement(
      "button",
      { onClick: toggle, "aria-expanded": expanded },
      "Manager",
    );
  const openManagerCard = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(
          OrchestrationActions.Provider,
          {
            value: {
              open: vi.fn(),
              update: vi.fn(),
              retry: vi.fn(),
              confirm: vi.fn(),
              openManagerCard,
            },
          },
          createElement(ProjectWorktrees, props),
        ),
      ),
    );
    const your = container.querySelector('[role="group"][aria-label="Your worktrees"]')!;
    const queue = container.querySelector('[role="group"][aria-label="Task worktrees"]')!;
    expect(your.querySelector('[data-worktree="/repo"]')).not.toBeNull();
    expect(your.querySelector('[class*="border-l"]')).toBeNull();
    expect(your.parentElement).toBe(queue.parentElement);
    expect(queue.querySelector('[class*="border-l"]')).toBeNull();
    expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("false");
    expect(button("Toggle Task worktrees").textContent).toContain("3 active");
    expect(button("Toggle Task worktrees").title).toBe("3 active · 3 finished");
    expect(queue.querySelector<HTMLDivElement>('[data-worktree-group-list]')?.hidden).toBe(true);
    await act(async () => button("Toggle Task worktrees").click());
    expect(
      [...queue.querySelectorAll("[data-worktree]")].filter(row => !row.closest('[aria-label="Finished"]')).map((row) =>
        row.getAttribute("data-worktree"),
      ),
    ).toEqual(["/queue/blocked", "/queue/ready", "/queue/running"]);
    await act(async () => button("Actions for ready").click());
    await act(async () => menuItem("Review in Manager").click());
    expect(openManagerCard).toHaveBeenCalledWith("manager", "ready");
    const done = queue.querySelector('[aria-label="Finished"]')!;
    const merged = done.querySelector('[data-worktree="/queue/merged"]')!;
    const closed = done.querySelector('[data-worktree="/queue/closed"]')!;
    expect(merged.className).toContain("opacity-60");
    expect(merged.textContent).not.toContain("+21");
    expect(merged.querySelector("[data-worktree-metadata]")?.textContent).toBe("Merged");
    expect(closed.querySelector("[data-worktree-metadata]")?.textContent).toContain("Closed");
    expect(closed.querySelector('[title="Closed (not merged)"]')).not.toBeNull();
    expect(button("Open worktree closed").title).toContain("Closed (not merged)");
    expect(done.querySelector('[data-worktree="/queue/cancelled"] [data-worktree-metadata]')?.textContent).toBe("Cancelled");
    const warning = closed.querySelector("[data-worktree-metadata] [role=img]")!;
    expect(warning.textContent).toBe("2");
    expect(warning.getAttribute("title")).toContain("2 unpushed commits");
    expect(warning.getAttribute("title")).toContain("1 changed file would be lost");
    expect(warning.getAttribute("title")).toContain("1 untracked file");
    expect(closed.querySelector('[aria-label="1 untracked file"]')).toBeNull();
    expect(warning.getAttribute("title")).toContain("before deleting it");
    expect(done.querySelector('[data-worktree="/queue/closed"]')).not.toBeNull();
    expect(
      done.querySelector('[data-worktree="/queue/merged"]')?.parentElement
        ?.hidden,
    ).toBe(true);
    await act(async () =>
      (done.querySelector("button") as HTMLButtonElement).click(),
    );
    expect(
      done.querySelector('[data-worktree="/queue/merged"]')?.parentElement
        ?.hidden,
    ).toBe(false);
    await act(async () => root.render(null));
    await render();
    expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("true");
    expect(button("Toggle Finished worktrees").getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      localStorage.setItem("monocode.activeWorktrees:/repo", "1");
      window.dispatchEvent(new Event("storage"));
    });
    expect(
      container.querySelector('[data-worktree="/queue/merged"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-worktree="/queue/running"]'),
    ).not.toBeNull();
    expect(localStorage.getItem("monocode.activeWorktrees:/repo")).toBe("1");
  } finally {
    snapshot.mockRestore();
    vi.mocked(useProjectDiffStats).mockReturnValue(null);
  }
});

it("remembers Task worktrees expansion per project across remounts, independently of the Manager team", async () => {
  props.renderManager = (expanded, toggle) => createElement("button", { onClick: toggle, "aria-label": "Toggle team", "aria-expanded": expanded }, "Manager");
  await render();
  expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("false");
  await act(async () => button("Toggle Task worktrees").click());
  expect(localStorage.getItem("monocode:task-worktrees-expanded:/repo")).toBe("1");
  await act(async () => button("Toggle team").click());
  expect(button("Toggle team").getAttribute("aria-expanded")).toBe("false");
  expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("true");
  await act(async () => root.render(null));
  await render();
  expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("true");
  expect(button("Toggle team").getAttribute("aria-expanded")).toBe("false");
  props.project = "/another";
  await render();
  expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("false");
  expect(button("Toggle team").getAttribute("aria-expanded")).toBe("true");
  props.project = "/repo";
  await render();
  expect(button("Toggle Task worktrees").getAttribute("aria-expanded")).toBe("true");
  expect(button("Toggle team").getAttribute("aria-expanded")).toBe("false");
});

it("names remaining pagination separately from the inactive filter, including dirty worktrees", async () => {
  const worktrees = Array.from({ length: 8 }, (_, i) => ({ ...tree(`/idle/${i}`, `idle-${i}`), dirty: i === 7 }));
  vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees, defaultRoot: "/idle" }, refresh });
  props.history = [];
  props.openSessions = [];
  await render();
  const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Show 3 more"))!;
  expect(more.textContent).toContain("3 remaining");
  expect(more.textContent).not.toContain("inactive");
  expect(more.title).toContain("shown five at a time");
  expect(more.title).toContain("focused checkout");
  expect(more.title).toContain("sessions needing attention");
  await act(async () => more.click());
  expect(container.querySelectorAll("[data-worktree]")).toHaveLength(8);
});

it("names detached worktrees from their latest titled session then commit subject, keeping the hash secondary", async () => {
  const worktrees = [
    { ...tree("/detached/session", ""), branch: null, headSubject: "Commit fallback" },
    { ...tree("/detached/commit", ""), branch: null, headSubject: "Fix worktree selection" },
    { ...tree("/detached/unknown", ""), branch: null },
  ];
  vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees, defaultRoot: "/detached" }, refresh });
  props.openSessions = [];
  props.history = [
    { ...session("older", "/detached/session"), title: "Old task", updatedAt: 1 },
    { ...session("latest", "/detached/session"), title: "Useful latest task", updatedAt: 2 },
  ];
  await render();
  const named = button("Open worktree Useful latest task");
  expect(named.title).toContain("Detached abc1234");
  expect(named.textContent).toContain("abc1234");
  expect(button("Open worktree Fix worktree selection").textContent).toContain("abc1234");
  expect(button("Open worktree Detached worktree").title).toContain("Detached abc1234");
});

it("explicitly adds a linked worktree as a separate project from its menu", async () => {
  props.onAddAsSeparateProject = vi.fn();
  await render();
  await act(async () => button("Actions for feature-a").click());
  await act(async () => menuItem("Add as separate project").click());
  expect(props.onAddAsSeparateProject).toHaveBeenCalledWith(expect.objectContaining({ path: "/trees/a" }));
  await act(async () => button("Actions for main").click());
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Add as separate project");
});

it("uses each checkout for line counts and guards primary removal", async () => {
  props.busySessionIds = new Set();
  props.approvalSessionIds = new Set();
  vi.mocked(useProjectDiffStats).mockImplementation((path) =>
    path === "/trees/a" ? { files: 1, additions: 12, deletions: 3 } : null,
  );
  props.onRemove = vi.fn(async () => {});
  try {
    await render();
    expect(
      container.querySelector('[data-worktree="/trees/a"]')?.textContent,
    ).toContain("+12−3");
    expect(
      container.querySelector('[data-worktree="/trees/b"]')?.textContent,
    ).not.toContain("+12");
    await act(async () => button("Actions for main").click());
    expect(menuItem("Remove worktree…").disabled).toBe(true);
    expect(menuItem("Give to Manager…").disabled).toBe(true);
    expect(props.onRemove).not.toHaveBeenCalled();
  } finally {
    vi.mocked(useProjectDiffStats).mockReturnValue(null);
  }
});

it("shows main and all worktrees with blank and live sessions even in an inactive project", async () => {
  await render();
  const a = container.querySelector('[data-worktree="/trees/a"]')!;
  const b = container.querySelector('[data-worktree="/trees/b"]')!;
  expect(a.textContent).toContain("1 working");
  expect(a.textContent).toContain("blank");
  expect(b.textContent).toContain("1 needs input");
  expect(
    container.querySelector('[data-worktree="/repo"]')?.textContent,
  ).toContain("main");
  expect(props.onLoadHistory).toHaveBeenCalledExactlyOnceWith("/repo");
  act(() => button("Collapse sessions in feature-a").click());
  expect(a.textContent).toContain("1 working");
  expect(a.textContent).not.toContain("a-chat");
  expect(b.textContent).toContain("feature-b");
  props = {
    ...props,
    busySessionIds: new Set(),
    unseenFinishedIds: new Set(["a-chat"]),
  };
  await render();
  expect(a.textContent).toContain("1 done");
  expect(props.onLoadHistory).toHaveBeenCalledTimes(1);
});

it("uses quiet single-line idle rows, with selection only on the active session", async () => {
  props = {
    ...props,
    currentProject: "/repo",
    activeSessionId: "main-chat",
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    unseenFinishedIds: new Set(),
  };
  await render();
  expect(container.textContent).not.toContain("Idle");
  expect(container.textContent).not.toContain("· root");
  expect(container.textContent).not.toContain("No sessions yet");
  expect(button("Open worktree main").getAttribute("aria-current")).toBe(
    null,
  );
  expect(button("Open worktree main").parentElement!.className).not.toContain(
    "bg-selection",
  );
  expect(
    container.querySelector('[data-worktree="/repo"]')?.className,
  ).not.toContain("bg-selection");
  expect(
    container.querySelector('[data-worktree-session="main-chat"] button')?.getAttribute("aria-current"),
  ).toBe("true");
  expect(container.querySelector('[data-worktree-session="main-chat"] button')?.className).toContain("bg-selection");
  expect(container.querySelectorAll('[class*="border-l"]')).toHaveLength(0);
  act(() => button("Collapse sessions in feature-a").click());
  expect(button("Open worktree feature-a").textContent).toContain("2");
  expect(button("Open worktree feature-a").title).toContain("2 sessions");
});

it("overlays worktree actions and only reserves title space when they are revealed", async () => {
  await render();
  const open = button("Open worktree feature-a");
  const row = open.parentElement!;
  expect(row.className).toContain("relative");
  expect(open.className).not.toContain("pr-14");
  // An in-flow spacer reserves the space so status icons shift left of the actions instead of under them.
  const spacer = row.querySelector("[data-worktree-actions-spacer]")!;
  expect(spacer.className.split(" ")).toContain("hidden");
  expect(spacer.className).toContain("group-hover/worktree:block");
  expect(spacer.className).toContain("group-focus-within/worktree:block");
  expect(spacer.className).toContain("[@media(hover:none)]:block");
  for (const label of ["New session in feature-a", "Actions for feature-a"]) {
    const action = button(label);
    expect(action.parentElement).toBe(row);
    expect(action.className.split(" ")).toContain("absolute");
    expect(action.className).toContain(
      "group-focus-within/worktree:opacity-100",
    );
    expect(action.tabIndex).toBe(0);
  }
  expect(row.hasAttribute("data-actions-open")).toBe(false);
  act(() => button("Actions for feature-a").click());
  expect(row.getAttribute("data-actions-open")).toBe("true");
  expect(spacer.className).toContain(
    "group-data-[actions-open=true]/worktree:block",
  );
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(row.hasAttribute("data-actions-open")).toBe(false);
  expect(document.activeElement).toBe(button("Actions for feature-a"));
});

it("switches and creates repeated sessions in the explicit checkout without mutating its bindings", async () => {
  await render();
  act(() => button("Open worktree feature-b").click());
  expect(button("Open worktree feature-b").getAttribute("aria-expanded")).toBe("false");
  expect(props.onSelectWorktree).not.toHaveBeenCalled();
  expect(props.onSelectSession).not.toHaveBeenCalled();
  expect(worktreeFocus("/repo")).toBeUndefined();
  act(() => button("Collapse sessions in feature-a").click());
  act(() => {
    button("New session in feature-a").click();
    button("New session in feature-a").click();
  });
  expect(props.onNewSession).toHaveBeenCalledTimes(2);
  expect(props.onNewSession).toHaveBeenLastCalledWith(
    "/repo",
    expect.objectContaining({ path: "/trees/a" }),
  );
  expect(button("a-chat, Working")).toBeDefined();
  act(() => button("a-chat, Working").click());
  expect(props.onSelectSession).toHaveBeenCalledWith("a-chat", {
    project: "/repo",
    tree: expect.objectContaining({ path: "/trees/a" }),
  });
  expect(props.history[1].worktreeCwd).toBe("/trees/a");
});

it("disables missing worktrees and keeps the last list visible when refreshing fails", async () => {
  const data = {
    worktrees: [{ ...tree("/trees/gone", "gone"), missing: true }],
    defaultRoot: "/trees",
  };
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data,
    error: "Git unavailable",
    refresh,
  });
  await render();
  expect(button("Open worktree gone").disabled).toBe(true);
  expect(button("New session in gone").disabled).toBe(true);
  expect(container.textContent).toContain("Missing folder");
  expect(container.textContent).toContain("Git unavailable");
});

it("does not render the removed Worktrees header or duplicate creation action", async () => {
  await render();
  expect(
    container.querySelector('[aria-label="New worktree in repo"]'),
  ).toBeNull();
  expect(
    [...container.querySelectorAll("span")].some(
      (item) => item.textContent === "Worktrees",
    ),
  ).toBe(false);
});

it("suspends history loading with a hidden rail and retries failed history without losing live sessions", async () => {
  props = { ...props, enabled: false, onLoadHistory: vi.fn(async () => false) };
  await render();
  expect(useProjectWorktrees).toHaveBeenLastCalledWith("/repo", false);
  expect(props.onLoadHistory).not.toHaveBeenCalled();
  props = { ...props, enabled: true };
  await render();
  expect(container.textContent).toContain("Could not load sessions");
  expect(button("a-chat, Working")).toBeDefined();
  expect(props.onLoadHistory).toHaveBeenCalledOnce();
});

it("renders collapsible worktrees under pinned, grouped, and ordinary projects without switching projects", async () => {
  savePinnedProjects(["/pinned"]);
  saveProjectGroups([{ id: "clients", name: "Clients", collapsed: false }]);
  saveProjectGroupAssignments({ [pathKey("/grouped")]: "clients" });
  const onSelectProject = vi.fn();
  const onNewWorktree = vi.fn();
  const renderProjectWorktrees = vi.fn((path: string) =>
    createElement(
      "div",
      { "data-project-trees": path },
      `Worktrees in ${path}`,
    ),
  );
  await act(async () =>
    root.render(
      createElement(ProjectRail, {
        cwd: "/ordinary",
        recents: ["/ordinary", "/grouped", "/pinned"].map((path) => ({
          path,
          openedAt: 1,
        })),
        onSelectProject,
        onNewWorktree,
        onOpenProject: vi.fn(),
        renderProjectWorktrees,
      }),
    ),
  );
  expect(
    container.querySelector('[data-project-trees="/ordinary"]'),
  ).not.toBeNull();
  const filters = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Show active only"]')];
  expect(filters).toHaveLength(3);
  await act(async () => filters[0].click());
  expect(filters[0].getAttribute("aria-pressed")).toBe("true");
  expect(filters[0].title).toContain("Filtered");
  expect(filters[1].getAttribute("aria-pressed")).toBe("false");
  expect(onSelectProject).not.toHaveBeenCalled();
  act(() => button("Expand worktrees in pinned").click());
  act(() => button("Expand worktrees in grouped").click());
  expect(
    container.querySelector('[data-project-trees="/pinned"]'),
  ).not.toBeNull();
  expect(
    container.querySelector(
      '[data-project-group="clients"] [data-project-trees="/grouped"]',
    ),
  ).not.toBeNull();
  act(() => button("Create new worktree in ordinary").click());
  expect(onNewWorktree).toHaveBeenCalledWith("/ordinary");
  expect(onSelectProject).not.toHaveBeenCalled();
  expect(
    container.querySelector(".project-reorder-item[data-selected]")?.className,
  ).not.toContain("bg-selection");
  act(() => button("Collapse worktrees in ordinary").click());
  expect(
    container.querySelector('[data-project-trees="/ordinary"]'),
  ).toBeNull();
  expect(
    container.querySelector('[data-project-trees="/grouped"]'),
  ).not.toBeNull();
});

it("keeps Manager team collapse separate from the task worktree count", async () => {
  const manager = { project: "/repo", onOpen: vi.fn(), onToggle: vi.fn(), expanded: false };
  await act(async () => root.render(createElement(ProjectManagerRow, manager)));
  expect(container.querySelector('[aria-label="Toggle Manager team"]')).toBeNull();
  await act(async () => root.render(createElement(ProjectManagerRow, { ...manager, ownedCount: 2 })));
  expect(container.textContent).toBe("Manager");
  expect(container.querySelector('[aria-label="Toggle Manager team"]')).toBeNull();
});

it("keeps metadata in the title row, prioritizes status, and omits zero counts", async () => {
  vi.mocked(useProjectDiffStats).mockReturnValue({ files: 1, additions: 12, deletions: 0 });
  try {
    await render();
    const row = () => container.querySelector('[data-worktree="/trees/a"] [data-worktree-metadata]')!;
    expect(row().textContent).toContain("working");
    expect(row().textContent).not.toContain("+12");
    props.busySessionIds = new Set();
    await render();
    expect(row().textContent).toBe("+12");
    expect(row().parentElement?.className).toContain("h-7");
    expect(row().className).toContain("group-focus-within/worktree:hidden");
    expect(row().className).toContain("[@media(hover:none)]:hidden");
  } finally { vi.mocked(useProjectDiffStats).mockReturnValue(null); }
});

it("folds older idle sessions behind show more but keeps active ones listed", async () => {
  props.history = Array.from({ length: 8 }, (_, index) =>
    session(`old-${index}`),
  );
  props.openSessions = [];
  props.busySessionIds = new Set(["old-7"]);
  props.approvalSessionIds = new Set();
  await render();
  const listed = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .map((item) => item.getAttribute("aria-label") ?? "")
      .filter((label) => label.startsWith("old-"));
  expect(listed()).toHaveLength(6);
  expect(listed()).toContain("old-7, Working");
  const more = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Show 2 more",
  );
  await act(async () => more!.click());
  expect(listed()).toHaveLength(8);
  expect(document.body.textContent).toContain("Show less");
});

it("pages worktrees five at a time and keeps busy ones listed", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [
        tree("/repo", "main", true),
        ...Array.from({ length: 12 }, (_, index) =>
          tree(`/trees/w${index}`, `w${index}`),
        ),
      ],
      defaultRoot: "/trees",
    },
    refresh,
  });
  props.history = [session("late", "/trees/w11")];
  props.openSessions = [];
  props.busySessionIds = new Set(["late"]);
  props.approvalSessionIds = new Set();
  await render();
  const listed = () => container.querySelectorAll("[data-worktree]").length;
  const more = () =>
    [...container.querySelectorAll("button")].find((item) =>
      /^Show \d more/.test(item.textContent ?? ""),
    );
  expect(listed()).toBe(6);
  expect(
    container.querySelector('[data-worktree="/trees/w11"]'),
  ).not.toBeNull();
  await act(async () => more()!.click());
  expect(listed()).toBe(11);
  expect(more()!.textContent).toContain("Show 2 more");
  await act(async () => more()!.click());
  expect(listed()).toBe(13);
  expect(more()).toBeUndefined();
});

it.each([
  ["open", false, "1 open PR", "text-emerald-400/90"],
  ["merged", false, "No open PR", "text-content/45"],
  ["closed", false, "No open PR", "text-content/45"],
  ["open", true, "1 open PR", "text-emerald-400/90"],
] as const)(
  "reflects %s PR status (draft: %s) for the worktree's own checkout",
  async (state, isDraft, label, color) => {
    vi.mocked(gitPrStatus).mockImplementation(async (cwd) =>
      cwd === "/trees/a"
        ? {
            number: 42,
            title: "Sidebar fix",
            url: "https://example.com/42",
            state,
            isDraft,
          }
        : null,
    );
    await render();
    const icon = button("Open worktree feature-a").querySelector(
      '[role="img"]',
    )!;
    expect(icon.getAttribute("aria-label")).toBe(
      label,
    );
    expect(icon.getAttribute("title")).toBe(state === "open" ? "Open PR #42: Sidebar fix" : "No open PR");
    expect(icon.querySelector("svg")!.getAttribute("class")).toContain(color);
    expect(
      button("Open worktree feature-b")
        .querySelector('[role="img"]')!
        .getAttribute("aria-label"),
    ).toBe("No open PR");
    expect(gitPrStatus).toHaveBeenCalledWith("/trees/a");
  },
);

it("refreshes PR status on focus and Git changes and retains known status on failure", async () => {
  const pr: GitPr = {
    number: 42,
    title: "Sidebar fix",
    url: "https://example.com/42",
    state: "open",
  };
  vi.mocked(gitPrStatus).mockResolvedValue(pr);
  await render();
  const label = () =>
    button("Open worktree feature-a")
      .querySelector('[role="img"]')!
      .getAttribute("aria-label");
  expect(label()).toBe("1 open PR");
  vi.mocked(gitPrStatus).mockResolvedValue({ ...pr, state: "merged" });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(label()).toBe("No open PR");
  vi.mocked(gitPrStatus).mockResolvedValue({ ...pr, state: "closed" });
  await act(async () => notifyGitChanged());
  expect(label()).toBe("No open PR");
  vi.mocked(gitPrStatus).mockRejectedValue(new Error("GitHub unavailable"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(label()).toBe("No open PR");
  vi.mocked(gitPrStatus).mockResolvedValue(null);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(label()).toBe("No open PR");
});

it.each(["merged", "closed"])(
  "stops force-listing an accepted manager worktree when its PR is %s",
  async (state) => {
    const worktrees = [
      tree("/repo", "main", true),
      ...Array.from({ length: 8 }, (_, i) =>
        tree(`/terminal-pr/${state}/${i}`, `branch-${i}`),
      ),
    ];
    vi.mocked(useProjectWorktrees).mockReturnValue({
      data: { worktrees, defaultRoot: "/terminal-pr" },
      refresh,
    });
    const last = worktrees.at(-1)!;
    const runs = [
      {
        leadId: "project-manager-test",
        cwd: "/repo",
        projectManager: true,
        tasks: [
          {
            id: "t",
            status: "completed",
            accepted: true,
            lastDispatchId: "d",
            acceptedDispatchId: "d",
            prUrl: "https://example.com/42",
            workspace: { checkoutCwd: last.path, branch: last.branch },
          },
        ],
      },
    ] as OrchestrationRun[];
    const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
    vi.mocked(gitPrStatus).mockResolvedValue({
      number: 42,
      title: "Docs",
      url: "https://example.com/42",
      state,
    });
    try {
      await render();
      expect(container.querySelectorAll("[data-worktree]")).toHaveLength(5);
      expect(
        container.querySelector(`[data-worktree="${last.path}"]`),
      ).toBeNull();
    } finally {
      snapshot.mockRestore();
    }
  },
);

it("does not query PRs for hidden, detached, or missing worktrees", async () => {
  props.enabled = false;
  await render();
  expect(gitPrStatus).not.toHaveBeenCalled();
  props.enabled = true;
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [
        { ...tree("/trees/missing", "gone"), missing: true },
        { ...tree("/trees/detached", ""), branch: null },
      ],
      defaultRoot: "/trees",
    },
    refresh,
  });
  await render();
  expect(gitPrStatus).not.toHaveBeenCalled();
});

it("retains a PR discovered on the worktree's previous branch", async () => {
  let resolveOld!: (pr: GitPr) => void;
  vi.mocked(gitPrStatus).mockImplementation((cwd) =>
    cwd === "/trees/a"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(null),
  );
  await render();
  const data = vi.mocked(useProjectWorktrees).mock.results.at(-1)!.value.data!;
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      ...data,
      worktrees: data.worktrees.map((item: Worktree) =>
        item.path === "/trees/a" ? { ...item, branch: "replacement" } : item,
      ),
    },
    refresh,
  });
  vi.mocked(gitPrStatus).mockResolvedValue(null);
  await render();
  await act(async () =>
    resolveOld({
      number: 99,
      title: "Old branch",
      url: "https://example.com/99",
      state: "open",
    }),
  );
  expect(
    button("Open worktree replacement")
      .querySelector('[role="img"]')!
      .getAttribute("title"),
  ).toContain("Open PR #99: Old branch");
});

it("shows only open PR state and keeps merged history in a collapsed menu", async () => {
  const checkout = tree("/trees/followup", "followup");
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: [checkout], defaultRoot: "/trees" }, refresh,
  });
  vi.mocked(gitPrList).mockResolvedValue([
    { number: 41, title: "Original change", url: "https://github.com/example/repo/pull/41", state: "merged" },
    { number: 42, title: "Follow-up fix", url: "https://github.com/example/repo/pull/42", state: "open" },
  ]);
  await render();
  const icon = button("Open worktree followup").querySelector('[role="img"]')!;
  expect(icon.getAttribute("aria-label")).toBe("1 open PR");
  expect(icon.textContent).toContain("1 open PR");
  expect(icon.textContent).not.toContain("2 PRs");
  expect(icon.getAttribute("title")).toContain("Open PR #42: Follow-up fix");
  expect(icon.getAttribute("title")).not.toContain("Merged PR #41: Original change");
  await act(async () => button("Actions for followup").click());
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Open PR #42: Follow-up fix");
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Merged PR #41: Original change");
  const settled = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes("Merged / closed PRs"))!;
  await act(async () => settled.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.body.textContent).toContain("Merged PR #41: Original change");
});

it("reflects a verified closed update without reloading the branch lookup", async () => {
  const checkout = tree("/trees/live-pr-refresh", "live-pr-refresh");
  const pr: GitPr = { number: 42, title: "Live status", url: "https://github.com/example/repo/pull/42", state: "open" };
  vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees: [checkout], defaultRoot: "/trees" }, refresh });
  vi.mocked(gitPrList).mockResolvedValue([pr]);
  await render();
  const label = () => button("Open worktree live-pr-refresh").querySelector('[role="img"]')?.getAttribute("aria-label");
  expect(label()).toBe("1 open PR");
  await act(async () => recordPullRequest(checkout.path, { ...pr, state: "closed" }));
  expect(label()).toBe("No open PR");
  expect(gitPrList).toHaveBeenCalledExactlyOnceWith(checkout.path, [checkout.branch]);
});

it("prioritizes failing checks over another ready open PR", async () => {
  const checkout = tree("/trees/mixed-checks", "mixed-checks");
  vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees: [checkout], defaultRoot: "/trees" }, refresh });
  vi.mocked(gitPrList).mockResolvedValue([
    { number: 51, title: "Ready", url: "https://github.com/example/repo/pull/51", state: "open", checksStatus: "success", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" },
    { number: 50, title: "Failing", url: "https://github.com/example/repo/pull/50", state: "open", checksStatus: "failure" },
  ]);
  await render();
  expect(button("Open worktree mixed-checks").querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("checks failing");
});

const menuItem = (label: string) => {
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.querySelector("span > span")?.textContent === label);
  expect(item, label).toBeDefined();
  return item!;
};

it("allows detached removal and explains unavailable branch actions", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: [{ ...tree("/trees/detached", ""), branch: null, headSubject: "Detached commit" }], defaultRoot: "/trees" },
    refresh,
  });
  props.onRemove = vi.fn(async () => {});
  await render();
  await act(async () => button("Actions for Detached commit").click());
  expect(menuItem("Remove worktree…").disabled).toBe(false);
  for (const label of ["Create PR", "Copy branch"]) {
    expect(menuItem(label).disabled).toBe(true);
    expect(menuItem(label).textContent).toContain("No branch: this worktree is on a detached commit");
  }
  await act(async () => menuItem("Remove worktree…").click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(props.onRemove).not.toHaveBeenCalled();
});

it.each([
  [{ isMain: true }, "Primary checkout can't be removed"],
  [{ locked: true }, "Worktree is locked"],
] as const)("keeps protected worktrees disabled with a reason: %s", async (protection, reason) => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: [{ ...tree("/trees/protected", "protected"), ...protection }], defaultRoot: "/trees" }, refresh,
  });
  props.onRemove = vi.fn(async () => {});
  await render();
  await act(async () => button("Actions for protected").click());
  expect(menuItem("Remove worktree…").disabled).toBe(true);
  expect(menuItem("Remove worktree…").textContent).toContain(reason);
});

it("gives every disabled worktree menu item a reason, including Terminal", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: [{ ...tree("/gone", "gone"), missing: true }], defaultRoot: "/trees" }, refresh,
  });
  await render();
  await act(async () => button("Actions for gone").click());
  for (const item of document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:disabled')) {
    expect(item.querySelectorAll("span > span").length).toBe(2);
  }
  expect(menuItem("Open worktree").textContent).toContain("Worktree folder is missing");
  expect(menuItem("Remove worktree…").textContent).toContain("Worktree removal is unavailable");
  await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  vi.mocked(useProjectWorktrees).mockReturnValue({ data: { worktrees: [tree("/trees/a", "feature-a")], defaultRoot: "/trees" }, refresh });
  await render();
  await act(async () => button("Actions for feature-a").click());
  await act(async () => menuItem("Open in").click());
  expect(menuItem("Terminal").disabled).toBe(true);
  expect(menuItem("Terminal").textContent).toContain("Terminal is unavailable");
});

it("marks untracked-only changes even while sessions are busy, without mislabelling zero-line tracked files", async () => {
  vi.mocked(useProjectDiffStats).mockImplementation((path) => path === "/trees/a"
    ? { files: 2, additions: 0, deletions: 0, untracked: 2 }
    : { files: 1, additions: 0, deletions: 0, untracked: 0 });
  try {
    await render();
    expect(container.querySelector('[data-worktree="/trees/a"] [aria-label="2 untracked files"]')?.textContent).toBe("untracked");
    expect(container.querySelector('[data-worktree="/trees/a"] [aria-label="2 untracked files"]')?.getAttribute("title")).toBe("2 untracked files");
    expect(container.querySelector('[data-worktree="/trees/b"]')?.textContent).not.toContain("untracked");
    props.busySessionIds = new Set();
    vi.mocked(useProjectDiffStats).mockReturnValue({ files: 2, additions: 12, deletions: 0, untracked: 2 });
    await render();
    expect(container.querySelector('[data-worktree="/trees/a"] [aria-label="2 untracked files"]')).not.toBeNull();
    expect(container.querySelector('[data-worktree="/trees/a"] [aria-label="12 additions, 0 deletions"]')).not.toBeNull();
  } finally { vi.mocked(useProjectDiffStats).mockReturnValue(null); }
});

it("keeps a live subagent's worktree and lead visible beyond both paging limits", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: Array.from({ length: 7 }, (_, i) =>
        tree(`/trees/${i}`, `tree-${i}`),
      ),
      defaultRoot: "/trees",
    },
    refresh,
  });
  props.history = Array.from({ length: 7 }, (_, i) => ({
    ...session(`lead-${i}`, "/trees/6"),
    updatedAt: 10 - i,
  }));
  props.history[6].orchestration = {
    status: "running",
    live: true,
    tasks: [
      {
        sessionId: "worker",
        title: "Worker beyond page",
        harness: "pi",
        model: "",
        status: "running",
      },
    ],
  };
  props.openSessions = [];
  await render();
  expect(
    container.querySelector(
      '[data-worktree="/trees/6"] [data-worktree-session="lead-6"] [data-orchestration-agent="worker"]',
    ),
  ).not.toBeNull();
});

it("opens the clicked worktree's menu without switching, copies its path, and restores keyboard focus", async () => {
  await render();
  act(() =>
    button("Open worktree feature-b").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 100,
      }),
    ),
  );
  expect(
    document.querySelector('[role="menu"]')?.getAttribute("aria-label"),
  ).toBe("Worktree actions");
  expect(props.onSelectWorktree).not.toHaveBeenCalled();
  await act(async () => menuItem("Copy path").click());
  expect(copyText).toHaveBeenLastCalledWith("/trees/b");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button("Actions for feature-b"));
  act(() =>
    button("Open worktree feature-a").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await act(async () => menuItem("New session").click());
  await act(async () => menuItem("Codex").click());
  expect(props.onNewSession).toHaveBeenLastCalledWith(
    "/repo",
    expect.objectContaining({ path: "/trees/a" }),
    { harness: "codex" },
  );
  expect(document.activeElement).toBe(button("Open worktree feature-a"));
});

it("supports menu actions and exposes failures without navigating to a different checkout", async () => {
  await render();
  act(() => button("Actions for feature-a").click());
  await act(async () => menuItem("Copy branch").click());
  expect(copyText).toHaveBeenLastCalledWith("feature-a");
  act(() => button("Actions for feature-a").click());
  await act(async () => menuItem("Open worktree").click());
  expect(props.onSelectWorktree).toHaveBeenLastCalledWith(
    "/repo",
    expect.objectContaining({ path: "/trees/a" }),
  );
  act(() => button("Actions for feature-a").click());
  await act(async () => menuItem("Collapse sessions").click());
  expect(
    container.querySelector('[data-worktree-session="a-chat"]'),
  ).toBeNull();
  act(() => button("Actions for feature-a").click());
  await act(async () => menuItem("Refresh worktrees").click());
  expect(refresh).toHaveBeenCalledOnce();
  vi.mocked(revealPath).mockRejectedValueOnce(new Error("Folder unavailable"));
  act(() => button("Actions for feature-b").click());
  await act(async () => menuItem("Open in").click());
  await act(async () => menuItem("Explorer").click());
  expect(revealPath).toHaveBeenLastCalledWith("/trees/b");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Folder unavailable",
  );
});

it("keeps missing worktree copy actions available but disables checkout actions", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [{ ...tree("/gone", "gone"), missing: true }],
      defaultRoot: "/trees",
    },
    refresh,
  });
  await render();
  act(() => button("Actions for gone").click());
  for (const label of ["Open worktree", "New session", "Open in"])
    expect(menuItem(label).disabled).toBe(true);
  expect(menuItem("Copy path").disabled).toBe(false);
  act(() =>
    document
      .querySelector('[role="menu"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("shows saved and live subagents under their lead inside the hover/focus worktree card", async () => {
  const saved = {
    status: "completed" as const,
    tasks: [
      {
        sessionId: "worker",
        title: "Review sidebar",
        harness: "pi" as const,
        model: "test-model",
        status: "completed" as const,
      },
    ],
  };
  props.history = [{ ...session("lead", "/trees/a"), orchestration: saved }];
  props.openSessions = [session("lead", "/trees/a")];
  const openDetails = vi.fn();
  const renderWorkers = async () =>
    act(async () =>
      root.render(
        createElement(
          OrchestrationWorkers.Provider,
          { value: { selectedId: null, inspect: vi.fn(), openDetails } },
          createElement(ProjectWorktrees, props),
        ),
      ),
    );
  await renderWorkers();
  const card = container.querySelector('[data-worktree="/trees/a"]')!;
  expect(card.className).toContain("hover:bg-content/5");
  expect(card.className).toContain("focus-within:bg-content/5");
  expect(
    card.querySelector(
      '[data-worktree-session="lead"] [data-orchestration-agent="worker"]',
    )?.textContent,
  ).toContain("Done");
  expect(
    container.querySelector(
      '[data-worktree="/trees/b"] [data-orchestration-agent]',
    ),
  ).toBeNull();
  props.openSessions = [
    {
      ...session("lead", "/trees/a"),
      orchestration: {
        ...saved,
        live: true,
        status: "running",
        tasks: [{ ...saved.tasks[0], status: "running", needsInput: true }],
      },
    },
  ];
  await renderWorkers();
  expect(card.textContent).toContain("Needs input");
  const details = [...card.querySelectorAll("button")].find(
    (item) => item.textContent === "See details",
  )!;
  act(() => details.click());
  expect(openDetails).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "worker", leadId: "lead" }),
  );
  expect(props.onSelectSession).not.toHaveBeenCalled();
  expect(
    container.querySelector('[aria-label="Collapse sessions in feature-a"]'),
  ).not.toBeNull();
  expect(card.querySelector("[data-orchestration-agent]")).not.toBeNull();
});

it("shows or hides a worktree's sessions when its row is clicked", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: [tree("/repo", "main", true)], defaultRoot: "/trees" },
    refresh,
  });
  props.history = [session("chat", "/repo")];
  props.openSessions = [];
  props.busySessionIds = new Set();
  props.approvalSessionIds = new Set();
  await render();
  const row = button("Open worktree main");
  const listed = () => container.querySelector('[data-worktree-session="chat"]');
  expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(listed()).not.toBeNull();
  await act(async () => row.click());
  expect(row.getAttribute("aria-expanded")).toBe("false");
  expect(listed()).toBeNull();
  await act(async () => row.click());
  expect(listed()).not.toBeNull();
  expect(props.onSelectWorktree).not.toHaveBeenCalled();
  expect(props.onSelectSession).not.toHaveBeenCalled();
});
