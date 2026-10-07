import { findMono, monoForSession } from "./mono";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

export const memberDetailsView = (id: string) => `mono-member:${id}`;
export function monoForView(id: string | null | undefined) {
  if (!id) return undefined;
  if (id.startsWith("mono-member:")) {
    const mono = findMono(id.slice("mono-member:".length));
    return mono?.role === "member" ? mono : undefined;
  }
  return monoForSession(id);
}

/** Standalone views participate in the same project-return memory as panes. */
export function monoViewProject(id: string | null | undefined): string | undefined {
  const mono = monoForView(id);
  return mono?.role === "manager" || mono?.role === "member"
    ? mono.managerProject ?? mono.projects[0] : undefined;
}

export function memberTasks(runs: readonly OrchestrationRun[], memberId: string) {
  return runs.flatMap(run => run.tasks.filter(task => task.memberId === memberId).map((task, index) => ({
    task, order: index, started: Math.max(0, ...(run.dispatches ?? []).filter(dispatch => dispatch.taskId === task.id).map(dispatch => dispatch.startedAt)),
  }))).sort((a, b) => b.started - a.started || b.order - a.order).map(entry => entry.task);
}

/** Exactly one org row owns a visible chat/worker/details view. */
export function selectedOrgMono(sessionId: string | undefined, viewId: string | null, _runs: readonly OrchestrationRun[]) {
  const mono = monoForView(viewId) ?? (sessionId ? monoForSession(sessionId) : undefined);
  if (mono) return mono.id;
  // A worker is a different pane from the member's durable chat.
  return undefined;
}

export function loadMonoView(windowLabel: string): string | null {
  try {
    const id = localStorage.getItem(`monocode:mono-view:${windowLabel}`);
    return monoForView(id) ? id : null;
  } catch { return null; }
}

export function saveMonoView(windowLabel: string, id: string | null) {
  try {
    const key = `monocode:mono-view:${windowLabel}`;
    if (id && monoForView(id)) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch { /* Storage may be unavailable; navigation still works. */ }
}
