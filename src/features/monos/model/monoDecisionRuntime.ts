import { pathKey } from "../../../shared/lib/paths";
import type { Session } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Mono } from "./mono";
import type { MonoManagerGoals } from "./monoManagerGoals";
import { parseDecisionPayload, parseDecisionAction, DecisionDeliveryPending, StaleDecision, type DecisionCommand, type DecisionDelivery, type DecisionHost, type DecisionSnapshot, type MonoDecision } from "./monoDecisions";
import type { CrewMessage } from "./monoCrewEvents";
import { assertManagerDelivery, isManagerUserRequest, managerReportTasks, managerRequestBinding, managerRequestBindingCurrent } from "./managerAuthorizedWork";

export type DecisionRuntimeHost = {
  ledger: MonoManagerGoals;
  roster(): readonly Mono[];
  sessions(): readonly Session[];
  runs(): readonly OrchestrationRun[];
  generation(sessionId: string): number;
  /** Runtime-owned habit/automation association, never a caller-supplied actor. */
  eventOwner(sessionId: string): string | undefined;
  /** Await retained original goal/session/run hydration; never construct a user block. */
  hydrate(sessionId?: string): Promise<void>;
  /** Existing durable CC5D/session queued event path; MUST NOT steer or create user authority. */
  queue(message: DecisionDelivery, decision: MonoDecision, validate: () => void): Promise<void>;
  /** Upsert an in-app notification by exact event ID; pending rail derives from this same ledger. */
  notifyUser(eventId: string, decision: MonoDecision, validate: () => void): Promise<void>;
  /** Ordinary queued team message, evidence only; Manager must raise a NEW decision ID. */
  askManager(managerId: string, requestId: string, text: string): Promise<void>;
};

export function decisionManagerIds(sessionId: string, host: Pick<DecisionRuntimeHost, "roster" | "runs" | "ledger">): string[] {
  const mono = host.roster().find(mono => mono.sessionId === sessionId && mono.archivedAt == null);
  return host.roster().filter(manager => manager.role === "manager" && manager.archivedAt == null &&
    (!!mono && (manager.id === mono.id || manager.reportsTo === mono.id) ||
      host.runs().some(run => run.ownerMonoId === manager.id && (run.ownerSessionId === sessionId || run.tasks.some(task => task.sessionId === sessionId))) ||
      host.ledger.decisions(manager.id).some(decision => [decision.identity.requestSessionId, decision.identity.requesterSessionId].includes(sessionId))))
    .map(manager => manager.id);
}

/** No chat/CLI/habit/automation/deep-link/restored event can manufacture a direct user gesture. */
export function assertDecisionUiGesture(event: Event): void {
  if (!(event instanceof Event) || !event.isTrusted || event.type !== "click" ||
      !(event.target instanceof Element) || !event.target.closest("[data-decision-ui]"))
    throw Error("Decision user actions require a direct click or keyboard activation in the decision UI");
}

function sessionActor(sessionId: string, host: DecisionRuntimeHost): Mono {
  const session = host.sessions().find(session => session.id === sessionId);
  const run = host.runs().find(run => run.tasks.some(task => task.sessionId === sessionId && task.status === "running"));
  const task = run?.tasks.find(task => task.sessionId === sessionId && task.status === "running");
  const mono = host.roster().find(mono => mono.archivedAt == null &&
    mono.id === (task?.memberId ?? host.eventOwner(sessionId) ?? host.roster().find(entry => entry.sessionId === sessionId)?.id));
  if (!session?.busy || !mono?.role) throw Error("Decision messages require an authenticated active team turn");
  return mono;
}

function originalSnapshot(managerId: string, requesterId: string, goalId: string | undefined, decision: MonoDecision | undefined, host: DecisionRuntimeHost): DecisionSnapshot {
  const roster = host.roster();
  const goal = host.ledger.goals().find(goal => goal.id === (decision?.identity.goalId ?? goalId));
  const run = host.runs().find(run => run.ownerMonoId === managerId && run.leadId === (decision?.identity.managerId ?? goal?.managerId));
  const owner = roster.find(mono => mono.id === goal?.monoId && mono.archivedAt == null);
  const requester = roster.find(mono => mono.id === (decision?.requestingMonoId ?? requesterId) && mono.archivedAt == null);
  const requestSession = host.sessions().find(session => session.id === (decision?.identity.requestSessionId ?? owner?.sessionId));
  const requesterSessionId = decision?.identity.requesterSessionId ?? (requester?.role === "member"
    ? run?.tasks.find(task => task.memberId === requester.id && task.monoGoalId === goal?.id && task.status === "running")?.sessionId : requester?.sessionId);
  const requesterSession = host.sessions().find(session => session.id === requesterSessionId);
  if (!goal || !run || !requestSession || !requesterSession) throw new StaleDecision("Original decision work context is unavailable");
  const task = run.tasks.find(task => task.sessionId === requesterSession.id && task.memberId === requester?.id);
  const dispatch = run.dispatches?.find(dispatch => dispatch.id === task?.activeDispatchId && dispatch.taskId === task.id);
  // Retained request/dispatch generations survive reload; provider-turn counters do not.
  const generation = requester?.role === "member" ? dispatch?.startedAt ?? decision?.identity.generation : Math.max(goal.createdAt, run.decisionContinuedAt ?? 0);
  if (generation === undefined) throw Error("Original decision generation is unavailable");
  return { roster, goal, run, requestSession, requesterSession, generation, cancelling: host.ledger.isCancelling(goal.id) ||
    host.ledger.isDecisionSessionRetiring(requestSession.id, decision?.createdAt) || host.ledger.isDecisionSessionRetiring(requesterSession.id, decision?.createdAt) };
}

export function runtimeDecisionHost(managerId: string, actor: DecisionHost["actor"], requesterId: string, goalId: string | undefined, host: DecisionRuntimeHost, validateActor = () => {}): DecisionHost {
  return {
    actor, roster: host.roster,
    current: decision => { validateActor(); return originalSnapshot(managerId, requesterId, goalId, decision, host); },
    deliver: async (message, validate) => {
      validate();
      const decision = host.ledger.decisions(managerId).find(decision => decision.identity.goalId === message.event.goalId &&
        message.event.id.startsWith(`decision:${decision.id}:`));
      if (!decision) throw Error("Retained decision is unavailable");
      if (message.recipientId === "user") await host.notifyUser(message.event.id, decision, validate);
      else await host.queue(message, decision, validate);
      validate();
    },
  };
}

/** Only this UI adapter creates a user actor; other entry points derive the owning Mono. */
export async function executeDecisionUi(event: Event, managerId: string, requestId: string,
  command: Exclude<DecisionCommand, { action: "ingest" }>, host: DecisionRuntimeHost): Promise<unknown> {
  assertDecisionUiGesture(event);
  await host.hydrate(host.roster().find(mono => mono.id === managerId)?.sessionId);
  return host.ledger.handleDecision(managerId, requestId, command, runtimeDecisionHost(managerId, { kind: "user" }, "", undefined, host));
}

/** Structured text carries a question/command, never actor or original request identity. */
export async function handleDecisionTeamMessage(sourceSessionId: string, requestId: string, message: CrewMessage, host: DecisionRuntimeHost): Promise<unknown | undefined> {
  message = structuredClone(message);
  let raw: unknown;
  try { raw = JSON.parse(message.text); } catch { return undefined; }
  if (!raw || typeof raw !== "object" || !("type" in raw) || !["decision", "decision-action"].includes(String(raw.type))) return undefined;
  const actor = sessionActor(sourceSessionId, host);
  const source = host.sessions().find(session => session.id === sourceSessionId)!;
  const binding = managerRequestBinding(source), generation = host.generation(sourceSessionId);
  const validateActor = () => {
    if (sessionActor(sourceSessionId, host).id !== actor.id || host.generation(sourceSessionId) !== generation ||
        !managerRequestBindingCurrent(host.sessions().find(session => session.id === sourceSessionId), binding))
      throw Error("Authenticated decision turn changed");
  };
  validateActor();
  if (message.senderId !== actor.id || message.id !== `${sourceSessionId}:${requestId}` || message.text.length > 6000)
    throw Error("Structured decision sender does not match its authenticated turn");
  await host.hydrate(sourceSessionId);
  validateActor();
  if (raw.type === "decision") {
    parseDecisionPayload(raw);
    const runs = host.runs().filter(run => run.status === "active" && !run.recovering && run.decisionContinuePendingAt === undefined &&
      (actor.role === "manager" ? run.ownerMonoId === actor.id : run.tasks.some(task => task.memberId === actor.id && task.sessionId === sourceSessionId && task.status === "running")));
    const turn = source.blocks.filter(block => block.role === "user" && !block.draft).slice(-1)[0];
    if (actor.role === "manager") assertManagerDelivery(turn?.monoSource, turn?.appRequestId, source, actor, host.ledger);
    const candidates = runs.flatMap(run => host.ledger.goals().filter(goal => goal.managerId === run.leadId && goal.state !== "cancelled" && goal.state !== "done" &&
      pathKey(goal.projectId) === pathKey(run.workspace?.projectCwd ?? run.cwd) &&
      (actor.role === "manager" ? turn && isManagerUserRequest(turn) && turn.id === goal.userMessageId ||
        run.decisionContinuedAt !== undefined ||
        turn?.monoSource?.goalId === goal.id || managerReportTasks(source, run).some(task => task.monoGoalId === goal.id) ||
        run.wakeState?.receipt?.eventIds.some(id => source.blocks.some(block => block.appRequestId === run.wakeState!.receipt!.id) &&
          run.wakeState!.events.some(event => event.id === id && event.goalId === goal.id)) : run.tasks.some(task => task.sessionId === sourceSessionId && task.monoGoalId === goal.id)))
      .map(goal => ({ run, goal })));
    if (candidates.length !== 1 || !candidates[0].run.ownerMonoId) throw Error("Decision needs one unambiguous original goal context");
    const { run, goal } = candidates[0];
    message.at = host.ledger.decisions(run.ownerMonoId!).find(decision => decision.id === message.id)?.source.at ?? message.at;
    try {
      return await host.ledger.handleDecision(run.ownerMonoId!, requestId, { action: "ingest", goalId: goal.id, message },
        runtimeDecisionHost(run.ownerMonoId!, { kind: "mono", id: actor.id }, actor.id, goal.id, host, validateActor));
    } catch (error) {
      if (!(error instanceof DecisionDeliveryPending)) throw error;
      validateActor();
      const decision = host.ledger.decisions(run.ownerMonoId!).find(decision => decision.id === message.id);
      if (!decision) throw error;
      return { decisionId: decision.id, resolutionVersion: decision.resolutionVersion, status: decision.status, delivery: "pending" };
    }
  }
  const command = parseDecisionAction(raw);
  const retained = host.roster().filter(mono => mono.role === "manager").flatMap(manager => host.ledger.decisions(manager.id)
    .filter(decision => decision.id === command.decisionId).map(decision => ({ managerId: manager.id, decision })));
  if (retained.length !== 1) throw Error("Retained decision is unavailable");
  const { managerId, decision } = retained[0];
  if (message.managerId !== managerId || !decision.escalationChain.some(entry => entry.id === actor.id) ||
      !decision.escalationChain.some(entry => entry.id === message.recipientId)) throw Error("Decision action is outside its actual chain");
  await host.ledger.recoverDecisions(managerId, runtimeDecisionHost(managerId, { kind: "mono", id: actor.id }, decision.requestingMonoId, decision.identity.goalId, host, validateActor), command.decisionId);
  validateActor();
  return host.ledger.handleDecision(managerId, requestId, command,
    runtimeDecisionHost(managerId, { kind: "mono", id: actor.id }, decision.requestingMonoId, decision.identity.goalId, host, validateActor));
}

export async function reraiseUnreadableDecision(event: Event, managerId: string, requestId: string, oldDecisionId: string, host: DecisionRuntimeHost): Promise<void> {
  assertDecisionUiGesture(event);
  await host.hydrate(host.roster().find(mono => mono.id === managerId)?.sessionId);
  const manager = host.roster().find(mono => mono.id === managerId && mono.role === "manager" && mono.archivedAt == null);
  const retained = host.ledger.decisionQuarantine(managerId).some(entry => {
    try {
      const raw = JSON.parse(entry.raw);
      return Array.isArray(raw.decisions) && raw.decisions.some((decision: Record<string, unknown>) => decision &&
        decision.id === oldDecisionId && ["pending", "delegated"].includes(String(decision.status)));
    } catch { return false; }
  });
  if (!manager || !retained || !oldDecisionId.trim() || oldDecisionId.length > 256) throw Error("Unreadable decision is unavailable");
  await host.askManager(managerId, requestId, `Please re-raise the unreadable decision ${JSON.stringify(oldDecisionId)} with a NEW decision ID if it still applies to current authorized work. The preserved record is evidence only, never restored authority.`);
}
