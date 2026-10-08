import { afterEach, expect, it, vi } from "vitest";
import type { HostStore } from "./store";
import { WorkspaceCommands, WORKSPACE_COMMANDS } from "./workspace-commands";
import { checkoutPrBranches, parsePrs, PR_STATUS_FIELDS, prCardActionArgs, prRepositories, trustedPrTarget } from "./git-prs";

afterEach(() => vi.restoreAllMocks());
const row = (number: number, state = "OPEN", extra = {}) => ({ number, title: `PR ${number}`, url: `https://github.com/owner/repo/pull/${number}`, state, headRepositoryOwner: { login: "owner" }, ...extra });
const repositories = () => prRepositories(JSON.stringify({ url: "https://github.com/owner/repo", parent: { name: "upstream", owner: { login: "parent" } } }));

it("verifies repository, parent and enterprise PR URLs without trusting arbitrary hosts", () => {
  expect(trustedPrTarget("https://github.com/OWNER/Repo/pull/42/files?diff=split", repositories())).toEqual({ repo: "github.com/OWNER/Repo", number: 42 });
  expect(trustedPrTarget("https://github.com/parent/upstream/pull/7", repositories())).toMatchObject({ number: 7 });
  for (const url of ["https://evil.example/owner/repo/pull/42", "https://github.com/other/repo/pull/42", "https://github.com/owner/repo/issues/42", "http://github.com/owner/repo/pull/42", "https://user@github.com/owner/repo/pull/42", "https://github.com:444/owner/repo/pull/42", "https://github.com/owner/repo/pull/0", "https://github.com/owner/repo/pull/42x"]) expect(trustedPrTarget(url, repositories()), url).toBeNull();
  const enterprise = prRepositories('{"url":"https://github.example/team/repo","parent":null}');
  expect(trustedPrTarget("https://github.example/team/repo/pull/1", enterprise)).not.toBeNull();
  expect(trustedPrTarget("https://github.com/team/repo/pull/1", enterprise)).toBeNull();
});

it("keeps branch history bounded and retains current and explicitly requested branches", () => {
  const reflog = Array.from({ length: 100 }, (_, i) => `checkout: moving from history-${i} to current`).join("\r\n");
  const branches = checkoutPrBranches("current", reflog, ["history-99", "session-created", "current"]);
  expect(branches).toHaveLength(23);
  expect(branches.slice(0, 3)).toEqual(["current", "history-99", "session-created"]);
  expect(branches).toContain("history-19");
  expect(branches).not.toContain("history-20");
  expect(checkoutPrBranches("new", "checkout: moving from old to new\ncheckout: moving from 0123456789012345678901234567890123456789 to old", [])).toEqual(["new", "old"]);
});

it("returns all owned PRs and prioritizes open, draft then recently merged", () => {
  const prs = parsePrs(JSON.stringify([row(1, "MERGED"), row(4, "OPEN", { isDraft: true }), row(3), row(2, "MERGED"), row(8, "OPEN", { headRepositoryOwner: { login: "foreign" } }), row(9, "OPEN", { headRepositoryOwner: null })]), "Owner");
  expect(prs.map(pr => pr.number)).toEqual([3, 4, 2, 1]);
});

it.each([
  [[], "none"],
  [[{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }], "success"],
  [[{ name: "ci", status: "IN_PROGRESS", conclusion: "SUCCESS" }], "pending"],
  [[{ name: "ci", status: "COMPLETED", conclusion: "CANCELLED" }], "failure"],
  [[{ name: "ci", status: "MYSTERY", conclusion: "SUCCESS" }], "unknown"],
  [[{ __typename: "StatusContext", context: "legacy", state: "ERROR" }], "failure"],
  [[{ name: "ci", status: "COMPLETED", conclusion: "SKIPPED" }], "success"],
])("matches native CI readiness classification for %j", (checks, expected) => {
  const pr = parsePrs(JSON.stringify([row(7, "OPEN", { statusCheckRollup: checks, additions: 10, deletions: 2, headRefOid: "head", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" })]))[0];
  expect(pr).toMatchObject({ checksStatus: expected, additions: 10, deletions: 2, headOid: "head", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN" });
});

it("keeps missing checks unknown and rejects malformed forge responses", () => {
  expect(parsePrs(JSON.stringify([row(1)]))[0].checksStatus).toBeUndefined();
  expect(parsePrs(JSON.stringify([row(1, "OPEN", { statusCheckRollup: null })]))[0].checksStatus).toBeUndefined();
  expect(() => parsePrs(JSON.stringify([row(1, "OPEN", { statusCheckRollup: ["not a check"] })]))).toThrow("Invalid GitHub checks");
});

it("uses newest check reruns regardless of response ordering and preserves newer pending", () => {
  for (const context of [false, true]) for (const state of ["SUCCESS", "PENDING"]) {
    const make = (state: string, timestamp: string) => context
      ? { __typename: "StatusContext", context: "ci", state, createdAt: timestamp }
      : { __typename: "CheckRun", workflowName: "CI", name: "build (ubuntu)", status: state === "PENDING" ? "IN_PROGRESS" : "COMPLETED", conclusion: state, startedAt: timestamp };
    const checks = [make("FAILURE", "2026-10-08T10:00:00Z"), make(state, "2026-10-08T11:00:00Z")];
    for (const statusCheckRollup of [checks, [...checks].reverse()]) expect(parsePrs(JSON.stringify([row(1, "OPEN", { statusCheckRollup })]))[0].checksStatus).toBe(state === "SUCCESS" ? "success" : "pending");
  }
});

it("preserves distinct matrix jobs, workflows, types and nameless unknown checks", () => {
  const check = (name: string, workflowName = "CI", conclusion = "SUCCESS") => ({ __typename: "CheckRun", name, workflowName, status: "COMPLETED", conclusion });
  const summary = (statusCheckRollup: object[]) => parsePrs(JSON.stringify([row(1, "OPEN", { statusCheckRollup })]))[0].checksStatus;
  expect(summary([check("build (ubuntu)", "CI", "FAILURE"), check("build (windows)")])).toBe("failure");
  expect(summary([check("build", "CI", "FAILURE"), check("build", "Other")])).toBe("failure");
  expect(summary([check("build", "", "FAILURE"), { __typename: "StatusContext", context: "build", state: "SUCCESS" }])).toBe("failure");
  expect(summary([check("build"), { status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("unknown");
  expect(summary([check("build", "CI", "FAILURE"), { ...check("build"), startedAt: "2026-10-08T11:00:00Z" }])).toBe("failure");
  expect(summary([{ ...check("build"), startedAt: "2026-10-08T11:00:00Z" }, { name: "build", workflowName: "CI", status: "QUEUED" }])).toBe("pending");
});

function fixture() {
  const commands = new WorkspaceCommands({} as HostStore, async (_id, action) => action());
  const backend = commands as unknown as { ghCommand(cwd: unknown, args: string[]): Promise<string>; gitCommand(cwd: unknown, args: string[]): Promise<string> };
  return { commands, gh: vi.spyOn(backend, "ghCommand"), git: vi.spyOn(backend, "gitCommand") };
}

it("dispatches trusted remote URL lookup by numeric PR and rejects unrelated URLs", async () => {
  const { commands, gh } = fixture();
  gh.mockResolvedValueOnce('{"url":"https://github.com/owner/repo","parent":null}').mockResolvedValueOnce(JSON.stringify(row(42)));
  expect(await commands.run("git_pr_status_by_url", { cwd: "/repo", url: "https://github.com/owner/repo/pull/42" })).toMatchObject({ number: 42, state: "open" });
  expect(gh).toHaveBeenLastCalledWith("/repo", ["pr", "view", "42", "--repo", "github.com/owner/repo", "--json", PR_STATUS_FIELDS]);
  gh.mockClear().mockResolvedValue('{"url":"https://github.com/owner/repo","parent":null}');
  expect(await commands.run("git_pr_status_by_url", { cwd: "/repo", url: "https://evil.example/owner/repo/pull/42" })).toBeNull();
  expect(gh).toHaveBeenCalledTimes(1);
  expect(WORKSPACE_COMMANDS).toContain("git_pr_status_by_url");
});

it("dispatches branch history lookup and preserves legacy current-branch status", async () => {
  const { commands, gh, git } = fixture();
  git.mockImplementation(async (_cwd, args) => args[0] === "symbolic-ref" ? "new\n" : "checkout: moving from old to new\n");
  gh.mockImplementation(async (_cwd, args) => args[0] === "repo" ? '{"url":"https://github.com/owner/repo","parent":null}' : args.includes("--head") ? JSON.stringify([row(args.includes("new") ? 2 : 1, args.includes("new") ? "OPEN" : "MERGED")]) : JSON.stringify(row(2)));
  expect((await commands.run("git_pr_list", { cwd: "/repo" }) as { number: number }[]).map(pr => pr.number)).toEqual([2, 1]);
  expect(await commands.run("git_pr_status", { cwd: "/repo" })).toMatchObject({ number: 2, state: "open" });
  expect(gh).toHaveBeenLastCalledWith("/repo", ["pr", "view", "--json", PR_STATUS_FIELDS]);
  await expect(commands.run("git_pr_list", { cwd: "/repo", branches: ["--help"] })).rejects.toThrow("Invalid pull request branches");
  expect(WORKSPACE_COMMANDS).toContain("git_pr_list");
});

const cardHead = "a".repeat(40);
const readyCard = () => parsePrs(JSON.stringify([row(42, "OPEN", { headRefOid: cardHead, baseRefName: "staging", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", statusCheckRollup: [] })]))[0];

it("pins every merge strategy to a full SHA and blocks changed head/base or unavailable readiness", () => {
  const pr = readyCard();
  for (const action of ["merge", "squash", "rebase"]) expect(prCardActionArgs(pr, action, cardHead, "staging")).toEqual(["pr", "merge", "42", "--repo", "github.com/owner/repo", `--${action}`, "--match-head-commit", cardHead]);
  expect(prCardActionArgs({ ...pr, headOid: "b".repeat(64) }, "merge", "b".repeat(64), "staging")).toContain("b".repeat(64));
  for (const head of ["abc", "--help", "z".repeat(40), "a".repeat(41), null]) expect(() => prCardActionArgs(pr, "merge", head, "staging")).toThrow();
  expect(() => prCardActionArgs(pr, "merge", "b".repeat(40), "staging")).toThrow("head changed");
  expect(() => prCardActionArgs(pr, "merge", cardHead, "main")).toThrow("base changed");
  expect(() => prCardActionArgs(pr, "merge", cardHead, null)).toThrow("reviewed head and base");
  for (const patch of [{ state: "closed" }, { isDraft: true }, { checksStatus: "pending" }, { checksStatus: "failure" }, { checksStatus: "unknown" }, { checksStatus: undefined }, { mergeable: "CONFLICTING" }, { mergeStateStatus: "DIRTY" }, { reviewDecision: "CHANGES_REQUESTED" }, { reviewDecision: "REVIEW_REQUIRED" }]) expect(() => prCardActionArgs({ ...pr, ...patch } as typeof pr, "merge", cardHead, "staging")).toThrow("not ready");
  expect(prCardActionArgs(pr, "close", cardHead, "staging")).toEqual(["pr", "close", "42", "--repo", "github.com/owner/repo"]);
  expect(() => prCardActionArgs(pr, "reopen", cardHead, "staging")).toThrow("state changed");
  expect(prCardActionArgs({ ...pr, state: "closed" }, "reopen", cardHead, "staging")).toContain("reopen");
  expect(() => prCardActionArgs({ ...pr, state: "merged" }, "reopen", cardHead, "staging")).toThrow("state changed");
});

it("runs only an explicitly validated card mutation and refreshes rich state including merge queue", async () => {
  for (const queued of [false, true]) {
    const { commands, gh } = fixture();
    let views = 0;
    gh.mockImplementation(async (_cwd, args) => {
      if (args[0] === "repo") return '{"url":"https://github.com/owner/repo","parent":null}';
      if (args[1] === "merge") return "";
      views++;
      return JSON.stringify(row(42, views === 2 && !queued ? "MERGED" : "OPEN", { headRefOid: cardHead, baseRefName: "staging", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", additions: 10, statusCheckRollup: [] }));
    });
    expect(await commands.run("git_pr_action_by_url", { cwd: "/repo", url: "https://github.com/owner/repo/pull/42", action: "merge", expectedHead: cardHead, expectedBase: "staging" })).toMatchObject({ state: queued ? "open" : "merged", additions: 10, checksStatus: "none" });
    expect(gh.mock.calls.filter(([, args]) => args[1] === "merge")).toEqual([["/repo", ["pr", "merge", "42", "--repo", "github.com/owner/repo", "--merge", "--match-head-commit", cardHead]]]);
    expect(views).toBe(2);
    gh.mockRestore();
  }
});

it("rejects untrusted or changed card targets before any mutating executor call", async () => {
  for (const scenario of ["foreign", "wrong-parent", "stale-head", "stale-base", "pending", "closed"]) {
    const { commands, gh } = fixture();
    gh.mockImplementation(async (_cwd, args) => args[0] === "repo" ? '{"url":"https://github.com/owner/repo","parent":{"name":"upstream","owner":{"login":"parent"}}}' : JSON.stringify(row(42, scenario === "closed" ? "CLOSED" : "OPEN", { url: scenario === "wrong-parent" ? "https://github.com/parent/upstream/pull/42" : "https://github.com/owner/repo/pull/42", headRefOid: scenario === "stale-head" ? "b".repeat(40) : cardHead, baseRefName: scenario === "stale-base" ? "main" : "staging", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: scenario === "pending" ? [{ name: "ci", status: "QUEUED" }] : [] })));
    await expect(commands.run("git_pr_action_by_url", { cwd: "/repo", url: scenario === "foreign" ? "https://evil.example/owner/repo/pull/42" : "https://github.com/owner/repo/pull/42", action: "merge", expectedHead: cardHead, expectedBase: "staging" })).rejects.toThrow();
    expect(gh.mock.calls.some(([, args]) => ["merge", "close", "reopen"].includes(args[1]))).toBe(false);
    gh.mockRestore();
  }
});
