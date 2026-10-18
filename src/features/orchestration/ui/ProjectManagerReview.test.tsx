// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ProjectManagerReview,
  ProjectManagerStatus,
  ReadyCard,
} from "./ProjectManagerReview";
import { orchestrator } from "../model/orchestration";
import type { OrchestrationRun } from "../model/orchestrationState";
import type { GithubPrChecks } from "../../inbox/model/githubPrChecks";
import { recordPullRequest } from "../../source-control/model/pullRequests";
const statusView = vi.hoisted(() => ({ statuses: new Map() }));
vi.mock("../../source-control/hooks/usePrStatus", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../source-control/hooks/usePrStatus")
  >()),
  usePrStatusCache: () => statusView.statuses,
}));
const checkView = vi.hoisted(() => ({
  loading: false,
  error: null as string | null,
  checks: {
    headOid: "head",
    checks: [
      {
        name: "build",
        workflow: "CI",
        state: "pass",
        url: null,
        startedAt: null,
        completedAt: null,
      },
      {
        name: "test",
        workflow: "CI",
        state: "pass",
        url: null,
        startedAt: null,
        completedAt: null,
      },
    ],
  } as GithubPrChecks,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));
vi.mock("../../inbox/model/githubTasks", () => ({
  formatRelativeTime: vi.fn(() => "Just now"),
  githubPrDiff: vi.fn(async () => ({
    additions: 29,
    deletions: 0,
    files: [{}],
  })),
}));
vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: () => checkView,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("uses one slim team line with reviewer verdict and opens the shared PR view", async () => {
  const task = {
    id: "slim-ready",
    title: "Fix",
    sessionId: "worker",
    prUrl: "https://github.com/example/repo/pull/931",
    reviewedBy: "Reviewer",
    reviewedHead: "head",
    accepted: true,
    status: "completed",
    lastDispatchId: "d",
    acceptedDispatchId: "d",
    workspace: { checkoutCwd: "/repo/worker" },
  } as OrchestrationRun["tasks"][number];
  const run = {
    leadId: "manager",
    cwd: "/repo",
    tasks: [task],
  } as OrchestrationRun;
  const host = document.createElement("div"),
    root = createRoot(host),
    open = vi.fn();
  window.addEventListener("monocode:open-pull-requests", open);
  try {
    recordPullRequest("/repo/worker", {
      number: 931,
      title: "Fix",
      url: task.prUrl!,
      state: "open",
      checksStatus: "success",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      headOid: "head",
    });
    await act(async () =>
      root.render(<ReadyCard run={run} task={task} merged={false} />),
    );
    expect(host.textContent).toContain(
      "PR #931 ready to merge · Reviewed by Reviewer ✓",
    );
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.querySelector("section")).toBeNull();
    expect(host.textContent).not.toContain("Open diff");
    await act(async () => host.querySelector("button")!.click());
    expect(open.mock.calls[0][0].detail.urls).toEqual([task.prUrl]);
    await act(async () =>
      recordPullRequest("/repo/worker", {
        number: 931,
        title: "Fix",
        url: task.prUrl!,
        state: "open",
        checksStatus: "failure",
        headOid: "new-head",
      }),
    );
    expect(host.textContent).toContain("checks failed");
    expect(host.textContent).toContain("Re-review requested");
    expect(host.textContent).not.toContain("ready to merge");
    expect(host.textContent).not.toContain("Reviewer ✓");
    await act(async () =>
      recordPullRequest("/repo/worker", {
        number: 931,
        title: "Fix",
        url: task.prUrl!,
        state: "closed",
      }),
    );
    expect(host.textContent).toContain("PR #931 closed");
    expect(host.textContent).not.toContain("ready to merge");
  } finally {
    act(() => root.unmount());
    window.removeEventListener("monocode:open-pull-requests", open);
  }
});

it("counts accepted no-change tasks as finished in the Manager header", async () => {
  const host = document.createElement("div"),
    root = createRoot(host);
  const run = {
    tasks: [
      {
        id: "report",
        status: "completed",
        accepted: true,
        lastDispatchId: "dispatch",
        acceptedDispatchId: "dispatch",
        completionOutcome: "no-changes",
      },
    ],
  } as unknown as OrchestrationRun;
  try {
    await act(async () => root.render(<ProjectManagerStatus run={run} />));
    expect(host.textContent).toContain("0 running");
    expect(host.textContent).toContain("0 ready");
    expect(host.textContent).toContain("1 finished");
  } finally {
    await act(async () => root.unmount());
  }
});

it("explains a real blocker in chat and continues explicitly, without a Resume link", async () => {
  const continueManager = vi
    .spyOn(orchestrator, "continueManager")
    .mockResolvedValue();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ProjectManagerReview
          run={
            {
              leadId: "manager",
              tasks: [],
              status: "paused",
              error: "Provider unavailable",
            } as unknown as OrchestrationRun
          }
        />,
      ),
    );
    expect(host.textContent).toContain("Provider unavailable");
    expect(host.textContent).not.toContain("Resume");
    await act(async () => host.querySelector("button")!.click());
    expect(continueManager).toHaveBeenCalledWith("manager");
    await act(async () =>
      root.render(
        <ProjectManagerReview
          run={
            {
              leadId: "manager",
              tasks: [],
              status: "active",
              recoveryNotice: "Continued 2 workers after restart.",
            } as unknown as OrchestrationRun
          }
        />,
      ),
    );
    expect(host.textContent).toContain("Continued 2 workers");
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    continueManager.mockRestore();
  }
});
