import { pathKey } from "../../../shared/lib/paths";
import { assertDecisionUiGesture, type MonoDecision } from "../../monos/model/monoDecisions";
import type { GoalViewInput } from "./goalView";

export type GoalNextStep = {
  goalId: string; projectId: string; managerMonoId: string; managerId: string; sessionId: string;
  action: "open" | "continue" | "start"; label: string; revision: string;
};

/** A request to the existing Manager, never permission to dispatch or approve work. */
export function selectGoalNextAction(input: GoalViewInput, goalId: string, decisions: readonly MonoDecision[] = []): GoalNextStep | undefined {
  const goal = input.goals.find(goal => goal.id === goalId && !goal.archived && !["done", "cancelled", "ready"].includes(goal.state));
  if (!goal) return;
  const run = input.runs.find(run => run.leadId === goal.managerId && run.projectManager &&
    pathKey(run.cwd) === pathKey(goal.projectId) && ["active", "paused"].includes(run.status) && !run.recovering);
  const manager = run && input.roster.find(mono => mono.role === "manager" && mono.archivedAt == null &&
    (run.ownerMonoId ? mono.id === run.ownerMonoId : mono.managerEngineId === run.leadId) && mono.projects.some(project => pathKey(project) === pathKey(goal.projectId)));
  if (!run || !manager) return;
  const tasks = run.tasks.filter(task => task.monoGoalId === goal.id);
  if (run.managerTurnId || run.tasks.some(task => ["running", "cancelling"].includes(task.status))) return;
  const session = input.sessions.find(session => session.id === (run.ownerSessionId ?? run.leadId));
  if (!session || manager.sessionId && manager.sessionId !== session.id || session.busy) return;
  const pending = tasks.filter(task => task.status === "queued");
  const sources = [session, ...input.sessions.filter(session => pending.some(task => task.sessionId === session.id))];
  if (sources.some(session => session.busy)) return;
  const approval = sources.find(session => session.pendingQuestion || session.blocks.some(block => block.approval && !block.approval.decided));
  const decision = decisions.find(decision => decision.status === "waiting" && decision.answererId === "user" && !decision.readOnly && decision.noLongerNeededAt == null &&
    pathKey(decision.projectId) === pathKey(goal.projectId) && (decision.goalId === goal.id || tasks.some(task => task.id === decision.taskId)));
  const target = approval?.id ?? (decision ? session.id : undefined);
  if (!target && (session.codexStorageError || session.codexStoragePreparing || session.usageLimit || session.pendingSwitch || session.worktreeRemoved || session.worktreePreparing ||
    session.queuedMessages?.length || session.pendingMonoEvents?.length || session.queueStatus === "paused")) return;
  if (!target && !pending.length && tasks.length) return;
  const action = target ? "open" : run.status === "paused" ? "continue" : "start";
  return { goalId: goal.id, projectId: goal.projectId, managerMonoId: manager.id, managerId: run.leadId, sessionId: target ?? session.id, action,
    label: target ? "Waiting for your approval — Open" : action === "continue" ? "Manager paused — Continue" : "Next task hasn't started — Start",
    revision: JSON.stringify([goal.id, goal.state, goal.updatedAt, run.status, run.workspace, session.id, session.cwd, session.worktreeCwd, session.providerAccountId, action, target,
      decision?.id, approval?.pendingQuestion?.requestId, approval?.blocks.filter(block => block.approval && !block.approval.decided).map(block => block.id),
      tasks.map(task => [task.id, task.status, task.activeDispatchId, task.lastDispatchId, task.accepted])]) };
}

export type GoalActionHost = {
  read(): GoalNextStep | undefined;
  open(sessionId: string): Promise<unknown>;
  continueManager(managerId: string): Promise<void>;
  startGoal?(goalId: string): Promise<void>;
  pending: Set<string>; accepted: Set<string>;
};

export async function runGoalNextAction(event: Event, step: GoalNextStep, host: GoalActionHost): Promise<void> {
  assertDecisionUiGesture(event);
  const current = () => {
    if (host.read()?.revision !== step.revision) throw Error("This goal changed. Open its Manager to review the next step.");
  };
  current();
  if (step.action === "open") { await host.open(step.sessionId); return; }
  const key = `goal:${step.revision}`;
  if (host.pending.has(key) || host.accepted.has(key)) throw Error("This request has already been sent to the Manager.");
  host.pending.add(key);
  try {
    if (step.action === "continue") await host.continueManager(step.managerId);
    else {
      await host.open(step.sessionId);
      current();
      if (!host.startGoal) throw Error("Open the original Manager request to start this goal.");
      await host.startGoal(step.goalId);
    }
    host.accepted.add(key);
  } finally { host.pending.delete(key); }
}
