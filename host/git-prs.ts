import type { GitPr } from "../src/platform/tauri/fs";

export const PR_STATUS_FIELDS = "number,title,url,state,isDraft,headRepositoryOwner,baseRefName,headRefName,headRefOid,mergeable,closedAt,additions,deletions,updatedAt,reviewDecision,mergeStateStatus,statusCheckRollup";

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
  const latest = new Map<string, { state: GitPr["checksStatus"]; stamp: number | undefined }>();
  const anonymous: GitPr["checksStatus"][] = [];
  const rank = (state: GitPr["checksStatus"]) => state === "failure" ? 4 : state === "unknown" ? 3 : state === "pending" ? 2 : 0;
  for (const row of rows) {
    const context = isStatusContext(row);
    const name = context ? row.context : row.name;
    const state = checkState(row);
    if (typeof name !== "string" || !name.trim()) { anonymous.push("unknown"); continue; }
    const key = JSON.stringify([context ? "StatusContext" : "CheckRun", context ? "" : row.workflowName ?? "", name]);
    const stamp = (context ? [row.createdAt] : [row.startedAt, row.createdAt, row.completedAt]).map(value => typeof value === "string" ? Date.parse(value) : NaN).find(Number.isFinite);
    const old = latest.get(key);
    // Without comparable dates, preserve a blocker rather than infer a successful rerun.
    if (!old || (stamp !== undefined && old.stamp !== undefined && stamp !== old.stamp ? stamp > old.stamp : rank(state) > rank(old.state))) latest.set(key, { stamp, state });
  }
  return [...latest.values()].map(check => check.state).concat(anonymous);
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
