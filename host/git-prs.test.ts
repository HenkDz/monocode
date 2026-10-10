import { afterEach, expect, it, vi } from "vitest";
import type { HostStore } from "./store";
import { WorkspaceCommands, WORKSPACE_COMMANDS } from "./workspace-commands";
import { checkoutPrBranches, enrichPrCheckApps, parsePrs, PR_STATUS_FIELDS, prCardActionArgs, prRepositories, trustedPrTarget } from "./git-prs";
import { githubGateway } from "./github-gateway";

afterEach(() => { vi.restoreAllMocks(); githubGateway.invalidate(); });
const row = (number: number, state = "OPEN", extra = {}) => ({ number, title: `PR ${number}`, url: `https://github.com/owner/repo/pull/${number}`, state, headRepositoryOwner: { login: "owner" }, ...extra });
const repositories = () => prRepositories(JSON.stringify({ url: "https://github.com/owner/repo", parent: { name: "upstream", owner: { login: "parent" } } }));
const graphqlRows = (rows: Record<string, unknown>[]) => JSON.stringify({ data: { repository: Object.fromEntries(rows.map((pr, index) => [`p${index}`, { ...pr, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: pr.statusCheckRollup ?? [], totalCount: (pr.statusCheckRollup as unknown[] ?? []).length } } } }] } }])) } });

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

it("shares suite/attempt ordering with detailed checks and keeps app/context identity", () => {
  const check = (extra: object) => ({ name: "CI Required", workflowName: "CI", status: "COMPLETED", ...extra });
  const failed = check({ conclusion: "FAILURE", suiteId: 1, runAttempt: 9 });
  const passed = check({ conclusion: "SUCCESS", suiteId: 2, runAttempt: 1 });
  const summary = (statusCheckRollup: object[]) => parsePrs(JSON.stringify([row(1, "OPEN", { statusCheckRollup })]))[0].checksStatus;
  expect(summary([passed, failed])).toBe("success");
  expect(summary([passed, { ...failed, app: "external" }])).toBe("failure");
  expect(summary([passed, { ...failed, matrixKey: "windows" }])).toBe("failure");
  for (const slug of [undefined, "same-vendor"]) {
    expect(summary([{ ...passed, app: { id: 1, slug } }, { ...failed, app: { id: 2, slug } }])).toBe("failure");
  }
  expect(summary([check({ conclusion: "FAILURE", detailsUrl: "https://github.com/acme/web/actions/runs/1/job/10" }), check({ conclusion: "SUCCESS", detailsUrl: "https://github.com/acme/web/actions/runs/2/job/20" })])).toBe("success");
});

it("enriches same-name external apps once per head before cards and actions see their checks", async () => {
  const checks = [
    { name: "scan", workflowName: "", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://vendor.example/check", startedAt: "2026-10-08T10:00:00Z" },
    { name: "scan", workflowName: "", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://vendor.example/check", startedAt: "2026-10-08T11:00:00Z" },
  ];
  const gh = vi.fn(async () => JSON.stringify([{ check_runs: checks.map((check, index) => ({ name: check.name, details_url: check.detailsUrl, started_at: check.startedAt, app: { id: index + 1, slug: `app-${index}` }, check_suite: { id: index + 1 } })) }]));
  const pr = row(1, "OPEN", { headRefOid: "a".repeat(40), statusCheckRollup: checks });
  const json = await enrichPrCheckApps(JSON.stringify([pr, { ...pr, number: 2, url: "https://github.com/owner/repo/pull/2" }]), gh);
  expect(gh).toHaveBeenCalledTimes(1);
  expect(gh).toHaveBeenCalledWith(["api", "--hostname", "github.com", `repos/owner/repo/commits/${"a".repeat(40)}/check-runs?filter=all&per_page=100`, "--paginate", "--slurp"]);
  expect(parsePrs(json).map(pr => pr.checksStatus)).toEqual(["failure", "failure"]);
  const rerun = await enrichPrCheckApps(JSON.stringify([pr]), async () => JSON.stringify(checks.map((check, index) => ({ check_runs: [{ name: check.name, details_url: check.detailsUrl, started_at: check.startedAt, app: { id: 1 }, check_suite: { id: index + 1 } }] }))));
  expect(parsePrs(rerun)[0].checksStatus).toBe("success");
  const failed = await enrichPrCheckApps(JSON.stringify([pr]), async () => { throw new Error("offline"); });
  expect(parsePrs(failed)[0].checksStatus).toBe("failure");
  const unidentified = await enrichPrCheckApps(JSON.stringify([{ ...pr, statusCheckRollup: checks.map(check => ({ ...check, conclusion: "SUCCESS" })) }]), async () => "[]");
  expect(parsePrs(unidentified)[0].checksStatus).toBe("unknown");
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

it("gets external identity in batched remote paths without per-head REST requests", async () => {
  const { commands, gh, git } = fixture();
  const checks = ["10", "11"].map((hour, index) => ({ name: "scan", workflowName: "", status: "COMPLETED", conclusion: index ? "SUCCESS" : "FAILURE", startedAt: `2026-10-08T${hour}:00:00Z`, detailsUrl: null }));
  const pr = row(42, "OPEN", { headRefOid: "a".repeat(40), statusCheckRollup: checks });
  git.mockImplementation(async (_cwd, args) => args[0] === "symbolic-ref" ? "new" : "checkout: moving from old to new");
  gh.mockImplementation(async (_cwd, args) => args[0] === "repo" ? '{"url":"https://github.com/owner/repo","parent":null}' : args.includes("graphql") ? graphqlRows([{ ...pr, statusCheckRollup: checks.map((check, index) => ({ ...check, checkSuite: { app: { databaseId: index + 1 } } })) }]) : args[0] === "api" ? JSON.stringify([{ check_runs: checks.map((check, index) => ({ name: check.name, started_at: check.startedAt, app: { id: index + 1 } })) }]) : JSON.stringify(pr));
  for (const command of ["git_pr_list", "git_pr_status", "git_pr_status_by_url"]) {
    githubGateway.invalidate();
    gh.mockClear();
    const value = await commands.run(command, { cwd: "/repo", url: pr.url });
    expect(Array.isArray(value) ? value[0] : value).toMatchObject({ checksStatus: "failure" });
    expect(gh.mock.calls.filter(([, args]) => args[0] === "api")).toHaveLength(1);
  }
});

it("dispatches trusted remote URL lookup by numeric PR and rejects unrelated URLs", async () => {
  const { commands, gh } = fixture();
  gh.mockResolvedValueOnce('{"url":"https://github.com/owner/repo","parent":null}').mockResolvedValueOnce(graphqlRows([row(42)]));
  expect(await commands.run("git_pr_status_by_url", { cwd: "/repo", url: "https://github.com/owner/repo/pull/42" })).toMatchObject({ number: 42, state: "open" });
  expect(gh.mock.calls.at(-1)?.[1].join(" ")).toContain("pullRequest(number:42)");
  gh.mockClear().mockResolvedValue('{"url":"https://github.com/owner/repo","parent":null}');
  expect(await commands.run("git_pr_status_by_url", { cwd: "/repo", url: "https://evil.example/owner/repo/pull/42" })).toBeNull();
  expect(gh).toHaveBeenCalledTimes(1);
  expect(WORKSPACE_COMMANDS).toContain("git_pr_status_by_url");
});

it("dispatches branch history lookup and preserves legacy current-branch status", async () => {
  const { commands, gh, git } = fixture();
  git.mockImplementation(async (_cwd, args) => args[0] === "symbolic-ref" ? "new\n" : "checkout: moving from old to new\n");
  gh.mockImplementation(async (_cwd, args) => args[0] === "repo" ? '{"url":"https://github.com/owner/repo","parent":null}' : args.includes("graphql") ? graphqlRows([row(2, "OPEN", { headRefName: "new" }), row(1, "MERGED", { headRefName: "old" })]) : JSON.stringify(row(2)));
  expect((await commands.run("git_pr_list", { cwd: "/repo" }) as { number: number }[]).map(pr => pr.number)).toEqual([2, 1]);
  expect(await commands.run("git_pr_status", { cwd: "/repo" })).toMatchObject({ number: 2, state: "open" });
  expect(gh.mock.calls.filter(([, args]) => args.includes("graphql"))).toHaveLength(1);
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
      return graphqlRows([row(42, views === 2 && !queued ? "MERGED" : "OPEN", { headRefOid: cardHead, baseRefName: "staging", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", additions: 10, statusCheckRollup: [] })]);
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
    gh.mockImplementation(async (_cwd, args) => args[0] === "repo" ? '{"url":"https://github.com/owner/repo","parent":{"name":"upstream","owner":{"login":"parent"}}}' : graphqlRows([row(42, scenario === "closed" ? "CLOSED" : "OPEN", { url: scenario === "wrong-parent" ? "https://github.com/parent/upstream/pull/42" : "https://github.com/owner/repo/pull/42", headRefOid: scenario === "stale-head" ? "b".repeat(40) : cardHead, baseRefName: scenario === "stale-base" ? "main" : "staging", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: scenario === "pending" ? [{ name: "ci", status: "QUEUED" }] : [] })]));
    await expect(commands.run("git_pr_action_by_url", { cwd: "/repo", url: scenario === "foreign" ? "https://evil.example/owner/repo/pull/42" : "https://github.com/owner/repo/pull/42", action: "merge", expectedHead: cardHead, expectedBase: "staging" })).rejects.toThrow();
    expect(gh.mock.calls.some(([, args]) => ["merge", "close", "reopen"].includes(args[1]))).toBe(false);
    gh.mockRestore();
  }
});
