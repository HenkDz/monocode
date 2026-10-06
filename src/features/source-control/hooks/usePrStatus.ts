import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  gitPrStatus,
  subscribeGitChanged,
  type GitPr,
} from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";

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

async function load(cwd: string, branch?: string | null): Promise<void> {
  const key = prStatusKey(cwd, branch);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = gitPrStatus(cwd)
    .then((pr) => {
      // Native lookup also returns null when GitHub is unavailable. Do not
      // resurrect a merged/closed PR as "unknown" after a transient failure.
      if (pr === null && cache.has(key)) return;
      cache = new Map(cache).set(key, pr);
      for (const listener of listeners) listener();
    })
    .catch(() => {})
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/** Also refresh accepted worktrees currently folded out of the sidebar. */
export function usePrStatuses(
  targets: readonly { cwd: string; branch?: string | null }[],
) {
  const keys = JSON.stringify(
    targets
      .filter((t) => t.cwd && t.cwd !== "~" && t.branch)
      .map((t) => [t.cwd, t.branch]),
  );
  const reload = useCallback(() => {
    for (const [cwd, branch] of JSON.parse(keys) as [string, string][])
      void load(cwd, branch);
  }, [keys]);
  useEffect(() => {
    reload();
    const resume = () => {
      if (!document.hidden) reload();
    };
    const unsubscribe = subscribeGitChanged(resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      unsubscribe();
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
): { pr: GitPr | null; reload: () => void } {
  const { statuses, reload } = usePrStatuses(enabled ? [{ cwd, branch }] : []);
  return {
    pr: enabled ? (statuses.get(prStatusKey(cwd, branch)) ?? null) : null,
    reload,
  };
}
