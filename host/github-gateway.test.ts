import { expect, it, vi } from "vitest";
import { GithubGateway, githubPrQuery } from "./github-gateway";

const rate = (remaining = 4500, cost = 1) => ({ cost, remaining, limit: 5000, resetAt: new Date(3_600_000).toISOString() });
const response = (numbers: number[], remaining = 4500, cost = 1) => ({ stdout: JSON.stringify({ data: { rateLimit: rate(remaining, cost), repository: Object.fromEntries(numbers.map((number, i) => [`p${i}`, { number, title: `PR ${number}`, url: `https://github.com/owner/repo/pull/${number}`, state: number < 61 ? "MERGED" : "OPEN", headRefOid: `${number}`, commits: { nodes: [] } }])) } }) });

it("batches 75 summaries once, coalesces inflight reads and never polls closed PRs", async () => {
  let now = 0;
  const execute = vi.fn(async () => response(Array.from({ length: 75 }, (_, i) => i + 1)));
  const gateway = new GithubGateway(execute, () => now);
  const numbers = Array.from({ length: 75 }, (_, i) => i + 1);
  const results = await Promise.all([gateway.summaries("/repo", "github.com", "owner", "repo", numbers), gateway.summaries("/other-worktree", "github.com", "owner", "repo", numbers)]);
  expect(results.map(rows => rows.length)).toEqual([75, 75]);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][1].join(" ")).toContain("p74: pullRequest(number:75)");
  expect(execute.mock.calls[0][1].join(" ")).toContain("detailsUrl createdAt startedAt");
  await gateway.summaries("/repo", "github.com", "owner", "repo", numbers);
  expect(execute).toHaveBeenCalledTimes(1);
  now = 60_001;
  await gateway.summaries("/repo", "github.com", "owner", "repo", numbers.slice(0, 60));
  expect(execute).toHaveBeenCalledTimes(1);
  await gateway.summaries("/repo", "github.com", "owner", "repo", numbers.slice(60));
  expect(execute).toHaveBeenCalledTimes(2);
});

it("keeps stale data at low budget, pauses on exhaustion and resumes after reset", async () => {
  let now = 0;
  const execute = vi.fn(async () => response([1], 499));
  const gateway = new GithubGateway(execute, () => now);
  const args = githubPrQuery("github.com", "owner", "repo", [], [1]);
  const first = await gateway.run("/repo", args);
  now = 61_000;
  expect(await gateway.run("/repo", args)).toBe(first);
  expect(gateway.budget()).toMatchObject({ low: true, limited: false, remaining: 499 });
  await expect(gateway.run("/repo", ["pr", "view", "2"])).rejects.toThrow("last known data");
  execute.mockImplementation(async () => { throw Object.assign(new Error("gh failed"), { stderr: "GraphQL: API rate limit already exceeded for user ID 17301927" }); });
  expect(await gateway.run("/repo", args, true)).toBe(first);
  expect(gateway.budget().limited).toBe(true);
  await expect(gateway.run("/repo", ["pr", "close", "2"], true)).rejects.toThrow("last known data");
  expect(execute).toHaveBeenCalledTimes(2);
  now = 3_600_001;
  execute.mockImplementation(async () => response([1]));
  await gateway.run("/repo", args);
  expect(execute).toHaveBeenCalledTimes(3);
});

it("uses ETag/304 without spending points and reads the latest quota headers", async () => {
  let now = 0;
  const execute = vi.fn(async () => ({ stdout: 'HTTP/2 200 OK\r\nETag: "head"\r\nx-ratelimit-resource: core\r\nx-ratelimit-remaining: 4000\r\nx-ratelimit-limit: 5000\r\nx-ratelimit-reset: 3600\r\n\r\n{"checks":[]}' }));
  const gateway = new GithubGateway(execute, () => now);
  const args = ["api", "repos/owner/repo/commits/head/check-runs"];
  const first = await gateway.run("/repo", args);
  now = 61_000;
  execute.mockImplementation(async () => ({ stdout: 'HTTP/2 304 Not Modified\r\nx-ratelimit-resource: core\r\nx-ratelimit-remaining: 4000\r\nx-ratelimit-limit: 5000\r\nx-ratelimit-reset: 3600\r\n\r\n' }));
  expect(await gateway.run("/repo", args)).toBe(first);
  expect(execute.mock.calls[1][1]).toContain("If-None-Match: \"head\"");
  expect(gateway.budget()).toMatchObject({ points: 1, calls: 2, remaining: 4000 });
});

it("keeps mutation freshness when an older read finishes after invalidation", async () => {
  let release: ((value: { stdout: string }) => void) | undefined;
  const execute = vi.fn(async () => execute.mock.calls.length === 1 ? new Promise<{ stdout: string }>(resolve => { release = resolve; }) : { stdout: '{"state":"OPEN","head":"new"}' });
  const gateway = new GithubGateway(execute, () => 0);
  const args = ["pr", "view", "1", "--repo", "owner/repo"];
  const old = gateway.run("/repo", args);
  gateway.invalidate();
  const fresh = await gateway.run("/repo", args);
  release!({ stdout: '{"state":"OPEN","head":"old"}' });
  await old;
  expect(await gateway.run("/repo", args)).toBe(fresh);
  expect(execute).toHaveBeenCalledTimes(2);
});

it("historical discovery retains closed snapshots and excludes them from subsequent polling", async () => {
  let now = 0;
  const execute = vi.fn(async (_cwd: string, args: string[]) => {
    const result = response(args.join(" ").includes("states:[OPEN,CLOSED,MERGED]") ? [1, 61] : [61]);
    const json = JSON.parse(result.stdout);
    for (const pr of Object.values(json.data.repository) as Record<string, unknown>[]) pr.headRefName = "feature";
    return { stdout: JSON.stringify(json) };
  });
  const gateway = new GithubGateway(execute, () => now);
  expect(await gateway.heads("/repo", "github.com", "owner", "repo", ["feature"])).toHaveLength(2);
  now = 61_000;
  expect(await gateway.heads("/repo", "github.com", "owner", "repo", ["feature"])).toHaveLength(2);
  const query = execute.mock.calls[1][1].join(" ");
  expect(query).toContain("states:[OPEN]");
  expect(query).toContain("pullRequest(number:61)");
  expect(query).not.toContain("pullRequest(number:1)");
});

it("never exposes gh debug response bodies in execution errors", async () => {
  const gateway = new GithubGateway(async () => { throw Object.assign(new Error("debug secret"), { stderr: '< Authorization: secret\n{"private":"data"}' }); }, () => 0);
  await expect(gateway.run("/repo", ["pr", "view", "1"])).rejects.toThrow("GitHub request failed");
});

it.each([["api", "repos/owner/repo", "-X", "PATCH"], ["api", "repos/owner/repo", "-XPOST"], ["api", "repos/owner/repo", "--method=PATCH"], ["api", "repos/owner/repo", "-fbody=input"], ["api", "repos/owner/repo", "--field=body=input"], ["api", "repos/owner/repo", "-f", "body=input"], ["api", "graphql", "-f", "query=mutation { test }"], ["pr", "review", "1"], ["issue", "create"]])("never caches or coalesces writes %j", async (...args) => {
  const execute = vi.fn(async () => ({ stdout: "done" }));
  const gateway = new GithubGateway(execute, () => 0);
  await Promise.all([gateway.run("/repo", args), gateway.run("/repo", args)]);
  expect(execute).toHaveBeenCalledTimes(2);
});

it("records observed fixture usage for the 10-minute 75-PR workload", async () => {
  let now = 0;
  const events: Record<string, number> = {};
  const execute = vi.fn(async (_cwd: string, args: string[]) => {
    const query = args.join(" ");
    const numbers = [...query.matchAll(/pullRequest\(number:(\d+)\)/g)].map(match => Number(match[1]));
    events[query.includes("pullRequest") ? "summaries" : "details"] = (events[query.includes("pullRequest") ? "summaries" : "details"] ?? 0) + 1;
    return response(numbers, 4500, 1);
  });
  const gateway = new GithubGateway(execute, () => now);
  const all = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let cycle = 0; cycle < 20; cycle++) {
    now = cycle * 30_000;
    await Promise.all(Array.from({ length: 4 }, (_, tree) => gateway.summaries(`/worktree-${tree}`, "github.com", "owner", "repo", all.filter((_n, index) => index % 4 === tree))));
    await gateway.run("/worktree-0", ["api", "repos/owner/repo/commits/active/check-runs"]);
  }
  expect(events).toEqual({ summaries: 40, details: 10 });
  expect(gateway.budget()).toMatchObject({ calls: 50, points: 50 });
  // Baseline session URL lookups alone issue 75 * 20 repo/view commands each.
  expect(3000 / gateway.budget().calls).toBeGreaterThanOrEqual(5);
});

it("measures the complete host consumer fixture before and after", async () => {
  let now = 0;
  const baseline: Record<string, number> = {};
  const oldCall = vi.fn(async (path: string, _args: string[]) => { baseline[path] = (baseline[path] ?? 0) + 1; });
  const all = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const number of all) { await oldCall("session", ["repo", "view"]); await oldCall("session", ["pr", "view", String(number)]); }
    for (let tree = 0; tree < 4; tree++) {
      await oldCall("list", ["repo", "view"]);
      for (let branch = 0; branch < 21; branch++) await oldCall("list", ["pr", "list", "--head", `${tree}-${branch}`]);
    }
    if (cycle % 4 === 0) { await oldCall("inbox", ["issue", "list"]); await oldCall("inbox", ["pr", "list"]); }
    await oldCall("checks", ["api", "check-runs"]);
    await oldCall("delivery", ["pr", "view", "75"]);
    await oldCall("delivery", ["api", "check-runs"]);
  }
  const execute = vi.fn(async (_cwd: string, args: string[]) => {
    const query = args.join(" ");
    const tree = /headRefName:\"tree-(\d+)/.exec(query)?.[1];
    const numbers = tree == null ? [...query.matchAll(/pullRequest\(number:(\d+)\)/g)].map(match => Number(match[1])) : all.filter((number, index) => index % 4 === Number(tree) && (!query.includes("states:[OPEN]") || number > 60));
    return response(numbers, 4500, 1);
  });
  const gateway = new GithubGateway(execute, () => now);
  const checks = ["api", "repos/owner/repo/commits/active/check-runs"];
  for (let cycle = 0; cycle < 20; cycle++) {
    now = cycle * 30_000;
    for (let tree = 0; tree < 4; tree++) {
      await gateway.run(`/worktree-${tree}`, ["repo", "view", "--json", "url,parent"]);
      const branches = Array.from({ length: 21 }, (_, branch) => `tree-${tree}-${branch}`);
      await gateway.heads(`/worktree-${tree}`, "github.com", "owner", "repo", branches);
    }
    for (let tree = 0; tree < 4; tree++) await gateway.summaries(`/worktree-${tree}`, "github.com", "owner", "repo", all.filter((_number, index) => index % 4 === tree));
    if (cycle % 4 === 0) for (const type of ["issues", "pullRequests"]) await gateway.run("/worktree-0", ["api", "graphql", "-f", `query=query { rateLimit { cost remaining limit resetAt } ${type} }`]);
    await gateway.run("/worktree-0", checks);
    await gateway.summaries("/worktree-0", "github.com", "owner", "repo", [75]);
    await gateway.run("/worktree-0", checks);
  }
  expect(baseline).toEqual({ session: 3000, list: 1760, inbox: 10, checks: 20, delivery: 40 });
  expect(oldCall).toHaveBeenCalledTimes(4830);
  expect(gateway.budget()).toMatchObject({ calls: 68, points: 68, paths: {
    "repo/view": { calls: 4, points: 4 }, "pr/list": { calls: 44, points: 44 },
    "inbox/graphql": { calls: 10, points: 10 }, "pr/checks": { calls: 10, points: 10 },
  } });
});
