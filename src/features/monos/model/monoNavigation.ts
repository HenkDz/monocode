import { findMono, monoForSession, monoState, type Mono, type MonoState } from "./mono";
import type { Session } from "../../sessions/model/session";
import { orgDescendants, teamDecisions } from "./monoTeamActivity";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
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

/** A saved worker keeps its dispatch's status and worktree after the task is retried. */
export type WorkbenchSessionTask = OrchestrationTask & { historical?: boolean };
export function workbenchSessionTask(runs: readonly OrchestrationRun[], sessionId: string): WorkbenchSessionTask | undefined {
  const current = runs.flatMap(run => run.tasks).find(task => task.sessionId === sessionId && task.memberId);
  if (current) return current;
  for (const run of runs) {
    const dispatch = run.dispatches?.find(entry => entry.sessionId === sessionId);
    const task = dispatch && run.tasks.find(entry => entry.id === dispatch.taskId && entry.memberId);
    if (!dispatch || !task) continue;
    const status = dispatch.state === "starting" ? "queued"
      : dispatch.state === "start_unknown" || dispatch.state === "stop_unknown" ? "interrupted" : dispatch.state;
    return {
      ...task, sessionId, workspace: dispatch.workspace, status,
      historical: true, prompt: "", result: dispatch.result ?? "",
      checkoutBaseline: dispatch.checkoutBaseline,
      reportArtifactId: undefined, reviewArtifactId: undefined,
      reviewVerdict: undefined, prSummaryArtifactId: undefined, prUrl: undefined,
      readOnly: undefined, readOnlyFallback: undefined,
      error: dispatch.error ?? dispatch.cleanupError,
      accepted: !!task.accepted && task.acceptedDispatchId === dispatch.id,
      activeDispatchId: undefined, lastDispatchId: dispatch.id,
    };
  }
}

export function memberMonoState(runs: readonly OrchestrationRun[], memberId: string, sessions: readonly Session[], memberSessionId?: string): MonoState {
  const tasks = memberTasks(runs, memberId);
  const task = tasks.find(t => ["queued", "running", "cancelling"].includes(t.status)) ?? tasks[0];
  const run = task && runs.find(run => run.tasks.includes(task));
  const session = sessions.find(s => s.id === memberSessionId);
  const workerSession = sessions.find(s => s.id === task?.sessionId);
  const own = session && monoState({ ...session, codexStorageError: session.codexStorageError ?? workerSession?.codexStorageError });
  const worker = monoState(workerSession, { task, tasks: run?.tasks ?? tasks, runStatus: run?.status, pauseReason: run?.lastPauseReason });
  if (own?.status === "needs-you" || worker.status === "needs-you") return own?.status === "needs-you" ? own : worker;
  if (own && (session?.busy || own.status === "blocked" || !task && own.liveState?.status !== "idle")) return own;
  return worker;
}

/** Own work controls the pulse; only attention rolls up from the team. */
export function monoLiveState(roster: readonly Mono[], runs: readonly OrchestrationRun[], sessions: readonly Session[], monoId: string): MonoState {
  const mono = roster.find(entry => entry.id === monoId);
  if (!mono || mono.archivedAt != null) return { status: "idle" };
  const scope = orgDescendants(roster, monoId);
  const decisions = teamDecisions(roster, sessions, runs, monoId).filter(decision => decision.owner.archivedAt == null);
  const states = roster.filter(entry => scope.has(entry.id) && entry.archivedAt == null).map(entry => {
    const session = sessions.find(value => value.id === entry.sessionId);
    const owned = runs.filter(run => run.ownerMonoId === entry.id || !!entry.sessionId && run.ownerSessionId === entry.sessionId);
    const state = entry.role === "member" ? memberMonoState(runs, entry.id, sessions, entry.sessionId) : monoState(session, {
      tasks: owned.flatMap(run => run.tasks),
      wakeStates: owned.flatMap(run => run.wakeState ? [run.wakeState] : []),
      runStatus: owned.find(run => run.status === "paused")?.status ?? owned.find(run => run.status === "active")?.status ?? owned[0]?.status,
      pauseReason: owned.find(run => run.status === "paused")?.lastPauseReason,
    });
    const decision = decisions.find(value => value.owner.id === entry.id);
    return { mono: entry, state: decision && state.status !== "needs-you" ? { ...state, status: "needs-you" as const, liveState: { status: "needs-you" as const, reason: "decision" as const, detail: decision.resume?.reason ?? state.activity }, activity: decision.resume?.reason ?? state.activity } : state };
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
      liveState: attention.state.liveState, activity: attention.state.activity } : {}),
  };
}

/** Exactly one org row owns a visible chat/worker/details view. */
export function selectedOrgMono(sessionId: string | undefined, viewId: string | null, _runs: readonly OrchestrationRun[]) {
  const mono = monoForView(viewId) ?? monoForView(sessionId);
  if (mono) return mono.id;
  return workbenchSessionTask(_runs, sessionId ?? "")?.memberId;
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
