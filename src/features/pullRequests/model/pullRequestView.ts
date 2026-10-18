import { pathKey, projectName } from "../../../shared/lib/paths";
import { monoLook, type Mono } from "../../monos/model/mono";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import {
  prIdentity,
  pullRequestLabel,
  pullRequestReady,
  type WorktreePr,
} from "../../source-control/model/pullRequests";
import type { CardSession } from "../../monos/model/monoCards";

export const PR_GROUPS = [
  "Needs you",
  "Ready to merge",
  "In progress",
  "Recently merged",
  "Closed",
] as const;
export type PullRequestGroup = (typeof PR_GROUPS)[number];
export type PullRequestScope = {
  project?: string;
  projects?: readonly string[];
  monoId?: string;
  sessionId?: string;
  cwd?: string;
  urls?: readonly string[];
};
export type PullRequestFilters = {
  search?: string;
  project?: string;
  agent?: string;
  ownership?: "mine" | "team" | "all";
  closed?: boolean;
};
export type PullRequestRow = {
  entry: WorktreePr;
  worktreeCwds: string[];
  project: string;
  projectName: string;
  author: { id: string; name: string; mascot?: string; color?: string };
  monoIds: string[];
  sessionIds: string[];
  task?: OrchestrationTask;
  busy: boolean;
  label: string;
};
export type PullRequestContext = {
  sessions?: readonly Pick<Session, "id" | "cwd" | "worktreeCwd" | "busy">[];
  runs?: readonly OrchestrationRun[];
  roster?: readonly Mono[];
  cardSessions?: ReadonlyMap<string, CardSession>;
};
export const OPEN_PULL_REQUESTS = "monocode:open-pull-requests";
export function pullRequestRepo(url: string): string {
  const parsed = new URL(url);
  const repo = parsed.pathname.split("/").slice(1, 3).join("/");
  return parsed.host === "github.com" ? repo : `${parsed.host}/${repo}`;
}
export function openPullRequests(scope: PullRequestScope = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_PULL_REQUESTS, { detail: scope }));
}

export function buildPullRequestRows(
  entries: readonly WorktreePr[],
  context: PullRequestContext = {},
): PullRequestRow[] {
  const { sessions = [], runs = [], roster = [], cardSessions } = context;
  const rows = new Map<string, PullRequestRow>();
  for (const entry of entries) {
    const linked = sessions.filter((session) =>
      entry.links.some((link) => link.sessionId === session.id),
    );
    const run = runs.find((run) =>
      run.tasks.some(
        (task) =>
          entry.links.some((link) => link.taskId === task.id) ||
          (task.prUrl && prIdentity(task.prUrl) === prIdentity(entry.pr.url)),
      ),
    );
    const task = run?.tasks.find(
      (task) =>
        entry.links.some((link) => link.taskId === task.id) ||
        (task.prUrl && prIdentity(task.prUrl) === prIdentity(entry.pr.url)),
    );
    const author =
      roster.find((mono) => mono.id === task?.memberId) ??
      roster.find((mono) =>
        entry.links.some((link) => link.sessionId === mono.sessionId),
      );
    const project =
      run?.workspace?.projectCwd ??
      run?.cwd ??
      linked.find(
        (session) =>
          pathKey(session.worktreeCwd ?? session.cwd) === pathKey(entry.cwd),
      )?.cwd ??
      linked[0]?.cwd ??
      author?.projects[0] ??
      entry.cwd;
    const look = author ? monoLook(author) : undefined;
    const teamLinks = entry.links.filter((link) => link.taskId);
    const label =
      pullRequestReady(entry) &&
      teamLinks.some(
        (link) => !link.acceptedHead || link.acceptedHead !== entry.pr.headOid,
      )
        ? "Awaiting team review"
        : pullRequestLabel(entry);
    const row: PullRequestRow = {
      entry,
      worktreeCwds: [entry.cwd],
      project,
      projectName: projectName(project),
      author: look
        ? {
            id: author!.id,
            name: look.name,
            mascot: look.mascot,
            color: look.color,
          }
        : task?.memberId
          ? {
              id: task.memberId,
              name: task.memberName ?? "Agent",
              mascot: task.memberMascot,
              color: task.memberColor,
            }
          : { id: "you", name: "you" },
      monoIds: [
        ...new Set(
          [author?.id, run?.ownerMonoId, task?.memberId].filter(
            (id): id is string => !!id,
          ),
        ),
      ],
      sessionIds: entry.links.map((link) => link.sessionId),
      task,
      busy:
        (task
          ? task.status === "running" ||
            task.status === "cancelling" ||
            linked.some(
              (session) => session.id === task.sessionId && session.busy,
            ) ||
            !!cardSessions?.get(task.sessionId)?.busy
          : linked.some((session) => session.busy) ||
            entry.links.some(
              (link) => cardSessions?.get(link.sessionId)?.busy,
            )) ||
        task?.delivery?.state === "fixing-ci" ||
        task?.delivery?.state === "resolving-conflicts",
      label,
    };
    const old = rows.get(prIdentity(entry.pr.url));
    if (!old) rows.set(prIdentity(entry.pr.url), row);
    else {
      const latest = entry.verifiedAt > old.entry.verifiedAt ? row : old;
      const links = [...old.entry.links, ...row.entry.links];
      const sharedEntry = { ...latest.entry, links };
      rows.set(prIdentity(entry.pr.url), {
        ...latest,
        entry: sharedEntry,
        worktreeCwds: [...new Set([...old.worktreeCwds, ...row.worktreeCwds])],
        sessionIds: [...new Set([...old.sessionIds, ...row.sessionIds])],
        monoIds: [...new Set([...old.monoIds, ...row.monoIds])],
        busy: old.busy || row.busy,
        label:
          pullRequestReady(sharedEntry) &&
          links.some(
            (link) =>
              link.taskId &&
              (!link.acceptedHead ||
                link.acceptedHead !== sharedEntry.pr.headOid),
          )
            ? "Awaiting team review"
            : latest.label,
      });
    }
  }
  return [...rows.values()];
}

export function pullRequestGroup(
  row: PullRequestRow,
  now = Date.now(),
): PullRequestGroup | null {
  const { pr } = row.entry;
  if (pr.state === "closed") return "Closed";
  if (pr.state === "merged") {
    const mergedAt = Date.parse(pr.closedAt ?? "");
    return Number.isFinite(mergedAt) &&
      mergedAt <= now &&
      mergedAt >= now - 7 * 86400000
      ? "Recently merged"
      : null;
  }
  if (row.entry.unavailable) return "In progress";
  if (
    (!row.busy &&
      (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "BLOCKED")) ||
    pr.reviewDecision === "REVIEW_REQUIRED" ||
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    row.task?.status === "blocked" ||
    (pr.checksStatus === "failure" && !row.busy)
  )
    return "Needs you";
  return row.label === "Ready to merge" ? "Ready to merge" : "In progress";
}

export function filterPullRequestRows(
  rows: readonly PullRequestRow[],
  filters: PullRequestFilters = {},
  scope: PullRequestScope = {},
) {
  const search = filters.search?.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (scope.project && pathKey(scope.project) !== pathKey(row.project))
      return false;
    if (
      scope.projects &&
      !scope.projects.some(
        (project) => pathKey(project) === pathKey(row.project),
      )
    )
      return false;
    if (scope.monoId && !row.monoIds.includes(scope.monoId)) return false;
    if (scope.sessionId && !row.sessionIds.includes(scope.sessionId))
      return false;
    if (
      scope.cwd &&
      !row.worktreeCwds.some((cwd) => pathKey(scope.cwd!) === pathKey(cwd))
    )
      return false;
    if (
      scope.urls &&
      !scope.urls.some(
        (url) => prIdentity(url) === prIdentity(row.entry.pr.url),
      )
    )
      return false;
    if (filters.project && pathKey(filters.project) !== pathKey(row.project))
      return false;
    if (
      filters.agent &&
      !row.monoIds.includes(filters.agent) &&
      row.author.id !== filters.agent
    )
      return false;
    if (filters.ownership === "mine" && row.author.id !== "you") return false;
    if (filters.ownership === "team" && row.author.id === "you") return false;
    return (
      !search ||
      [
        row.entry.pr.title,
        `#${row.entry.pr.number}`,
        row.entry.pr.headRefName,
        row.entry.pr.baseRefName,
        row.projectName,
        row.author.name,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search)
    );
  });
}

export function groupPullRequestRows(
  rows: readonly PullRequestRow[],
  filters: PullRequestFilters = {},
  scope: PullRequestScope = {},
  now = Date.now(),
) {
  const groups = PR_GROUPS.filter(
    (group) => group !== "Closed" || filters.closed || scope.urls,
  ).map((label) => ({ label, rows: [] as PullRequestRow[] }));
  for (const row of filterPullRequestRows(rows, filters, scope)) {
    const label =
      scope.urls && row.entry.pr.state === "merged"
        ? "Recently merged"
        : pullRequestGroup(row, now);
    groups.find((group) => group.label === label)?.rows.push(row);
  }
  for (const group of groups)
    group.rows.sort(
      (a, b) =>
        (b.entry.pr.updatedAt ?? b.entry.pr.closedAt ?? "").localeCompare(
          a.entry.pr.updatedAt ?? a.entry.pr.closedAt ?? "",
        ) || b.entry.pr.number - a.entry.pr.number,
    );
  return groups;
}

export function pullRequestAttention(rows: readonly PullRequestRow[]) {
  return rows
    .filter((row) => pullRequestGroup(row) === "Ready to merge")
    .map((row) => ({
      key: `pr:${prIdentity(row.entry.pr.url)}`,
      id:
        row.entry.links.find((link) => link.taskId)?.sessionId ??
        row.entry.links[0]?.sessionId ??
        "",
      project: row.project,
      kind: "ready" as const,
      notificationId: `${row.entry.pr.url}:${row.entry.pr.headOid ?? ""}`,
      sourceLabel: `${row.author.name} · ${row.projectName}`,
      question: `PR #${row.entry.pr.number}: ${row.entry.pr.title}`,
      urls: [row.entry.pr.url],
    }));
}
