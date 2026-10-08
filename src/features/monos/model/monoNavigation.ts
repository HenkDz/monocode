import { findMono, monoForSession, monoState, type Mono, type MonoStatus, type MonoState } from "./mono";
import type { Session } from "../../sessions/model/session";
import { activityTaskEvent, orgDescendants, teamDecisions } from "./monoTeamActivity";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { projectName } from "../../../shared/lib/paths";

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
  const attention = new Set(sessions.filter(s => monoState(s).status === "needs-you").map(s => s.id));
  const busy = new Set(sessions.filter(s => monoState(s).status === "working").map(s => s.id));
  const status = memberAvailability(tasks, attention, busy, memberSessionId);
  const task = tasks.find(t => ["queued", "running", "cancelling"].includes(t.status)) ?? tasks[0];
  const session = sessions.find(s => s.id === memberSessionId);
  const own = session && monoState(session);
  const activity = own?.status === status && own.activity ? own.activity : task ? activityTaskEvent(task, sessions.find(s => s.id === task.sessionId)) : undefined;
  return { status, ...(status !== "idle" && activity ? { activity } : {}) };
}

/** Own work controls the pulse; only attention rolls up from the team. */
export function monoLiveState(roster: readonly Mono[], runs: readonly OrchestrationRun[], sessions: readonly Session[], monoId: string): MonoState {
  const mono = roster.find(entry => entry.id === monoId);
  if (!mono || mono.archivedAt != null) return { status: "idle" };
  const scope = orgDescendants(roster, monoId);
  const decisions = teamDecisions(roster, sessions, runs, monoId).filter(decision => decision.owner.archivedAt == null);
  const states = roster.filter(entry => scope.has(entry.id) && entry.archivedAt == null).map(entry => {
    const session = sessions.find(value => value.id === entry.sessionId);
    const state = entry.role === "member" ? memberMonoState(runs, entry.id, sessions, entry.sessionId) : session ? monoState(session) : { status: "idle" as const };
    const decision = decisions.find(value => value.owner.id === entry.id);
    return { mono: entry, state: decision ? { ...state, status: "needs-you" as const, activity: decision.resume?.reason ?? state.activity } : state };
  });
  const own = states.find(entry => entry.mono.id === monoId)!.state;
  const below = states.filter(entry => entry.mono.id !== monoId);
  const teamWorking = below.filter(entry => entry.state.status === "working").length;
  const attention = own.status === "needs-you" ? undefined : below.find(entry => entry.state.status === "needs-you");
  const decision = attention && decisions.find(entry => entry.owner.id === attention.mono.id);
  const location = attention && (decision?.project ?? attention.mono.managerProject ?? attention.mono.projects[0]);
  return {
    ...own,
    ...(teamWorking ? { teamWorking } : {}),
    ...(attention ? { status: "needs-you", attentionLocation: location ? projectName(location) : attention.mono.name ?? attention.mono.id,
      activity: attention.state.activity } : {}),
  };
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
