import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  gitPrStatus,
  gitPrList,
  gitPrStatusByUrl,
  subscribeGitChanged,
  type GitPr,
} from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { githubPollingAllowed, refreshGithubBudget } from "../../inbox/model/githubBudget";
import {
  recordPullRequest,
  worktreePullRequests,
  usePullRequests,
  relevantPullRequests,
} from "../model/pullRequests";

// Shared by worktree icons, manager attention, and cards. A failed read must
// not erase the last known state or pretend that a ready PR was closed.
let cache: ReadonlyMap<string, GitPr | null> = new Map();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();
const snapshot = () => cache;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const prStatusKey = (cwd: string, branch?: string | null) =>
  `${pathKey(cwd)}\n${branch ?? ""}`;
export const usePrStatusCache = () =>
  useSyncExternalStore(subscribe, snapshot, snapshot);

async function load(
  cwd: string,
  branch?: string | null,
  prUrl?: string,
  automatic = false,
): Promise<void> {
  const key = prStatusKey(cwd, prUrl ?? branch);
  if (!githubPollingAllowed()) return;
  const known = cache.get(key);
  if (automatic && known && known.state !== "open") return;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const query = async () => {
    if (prUrl) return gitPrStatusByUrl(cwd, prUrl);
    try {
      const prs = await gitPrList(cwd, branch ? [branch] : undefined);
      for (const pr of prs) recordPullRequest(cwd, pr);
      return relevantPullRequests(prs)[0] ?? null;
    } catch {
      return gitPrStatus(cwd);
    }
  };
  const request = query()
    .then((pr) => {
      // Native lookup also returns null when GitHub is unavailable. Do not
      // resurrect a merged/closed PR as "unknown" after a transient failure.
      if (pr === null && cache.has(key)) return;
      if (pr) recordPullRequest(cwd, pr);
      cache = new Map(cache).set(key, pr);
      for (const listener of listeners) listener();
    })
    .catch(() => {})
    .finally(() => {
      inFlight.delete(key);
      void refreshGithubBudget();
    });
  inFlight.set(key, request);
  return request;
}

/** Also refresh accepted worktrees currently folded out of the sidebar. */
export function usePrStatuses(
  targets: readonly { cwd: string; branch?: string | null; prUrl?: string }[],
) {
  const keys = JSON.stringify(
    targets
      .filter((t) => t.cwd && t.cwd !== "~" && (t.branch || t.prUrl))
      .map((t) => [t.cwd, t.branch, t.prUrl]),
  );
  const reload = useCallback((automatic = false) => {
    for (const [cwd, branch, prUrl] of JSON.parse(keys) as [
      string,
      string | undefined,
      string | undefined,
    ][])
      void load(cwd, branch, prUrl, automatic);
  }, [keys]);
  useEffect(() => {
    reload();
    const resume = () => {
      if (!document.hidden) reload(true);
    };
    const unsubscribe = subscribeGitChanged(() => reload());
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [reload]);
  return { statuses: usePrStatusCache(), reload };
}

export function usePrStatus(
  cwd: string,
  branch: string | null | undefined,
  enabled = true,
): { pr: GitPr | null; prs: GitPr[]; reload: () => void } {
  const { statuses, reload } = usePrStatuses(enabled ? [{ cwd, branch }] : []);
  const entries = usePullRequests();
  const prs = enabled ? worktreePullRequests(cwd, entries) : [];
  const cached = enabled
    ? (statuses.get(prStatusKey(cwd, branch)) ?? null)
    : null;
  const all = relevantPullRequests([...(cached ? [cached] : []), ...prs]);
  return {
    pr: all[0] ?? null,
    prs: all,
    reload,
  };
}
