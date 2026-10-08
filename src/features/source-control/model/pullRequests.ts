import { useSyncExternalStore } from "react";
import type { GitPr } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import type { Block, Session } from "../../sessions/model/session";

export type PrLink = {
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  blockId: string;
  at: number;
  taskId?: string;
  acceptedHead?: string | null;
};
export type WorktreePr = {
  cwd: string;
  pr: GitPr;
  links: PrLink[];
  verifiedAt: number;
  unavailable?: boolean;
};
const STORAGE_KEY = "monocode.worktreePullRequests.v1";
function restore(): WorktreePr[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (entry): entry is WorktreePr =>
              typeof entry?.cwd === "string" &&
              typeof entry?.pr?.url === "string" &&
              prUrls(entry.pr.url).some(
                (url) => url.toLowerCase() === entry.pr.url.toLowerCase(),
              ) &&
              typeof entry.pr.title === "string" &&
              ["open", "merged", "closed"].includes(entry.pr.state) &&
              Number.isSafeInteger(entry?.pr?.number) &&
              entry.pr.number > 0 &&
              Array.isArray(entry?.links) &&
              entry.links.every(
                (link: PrLink) =>
                  link &&
                  typeof link.sessionId === "string" &&
                  typeof link.sessionTitle === "string" &&
                  typeof link.turnId === "string" &&
                  typeof link.blockId === "string" &&
                  Number.isFinite(link.at) &&
                  link.at > 0 &&
                  link.at <= 8.64e15,
              ) &&
              Number.isFinite(entry.verifiedAt),
          )
          .map((entry) => ({ ...entry, unavailable: true }))
      : [];
  } catch {
    return [];
  }
}
let records: readonly WorktreePr[] = restore();
const deletedSessions = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => records;
export const usePullRequests = () =>
  useSyncExternalStore(subscribe, snapshot, snapshot);
export const pullRequests = snapshot;
export const prIdentity = (url: string) => url.toLowerCase();

function publish(next: readonly WorktreePr[]) {
  records = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Keep this window's verified state. */
  }
  for (const listener of listeners) listener();
}

/** Only forge-verified records enter the list; association anchors never move on refresh. */
export function recordPullRequest(cwd: string, pr: GitPr, link?: PrLink) {
  if (link && deletedSessions.has(link.sessionId)) link = undefined;
  const index = records.findIndex(
    (entry) =>
      pathKey(entry.cwd) === pathKey(cwd) &&
      prIdentity(entry.pr.url) === prIdentity(pr.url),
  );
  const old = records[index];
  const links = old?.links ?? [];
  const existing =
    link &&
    links.find(
      (item) =>
        item.sessionId === link.sessionId && item.taskId === link.taskId,
    );
  const nextLinks = !link
    ? links
    : existing
      ? links.map((item) =>
          item === existing
            ? {
                ...item,
                ...(link.acceptedHead !== undefined
                  ? { acceptedHead: link.acceptedHead }
                  : {}),
              }
            : item,
        )
      : [...links, link];
  const next = {
    cwd,
    pr,
    links: nextLinks,
    verifiedAt: Date.now(),
    unavailable: false,
  };
  if (index < 0) publish([...records, next]);
  else publish(records.map((entry, i) => (i === index ? next : entry)));
}

/** Keep forge/worktree history while preventing late refreshes from restoring deleted chats. */
export function forgetSessionPullRequests(sessionId: string) {
  deletedSessions.add(sessionId);
  publish(
    records.map((entry) => ({
      ...entry,
      links: entry.links.filter((link) => link.sessionId !== sessionId),
    })),
  );
}

export function setTaskPrAcceptance(
  taskId: string,
  url: string,
  acceptedHead: string | null,
) {
  let changed = false;
  const next = records.map((entry) => {
    if (prIdentity(entry.pr.url) !== prIdentity(url)) return entry;
    const links = entry.links.map((link) => {
      if (link.taskId !== taskId || link.acceptedHead === acceptedHead)
        return link;
      changed = true;
      return { ...link, acceptedHead };
    });
    return { ...entry, links };
  });
  if (changed) publish(next);
}

export function markPullRequestUnavailable(cwd: string, url: string) {
  const old = records.find(
    (entry) =>
      pathKey(entry.cwd) === pathKey(cwd) &&
      prIdentity(entry.pr.url) === prIdentity(url),
  );
  if (old && !old.unavailable)
    publish(
      records.map((entry) =>
        entry === old ? { ...entry, unavailable: true } : entry,
      ),
    );
}

export function relevantPullRequests(prs: readonly GitPr[]): GitPr[] {
  const rank = (pr: GitPr) =>
    pr.state === "open" ? (pr.isDraft ? 1 : 0) : pr.state === "merged" ? 2 : 3;
  return [...new Map(prs.map((pr) => [prIdentity(pr.url), pr])).values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.updatedAt ?? b.closedAt ?? "").localeCompare(
        a.updatedAt ?? a.closedAt ?? "",
      ) ||
      b.number - a.number,
  );
}

export function worktreePullRequests(cwd: string, entries = records): GitPr[] {
  return relevantPullRequests(
    entries
      .filter((entry) => pathKey(entry.cwd) === pathKey(cwd))
      .map((entry) => entry.pr),
  );
}

export function pullRequestReady(entry: WorktreePr): boolean {
  const { pr } = entry;
  return (
    !entry.unavailable &&
    pr.state === "open" &&
    !pr.isDraft &&
    (pr.checksStatus === "success" || pr.checksStatus === "none") &&
    pr.mergeable === "MERGEABLE" &&
    pr.mergeStateStatus === "CLEAN" &&
    pr.reviewDecision !== "CHANGES_REQUESTED" &&
    pr.reviewDecision !== "REVIEW_REQUIRED"
  );
}

export function pullRequestLabel(entry: WorktreePr): string {
  if (entry.pr.state === "merged") return "Merged";
  if (entry.pr.state === "closed") return "Closed";
  if (entry.unavailable) return "Status unavailable";
  if (entry.pr.isDraft) return "Draft";
  if (pullRequestReady(entry)) return "Ready to merge";
  if (entry.pr.checksStatus === "failure") return "Checks failed";
  if (entry.pr.reviewDecision === "CHANGES_REQUESTED")
    return "Changes requested";
  if (entry.pr.mergeable === "CONFLICTING") return "Conflicts";
  return "Open";
}

export function prUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const value of text.match(/https:\/\/[^\s<>"'`]+/g) ?? []) {
    try {
      const url = new URL(value.replace(/[),.;\]}]+$/, ""));
      const web = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(url.pathname);
      const api =
        /^\/(?:api\/v3\/)?repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)(?:\/|$)/.exec(
          url.pathname,
        );
      const match = web ?? api;
      if (
        !match ||
        !Number.isSafeInteger(Number(match[3])) ||
        Number(match[3]) < 1 ||
        url.username ||
        url.password
      )
        continue;
      const host = url.hostname === "api.github.com" ? "github.com" : url.host;
      urls.add(`https://${host}/${match[1]}/${match[2]}/pull/${match[3]}`);
    } catch {
      /* Agent text may contain incomplete URLs while streaming. */
    }
  }
  return [...urls];
}

export function sessionPrCandidates(
  session: Session,
): { url: string; cwd: string; link: PrLink }[] {
  const found = new Map<string, { url: string; cwd: string; link: PrLink }>();
  let turn: Block | undefined;
  for (const block of session.blocks) {
    if (block.role === "user") turn = block;
    if (!turn || block.streaming || !["assistant", "tool"].includes(block.role)) continue;
    const text = [
      block.text,
      block.tool?.title,
      block.tool?.detail,
      block.tool?.preview?.output,
      ...(block.tool?.preview?.lines?.map((line) => line.text) ?? []),
      ...(block.agentRun?.steps?.flatMap((step) => [
        step.text,
        step.detail,
        step.preview?.output,
      ]) ?? []),
    ]
      .filter(Boolean)
      .join("\n");
    for (const url of prUrls(text))
      if (!found.has(url))
        found.set(url, {
          url,
          cwd: session.worktreeCwd || session.cwd,
          link: {
            sessionId: session.id,
            sessionTitle: session.title,
            turnId: turn.id,
            blockId: block.id,
            at: block.sentAt ?? turn.startedAt ?? Date.now(),
          },
        });
  }
  return [...found.values()];
}

export function sessionPrAttention(entries: readonly WorktreePr[]) {
  return entries.filter(pullRequestReady).flatMap((entry) =>
    entry.links
      .filter((link) => !link.taskId)
      .map((link) => ({
        key: `session-pr:${link.sessionId}:${entry.pr.url}`,
        id: link.sessionId,
        project: entry.cwd,
        kind: "ready" as const,
        notificationId: `${entry.pr.url}:${entry.pr.headOid ?? ""}`,
        sourceLabel: `${link.sessionTitle} · ${entry.cwd.split(/[\\/]/).pop()}`,
        question: `PR #${entry.pr.number}: ${entry.pr.title}`,
      })),
  );
}
