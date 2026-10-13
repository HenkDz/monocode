import { pathKey } from "../../../shared/lib/paths";
import { canAcceptManagerWake } from "../../orchestration/model/managerWake";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Block, Session } from "../../sessions/model/session";
import type { Mono } from "./mono";
import type { GoalOrigin, ManagerGoalHost, ManagerProject, MonoManagerGoal, MonoManagerGoals } from "./monoManagerGoals";
import { sameProviderAccountId } from "../../providers/model/providerAccounts";
import { codexStorageAccountId } from "./monoCodexStorageIssues";

export const MANAGER_CONFIRMATION = "This request needs your one-click confirmation. Choose Continue this request on the original request; do not repeat it or reassign projects.";
export type ManagerRequestRecovery = {
  monoId: string;
  sessionId: string;
  managerId: string;
  projectId: string;
  userMessageId: string;
  providerAccountId?: string;
  binding?: ReturnType<typeof managerRequestBinding>;
  state: "pending" | "continued" | "cancelled";
};

export const managerRequestBinding = (session: Session) => ({
  harness: session.harness, cwd: session.cwd, worktreeCwd: session.worktreeCwd ?? null,
  providerAccountId: session.providerAccountId ?? null, codexStorageHome: session.codexStorageHome ?? null,
  codexStorageAccountId: session.harness === "codex" ? codexStorageAccountId(session) : null,
  runtimeMode: session.runtimeMode, readOnly: session.readOnly === true, windowsSandbox: session.windowsSandbox ?? null,
});

export function managerRequestBindingCurrent(session: Session | undefined, binding: ManagerRequestRecovery["binding"]) {
  return !!session && !!binding && binding.harness === session.harness && binding.cwd === session.cwd &&
    binding.worktreeCwd === (session.worktreeCwd ?? null) &&
    Object.prototype.hasOwnProperty.call(binding, "providerAccountId") && sameProviderAccountId(binding.providerAccountId ?? undefined, session.providerAccountId) &&
    binding.codexStorageHome === (session.codexStorageHome ?? null) &&
    binding.codexStorageAccountId === (session.harness === "codex" ? codexStorageAccountId(session) : null) &&
    (session.harness !== "codex" || typeof binding.codexStorageHome === "string" && !!binding.codexStorageHome) &&
    binding.runtimeMode === session.runtimeMode && binding.readOnly === (session.readOnly === true) &&
    binding.windowsSandbox === (session.windowsSandbox ?? null) &&
    !session.codexHomeThreadsUnresolved && !session.codexStorageError && !session.codexStoragePreparing &&
    !session.codexStorageReturnChoice && !session.codexStorageHeld && !session.pendingSwitch &&
    !session.worktreePreparing && !session.worktreeRemoved && !session.pendingQuestion && !session.usageLimit &&
    !session.blocks.some(block => block.approval && !block.approval.decided);
}

export function managerRequestState(request: ManagerRequestRecovery, goals: readonly MonoManagerGoal[], isCancelling = (_id: string) => false) {
  return goals.some(goal => goal.monoId === request.monoId && goal.managerId === request.managerId &&
    goal.projectId === request.projectId && goal.userMessageId === request.userMessageId &&
    (goal.state === "cancelled" || isCancelling(goal.id))) ? "cancelled" : request.state;
}

export const isManagerUserRequest = (block: Block) => block.role === "user" && !block.draft &&
  !block.internal && !block.appRequestId && !block.monoSource && !block.monoSessionCompletion && !!block.text.trim();

export function assertManagerRequest(manager: Mono, project: ManagerProject, block: Block) {
  if (manager.role !== "manager" || manager.archivedAt != null || !project.managerExists ||
      project.managerMonoId !== manager.id || !manager.projects.some(path => pathKey(path) === pathKey(project.folder)) ||
      !isManagerUserRequest(block)) throw Error("A registered Manager and an original user request are required");
}

/** Only dispatch IDs from the app's retained digest receipt confer report authority. */
export function managerReportTasks(session: Session, run?: OrchestrationRun) {
  const turn = session.blocks.filter(block => block.role === "user" && !block.draft).slice(-1)[0];
  const receipt = run?.wakeState?.receipt;
  if (!run || !receipt || turn?.appRequestId !== receipt.id) return [];
  return receipt.eventIds.flatMap(id => {
    const event = run.wakeState!.events.find(event => event.id === id);
    const dispatch = run.dispatches?.find(dispatch => dispatch.id === event?.dispatchId && dispatch.taskId === event.taskId);
    const task = run.tasks.find(task => task.id === dispatch?.taskId && task.monoGoalId === event?.goalId);
    return task && task.status !== "cancelled" ? [task] : [];
  });
}

export async function managerDelegateGoal(input: {
  manager: Mono; project: ManagerProject; session: Session; origin?: GoalOrigin;
  run?: OrchestrationRun; ledger: MonoManagerGoals; goalId?: unknown; reviewTaskId?: unknown;
  persist(): Promise<unknown>; validate(): void;
}): Promise<string | undefined> {
  const { manager, project, session, origin, ledger, run } = input;
  input.validate();
  if (!session.busy || !origin) throw Error(MANAGER_CONFIRMATION);
  const turn = session.blocks.filter(block => block.role === "user" && !block.draft).slice(-1)[0];
  await ledger.hydrate(manager.id);
  input.validate();
  const reports = managerReportTasks(session, run);
  const controlled = turn?.monoSource && turn.appRequestId ? ledger.goals().filter(goal =>
    goal.id === turn.monoSource!.goalId && goal.monoId === turn.monoSource!.id).map(goal => goal.id) : [];
  const allowed = [...new Set([...controlled, ...reports.flatMap(task => task.monoGoalId ? [task.monoGoalId] : [])])];
  let goalId = input.goalId;
  if (origin.kind === "user" && turn && isManagerUserRequest(turn) && !controlled.length) {
    assertManagerRequest(manager, project, turn);
    await input.persist();
    input.validate();
    const goal = await ledger.anchorManagerRequest(manager, project, turn);
    input.validate();
    if (goalId != null && goalId !== goal.id) throw Error("Goal does not belong to this request");
    goalId = goal.id;
  } else if (origin.kind === "event") {
    if (input.reviewTaskId != null && !reports.some(task => task.id === input.reviewTaskId) &&
        !run?.tasks.some(task => task.id === input.reviewTaskId && task.monoGoalId && allowed.includes(task.monoGoalId)))
      throw Error(MANAGER_CONFIRMATION);
    if (goalId == null && allowed.length === 1) goalId = allowed[0];
    if (goalId == null && input.reviewTaskId != null && reports.some(task => task.id === input.reviewTaskId)) return;
    if (goalId == null || !allowed.includes(String(goalId))) throw Error(MANAGER_CONFIRMATION);
  } else if (goalId == null && allowed.length === 1) goalId = allowed[0];
  if (goalId != null && !ledger.goals().some(goal => goal.id === goalId && goal.managerId === project.managerId &&
      goal.projectId === project.id && goal.state !== "cancelled" && !ledger.isCancelling(goal.id)))
    throw Error("Goal does not belong to this Manager or is cancelled");
  return goalId == null ? undefined : String(goalId);
}

export function managerRecoveryRequest(session: Session, run?: OrchestrationRun): Block | undefined {
  const tasks = managerReportTasks(session, run);
  const ids = [...new Set(tasks.flatMap(task => task.managerTurnBlockId ? [task.managerTurnBlockId] : []))];
  if (ids.length > 1) return;
  return ids.length ? session.blocks.find(block => block.id === ids[0] && isManagerUserRequest(block)) : undefined;
}

export function appendManagerRecovery(session: Session, recovery: ManagerRequestRecovery): Session {
  const id = `manager-request-${recovery.userMessageId}`;
  if (session.blocks.some(block => block.id === id)) return session;
  return { ...session, blocks: [...session.blocks, { id, role: "system", text: MANAGER_CONFIRMATION, managerRequestRecovery: recovery }] };
}

export const canContinueManagerRequest = (session: Session) => canAcceptManagerWake(session) &&
  session.queueStatus !== "paused" && !session.sendingQueuedMessageId && !session.editingQueuedMessageId;

export function assertManagerContinuation(request: ManagerRequestRecovery, session: Session | undefined, manager: Mono | undefined, ledger: MonoManagerGoals) {
  const retained = session?.blocks.find(block => block.id === `manager-request-${request.userMessageId}`)?.managerRequestRecovery;
  if (!session || !manager || session.id !== request.sessionId || manager.id !== request.monoId || manager.sessionId !== session.id ||
      manager.role !== "manager" || manager.archivedAt != null || JSON.stringify(retained) !== JSON.stringify(request) ||
      request.state !== "pending" || !sameProviderAccountId(session.providerAccountId, request.providerAccountId) ||
      !managerRequestBindingCurrent(session, request.binding) ||
      managerRequestState(request, ledger.goals(), id => ledger.isCancelling(id)) !== "pending" ||
      !canContinueManagerRequest(session) || session.blocks.filter(isManagerUserRequest).slice(-1)[0]?.id !== request.userMessageId)
    throw Error("This request changed or is held; open its Manager conversation before continuing");
}

export async function resumeManagerRequest(request: ManagerRequestRecovery, host: {
  session(): Session | undefined;
  manager(): Mono | undefined;
  project(): Promise<ManagerProject | undefined>;
  ledger: MonoManagerGoals;
  goals: ManagerGoalHost;
  save(change: (session: Session) => Session): Promise<unknown>;
}) {
  const blockId = `manager-request-${request.userMessageId}`;
  const original = host.session()?.blocks.find(block => block.id === request.userMessageId && isManagerUserRequest(block));
  const validate = () => {
    const session = host.session(), manager = host.manager();
    assertManagerContinuation(request, session, manager, host.ledger);
    if (!original || session!.blocks.find(block => block.id === original.id && isManagerUserRequest(block))?.text !== original.text)
      throw Error("This request changed or is held; open its Manager conversation before continuing");
  };
  validate();
  const project = await host.project();
  validate();
  if (!project || project.id !== request.projectId || project.managerId !== request.managerId || !original)
    throw Error("The original request's registered project is unavailable");
  const goal = await host.ledger.anchorManagerRequest(host.manager()!, project, original);
  validate();
  const receipt = `continue-${request.userMessageId}`;
  await host.ledger.handle(request.monoId, { kind: "user", messageId: original.id }, receipt, "goals.message",
    { goalId: goal.id, text: original.text }, { ...host.goals, deliver: async (goal, text, receipt, cancel) => {
      validate(); await host.goals.deliver(goal, text, receipt, cancel, validate);
    } });
  await host.save(session => ({ ...session, blocks: session.blocks.map(block => block.id === blockId && block.managerRequestRecovery?.state === "pending"
    ? { ...block, managerRequestRecovery: { ...request, state: "continued" } } : block) }));
}

let continueRequest: ((request: ManagerRequestRecovery) => Promise<void>) | undefined;
const pendingRequests = new Set<string>();
export function registerManagerRequestContinuation(callback: NonNullable<typeof continueRequest>) {
  continueRequest = callback;
  return () => { if (continueRequest === callback) continueRequest = undefined; };
}
export async function continueManagerRequest(request: ManagerRequestRecovery) {
  if (!continueRequest) throw Error("Open the original Manager conversation to continue");
  const key = `${request.sessionId}:${request.userMessageId}`;
  if (pendingRequests.has(key)) throw Error("This request is already being continued");
  pendingRequests.add(key);
  try { await continueRequest(request); } finally { pendingRequests.delete(key); }
}
