import { pathKey } from "../../../shared/lib/paths";
import { assertDecisionUiGesture, type MonoDecision } from "../../monos/model/monoDecisions";
import { canContinueManagerRequest, isManagerUserRequest, managerRequestBindingCurrent, type ManagerRequestRecovery } from "../../monos/model/managerAuthorizedWork";
import type { GoalViewInput } from "./goalView";

export type GoalNextStep = {
  goalId: string; projectId: string; managerMonoId: string; managerId: string; sessionId: string;
  action: "open" | "continue" | "start" | "chat"; label: string; revision: string;
  key: string; message?: string; request?: ManagerRequestRecovery; decisionId?: string;
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
  const approvalBlock = approval?.blocks.find(block => block.approval && !block.approval.decided);
  const decision = approval ? undefined : decisions.find(decision => decision.status === "waiting" && decision.answererId === "user" && !decision.readOnly && decision.noLongerNeededAt == null &&
    pathKey(decision.projectId) === pathKey(goal.projectId) && (decision.goalId === goal.id || tasks.some(task => task.id === decision.taskId)));
  const target = approval?.id ?? (decision ? session.id : undefined);
  if (!target && !pending.length && tasks.length) return;
  const safe = !session.codexStorageError && !session.codexStoragePreparing && !session.usageLimit && !session.pendingSwitch && !session.worktreeRemoved && !session.worktreePreparing;
  const request = session.blocks.map(block => block.managerRequestRecovery).find(request => request?.state === "pending" && request.sessionId === session.id && request.monoId === manager.id && request.monoId === goal.monoId &&
    request.managerId === goal.managerId && pathKey(request.projectId) === pathKey(goal.projectId) && request.userMessageId === goal.userMessageId &&
    input.goals.filter(candidate => candidate.monoId === request.monoId && candidate.userMessageId === request.userMessageId && candidate.managerId === request.managerId).length === 1 &&
    session.blocks.filter(isManagerUserRequest).slice(-1)[0]?.id === request.userMessageId && canContinueManagerRequest(session) && managerRequestBindingCurrent(session, request.binding));
  const action = target ? "open" : run.status === "paused" && safe ? "continue" : request ? "start" : "chat";
  const key = action === "continue" ? `${run.leadId}:continue` : action === "start" ? `manager-request:${session.id}:${request!.userMessageId}`
    : decision ? `decision:${manager.id}:${decision.id}` : approval ? approval.pendingQuestion ? `${approval.id}:question:${approval.pendingQuestion.requestId}` : `${approval.id}:approval:${approvalBlock?.approval?.requestId}` : `goal:${goal.id}:chat`;
  return { goalId: goal.id, projectId: goal.projectId, managerMonoId: manager.id, managerId: run.leadId, sessionId: target ?? session.id, action,
    key, request: action === "start" ? request : undefined, decisionId: decision?.id,
    label: target ? "Waiting for your approval — Open" : action === "continue" ? "Manager paused — Continue" : action === "start" ? "Next task hasn't started — Start" : "Open Manager chat",
    message: action === "chat" ? "Next task hasn't started. Ask the Manager to continue." : undefined,
    revision: JSON.stringify([goal.id, goal.monoId, goal.managerId, goal.projectId, goal.userMessageId, goal.state, goal.updatedAt, manager.id, run.status, run.workspace, session.id, session.cwd, session.worktreeCwd, session.providerAccountId,
      session.blocks.filter(block => block.role === "user" && !block.draft).slice(-1)[0]?.id, action, target, request,
      decision?.id, approval?.pendingQuestion?.requestId, approval?.blocks.filter(block => block.approval && !block.approval.decided).map(block => block.id),
      tasks.map(task => [task.id, task.status, task.activeDispatchId, task.lastDispatchId, task.accepted])]) };
}

export type GoalActionHost = {
  read(): GoalNextStep | undefined;
  open(sessionId: string): Promise<unknown>;
  openDecision?(decisionId: string): void;
  continueManager(managerId: string): Promise<void>;
  continueRequest(request: ManagerRequestRecovery): Promise<void>;
  pending: Set<string>; accepted: Set<string>;
};

export const distinctGoalNextActions = (steps: readonly GoalNextStep[]) => [...new Map(steps.map(step => [step.key, step])).values()];

export async function runGoalNextAction(event: Event, step: GoalNextStep, host: GoalActionHost): Promise<void> {
  assertDecisionUiGesture(event);
  const current = () => {
    if (host.read()?.revision !== step.revision) throw Error("This goal changed. Open its Manager to review the next step.");
  };
  current();
  if (step.action === "open" || step.action === "chat") {
    if (step.decisionId && host.openDecision) host.openDecision(step.decisionId);
    else await host.open(step.sessionId);
    return;
  }
  const key = `goal:${step.revision}`;
  const pendingKey = step.action === "continue" ? `continue:${step.managerId}` : key;
  if (host.pending.has(pendingKey) || host.accepted.has(key)) throw Error("This request has already been sent to the Manager.");
  host.pending.add(pendingKey);
  try {
    if (step.action === "continue") await host.continueManager(step.managerId);
    else {
      current();
      if (!step.request) throw Error("Open the original Manager request to start this goal.");
      await host.continueRequest(step.request);
    }
    host.accepted.add(key);
  } finally { host.pending.delete(pendingKey); }
}
