// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { WorktreePr } from "../model/pullRequests";
import type { GitPr } from "../../../platform/tauri/fs";

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  status: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitPrActionByUrl: mocks.action,
  gitPrStatusByUrl: mocks.status,
  notifyGitChanged: mocks.notify,
}));
vi.mock("../../inbox/model/githubTasks", () => ({ githubPrAction: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  mocks.action.mockReset();
  mocks.status.mockReset();
  mocks.notify.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function entry(fields: Partial<GitPr> = {}, team = false): WorktreePr {
  return {
    cwd: "/repo-worktrees/fix",
    verifiedAt: 1000,
    pr: {
      number: 24,
      title: "Ready fix",
      url: "https://github.com/example/repo/pull/24",
      state: "open",
      headOid: "confirmed-head",
      baseRefName: "main",
      headRefName: "fix",
      checksStatus: "success",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      ...fields,
    },
    links: [
      {
        sessionId: "chat",
        sessionTitle: "Session",
        turnId: "first",
        blockId: "pr",
        at: 1000,
        ...(team ? { taskId: "task", acceptedHead: "confirmed-head" } : {}),
      },
    ],
  };
}
async function mount(initial = entry(), taskId?: string) {
  const React = await import("react"),
    { createRoot } = await import("react-dom/client");
  const model = await import("../model/pullRequests");
  const { WorktreePrActions } = await import("./WorktreePrActions");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  model.recordPullRequest(initial.cwd, initial.pr, initial.links[0]);
  function Probe() {
    const current = model.usePullRequests()[0];
    return React.createElement(
      "div",
      null,
      React.createElement("output", null, current.pr.state),
      React.createElement(WorktreePrActions, {
        entry: current,
        sessionId: "chat",
        taskId,
      }),
    );
  }
  await React.act(async () => root.render(React.createElement(Probe)));
  const click = async (label: string, scope: ParentNode = host) => {
    const button = Array.from(
      scope.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === label);
    expect(button, `Missing button ${label}`).toBeTruthy();
    await React.act(async () => button!.click());
  };
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  return {
    host,
    model,
    act: React.act,
    click,
    dialog,
    unmount: async () => {
      await React.act(async () => root.unmount());
      host.remove();
      document
        .querySelectorAll("[data-popover-side]")
        .forEach((element) => element.remove());
    },
  };
}

it.each(["Close pull request", "Merge pull request"])(
  "cancels %s with no native action or state effects",
  async (label) => {
    const view = await mount();
    try {
      const before = view.model.pullRequests()[0];
      await view.click(label);
      expect(view.dialog()).not.toBeNull();
      expect(mocks.action).not.toHaveBeenCalled();
      await view.click("Cancel", view.dialog());
      expect(view.dialog()).toBeNull();
      expect(mocks.action).not.toHaveBeenCalled();
      expect(mocks.notify).not.toHaveBeenCalled();
      expect(view.model.pullRequests()[0]).toBe(before);
    } finally {
      await view.unmount();
    }
  },
);

it.each([
  { label: "Merge pull request", strategy: "merge", option: undefined },
  { label: "Squash and merge", strategy: "squash", option: "Squash and merge" },
  { label: "Rebase and merge", strategy: "rebase", option: "Rebase and merge" },
])(
  "confirms $strategy and immediately publishes returned merged state",
  async ({ label, strategy, option }) => {
    const initial = entry();
    mocks.action.mockResolvedValue({ ...initial.pr, state: "merged" });
    const view = await mount(initial);
    try {
      if (option) {
        await view.act(async () =>
          view.host
            .querySelector<HTMLButtonElement>('[aria-label="Merge options"]')!
            .click(),
        );
        const choice = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ),
        ).find((button) => button.textContent?.includes(option))!;
        await view.act(async () => choice.click());
      }
      await view.click(label);
      expect(view.dialog().textContent).toContain("main");
      expect(mocks.action).not.toHaveBeenCalled();
      await view.click(label, view.dialog());
      expect(mocks.action).toHaveBeenCalledWith(
        initial.cwd,
        initial.pr.url,
        strategy,
        "confirmed-head",
        "main",
      );
      expect(view.model.pullRequests()[0].pr.state).toBe("merged");
      expect(view.host.querySelector("output")?.textContent).toBe("merged");
      expect(
        view.host.querySelector('[aria-label="Merge options"]'),
      ).toBeNull();
      expect(mocks.notify).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  },
);

it("publishes a fresh close and confirms Reopen against the same PR identity", async () => {
  const initial = entry();
  mocks.action
    .mockResolvedValueOnce({ ...initial.pr, state: "closed" })
    .mockResolvedValueOnce(initial.pr);
  const view = await mount(initial);
  try {
    await view.click("Close pull request");
    await view.click("Close pull request", view.dialog());
    expect(view.host.querySelector("output")?.textContent).toBe("closed");
    expect(view.model.pullRequests()[0].links).toEqual(initial.links);
    await view.click("Reopen pull request");
    expect(mocks.action).toHaveBeenCalledTimes(1);
    await view.click("Reopen pull request", view.dialog());
    expect(mocks.action).toHaveBeenLastCalledWith(
      initial.cwd,
      initial.pr.url,
      "reopen",
      "confirmed-head",
      "main",
    );
    expect(view.host.querySelector("output")?.textContent).toBe("open");
  } finally {
    await view.unmount();
  }
});

it("reports merge queued when the returned forge state stays open", async () => {
  const initial = entry();
  mocks.action.mockResolvedValue({
    ...initial.pr,
    mergeStateStatus: "BLOCKED",
  });
  const view = await mount(initial);
  try {
    await view.click("Merge pull request");
    await view.click("Merge pull request", view.dialog());
    expect(view.host.textContent).toContain(
      "Merge queued or auto-merge enabled",
    );
    expect(view.model.pullRequests()[0].pr.state).toBe("open");
    expect(view.model.pullRequestReady(view.model.pullRequests()[0])).toBe(
      false,
    );
  } finally {
    await view.unmount();
  }
});

it("refuses a merge when another linked task loses its review during confirmation", async () => {
  const initial = entry({}, true);
  const view = await mount(initial);
  try {
    await view.click("Merge pull request");
    await view.act(async () => view.model.recordPullRequest("/other-worktree", initial.pr, {
      ...initial.links[0], sessionId: "other-worker", taskId: "other-task", acceptedHead: null,
    }));
    await view.click("Merge pull request", view.dialog());
    expect(mocks.action).not.toHaveBeenCalled();
    expect(view.dialog().textContent).toContain("Checks or review changed");
  } finally {
    await view.unmount();
  }
});

it.each(["checks", "team"])(
  "refuses a merge after %s changes during confirmation",
  async (change) => {
    const initial = entry({}, change === "team"),
      view = await mount(initial);
    try {
      await view.click("Merge pull request");
      await view.act(async () => {
        if (change === "team")
          view.model.setTaskPrAcceptance("task", initial.pr.url, null);
        else
          view.model.recordPullRequest(initial.cwd, {
            ...initial.pr,
            checksStatus: "pending",
          });
      });
      await view.click("Merge pull request", view.dialog());
      expect(mocks.action).not.toHaveBeenCalled();
      const confirm = Array.from(
        view.dialog().querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Merge pull request")!;
      expect(confirm.disabled).toBe(true);
      const cancel = Array.from(
        view.dialog().querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Cancel")!;
      expect(cancel.disabled).toBe(false);
      await view.click("Cancel", view.dialog());
      expect(view.dialog()).toBeNull();
    } finally {
      await view.unmount();
    }
  },
);

it.each([
  { checksStatus: "pending" },
  { checksStatus: "unknown" },
  { mergeable: "CONFLICTING" },
  { headOid: undefined },
  { baseRefName: undefined },
] as Partial<GitPr>[])(
  "disables merge when trustworthy readiness evidence is missing %j",
  async (fields) => {
    const view = await mount(entry(fields));
    try {
      const merge = Array.from(
        view.host.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Merge pull request")!;
      expect(merge.disabled).toBe(true);
      expect(view.host.textContent).not.toContain("Convert to draft");
      expect(view.host.textContent).not.toContain("Ready for review");
      await view.click("Close pull request");
      await view.click("Cancel", view.dialog());
      expect(mocks.action).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  },
);

it("does not treat a known team PR as regular while its owner association is missing", async () => {
  const initial = entry({}, true);
  initial.links = initial.links.map((link) => ({
    ...link,
    sessionId: "worker",
  }));
  const view = await mount(initial, "task");
  try {
    const merge = Array.from(
      view.host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Merge pull request")!;
    expect(merge.disabled).toBe(true);
    await view.click("Close pull request");
    await view.click("Cancel", view.dialog());
    expect(mocks.action).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it.each(["head", "base"])(
  "keeps the confirmed %s snapshot and surfaces native stale-target refusal",
  async (change) => {
    const initial = entry(),
      fresh = {
        ...initial.pr,
        ...(change === "head"
          ? { headOid: "new-head" }
          : { baseRefName: "staging" }),
      };
    mocks.action.mockRejectedValue(
      new Error("Pull request changed since confirmation"),
    );
    mocks.status.mockResolvedValue(fresh);
    const view = await mount(initial);
    try {
      await view.click("Merge pull request");
      await view.act(async () =>
        view.model.recordPullRequest(initial.cwd, fresh),
      );
      await view.click("Merge pull request", view.dialog());
      expect(mocks.action).toHaveBeenCalledWith(
        initial.cwd,
        initial.pr.url,
        "merge",
        "confirmed-head",
        "main",
      );
      expect(
        view.dialog().querySelector('[role="alert"]')?.textContent,
      ).toContain("changed since confirmation");
      expect(view.model.pullRequests()[0].pr).toEqual(fresh);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  },
);

it("keeps a failed Close confirmation open, refreshes status, and allows retry", async () => {
  const initial = entry();
  mocks.action
    .mockRejectedValueOnce(new Error("Permission denied"))
    .mockResolvedValueOnce({ ...initial.pr, state: "closed" });
  mocks.status.mockResolvedValue(initial.pr);
  const view = await mount(initial);
  try {
    await view.click("Close pull request");
    await view.click("Close pull request", view.dialog());
    expect(
      view.dialog().querySelector('[role="alert"]')?.textContent,
    ).toContain("Permission denied");
    expect(mocks.status).toHaveBeenCalledWith(initial.cwd, initial.pr.url);
    await view.click("Close pull request", view.dialog());
    expect(mocks.action).toHaveBeenCalledTimes(2);
    expect(view.host.querySelector("output")?.textContent).toBe("closed");
  } finally {
    await view.unmount();
  }
});
