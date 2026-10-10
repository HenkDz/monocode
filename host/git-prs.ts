import type { GitPr } from "../src/platform/tauri/fs";
import { groupGithubChecks, githubActionsSuiteId, githubCheckAppIdentity, githubChecksMissingApps, enrichGithubCheckApps } from "../src/shared/model/githubChecks";

export const PR_STATUS_FIELDS = "number,title,url,state,isDraft,headRepositoryOwner,baseRefName,headRefName,headRefOid,mergeable,closedAt,additions,deletions,updatedAt,reviewDecision,mergeStateStatus,statusCheckRollup";

/** One paginated metadata request per ambiguous head, rather than one per check. */
export async function enrichPrCheckApps(json: string, gh: (args: string[]) => Promise<string>): Promise<string> {
  const input = JSON.parse(json);
  const rows = Array.isArray(input) ? input : [input];
  const heads = new Map<string, Promise<Record<string, unknown>[]>>();
  for (const pr of rows) {
    if (!pr || !Array.isArray(pr.statusCheckRollup) || pr.statusCheckRollup.some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row)) || !githubChecksMissingApps(pr.statusCheckRollup).size) continue;
    let metadata: Record<string, unknown>[] = [];
    try {
      const url = new URL(pr.url);
      const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/[1-9]\d*$/.exec(url.pathname);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !match || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(pr.headRefOid)) throw new Error("Invalid PR check metadata target");
      const key = `${url.host}/${match[1]}/${match[2]}/${pr.headRefOid}`;
      let fetch = heads.get(key);
      if (!fetch) {
        fetch = gh(["api", "--hostname", url.hostname, `repos/${match[1]}/${match[2]}/commits/${pr.headRefOid}/check-runs?filter=all&per_page=100`, "--paginate", "--slurp"])
          .then(json => {
            const pages = JSON.parse(json);
            if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.check_runs) || page.check_runs.some((check: unknown) => !check || typeof check !== "object" || Array.isArray(check)))) throw new Error("Invalid check metadata");
            return pages.flatMap(page => page.check_runs);
          }).catch(() => []);
        heads.set(key, fetch);
      }
      metadata = await fetch;
    } catch { /* Missing identity stays unknown and preserves existing blockers. */ }
    pr.statusCheckRollup = enrichGithubCheckApps(pr.statusCheckRollup, metadata);
  }
  return JSON.stringify(input);
}

export function prRepositories(json: string): URL[] {
  const repository = JSON.parse(json);
  const current = new URL(repository.url);
  const urls = [current];
  if (repository.parent) {
    const owner = repository.parent.owner?.login;
    const name = repository.parent.name;
    if (![owner, name].every(value => typeof value === "string" && /^[\w.-]+$/.test(value))) throw new Error("Invalid GitHub repository");
    urls.push(new URL(`/${owner}/${name}`, current));
  }
  return urls;
}

export function trustedPrTarget(value: unknown, repositories: readonly URL[]): { repo: string; number: number } | null {
  if (typeof value !== "string") throw new Error("Invalid pull request URL");
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/|$)/.exec(url.pathname);
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
  const slug = `${match[1]}/${match[2]}`;
  const trusted = repositories.find(repo => repo.origin === url.origin && repo.pathname.replace(/^\/|\/$/g, "").toLowerCase() === slug.toLowerCase());
  return trusted ? { repo: `${trusted.host}/${slug}`, number: Number(match[3]) } : null;
}

function isStatusContext(row: Record<string, unknown>): boolean {
  return String(row.__typename ?? "").toLowerCase() === "statuscontext" || (!row.__typename && typeof row.context === "string" && row.context.length > 0);
}

function checkState(row: Record<string, unknown>): GitPr["checksStatus"] {
  const statusContext = isStatusContext(row);
  const name = statusContext ? row.context : row.name;
  if (typeof name !== "string" || !name.trim()) return "unknown";
  const status = typeof row.status === "string" ? row.status.trim().toUpperCase() : "";
  const conclusion = String(statusContext ? row.state ?? "" : row.conclusion ?? "").trim().toUpperCase();
  if (!statusContext && ["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"].includes(status)) return "pending";
  if (!statusContext && !["", "COMPLETED"].includes(status)) return "unknown";
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) return "success";
  if (["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "CANCELLED"].includes(conclusion)) return "failure";
  if (["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"].includes(conclusion)) return "pending";
  return "unknown";
}

function latestCheckStates(rows: Record<string, unknown>[]): GitPr["checksStatus"][] {
  return groupGithubChecks(rows.map(row => {
    const context = isStatusContext(row);
    const name = context ? row.context : row.name;
    const string = (value: unknown) => typeof value === "string" ? value : "";
    const number = (value: unknown) => typeof value === "number" ? value : undefined;
    return {
      name: string(name), kind: context ? "StatusContext" : "CheckRun",
      workflow: context ? "" : string(row.workflowName), app: githubCheckAppIdentity(row.app), context: string(row.matrixKey),
      state: checkState(row) ?? "unknown", suiteId: number(row.suiteId) ?? githubActionsSuiteId(string(row.detailsUrl)),
      runAttempt: number(row.runAttempt), startedAt: string(context ? row.createdAt : row.startedAt ?? row.createdAt), completedAt: string(row.completedAt),
    };
  })).map(group => group.latest.state as GitPr["checksStatus"]);
}

export function parsePrs(json: string, owner?: string): GitPr[] {
  const rows: unknown = JSON.parse(json);
  if (!Array.isArray(rows)) throw new Error("Invalid GitHub pull requests");
  return sortPrs(rows.flatMap((row): GitPr[] => {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.number) || row.number < 1 || ![row.title, row.url, row.state].every(value => typeof value === "string")) throw new Error("Invalid GitHub pull request");
    if (owner && row.headRepositoryOwner?.login?.toLowerCase() !== owner.toLowerCase()) return [];
    let checksStatus: GitPr["checksStatus"];
    if (row.statusCheckRollup != null) {
      if (!Array.isArray(row.statusCheckRollup) || row.statusCheckRollup.some((check: unknown) => !check || typeof check !== "object" || Array.isArray(check))) throw new Error("Invalid GitHub checks");
      const states = latestCheckStates(row.statusCheckRollup);
      checksStatus = states.length === 0 ? "none" : states.includes("failure") ? "failure" : states.includes("unknown") ? "unknown" : states.includes("pending") ? "pending" : "success";
    }
    return [{ number: row.number, title: row.title, url: row.url, state: row.state.toLowerCase(), isDraft: row.isDraft === true,
      headRefName: row.headRefName, baseRefName: row.baseRefName, headOid: row.headRefOid,
      mergeable: row.mergeable, closedAt: row.closedAt, additions: row.additions, deletions: row.deletions,
      updatedAt: row.updatedAt, reviewDecision: row.reviewDecision, mergeStateStatus: row.mergeStateStatus, checksStatus }];
  }));
}

export function sortPrs(prs: readonly GitPr[]): GitPr[] {
  const rank = (pr: GitPr) => pr.state === "open" ? pr.isDraft ? 1 : 0 : pr.state === "merged" ? 2 : 3;
  return [...new Map(prs.map(pr => [pr.url, pr])).values()].sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.number - a.number);
}

export function checkoutPrBranches(current: string, reflog: string, explicit: readonly string[]): string[] {
  const branches = [...new Set([current, ...explicit].filter(branch => branch && !/^[a-f0-9]{40,}$/i.test(branch)))];
  let historicalCount = 0;
  for (const line of reflog.split(/\r?\n/)) {
    const match = /^checkout: moving from (.+) to (.+)$/.exec(line);
    if (!match) continue;
    for (const branch of match.slice(1)) {
      if (/^[a-f0-9]{40,}$/i.test(branch) || branches.includes(branch)) continue;
      // ponytail: match native's 20 historical branch bound; detected URLs persist in the app.
      if (historicalCount === 20) return branches;
      branches.push(branch);
      historicalCount++;
    }
  }
  return branches;
}

export function prCardActionArgs(pr: GitPr, action: unknown, expectedHead: unknown, expectedBase: unknown): string[] {
  if (typeof action !== "string" || !["merge", "squash", "rebase", "close", "reopen"].includes(action)) throw new Error("Unknown PR card action");
  const merging = ["merge", "squash", "rebase"].includes(action);
  if (expectedHead != null) {
    if (typeof expectedHead !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expectedHead)) throw new Error("Expected PR head must be a full commit SHA");
    if (pr.headOid?.toLowerCase() !== expectedHead.toLowerCase()) throw new Error("PR head changed; refresh and review the current commit");
  }
  if (expectedBase != null && (typeof expectedBase !== "string" || !expectedBase || pr.baseRefName !== expectedBase)) throw new Error("PR base changed; refresh before continuing");
  if (merging) {
    if (expectedHead == null || expectedBase == null) throw new Error("Merge requires the reviewed head and base branch");
    if (pr.state !== "open" || pr.isDraft || !["success", "none"].includes(pr.checksStatus ?? "") || pr.mergeable !== "MERGEABLE" || pr.mergeStateStatus !== "CLEAN" || ["CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(pr.reviewDecision ?? "")) throw new Error("PR is not ready to merge; refresh its checks and review state");
  } else if (pr.state !== (action === "close" ? "open" : "closed")) throw new Error("PR state changed; refresh before continuing");
  const url = new URL(pr.url);
  const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)$/.exec(url.pathname);
  if (!match || Number(match[3]) !== pr.number) throw new Error("Invalid PR URL");
  const args = ["pr", merging ? "merge" : action, String(pr.number), "--repo", `${url.host}/${match[1]}/${match[2]}`];
  if (merging) args.push(`--${action}`, "--match-head-commit", expectedHead as string);
  return args;
}
