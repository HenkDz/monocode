import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
type Output = { stdout: string; stderr?: string };
type Executor = (cwd: string, args: string[]) => Promise<Output>;
type Cache = { value: string; expires: number; etag?: string };
export type GithubBudget = {
  remaining: number | null; limit: number | null; resetAt: string | null; resource: string | null;
  status: "unknown" | "ok" | "low" | "exhausted"; limited: boolean; low: boolean;
  calls: number; points: number; paths: Record<string, { calls: number; points: number }>;
};
const RATE_LIMIT_MESSAGE = "GitHub rate limit reached · showing last known data";

/** All host GitHub traffic shares budget, cached reads and pending requests. */
export class GithubGateway {
  private cache = new Map<string, Cache>();
  private pending = new Map<string, Promise<string>>();
  private budgets = new Map<string, { remaining: number; limit: number; resetAt: string }>();
  private calls = 0;
  private points = 0;
  private paths: GithubBudget["paths"] = {};
  private headSnapshots = new Map<string, { rows: Record<string, unknown>[]; expires: number }>();
  private generation = 0;
  constructor(private execute: Executor = async (cwd, args) => exec("gh", args, {
    cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", GH_DEBUG: "api" },
  }), private now = () => Date.now()) {}

  budget(): GithubBudget {
    for (const [resource, budget] of this.budgets) if (Date.parse(budget.resetAt) <= this.now()) this.budgets.delete(resource);
    const entry = [...this.budgets].sort((a, b) => a[1].remaining / a[1].limit - b[1].remaining / b[1].limit)[0];
    const resource = entry?.[0] ?? null;
    const remaining = entry?.[1].remaining ?? null;
    const limit = entry?.[1].limit ?? null;
    const resetAt = entry?.[1].resetAt ?? null;
    const limited = remaining === 0;
    const low = remaining != null && limit != null && remaining < limit / 10;
    return { remaining, limit, resetAt, resource, status: limited ? "exhausted" : low ? "low" : remaining == null ? "unknown" : "ok", limited, low, calls: this.calls, points: this.points, paths: structuredClone(this.paths) };
  }

  invalidate(): void { this.cache.clear(); this.headSnapshots.clear(); this.pending.clear(); this.generation++; }
  async heads(cwd: string, host: string, owner: string, name: string, heads: readonly string[], call = (args: string[]) => this.run(cwd, args)): Promise<Record<string, unknown>[]> {
    const generation = this.generation;
    if (heads.length === 1) for (const [scope, snapshot] of this.headSnapshots) {
      const [knownHost, knownOwner, knownName, branches] = JSON.parse(scope);
      if (knownHost !== host.toLowerCase() || knownOwner !== owner.toLowerCase() || knownName !== name.toLowerCase() || !branches.includes(heads[0]) || snapshot.expires <= this.now()) continue;
      const rows = snapshot.rows.filter(pr => pr.headRefName === heads[0]);
      const entries = rows.map(pr => this.cache.get(`pr:${host}/${owner}/${name}/${pr.number}`.toLowerCase()));
      if (entries.every(entry => entry && entry.expires > this.now())) return entries.map(entry => JSON.parse(entry!.value));
    }
    const key = JSON.stringify([host.toLowerCase(), owner.toLowerCase(), name.toLowerCase(), [...heads].sort()]);
    const previous = this.headSnapshots.get(key);
    const discover = !previous || previous.expires <= this.now();
    const open = discover ? [] : previous.rows.filter(pr => pr.state === "OPEN").map(pr => Number(pr.number));
    let rows: Record<string, unknown>[];
    try {
      rows = (await Promise.all(Array.from({ length: Math.ceil(heads.length / 40) }, (_unused, index) =>
        call(githubPrQuery(host, owner, name, heads.slice(index * 40, (index + 1) * 40), index === 0 ? open : [], discover)).then(githubPrRows)))).flat();
    }
    catch (error) { if (!previous || !this.budget().low) throw error; return previous.rows; }
    const merged = [...new Map([...(discover ? [] : previous.rows), ...rows].map(pr => [pr.number, pr])).values()];
    if (generation === this.generation) {
      this.headSnapshots.set(key, { rows: merged, expires: discover ? this.now() + 86_400_000 : previous.expires });
      this.rememberPrs(rows);
    }
    return merged;
  }
  async summaries(cwd: string, host: string, owner: string, name: string, numbers: readonly number[], call = (args: string[]) => this.run(cwd, args)): Promise<Record<string, unknown>[]> {
    const generation = this.generation;
    const unique = [...new Set(numbers)];
    const key = (number: number) => `pr:${host}/${owner}/${name}/${number}`.toLowerCase();
    const missing = unique.filter(number => !this.cache.has(key(number)) || this.cache.get(key(number))!.expires <= this.now());
    if (missing.length) {
      const query = githubPrQuery(host, owner, name, [], missing);
      try {
        const rows = githubPrRows(await call(query));
        if (generation !== this.generation) return rows;
        this.rememberPrs(rows);
      }
      catch (error) { if (!this.budget().low || unique.some(number => !this.cache.has(key(number)))) throw error; }
    }
    return unique.flatMap(number => { const cached = this.cache.get(key(number)); return cached ? [JSON.parse(cached.value)] : []; });
  }
  rememberPrs(rows: readonly Record<string, unknown>[]): void {
    for (const pr of rows) {
      const url = new URL(String(pr.url));
      const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/.exec(url.pathname);
      if (!match) continue;
      const key = `pr:${url.host}/${match[1]}/${match[2]}/${match[3]}`.toLowerCase();
      this.cache.set(key, { value: JSON.stringify(pr), expires: this.now() + (["MERGED", "CLOSED"].includes(String(pr.state)) ? 86_400_000 : 60_000) });
    }
  }
  private record(output: Output, path: string): { body: string; etag?: string; notModified: boolean } {
    const split = /^(?:HTTP\/\S+|HTTP)\s+\d+[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/.exec(output.stdout);
    const headers = `${split?.[1] ?? ""}\n${output.stderr ?? ""}`;
    const header = (name: string) => [...headers.matchAll(new RegExp(`(?:^|\\n)[< ]*${name}:\\s*([^\\r\\n]+)`, "gi"))].at(-1)?.[1]?.trim();
    const body = split?.[2] ?? output.stdout;
    const resource = header("x-ratelimit-resource") ?? "core";
    const remaining = Number(header("x-ratelimit-remaining"));
    const limit = Number(header("x-ratelimit-limit"));
    const reset = Number(header("x-ratelimit-reset"));
    if (Number.isFinite(remaining) && limit > 0 && reset > 0) this.budgets.set(resource, { remaining, limit, resetAt: new Date(reset * 1000).toISOString() });
    let cost = 0;
    try {
      const json = JSON.parse(body);
      const rate = json.data?.rateLimit;
      if (rate && Number.isFinite(rate.remaining) && Number.isFinite(rate.limit) && Number.isFinite(Date.parse(rate.resetAt))) {
        this.budgets.set("graphql", rate); cost = rate.cost ?? 0;
      }
    } catch { /* CLI text responses use debug response headers. */ }
    const notModified = /^(?:HTTP\/\S+|HTTP)\s+304\b/.test(output.stdout);
    if (!cost && !notModified && resource !== "graphql" && header("x-ratelimit-resource")) cost = 1;
    this.points += cost;
    this.paths[path].points += cost;
    return { body: body.trim(), etag: header("etag"), notModified };
  }

  async run(cwd: string, args: string[], essential = false): Promise<string> {
    const read = args[0] === "api"
      ? !args.some((arg, i) => (["--method", "-X"].includes(arg) && args[i + 1]?.toUpperCase() !== "GET") || (/^--method=/.test(arg) && arg.slice(9).toUpperCase() !== "GET") || (/^-X.+/.test(arg) && arg.slice(2).toUpperCase() !== "GET"))
        && !args.some(arg => /(?:^|=)\s*mutation\b/.test(arg))
        && (args.includes("graphql") || !args.some(arg => ["-f", "-F", "--field", "--raw-field"].includes(arg) || /^--(?:raw-)?field=/.test(arg) || /^-[fF].+/.test(arg)) || args.some((arg, i) => ["--method", "-X"].includes(arg) && args[i + 1]?.toUpperCase() === "GET"))
      : (args[0] === "pr" && ["view", "list", "checks", "status", "diff"].includes(args[1])) || (args[0] === "repo" && args[1] === "view");
    const mutation = !read;
    const explicitRepo = args.indexOf("--repo");
    const key = JSON.stringify([explicitRepo >= 0 || args[0] === "api" ? "" : cwd, args]);
    const cached = this.cache.get(key);
    if (!mutation && cached && cached.expires > this.now()) return cached.value;
    const budget = this.budget();
    if (budget.limited || (budget.low && !essential)) {
      if (!mutation && cached) return cached.value;
      throw new Error(RATE_LIMIT_MESSAGE);
    }
    if (!mutation && this.pending.has(key)) return this.pending.get(key)!;
    const generation = this.generation;
    const request = (async () => {
      const query = args.join(" ");
      const path = args.includes("graphql") ? query.includes("headRefName:") ? "pr/list" : query.includes("pullRequest(number:") ? "pr/status-batch" : "inbox/graphql"
        : query.includes("check-runs") ? "pr/checks" : `${args[0]}/${args[1] ?? ""}`;
      this.calls++;
      (this.paths[path] ??= { calls: 0, points: 0 }).calls++;
      const rest = args[0] === "api" && !args.includes("graphql") && !args.includes("--paginate");
      const requestArgs = rest ? [...args, "--include", ...(cached?.etag ? ["-H", `If-None-Match: ${cached.etag}`] : [])] : args;
      let recorded = false;
      try {
        const response = this.record(await this.execute(cwd, requestArgs), path);
        recorded = true;
        if (/rate.?limit|secondary rate|abuse detection/i.test(response.body) && response.body.includes('"errors"')) throw new Error(RATE_LIMIT_MESSAGE);
        if (response.notModified) {
          if (!cached) throw new Error("GitHub returned an empty conditional response");
          cached.expires = this.now() + 60_000;
          return cached.value;
        }
        if (mutation) this.invalidate();
        else if (generation === this.generation) {
          let ttl = args[0] === "repo" ? 3_600_000 : 60_000;
          try { const row = JSON.parse(response.body); if (!Array.isArray(row) && ["MERGED", "CLOSED"].includes(row.state)) ttl = 86_400_000; } catch { /* Non-JSON CLI results retain the short TTL. */ }
          this.cache.set(key, { value: response.body, expires: this.now() + ttl, etag: response.etag });
          if (this.cache.size > 2048) this.cache.delete(this.cache.keys().next().value!);
        }
        return response.body;
      } catch (error) {
        const failure = error as { stderr?: string; stdout?: string; message?: string };
        if (!recorded) this.record({ stdout: failure.stdout ?? "", stderr: failure.stderr }, path);
        if (/rate.?limit|secondary rate|abuse detection/i.test(`${failure.stderr ?? ""} ${failure.message ?? ""}`)) {
          const current = this.budget();
          this.budgets.set(current.resource ?? "graphql", { remaining: 0, limit: current.limit ?? 5000, resetAt: current.resetAt ?? new Date(this.now() + 3_600_000).toISOString() });
          if (!mutation && cached) return cached.value;
          throw new Error(RATE_LIMIT_MESSAGE);
        }
        throw new Error("GitHub request failed. Check your GitHub connection and try again.");
      }
    })();
    if (!mutation) this.pending.set(key, request);
    try { return await request; } finally { if (this.pending.get(key) === request) this.pending.delete(key); }
  }
}

export const githubGateway = new GithubGateway();

const PR_FIELDS = `number title url state isDraft headRepositoryOwner { login } baseRefName headRefName headRefOid mergeable closedAt additions deletions updatedAt reviewDecision mergeStateStatus commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100) { totalCount nodes { __typename ... on CheckRun { name status conclusion detailsUrl createdAt startedAt completedAt checkSuite { databaseId app { databaseId slug } workflowRun { workflow { name } } } } ... on StatusContext { context state createdAt targetUrl } } } } } } }`;
export function githubPrQuery(host: string, owner: string, name: string, heads: readonly string[], numbers: readonly number[] = [], historical = true): string[] {
  const aliases = [...heads.map((head, i) => `h${i}: pullRequests(first:100, headRefName:${JSON.stringify(head)}, states:[${historical ? "OPEN,CLOSED,MERGED" : "OPEN"}]) { nodes { ${PR_FIELDS} } }`), ...numbers.map((number, i) => `p${i}: pullRequest(number:${number}) { ${PR_FIELDS} }`)];
  return ["api", "--hostname", host, "graphql", "-f", `query=query { rateLimit { cost remaining limit resetAt } repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}) { ${aliases.join(" ")} } }`];
}
export function githubPrRows(json: string): Record<string, unknown>[] {
  const data = JSON.parse(json);
  if (data.errors?.length) throw new Error("GitHub pull request data is unavailable");
  const repository = data.data?.repository;
  if (!repository || typeof repository !== "object") throw new Error("Invalid GitHub pull requests");
  return Object.values(repository).flatMap((value: any) => value?.nodes ?? (value ? [value] : [])).map((pr: any) => {
    const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
    const rows = contexts?.nodes?.map((check: any) => ({ ...check, app: check.checkSuite?.app ? { id: check.checkSuite.app.databaseId, slug: check.checkSuite.app.slug } : undefined, suiteId: check.checkSuite?.databaseId, workflowName: check.checkSuite?.workflowRun?.workflow?.name }));
    return { ...pr, statusCheckRollup: contexts ? [...rows, ...(contexts.totalCount > rows.length ? [{}] : [])] : [] };
  });
}
