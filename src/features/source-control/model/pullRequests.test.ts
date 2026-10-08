import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import type { GitPr } from "../../../platform/tauri/fs";
import type { PrLink, WorktreePr } from "./pullRequests";

const url = "https://github.com/example/repo/pull/23";
const storage = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
const pr = (fields: Partial<GitPr> = {}): GitPr => ({
  number: 23,
  title: "Fix checkout",
  url,
  state: "open",
  checksStatus: "success",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  ...fields,
});
const link = (fields: Partial<PrLink> = {}): PrLink => ({
  sessionId: "chat",
  sessionTitle: "Regular chat",
  turnId: "turn-1",
  blockId: "tool-1",
  at: 1000,
  ...fields,
});
const entry = (fields: Partial<GitPr> = {}): WorktreePr => ({
  cwd: "/repo",
  pr: pr(fields),
  links: [link()],
  verifiedAt: 1000,
});

it("canonicalizes forge web/API links, strips display punctuation, and rejects invalid URLs", async () => {
  const { prUrls } = await import("./pullRequests");
  expect(
    prUrls(
      `Created [PR](${url}). Viewed ${url}/files?diff=split#file. Updated https://api.github.com/repos/example/repo/pulls/23`,
    ),
  ).toEqual([url]);
  expect(
    prUrls("https://git.example.test/api/v3/repos/org/repo/pulls/7"),
  ).toEqual(["https://git.example.test/org/repo/pull/7"]);
  expect(
    prUrls(
      "http://github.com/o/r/pull/2 https://user:password@github.com/o/r/pull/2 https://github.com/o/r/pull/0 https://github.com/o/r/pull/9007199254740993 https://github.com/o/r/issues/2 https://github.com/o/r/pull/nope",
    ),
  ).toEqual([]);
});

it.each([
  {
    name: "gh pr create output",
    block: {
      role: "tool",
      text: "",
      tool: { title: "gh pr create", preview: { kind: "shell", output: url } },
    },
  },
  {
    name: "gh pr view command",
    block: {
      role: "tool",
      text: "",
      tool: { title: `gh pr view ${url} --json url` },
    },
  },
  {
    name: "gh pr edit update",
    block: {
      role: "tool",
      text: "",
      tool: { title: "gh pr edit", detail: `Updated ${url}` },
    },
  },
  {
    name: "final response",
    block: { role: "assistant", text: `Merge ready: ${url}` },
  },
  {
    name: "GitHub API JSON",
    block: {
      role: "tool",
      text: JSON.stringify({
        html_url: url,
        url: "https://api.github.com/repos/example/repo/pulls/23",
      }),
    },
  },
  {
    name: "tool preview lines",
    block: {
      role: "tool",
      text: "",
      tool: {
        preview: { kind: "shell", lines: [{ kind: "context", text: url }] },
      },
    },
  },
])("detects $name at the first historical turn/block", async ({ block }) => {
  const { sessionPrCandidates } = await import("./pullRequests");
  const session = {
    id: "chat",
    title: "My session",
    cwd: "/main",
    worktreeCwd: "/main-worktrees/fix",
    blocks: [
      { id: "turn-1", role: "user", text: "Open PR", startedAt: 1000 },
      { ...block, id: "tool-1", sentAt: 2000 },
      { id: "turn-2", role: "user", text: "Check again" },
      { id: "final", role: "assistant", text: url },
    ],
  } as Session;
  expect(sessionPrCandidates(session)).toEqual([
    {
      url,
      cwd: "/main-worktrees/fix",
      link: {
        sessionId: "chat",
        sessionTitle: "My session",
        turnId: "turn-1",
        blockId: "tool-1",
        at: 2000,
      },
    },
  ]);
});

it("never infers a PR card from user requests or unanchored tool output", async () => {
  const { sessionPrCandidates } = await import("./pullRequests");
  const session = {
    id: "chat",
    title: "chat",
    cwd: "/repo",
    blocks: [
      { id: "unanchored", role: "assistant", text: url },
      { id: "user", role: "user", text: `Review ${url}` },
    ],
  } as Session;
  expect(sessionPrCandidates(session)).toEqual([]);
});

it.each(["assistant", "tool"] as const)(
  "waits for completed %s output before resolving a partially streamed PR number",
  async (role) => {
    const { sessionPrCandidates } = await import("./pullRequests");
    const output = {
      id: "streamed-pr",
      role,
      text: "https://github.com/example/repo/pull/184",
      streaming: true,
      sentAt: 2000,
    };
    const current = {
      id: "chat",
      title: "My session",
      cwd: "/repo",
      blocks: [
        { id: "turn", role: "user", text: "Create PR", startedAt: 1000 },
        output,
      ],
    } as Session;
    expect(sessionPrCandidates(current)).toEqual([]);
    const completed = {
      ...current,
      blocks: [
        current.blocks[0],
        {
          ...output,
          text: "https://github.com/example/repo/pull/1845",
          streaming: false,
        },
      ],
    };
    expect(sessionPrCandidates(completed)).toEqual([
      {
        url: "https://github.com/example/repo/pull/1845",
        cwd: "/repo",
        link: {
          sessionId: "chat",
          sessionTitle: "My session",
          turnId: "turn",
          blockId: "streamed-pr",
          at: 2000,
        },
      },
    ]);
  },
);

it("retains the earliest session anchor across updates and associates multiple sessions/tasks", async () => {
  const { recordPullRequest, pullRequests, worktreePullRequests } =
    await import("./pullRequests");
  recordPullRequest("C:/Repo", pr(), link());
  recordPullRequest(
    "c:\\repo",
    pr({ state: "merged" }),
    link({ turnId: "later", blockId: "later", at: 9999 }),
  );
  recordPullRequest(
    "C:/Repo",
    pr({ state: "merged" }),
    link({ sessionId: "other" }),
  );
  recordPullRequest(
    "C:/Repo",
    pr({ state: "merged" }),
    link({ taskId: "task-1" }),
  );
  expect(pullRequests()).toHaveLength(1);
  expect(pullRequests()[0].links).toEqual([
    link(),
    link({ sessionId: "other" }),
    link({ taskId: "task-1" }),
  ]);
  expect(worktreePullRequests("c:/repo")[0].state).toBe("merged");
});

it("shows open follow-up PR before draft and merged history with all entries retained", async () => {
  const { relevantPullRequests, recordPullRequest, worktreePullRequests } =
    await import("./pullRequests");
  const merged = pr({
    state: "merged",
    number: 1,
    url: "https://github.com/example/repo/pull/1",
    updatedAt: "2026-10-08",
  });
  const draft = pr({
    isDraft: true,
    number: 2,
    url: "https://github.com/example/repo/pull/2",
    updatedAt: "2026-10-07",
  });
  const open = pr({ updatedAt: "2026-10-06" });
  expect(relevantPullRequests([merged, draft, open, merged])).toEqual([
    open,
    draft,
    merged,
  ]);
  for (const item of [merged, draft, open]) recordPullRequest("/repo", item);
  expect(worktreePullRequests("/repo")).toEqual([open, draft, merged]);
  expect(worktreePullRequests("/repo")).toHaveLength(3);
});

it.each([
  { state: "merged" },
  { state: "closed" },
  { isDraft: true },
  { checksStatus: "pending" },
  { checksStatus: "failure" },
  { checksStatus: "unknown" },
  { checksStatus: undefined },
  { mergeable: "UNKNOWN" },
  { mergeable: "CONFLICTING" },
  { mergeable: undefined },
  { mergeStateStatus: "BLOCKED" },
  { mergeStateStatus: undefined },
  { reviewDecision: "CHANGES_REQUESTED" },
  { reviewDecision: "REVIEW_REQUIRED" },
] as Partial<GitPr>[])(
  "fails closed on non-ready forge evidence %j",
  async (fields) => {
    const { pullRequestReady } = await import("./pullRequests");
    expect(pullRequestReady(entry(fields))).toBe(false);
  },
);

it("makes unavailable state non-ready and labels regular-session Inbox entries", async () => {
  const {
    recordPullRequest,
    markPullRequestUnavailable,
    pullRequests,
    sessionPrAttention,
    pullRequestLabel,
  } = await import("./pullRequests");
  recordPullRequest("/repo", pr(), link());
  recordPullRequest(
    "/repo",
    pr(),
    link({ sessionId: "worker", taskId: "task" }),
  );
  expect(sessionPrAttention(pullRequests())).toEqual([
    expect.objectContaining({
      id: "chat",
      kind: "ready",
      sourceLabel: expect.stringContaining("Regular chat"),
      project: "/repo",
    }),
  ]);
  markPullRequestUnavailable("/repo", url);
  expect(sessionPrAttention(pullRequests())).toEqual([]);
  expect(pullRequestLabel(pullRequests()[0])).toBe("Status unavailable");
});

it("persists PRs and historical anchors but requires forge refresh after reload", async () => {
  let model = await import("./pullRequests");
  model.recordPullRequest("/repo", pr(), link());
  vi.resetModules();
  model = await import("./pullRequests");
  expect(model.pullRequests()).toEqual([
    expect.objectContaining({ pr: pr(), links: [link()], unavailable: true }),
  ]);
  expect(model.sessionPrAttention(model.pullRequests())).toEqual([]);
  model.recordPullRequest("/repo", pr());
  expect(model.pullRequests()[0].links).toEqual([link()]);
  expect(model.pullRequestReady(model.pullRequests()[0])).toBe(true);
});

it("forgets deleted session associations without losing worktree PRs or other chats", async () => {
  const model = await import("./pullRequests");
  model.recordPullRequest("/repo", pr(), link());
  model.recordPullRequest("/repo", pr(), link({ sessionId: "other" }));
  model.forgetSessionPullRequests("chat");
  expect(model.pullRequests()[0].links).toEqual([link({ sessionId: "other" })]);
  expect(model.worktreePullRequests("/repo")).toEqual([pr()]);
  model.recordPullRequest("/repo", pr(), link());
  expect(model.pullRequests()[0].links).toEqual([link({ sessionId: "other" })]);
  vi.resetModules();
  const restored = await import("./pullRequests");
  expect(restored.pullRequests()[0].links).toEqual([
    link({ sessionId: "other" }),
  ]);
});

it("preserves acceptance on transcript refresh but clears it on explicit task revocation", async () => {
  const model = await import("./pullRequests");
  const accepted = link({ taskId: "task", acceptedHead: "reviewed-head" });
  model.recordPullRequest("/repo", pr({ headOid: "reviewed-head" }), accepted);
  model.recordPullRequest(
    "/repo",
    pr({ headOid: "new-head" }),
    link({ taskId: "task" }),
  );
  expect(model.pullRequests()[0].links[0].acceptedHead).toBe("reviewed-head");
  model.recordPullRequest(
    "/repo",
    pr({ headOid: "new-head" }),
    link({ taskId: "task", acceptedHead: null }),
  );
  expect(model.pullRequests()[0].links[0].acceptedHead).toBeNull();
  expect(model.pullRequests()[0].links[0].turnId).toBe(accepted.turnId);
  model.recordPullRequest("/repo", pr(), link({ taskId: "task" }));
  expect(model.pullRequests()[0].links[0].acceptedHead).toBeNull();
});

it.each([
  { pr: pr({ url: "javascript:alert(1)" }) },
  { links: [{ ...link(), at: null }] },
  { links: [{ ...link(), sessionTitle: 42 }] },
])("rejects malformed persisted records %j", async (fields) => {
  storage.set(
    "monocode.worktreePullRequests.v1",
    JSON.stringify([{ ...entry(), ...fields }]),
  );
  const model = await import("./pullRequests");
  expect(model.pullRequests()).toEqual([]);
});
