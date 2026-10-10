// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { WorktreePr } from "../../source-control/model/pullRequests";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Mono } from "../../monos/model/mono";
import {
  buildPullRequestRows,
  filterPullRequestRows,
  groupPullRequestRows,
  pullRequestGroup,
  pullRequestAttention,
  pullRequestRepo,
} from "./pullRequestView";

const now = Date.parse("2026-10-08T12:00:00Z");
const fixture = (
  number: number,
  pr: Partial<WorktreePr["pr"]> = {},
): WorktreePr => ({
  cwd: "/repo/worktrees/fix",
  verifiedAt: now,
  links: [
    {
      sessionId: "session",
      sessionTitle: "Fix",
      turnId: "turn",
      blockId: "block",
      at: now,
    },
  ],
  pr: {
    number,
    title: `Fix ${number}`,
    url: `https://github.com/o/repo/pull/${number}`,
    state: "open",
    headOid: "head",
    checksStatus: "success",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    updatedAt: new Date(now - number * 1000).toISOString(),
    ...pr,
  },
});
const rows = (...entries: WorktreePr[]) => buildPullRequestRows(entries);

describe("pull request groups", () => {
  it("orders action groups, gates recent history and closed PRs, and keeps older reruns out of readiness", () => {
    const groups = groupPullRequestRows(
      rows(
        fixture(1, { checksStatus: "failure" }),
        fixture(2),
        fixture(3, { checksStatus: "pending" }),
        fixture(4, {
          state: "merged",
          closedAt: new Date(now - 86400000).toISOString(),
        }),
        fixture(5, {
          state: "merged",
          closedAt: new Date(now - 8 * 86400000).toISOString(),
        }),
        fixture(6, { state: "closed" }),
      ),
      {},
      {},
      now,
    );
    expect(
      groups.map((group) => [
        group.label,
        group.rows.map((row) => row.entry.pr.number),
      ]),
    ).toEqual([
      ["Needs you", [1]],
      ["Ready to merge", [2]],
      ["In progress", [3]],
      ["Recently merged", [4]],
    ]);
    expect(
      groupPullRequestRows(
        rows(fixture(6, { state: "closed" })),
        { closed: true },
        {},
        now,
      ).at(-1)?.rows[0].entry.pr.number,
    ).toBe(6);
  });
  it("puts running repairs in progress and unavailable cached failures cannot ask for action", () => {
    const row = rows(
      fixture(1, { checksStatus: "failure", mergeable: "CONFLICTING" }),
    )[0];
    expect(pullRequestGroup({ ...row, busy: true }, now)).toBe("In progress");
    expect(
      pullRequestGroup(
        { ...row, entry: { ...row.entry, unavailable: true } },
        now,
      ),
    ).toBe("In progress");
    expect(
      pullRequestGroup(
        { ...row, entry: fixture(2, { reviewDecision: "REVIEW_REQUIRED" }) },
        now,
      ),
    ).toBe("Needs you");
    expect(
      pullRequestGroup(
        { ...row, entry: fixture(2, { mergeStateStatus: "BLOCKED" }) },
        now,
      ),
    ).toBe("Needs you");
  });
  it("reveals an explicitly referenced historical PR", () => {
    const old = fixture(4, {
        state: "merged",
        closedAt: new Date(now - 90 * 86400000).toISOString(),
      }),
      closed = fixture(5, { state: "closed" });
    const groups = groupPullRequestRows(
      rows(old, closed),
      {},
      { urls: [old.pr.url, closed.pr.url] },
      now,
    );
    expect(
      groups.find((group) => group.label === "Recently merged")?.rows,
    ).toHaveLength(1);
    expect(groups.find((group) => group.label === "Closed")?.rows).toHaveLength(
      1,
    );
  });
  it("does not put a changed team head in Ready or Inbox Ready", () => {
    const entry = fixture(1);
    entry.links[0] = { ...entry.links[0], taskId: "task", acceptedHead: "old" };
    const row = rows(entry)[0];
    expect(row.label).toBe("Awaiting team review");
    expect(pullRequestGroup(row, now)).toBe("In progress");
    expect(pullRequestAttention([row])).toEqual([]);
    entry.links[0].acceptedHead = "head";
    expect(pullRequestAttention(rows(entry))[0].question).toBe("PR #1: Fix 1");
  });
});

it("uses canonical project, author mascot, team and session scopes and deduplicates shared PRs", () => {
  const member: Mono = {
    id: "member",
    role: "member",
    reportsTo: "manager",
    sessionId: "worker",
    name: "Builder",
    projects: ["/repo"],
    mascot: "crab",
    color: "#ee8844",
  };
  const run = {
    cwd: "/repo",
    ownerMonoId: "manager",
    tasks: [
      {
        id: "task",
        sessionId: "worker",
        memberId: "member",
        status: "completed",
        prUrl: fixture(1).pr.url,
      },
    ],
  } as OrchestrationRun;
  const entry = fixture(1);
  entry.links[0] = {
    ...entry.links[0],
    sessionId: "worker",
    taskId: "task",
    acceptedHead: "head",
  };
  const duplicate = {
    ...entry,
    cwd: "/repo",
    verifiedAt: now - 1,
    links: [{ ...entry.links[0], sessionId: "manager-chat" }],
  };
  const mapped = buildPullRequestRows([entry, duplicate, fixture(2)], {
    roster: [member],
    runs: [run],
  });
  expect(mapped).toHaveLength(2);
  expect(mapped[0]).toMatchObject({
    project: "/repo",
    author: { name: "Builder", mascot: "crab" },
    monoIds: ["member", "manager"],
  });
  for (const scope of [
    { project: "/repo" },
    { projects: ["/repo"] },
    { monoId: "member" },
    { monoId: "manager" },
    { sessionId: "worker" },
    { sessionId: "manager-chat" },
    { cwd: "/repo/worktrees/fix", project: "/repo" },
  ])
    expect(
      filterPullRequestRows(mapped, {}, scope).map(
        (row) => row.entry.pr.number,
      ),
    ).toEqual([1]);
  expect(filterPullRequestRows(mapped, {}, { projects: [] })).toEqual([]);
  expect(
    filterPullRequestRows(mapped, { ownership: "mine" }).map(
      (row) => row.entry.pr.number,
    ),
  ).toEqual([2]);
  expect(
    filterPullRequestRows(mapped, {
      ownership: "team",
      search: "builder",
      agent: "manager",
    }).map((row) => row.entry.pr.number),
  ).toEqual([1]);
});

it("preserves an unaccepted task and every worktree when deduplicating PRs", () => {
  const newest = fixture(1),
    older = { ...fixture(1), cwd: "/other-checkout", verifiedAt: now - 1000 };
  older.links[0] = { ...older.links[0], taskId: "task", acceptedHead: "old" };
  const mapped = buildPullRequestRows([newest, older]);
  expect(mapped[0].label).toBe("Awaiting team review");
  expect(
    filterPullRequestRows(mapped, {}, { cwd: "/other-checkout" }),
  ).toHaveLength(1);
  expect(pullRequestAttention(mapped)).toEqual([]);
});

it("retains enterprise host so detail and check requests cannot target github.com accidentally", () => {
  expect(pullRequestRepo("https://github.com/o/repo/pull/1")).toBe("o/repo");
  expect(pullRequestRepo("https://github.enterprise.test/o/repo/pull/1")).toBe(
    "github.enterprise.test/o/repo",
  );
});

it("a busy Manager report cannot hide a stopped worker's failed PR", () => {
  const entry = fixture(1, { checksStatus: "failure" });
  entry.links[0] = { ...entry.links[0], sessionId: "worker", taskId: "task" };
  entry.links.push({ ...entry.links[0], sessionId: "manager-chat" });
  const run = {
    cwd: "/repo",
    tasks: [
      {
        id: "task",
        sessionId: "worker",
        status: "completed",
        prUrl: entry.pr.url,
      },
    ],
  } as OrchestrationRun;
  const mapped = buildPullRequestRows([entry], {
    sessions: [
      { id: "worker", cwd: "/repo", busy: false },
      { id: "manager-chat", cwd: "/repo", busy: true },
    ],
    runs: [run],
  });
  expect(mapped[0].busy).toBe(false);
  expect(pullRequestGroup(mapped[0], now)).toBe("Needs you");
});
