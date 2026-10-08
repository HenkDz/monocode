// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PullRequestCard } from "./PullRequestCard";
import type { WorktreePr } from "../model/pullRequests";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));
vi.mock("../../inbox/model/githubTasks", () => ({
  formatRelativeTime: () => "A moment ago",
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("renders PR metadata, opens PR/diff/worktree, and updates checks/merge state in place", async () => {
  const entry: WorktreePr = {
    cwd: "/repo-worktrees/fix",
    verifiedAt: 1000,
    pr: {
      number: 24,
      title: "Follow-up checkout fix",
      url: "https://github.com/example/repo/pull/24",
      state: "open",
      checksStatus: "pending",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      baseRefName: "staging",
      headRefName: "fix/session-pr",
      additions: 12,
      deletions: 3,
    },
    links: [
      {
        sessionId: "chat",
        sessionTitle: "My regular chat",
        turnId: "first-turn",
        blockId: "first-pr",
        at: 1000,
      },
    ],
  };
  const host = document.createElement("div"),
    root = createRoot(host),
    openWorker = vi.fn();
  const actions = {
    update: vi.fn(),
    confirm: vi.fn(async () => {}),
    retry: vi.fn(),
    open: vi.fn(),
    openWorker,
  };
  const render = async (value: WorktreePr) => {
    await act(async () =>
      root.render(
        <OrchestrationActions.Provider value={actions}>
          <PullRequestCard entry={value} sessionId="chat" />
        </OrchestrationActions.Provider>,
      ),
    );
  };
  try {
    await render(entry);
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Open: Follow-up checkout fix",
    );
    expect(host.textContent).toContain("PR #24");
    expect(host.textContent).toContain("staging");
    expect(host.textContent).toContain("fix/session-pr");
    expect(host.textContent).toContain("+12");
    expect(host.textContent).toContain("3");
    expect(host.textContent).toContain("Checks pending");
    const buttons = Array.from(host.querySelectorAll("button"));
    for (const button of buttons) await act(async () => button.click());
    expect(openUrl).toHaveBeenCalledWith(entry.pr.url);
    expect(openUrl).toHaveBeenCalledWith(`${entry.pr.url}/files`);
    expect(openWorker).toHaveBeenCalledWith("chat");
    const anchor = host.querySelector("section")!.id;
    await render({ ...entry, pr: { ...entry.pr, checksStatus: "success" } });
    expect(host.querySelector("section")!.id).toBe(anchor);
    expect(host.textContent).toContain("Ready to merge");
    expect(host.textContent).toContain("Checks passed");
    await render({ ...entry, unavailable: true });
    expect(host.textContent).toContain("Status unavailable");
    expect(host.textContent).not.toContain("Ready to merge");
    await render({
      ...entry,
      pr: { ...entry.pr, state: "merged", checksStatus: "success" },
    });
    expect(host.querySelector("section")!.id).toBe(anchor);
    expect(host.textContent).toContain("Merged");
    await render({ ...entry, pr: { ...entry.pr, state: "closed" } });
    expect(host.textContent).toContain("Closed");
  } finally {
    await act(async () => root.unmount());
  }
});

it("requires team review again when a ready PR advances beyond its accepted head", async () => {
  const entry: WorktreePr = {
    cwd: "/repo-worktrees/fix",
    verifiedAt: 1000,
    pr: {
      number: 24,
      title: "Accepted fix",
      url: "https://github.com/example/repo/pull/24",
      state: "open",
      checksStatus: "success",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      headOid: "accepted-head",
    },
    links: [
      {
        sessionId: "manager",
        sessionTitle: "Manager",
        turnId: "first-turn",
        blockId: "first-pr",
        at: 1000,
        taskId: "task",
        acceptedHead: "accepted-head",
      },
    ],
  };
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(<PullRequestCard entry={entry} sessionId="manager" />),
    );
    expect(host.textContent).toContain("Ready to merge");
    await act(async () =>
      root.render(
        <PullRequestCard
          entry={{ ...entry, pr: { ...entry.pr, headOid: "new-head" } }}
          sessionId="manager"
        />,
      ),
    );
    expect(host.textContent).toContain("Awaiting team review");
    expect(host.textContent).not.toContain("Ready to merge");
    await act(async () =>
      root.render(
        <PullRequestCard
          entry={{
            ...entry,
            links: entry.links.map((link) => ({ ...link, acceptedHead: null })),
          }}
          sessionId="manager"
        />,
      ),
    );
    expect(host.textContent).toContain("Awaiting team review");
    expect(host.textContent).not.toContain("Ready to merge");
  } finally {
    await act(async () => root.unmount());
  }
});
