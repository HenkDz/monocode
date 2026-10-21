import type { ReactNode } from "react";
import { projectKey } from "../../shared/lib/paths";
import { monoState, type Mono } from "../monos/model/mono";
import { memberTasks } from "../monos/model/monoNavigation";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import type { Session } from "../sessions/model/session";
import type { OrbitProject } from "./orbit";

/** Controlled presentation supplied by the accepted V2 selector and components. */
export type CommandMapDecisions = {
  needYou: number;
  handledToday: number;
  incomplete: boolean;
  rail: ReactNode;
  railFor?(openProject: (projectId: string) => void): ReactNode;
  project(project: string, managerId: string, openProject?: (projectId: string) => void): {
    pending: number;
    teamPending: number;
    incomplete: boolean;
    autonomy: ReactNode;
    cards: ReactNode;
    goalAction?(goalId: string): ReactNode;
  };
};

export const mapText = (text: string, limit = 220) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

export function projectGoals(project: OrbitProject, goals: readonly MonoManagerGoal[]) {
  return goals.filter(goal => !goal.archived && (!goal.projectId || projectKey(goal.projectId) === projectKey(project.project)) && (goal.managerId === project.manager.mono.managerEngineId ||
    !project.manager.mono.managerEngineId && projectKey(goal.projectId ?? "") === projectKey(project.project)))
    .sort((a, b) => Number(["done", "cancelled"].includes(a.state)) - Number(["done", "cancelled"].includes(b.state)) || b.updatedAt - a.updatedAt);
}

export function mapOwnState(mono: Mono, runs: readonly OrchestrationRun[], sessions: readonly Session[]) {
  const owned = runs.filter(run => run.ownerMonoId === mono.id || !!mono.sessionId && run.ownerSessionId === mono.sessionId);
  const paused = owned.find(run => run.status === "paused");
  return monoState(sessions.find(session => session.id === mono.sessionId), {
    tasks: owned.flatMap(run => run.tasks), runStatus: paused?.status ?? owned.find(run => run.status === "active")?.status ?? owned[0]?.status,
    pauseReason: paused?.lastPauseReason, wakeStates: owned.flatMap(run => run.wakeState ? [run.wakeState] : []),
  });
}

export function goalProgress(project: OrbitProject, goal: MonoManagerGoal | undefined, runs: readonly OrchestrationRun[]) {
  if (!goal) return undefined;
  const tasks = runs.filter(run => run.leadId === goal.managerId && (run.ownerMonoId ? run.ownerMonoId === project.manager.id :
    !!project.manager.mono.managerEngineId && run.leadId === project.manager.mono.managerEngineId) &&
    (!run.cwd || projectKey(run.cwd) === projectKey(project.project))).flatMap(run => run.tasks.filter(task => task.monoGoalId === goal.id));
  if (!tasks.length) return undefined;
  // Acceptance is recorded progress; PR readiness and worker completion are not acceptance.
  const accepted = tasks.filter(task => task.accepted && (!(task.activeDispatchId ?? task.lastDispatchId) || task.acceptedDispatchId === (task.activeDispatchId ?? task.lastDispatchId))).length;
  return { accepted, total: tasks.length, percent: Math.round(accepted * 100 / tasks.length) };
}

export function projectMemberTask(project: OrbitProject, member: Mono, runs: readonly OrchestrationRun[], sessions: readonly Session[]) {
  const owned = runs.filter(run => (run.ownerMonoId ? run.ownerMonoId === project.manager.id :
    !!project.manager.mono.managerEngineId && run.leadId === project.manager.mono.managerEngineId) &&
    (!run.cwd || projectKey(run.cwd) === projectKey(project.project)));
  const tasks = memberTasks(owned, member.id);
  const task = tasks.find(entry => ["queued", "running", "cancelling"].includes(entry.status)) ?? tasks[0];
  const run = task && owned.find(entry => entry.tasks.includes(task));
  const dispatch = task && (run?.dispatches ?? []).find(entry => entry.id === (task.activeDispatchId ?? task.lastDispatchId));
  const session = sessions.find(entry => entry.id === (dispatch?.sessionId ?? task?.sessionId));
  const own = sessions.find(entry => entry.id === member.sessionId);
  const workerState = monoState(session, { task, tasks: run?.tasks, runStatus: run?.status, pauseReason: run?.lastPauseReason, wakeStates: run?.wakeState ? [run.wakeState] : [] });
  const ownState = own && monoState({ ...own, codexStorageError: own.codexStorageError ?? session?.codexStorageError });
  const state = ownState?.status === "needs-you" ? ownState : workerState.status === "needs-you" ? workerState : ownState && ownState.liveState?.status !== "idle" ? ownState : workerState;
  const history = owned.flatMap(run => (run.dispatches ?? []).filter(dispatch => run.tasks.some(task => task.id === dispatch.taskId && task.memberId === member.id))
    .map(dispatch => ({ run, dispatch }))).sort((a, b) => b.dispatch.startedAt - a.dispatch.startedAt);
  return { task, run, dispatch, session, state, tasks, history, owned };
}
