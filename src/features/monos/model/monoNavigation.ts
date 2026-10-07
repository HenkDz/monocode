import { findMono, monoForSession, type MonoStatus, type MonoState } from "./mono";
import type { Session } from "../../sessions/model/session";
import { activityTaskEvent } from "./monoTeamActivity";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

export const memberDetailsView = (id: string) => `mono-member:${id}`;
export function monoForView(id: string | null | undefined) {
  if (!id) return undefined;
  if (id.startsWith("mono-member:")) {
    const mono = findMono(id.slice("mono-member:".length));
    return mono?.role === "member" && mono.archivedAt == null ? mono : undefined;
  }
  const mono = monoForSession(id);
  return mono?.archivedAt == null ? mono : undefined;
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

/** Current work wins over historical failures; completed work is no longer busy. */
export function memberAvailability(
  tasks: ReturnType<typeof memberTasks>,
  attention: ReadonlySet<string> = new Set(),
  busy: ReadonlySet<string> = new Set(),
  memberSessionId?: string,
): MonoStatus {
  const active = tasks.filter(task => ["queued", "running", "cancelling"].includes(task.status));
  const current = active.length ? active : tasks.slice(0, 1);
  if ((memberSessionId && attention.has(memberSessionId)) || current.some(task =>
    attention.has(task.sessionId) || ["blocked", "failed", "interrupted"].includes(task.status),
  )) return "needs-you";
  if ((memberSessionId && busy.has(memberSessionId)) || current.some(task =>
    busy.has(task.sessionId) || ["running", "cancelling"].includes(task.status),
  )) return "working";
  return "idle";
}

export function memberMonoState(runs: readonly OrchestrationRun[], memberId: string, sessions: readonly Session[], memberSessionId?: string): MonoState {
  const tasks = memberTasks(runs, memberId);
  const attention = new Set(sessions.filter(s => s.pendingQuestion || s.blocks.some(b => b.approval && !b.approval.decided)).map(s => s.id));
  const busy = new Set(sessions.filter(s => s.busy).map(s => s.id));
  const status = memberAvailability(tasks, attention, busy, memberSessionId);
  const task = tasks.find(t => ["queued", "running", "cancelling"].includes(t.status)) ?? tasks[0];
  return { status, ...(status !== "idle" && task ? { activity: activityTaskEvent(task, sessions.find(s => s.id === task.sessionId)) } : {}) };
}

/** Exactly one org row owns a visible chat/worker/details view. */
export function selectedOrgMono(sessionId: string | undefined, viewId: string | null, _runs: readonly OrchestrationRun[]) {
  const mono = monoForView(viewId) ?? monoForView(sessionId);
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
