// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { GitPr } from "../../../platform/tauri/fs";

const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  changed: undefined as (() => void) | undefined,
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitPrStatusByUrl: mocks.view,
  subscribeGitChanged: (callback: () => void) => {
    mocks.changed = callback;
    return () => {
      mocks.changed = undefined;
    };
  },
}));
const url = "https://github.com/example/repo/pull/23";
const forge: GitPr = {
  number: 23,
  title: "Follow-up fix",
  url,
  state: "open",
  checksStatus: "success",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
};
const session = (fields: Partial<Session> = {}): Session =>
  ({
    id: "chat",
    title: "Regular session",
    cwd: "/repo",
    worktreeCwd: "/repo-worktrees/fix",
    blocks: [
      { id: "turn", role: "user", text: "PR and make ready", startedAt: 1000 },
      {
        id: "first-pr",
        role: "tool",
        text: "",
        sentAt: 2000,
        tool: {
          title: "gh pr create",
          preview: { kind: "shell", output: url },
        },
      },
    ],
    ...fields,
  }) as Session;

beforeEach(() => {
  vi.resetModules();
  mocks.view.mockReset();
  mocks.changed = undefined;
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => vi.useRealTimers());

async function mount(
  sessions: readonly Session[],
  runs: readonly OrchestrationRun[] = [],
) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useSessionPullRequests } = await import("./useSessionPullRequests");
  const model = await import("../model/pullRequests");
  const host = document.createElement("div"),
    root = createRoot(host);
  function Probe(props: {
    sessions: readonly Session[];
    runs: readonly OrchestrationRun[];
  }) {
    const entries = useSessionPullRequests(props.sessions, props.runs);
    return React.createElement("span", null, `${entries.length} PRs`);
  }
  const render = async (nextSessions = sessions, nextRuns = runs) => {
    await React.act(async () =>
      root.render(
        React.createElement(Probe, { sessions: nextSessions, runs: nextRuns }),
      ),
    );
  };
  await render();
  return {
    model,
    host,
    render,
    act: React.act,
    unmount: async () => {
      await React.act(async () => root.unmount());
    },
  };
}

it("records only forge-verified output, using the session worktree and historical anchor", async () => {
  let resolve!: (value: GitPr | null) => void;
  mocks.view.mockReturnValue(
    new Promise<GitPr | null>((done) => {
      resolve = done;
    }),
  );
  const view = await mount([session()]);
  try {
    expect(mocks.view).toHaveBeenCalledWith("/repo-worktrees/fix", url);
    expect(view.model.pullRequests()).toHaveLength(0);
    await view.act(async () => resolve(forge));
    expect(view.model.pullRequests()).toEqual([
      expect.objectContaining({
        cwd: "/repo-worktrees/fix",
        pr: forge,
        links: [
          expect.objectContaining({
            sessionId: "chat",
            turnId: "turn",
            blockId: "first-pr",
            at: 2000,
          }),
        ],
      }),
    ]);
    expect(view.host.textContent).toBe("1 PRs");
  } finally {
    await view.unmount();
  }
});

it("rejects unmatched verification, then retries after forge failure without creating a false card", async () => {
  mocks.view.mockResolvedValueOnce({
    ...forge,
    url: "https://github.com/other/repo/pull/23",
  });
  const view = await mount([session()]);
  try {
    expect(view.model.pullRequests()).toHaveLength(0);
    mocks.view.mockRejectedValueOnce(new Error("forge temporarily offline"));
    await view.act(async () => mocks.changed!());
    expect(view.model.pullRequests()).toHaveLength(0);
    mocks.view.mockResolvedValueOnce(forge);
    await view.act(async () => mocks.changed!());
    expect(view.model.pullRequests()).toHaveLength(1);
    expect(mocks.view).toHaveBeenCalledTimes(3);
  } finally {
    await view.unmount();
  }
});

it("retains the first appearance when later turns repeat a URL, and refreshes unavailable state", async () => {
  mocks.view.mockResolvedValue(forge);
  const first = session();
  const view = await mount([first]);
  try {
    const original = view.model.pullRequests()[0].links[0];
    await view.render([
      {
        ...first,
        blocks: [
          ...first.blocks,
          { id: "later-turn", role: "user", text: "check" },
          { id: "later-view", role: "assistant", text: url, sentAt: 9000 },
        ],
      },
    ]);
    expect(view.model.pullRequests()[0].links).toEqual([original]);
    mocks.view.mockRejectedValueOnce(new Error("unavailable"));
    await view.act(async () => mocks.changed!());
    expect(view.model.pullRequests()[0].unavailable).toBe(true);
    expect(view.model.sessionPrAttention(view.model.pullRequests())).toEqual(
      [],
    );
    mocks.view.mockResolvedValueOnce({ ...forge, state: "merged" });
    await view.act(async () => mocks.changed!());
    expect(view.model.pullRequests()[0].pr.state).toBe("merged");
    expect(view.model.pullRequests()[0].links).toEqual([original]);
  } finally {
    await view.unmount();
  }
});

it("uses one forge request for sessions sharing a PR while recording each association", async () => {
  mocks.view.mockResolvedValue(forge);
  const view = await mount([
    session(),
    session({ id: "other", title: "Other chat" }),
  ]);
  try {
    expect(mocks.view).toHaveBeenCalledTimes(1);
    expect(
      view.model.pullRequests()[0].links.map((link) => link.sessionId),
    ).toEqual(["chat", "other"]);
  } finally {
    await view.unmount();
  }
});

it("associates worker and manager task PRs and retains follow-up PRs for one task", async () => {
  const followup = "https://github.com/example/repo/pull/24";
  mocks.view.mockImplementation(async (_cwd, requested) =>
    requested === followup ? { ...forge, url: followup, number: 24 } : forge,
  );
  const run = {
    id: "run",
    leadId: "manager",
    ownerSessionId: "manager",
    tasks: [
      {
        id: "task",
        title: "Fix task",
        sessionId: "chat",
        prUrl: url,
        prReadyAt: 3000,
        prReadyTurnId: "manager-turn",
        workspace: { checkoutCwd: "/repo-worktrees/fix" },
      },
    ],
  } as unknown as OrchestrationRun;
  const worker = session();
  const view = await mount([worker], [run]);
  try {
    expect(view.model.pullRequests()[0].links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "chat", taskId: "task" }),
        expect.objectContaining({
          sessionId: "manager",
          taskId: "task",
          turnId: "manager-turn",
        }),
      ]),
    );
    expect(view.model.sessionPrAttention(view.model.pullRequests())).toEqual(
      [],
    );
    await view.render(
      [
        {
          ...worker,
          blocks: [
            ...worker.blocks,
            { id: "fix-turn", role: "user", text: "Follow-up" },
            { id: "fix-pr", role: "assistant", text: followup },
          ],
        },
      ],
      [{ ...run, tasks: [{ ...run.tasks[0], prUrl: followup }] }],
    );
    expect(
      view.model
        .worktreePullRequests("/repo-worktrees/fix")
        .map((pr) => pr.number)
        .sort(),
    ).toEqual([23, 24]);
    expect(
      view.model
        .pullRequests()
        .every((entry) => entry.links.some((link) => link.taskId === "task")),
    ).toBe(true);
  } finally {
    await view.unmount();
  }
});

it("polls retained historical URLs after their session is unloaded", async () => {
  mocks.view.mockResolvedValue(forge);
  const view = await mount([session()]);
  try {
    await view.render([]);
    mocks.view.mockClear();
    mocks.view.mockResolvedValue({ ...forge, checksStatus: "failure" });
    await view.act(async () => mocks.changed!());
    expect(mocks.view).toHaveBeenCalledWith("/repo-worktrees/fix", url);
    expect(view.model.pullRequests()[0].pr.checksStatus).toBe("failure");
  } finally {
    await view.unmount();
  }
});

it("bounds retries while output streams and retries on a later poll", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  mocks.view.mockResolvedValue(null);
  const first = session();
  const view = await mount([first]);
  try {
    expect(mocks.view).toHaveBeenCalledTimes(1);
    await view.render([{ ...first }]);
    expect(mocks.view).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_029_999);
    await view.render([{ ...first }]);
    expect(mocks.view).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_030_000);
    mocks.view.mockResolvedValueOnce(forge);
    await view.render([{ ...first }]);
    expect(mocks.view).toHaveBeenCalledTimes(2);
    expect(view.model.pullRequests()).toHaveLength(1);
  } finally {
    await view.unmount();
    now.mockRestore();
  }
});

it("pins team acceptance to the reviewed head when live forge state advances", async () => {
  mocks.view.mockResolvedValue({ ...forge, headOid: "reviewed-head" });
  const run = {
    id: "run",
    leadId: "manager",
    ownerSessionId: "manager",
    tasks: [
      {
        id: "task",
        title: "Accepted task",
        sessionId: "chat",
        prUrl: url,
        status: "completed",
        accepted: true,
        lastDispatchId: "dispatch",
        acceptedDispatchId: "dispatch",
        reviewedHead: "reviewed-head",
        delivery: { state: "ready", head: "reviewed-head" },
        prReadyAt: 3000,
        prReadyTurnId: "manager-turn",
        workspace: { checkoutCwd: "/repo-worktrees/fix" },
      },
    ],
  } as unknown as OrchestrationRun;
  const view = await mount([session()], [run]);
  try {
    const owner = view.model
      .pullRequests()[0]
      .links.find((link) => link.sessionId === "manager")!;
    expect(owner.acceptedHead).toBe("reviewed-head");
    mocks.view.mockResolvedValue({ ...forge, headOid: "unreviewed-new-head" });
    await view.act(async () => mocks.changed!());
    const current = view.model.pullRequests()[0];
    expect(current.pr.headOid).toBe("unreviewed-new-head");
    expect(current.links.find((link) => link.sessionId === "manager")).toEqual(
      owner,
    );
  } finally {
    await view.unmount();
  }
});

it("does not resurrect deleted-session links when an in-flight forge response arrives", async () => {
  let resolve!: (value: GitPr) => void;
  mocks.view.mockReturnValue(
    new Promise<GitPr>((done) => {
      resolve = done;
    }),
  );
  const view = await mount([session()]);
  try {
    await view.act(async () => view.model.forgetSessionPullRequests("chat"));
    await view.act(async () => resolve(forge));
    expect(view.model.worktreePullRequests("/repo-worktrees/fix")).toEqual([
      forge,
    ]);
    expect(view.model.pullRequests()[0].links).toEqual([]);
    expect(view.model.sessionPrAttention(view.model.pullRequests())).toEqual(
      [],
    );
  } finally {
    await view.unmount();
  }
});

it("keeps historical PR ownership when the session switches its selected worktree", async () => {
  mocks.view.mockResolvedValue(forge);
  const first = session();
  const view = await mount([first]);
  try {
    const anchor = view.model.pullRequests()[0].links[0];
    await view.render([{ ...first, worktreeCwd: "/repo-worktrees/new-task" }]);
    mocks.view.mockClear();
    await view.act(async () => mocks.changed!());
    expect(mocks.view).toHaveBeenCalledWith("/repo-worktrees/fix", url);
    expect(mocks.view).not.toHaveBeenCalledWith(
      "/repo-worktrees/new-task",
      url,
    );
    expect(view.model.pullRequests()).toHaveLength(1);
    expect(view.model.pullRequests()[0].cwd).toBe("/repo-worktrees/fix");
    expect(view.model.pullRequests()[0].links).toEqual([anchor]);
    expect(view.model.worktreePullRequests("/repo-worktrees/new-task")).toEqual(
      [],
    );
  } finally {
    await view.unmount();
  }
});

it("updates worker and owner acceptance immediately without waiting for another forge request", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  mocks.view.mockResolvedValue({ ...forge, headOid: "accepted-head" });
  const worker = session();
  const run = {
    id: "run",
    leadId: "manager",
    ownerSessionId: "manager",
    tasks: [
      {
        id: "task",
        title: "Accepted task",
        sessionId: worker.id,
        prUrl: url,
        status: "completed",
        accepted: true,
        lastDispatchId: "dispatch",
        acceptedDispatchId: "dispatch",
        reviewedHead: "accepted-head",
        delivery: { state: "ready", head: "accepted-head" },
        prReadyAt: 3000,
        prReadyTurnId: "manager-turn",
        workspace: { checkoutCwd: "/repo-worktrees/fix" },
      },
    ],
  } as unknown as OrchestrationRun;
  const view = await mount([worker], [run]);
  try {
    const first = view.model.pullRequests()[0];
    expect(first.links.map((link) => link.sessionId).sort()).toEqual([
      "chat",
      "manager",
    ]);
    expect(
      first.links.every((link) => link.acceptedHead === "accepted-head"),
    ).toBe(true);
    mocks.view.mockClear();
    await view.render(
      [worker],
      [{ ...run, tasks: [{ ...run.tasks[0], accepted: false }] }],
    );
    expect(mocks.view).not.toHaveBeenCalled();
    const revoked = view.model.pullRequests()[0];
    expect(revoked.pr.headOid).toBe("accepted-head");
    expect(revoked.links.every((link) => link.acceptedHead === null)).toBe(
      true,
    );
  } finally {
    await view.unmount();
    now.mockRestore();
  }
});

it.each(["revoked", "cleared-url"] as const)(
  "does not restore stale acceptance when an old forge response resolves after %s",
  async (change) => {
    let resolve!: (value: GitPr) => void;
    mocks.view.mockReturnValue(
      new Promise<GitPr>((done) => {
        resolve = done;
      }),
    );
    const worker = session();
    const run = {
      id: "run",
      leadId: "manager",
      ownerSessionId: "manager",
      tasks: [
        {
          id: "task",
          title: "Accepted task",
          sessionId: worker.id,
          prUrl: url,
          status: "completed",
          accepted: true,
          lastDispatchId: "dispatch",
          acceptedDispatchId: "dispatch",
          reviewedHead: "accepted-head",
          delivery: { state: "ready", head: "accepted-head" },
          prReadyAt: 3000,
          prReadyTurnId: "manager-turn",
          workspace: { checkoutCwd: "/repo-worktrees/fix" },
        },
      ],
    } as unknown as OrchestrationRun;
    const view = await mount([worker], [run]);
    try {
      expect(view.model.pullRequests()).toHaveLength(0);
      const currentTask =
        change === "revoked"
          ? { ...run.tasks[0], accepted: false }
          : { ...run.tasks[0], prUrl: undefined };
      await view.render([worker], [{ ...run, tasks: [currentTask] }]);
      await view.act(async () =>
        resolve({ ...forge, headOid: "accepted-head" }),
      );
      expect(mocks.view).toHaveBeenCalledTimes(1);
      const stored = view.model.pullRequests()[0];
      expect(stored.links.map((link) => link.sessionId).sort()).toEqual([
        "chat",
        "manager",
      ]);
      expect(stored.links.every((link) => link.acceptedHead === null)).toBe(
        true,
      );
      expect(stored.pr.url).toBe(url);
    } finally {
      await view.unmount();
    }
  },
);
