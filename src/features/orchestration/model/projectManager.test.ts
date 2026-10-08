import { expect, it } from "vitest";
import {
  isProjectManager,
  projectManagerId,
  managerWorktreeStatus,
  managerAttention,
  managerTaskMerged,
  managerTaskFinished,
  managerQueueRank,
  managerTaskOutcome,
  reviewedManagerPullRequest,
} from "./projectManager";
import type { OrchestrationRun } from "./orchestrationState";
import { newSession } from "../../sessions/model/session";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";

it("accepts only an open non-draft PR targeting the assignment's captured project branch", () => {
  const task = { baseBranch: "v4" } as OrchestrationRun["tasks"][number];
  const pr = { number: 4, title: "V4", url: "https://example.invalid/4", state: "open", baseRefName: "v4" };
  expect(reviewedManagerPullRequest(task, pr)).toBe(pr.url);
  expect(() => reviewedManagerPullRequest(task, { ...pr, baseRefName: "main" })).toThrow("assignment branch: v4");
  expect(() => reviewedManagerPullRequest(task, { ...pr, baseRefName: undefined })).toThrow("assignment branch");
  expect(() => reviewedManagerPullRequest(task, { ...pr, isDraft: true })).toThrow("non-draft");
  expect(() => reviewedManagerPullRequest(task, { ...pr, state: "closed" })).toThrow("open");
  expect(() => reviewedManagerPullRequest(task, null)).toThrow("lookup failure");
  expect(() => reviewedManagerPullRequest({ ...task, reviewedHead: "old" }, { ...pr, headOid: "new" })).toThrow("commit changed");
  expect(reviewedManagerPullRequest({ ...task, reviewedHead: "old", trivial: true }, { ...pr, headOid: "new" })).toBe(pr.url);
});

it("does not hide a new correction dispatch just because its previous PR merged", () => {
  const task = {
    status: "completed",
    accepted: true,
    lastDispatchId: "d",
    acceptedDispatchId: "d",
    prUrl: "https://example.com/pr",
  } as OrchestrationRun["tasks"][number];
  const pr = { number: 1, title: "PR", state: "merged", url: task.prUrl! };
  expect(managerTaskMerged(task, pr)).toBe(true);
  expect(managerTaskOutcome(task, pr)).toBe("Merged");
  const closed = { ...pr, state: "closed" };
  expect(managerTaskFinished(task, closed)).toBe(true);
  expect(managerQueueRank(task, closed)).toBe(3);
  expect(managerTaskMerged(task, closed)).toBe(false);
  expect(managerTaskOutcome(task, closed)).toBe("Closed (not merged)");
  expect(managerTaskOutcome({ ...task, status: "cancelled" }, pr)).toBe("Cancelled");
  expect(managerQueueRank({ ...task, status: "cancelled" }, pr)).toBe(3);
  expect(managerTaskOutcome({ ...task, lastDispatchId: "correction" }, closed)).toBeUndefined();
  expect(managerTaskFinished({ ...task, lastDispatchId: "correction" }, closed)).toBe(false);
  expect(managerTaskFinished(task, { ...closed, url: "another-pr" })).toBe(false);
  expect(
    managerTaskMerged({ ...task, status: "running", accepted: false }, pr),
  ).toBe(false);
  expect(managerTaskMerged({ ...task, lastDispatchId: "correction" }, pr)).toBe(
    false,
  );
});

it("uses one durable project identity across Windows spellings", async () => {
  const id = await projectManagerId("C:/Projects/My Repo");
  expect(await projectManagerId("//?/C:/Projects/My Repo")).toBe(id);
  expect(await projectManagerId("c:\\projects\\my repo")).toBe(id);
  expect(isProjectManager(id)).toBe(true);
  expect(await projectManagerId("C:/Projects/Other")).not.toBe(id);
  expect(await projectManagerId("C:/Projects/My Repo-worktrees/browser-link-4")).not.toBe(id);
});

it("makes a paused manager a decision in the shared Inbox and badge state", () => {
  const run = { leadId: "project-manager-test", cwd: "/v4", projectManager: true, status: "paused", error: "Provider unavailable", tasks: [] } as unknown as OrchestrationRun;
  expect(managerAttention([], [run], new Set(), new Map())).toEqual([
    expect.objectContaining({ kind: "decision", project: "/v4", question: "Provider unavailable" }),
  ]);
  expect(managerAttention([], [{ ...run, status: "active" }], new Set(), new Map())).toEqual([]);
});

it("shares unread, blocked and ready attention and clears terminal PRs", () => {
  const session = {
    ...newSession("claude", "/repo"),
    id: "project-manager-test",
  };
  const ready = {
    id: "ready",
    title: "Docs",
    status: "completed",
    accepted: true,
    prUrl: "https://example.test/pr/1",
    lastDispatchId: "d",
    acceptedDispatchId: "d",
    workspace: { checkoutCwd: "/worker", branch: "docs" },
  };
  const run = {
    leadId: session.id,
    cwd: "/repo",
    projectManager: true,
    tasks: [ready, { id: "failed", title: "Tests", status: "failed" }],
  } as OrchestrationRun;
  expect(
    managerAttention([session], [run], new Set([session.id]), new Map()).map(
      (i) => i.kind,
    ),
  ).toEqual(["reply", "ready"]);
  for (const state of ["merged", "closed"]) {
    const statuses = new Map([
      [
        prStatusKey("/worker", "docs"),
        { number: 1, title: "Docs", url: ready.prUrl, state },
      ],
    ]);
    expect(
      managerWorktreeStatus([run], "/worker", undefined, statuses),
    ).toBeUndefined();
    expect(
      managerAttention([session], [run], new Set(), statuses).map(
        (i) => i.kind,
      ),
    ).toEqual([]);
  }
  expect(
    managerAttention(
      [
        {
          ...session,
          pendingQuestion: { requestId: 1, title: "Choose", questions: [] },
        },
      ],
      [],
      new Set([session.id]),
      new Map(),
    ),
  ).toMatchObject([{ kind: "decision", question: "Choose" }]);
  expect(managerAttention([session], [], new Set(), new Map())).toEqual([]);
  expect(
    managerAttention(
      [
        {
          ...session,
          blocks: [
            {
              id: "a",
              role: "tool",
              text: "Publish branch",
              approval: { requestId: 1 },
            },
          ],
        },
      ],
      [],
      new Set(),
      new Map(),
    ),
  ).toMatchObject([{ kind: "decision", question: "Approve: Publish branch" }]);
});

it("never labels an unreviewed or stale result PR ready", () => {
  const task = {
    status: "completed",
    accepted: false,
    workspace: { checkoutCwd: "/worker" },
    prUrl: "https://example.test/pr/1",
    lastDispatchId: "new",
    acceptedDispatchId: "old",
  };
  const runs = [{ projectManager: true, tasks: [task] }] as OrchestrationRun[];
  expect(managerWorktreeStatus(runs, "/worker")).toBe("In review");
  task.accepted = true;
  expect(managerWorktreeStatus(runs, "/worker")).toBeUndefined();
  task.acceptedDispatchId = "new";
  expect(managerWorktreeStatus(runs, "/worker")).toBe("PR ready");
  task.status = "interrupted";
  expect(managerWorktreeStatus(runs, "/worker")).toBe("Blocked");
});
