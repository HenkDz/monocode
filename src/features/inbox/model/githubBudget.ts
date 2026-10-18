import { invokeWorkspace } from "../../../platform/tauri/fs";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { useEffect, useSyncExternalStore } from "react";

export type GithubApiBudget = {
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
  resource: string | null;
  status: "unknown" | "ok" | "low" | "exhausted";
  calls: number;
  points: number;
  paths: Record<string, { calls: number; points: number }>;
};
let budget: GithubApiBudget = {
  remaining: null, limit: null, resetAt: null, resource: null,
  status: "unknown", calls: 0, points: 0, paths: {},
};
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
let contextCwd: string | undefined;
let contextGeneration = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const snapshot = () => budget;
const budgetContext = (cwd?: string) => cwd?.startsWith(REMOTE_PATH_PREFIX) ? cwd : undefined;
export function setGithubBudgetContext(cwd?: string) {
  const context = budgetContext(cwd);
  if (context === contextCwd) return;
  contextCwd = context;
  contextGeneration++;
  pending = null;
  setGithubBudget({ remaining: null, limit: null, resetAt: null, resource: null, status: "unknown", calls: 0, points: 0, paths: {} });
}
export function setGithubBudget(next: GithubApiBudget) {
  budget = next;
  for (const listener of listeners) listener();
}
export function refreshGithubBudget(): Promise<void> {
  if (pending) return pending;
  const generation = contextGeneration;
  const cwd = contextCwd;
  const request = Promise.resolve().then(() => invokeWorkspace<GithubApiBudget>("github_api_budget", cwd ? { cwd } : undefined))
    .then(next => { if (generation === contextGeneration && next?.status) setGithubBudget(next); })
    .catch(() => {})
    .finally(() => { if (pending === request) pending = null; });
  pending = request;
  return pending;
}
export function githubLimited(now = Date.now()) {
  return budget.status === "exhausted" &&
    (!budget.resetAt || !Number.isFinite(Date.parse(budget.resetAt)) || Date.parse(budget.resetAt) > now);
}
export function githubPollingAllowed() {
  return !document.hidden && !githubLimited() && budget.status !== "low";
}
export function githubResetTime(resetAt = budget.resetAt) {
  return resetAt && Number.isFinite(Date.parse(resetAt))
    ? new Date(resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
}
export function githubLimitMessage() {
  const reset = githubResetTime();
  return `GitHub rate limit reached · showing last known data${reset ? ` · resets at ${reset}` : ""}`;
}
export function githubLowBudgetMessage() {
  const reset = githubResetTime();
  return `GitHub API budget is low · updates paused${reset ? ` · resets at ${reset}` : ""}`;
}
export function githubErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/rate.?limit|api.*limit.*exceed|secondary.*limit|abuse.*detect/i.test(message)) return message;
  if (budget.status === "low" && message.startsWith("GitHub rate limit reached")) return githubLowBudgetMessage();
  return githubLimitMessage();
}
export function noteGithubError(error: unknown, cwd?: string) {
  const message = githubErrorMessage(error);
  const raw = error instanceof Error ? error.message : String(error);
  if (/rate.?limit|api.*limit.*exceed|secondary.*limit|abuse.*detect/i.test(raw)) {
    if ((cwd === undefined || budgetContext(cwd) === contextCwd) && !(budget.status === "low" && raw.startsWith("GitHub rate limit reached")))
      setGithubBudget({ ...budget, remaining: 0, status: "exhausted" });
    void refreshGithubBudget();
  }
  return message;
}
export function useGithubBudget(cwd?: string) {
  const next = useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, snapshot, snapshot);
  useEffect(() => {
    if (cwd !== undefined) setGithubBudgetContext(cwd);
    void refreshGithubBudget();
  }, [cwd]);
  useEffect(() => {
    if (!timer) timer = setInterval(() => void refreshGithubBudget(), 30_000);
    return () => {
      if (!listeners.size) { clearInterval(timer); timer = undefined; }
    };
  }, []);
  const limited = githubLimited();
  return { ...next, limited, paused: limited || next.status === "low", message: next.status === "low" ? githubLowBudgetMessage() : githubLimitMessage() };
}
