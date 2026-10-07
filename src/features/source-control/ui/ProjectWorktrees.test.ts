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
import { OrchestrationWorkers } from "../../orchestration/ui/OrchestrationActions";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import {
  orchestrator,
  type OrchestrationRun,
} from "../../orchestration/model/orchestration";
import {
  gitPrStatus,
  revealPath,
  notifyGitChanged,
  type GitPr,
} from "../../../platform/tauri/fs";

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitPrStatus: vi.fn(async () => null),
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

it("groups Manager worktrees by attention, folds merged work, and links PR status back to its card", async () => {
  const worktrees = [
    tree("/repo", "main", true),
    ...["running", "ready", "blocked", "merged", "closed"].map((id) =>
      ({ ...tree(`/queue/${id}`, id), unpushed: id === "closed" ? 2 : 0, dirty: id === "closed" }),
    ),
  ];
  const tasks = worktrees.slice(1).map((tree) => ({
    id: tree.branch,
    title: tree.branch,
    sessionId: `s-${tree.branch}`,
    status:
      tree.branch === "running"
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
  vi.mocked(useProjectDiffStats).mockReturnValue({ files: 1, additions: 21, deletions: 0 });
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
    const queue = container.querySelector('[aria-label="Manager queue"]')!;
    expect(
      [...queue.querySelectorAll("[data-worktree]")].map((row) =>
        row.getAttribute("data-worktree"),
      ),
    ).toEqual(["/queue/blocked", "/queue/ready", "/queue/running"]);
    await act(async () => button("Actions for ready").click());
    await act(async () => menuItem("Review in Manager").click());
    expect(openManagerCard).toHaveBeenCalledWith("manager", "ready");
    const done = container.querySelector('[aria-label="Done"]')!;
    const merged = done.querySelector('[data-worktree="/queue/merged"]')!;
    const closed = done.querySelector('[data-worktree="/queue/closed"]')!;
    expect(merged.className).toContain("opacity-60");
    expect(merged.textContent).not.toContain("+21");
    expect(merged.querySelector("[data-worktree-metadata]")?.textContent).toBe("");
    const warning = closed.querySelector("[data-worktree-metadata] [role=img]")!;
    expect(warning.textContent).toBe("2");
    expect(warning.getAttribute("title")).toContain("2 unpushed commits");
    expect(warning.getAttribute("title")).toContain("1 changed file would be lost");
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
    "true",
  );
  expect(button("Open worktree main").parentElement!.className).not.toContain(
    "bg-selection",
  );
  expect(
    container.querySelector('[data-worktree="/repo"]')?.className,
  ).toContain("bg-selection");
  expect(
    container.querySelector('[data-worktree-session="main-chat"]'),
  ).toBeNull();
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
  expect(open.className.split(" ")).not.toContain("pr-14");
  expect(open.className).toContain("transition-[padding]");
  expect(open.className).toContain("group-hover/worktree:pr-14");
  expect(open.className).toContain("group-focus-within/worktree:pr-14");
  expect(open.className).toContain("[@media(hover:none)]:pr-14");
  expect(open.className).toContain("motion-reduce:transition-none");
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
  expect(open.className).toContain(
    "group-data-[actions-open=true]/worktree:pr-14",
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
  expect(props.onSelectSession).toHaveBeenCalledWith("b-chat", {
    project: "/repo",
    tree: expect.objectContaining({ path: "/trees/b" }),
  });
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

it("only offers Manager collapse when it owns worktrees and counts collapsed items", async () => {
  const manager = { project: "/repo", onOpen: vi.fn(), onToggle: vi.fn(), expanded: false };
  await act(async () => root.render(createElement(ProjectManagerRow, manager)));
  expect(container.querySelector('[aria-label="Toggle Manager queue"]')).toBeNull();
  await act(async () => root.render(createElement(ProjectManagerRow, { ...manager, ownedCount: 2 })));
  expect(container.textContent).toContain("Manager · 2");
  await act(async () => button("Toggle Manager queue").click());
  expect(manager.onToggle).toHaveBeenCalledOnce();
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
  ["open", false, "Open", "text-emerald-400/90"],
  ["merged", false, "Merged", "text-violet-400/90"],
  ["closed", false, "Closed", "text-rose-400/90"],
  ["open", true, "Draft", "text-content/50"],
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
      `${label} PR #42: Sidebar fix`,
    );
    expect(icon.getAttribute("title")).toBe(`${label} PR #42: Sidebar fix`);
    expect(icon.querySelector("svg")!.getAttribute("class")).toContain(color);
    expect(
      button("Open worktree feature-b")
        .querySelector('[role="img"]')!
        .getAttribute("aria-label"),
    ).toBe("No PR status available");
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
  expect(label()).toContain("Open PR #42");
  vi.mocked(gitPrStatus).mockResolvedValue({ ...pr, state: "merged" });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(label()).toContain("Merged PR #42");
  vi.mocked(gitPrStatus).mockResolvedValue({ ...pr, state: "closed" });
  await act(async () => notifyGitChanged());
  expect(label()).toContain("Closed PR #42");
  vi.mocked(gitPrStatus).mockRejectedValue(new Error("GitHub unavailable"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(label()).toBe("Closed PR #42: Sidebar fix");
  vi.mocked(gitPrStatus).mockResolvedValue(null);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(label()).toBe("Closed PR #42: Sidebar fix");
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

it("ignores late PR responses from a previous branch", async () => {
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
      .getAttribute("aria-label"),
  ).toBe("No PR status available");
});

const menuItem = (label: string) => {
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === label);
  expect(item, label).toBeDefined();
  return item!;
};

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
  ).toBeNull();
  expect(card.querySelector("[data-orchestration-agent]")).not.toBeNull();
});
