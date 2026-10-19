import { managerRequestBinding, managerRequestBindingCurrent, isManagerUserRequest } from "./managerAuthorizedWork";
import type { Mono } from "./mono";
import type { CrewMessage } from "./monoCrewEvents";
import type { GoalLedger, MonoManagerGoal } from "./monoManagerGoals";
import type { Session } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { ManagerWakeEvent } from "../../orchestration/model/managerWake";
import { pathKey } from "../../../shared/lib/paths";

export type ProjectAutonomy = "high-impact-only" | "medium-and-up" | "everything";
export type DecisionLevel = "manager" | "boss" | "user";
export type DecisionPayload = {
  version: 1;
  type: "decision";
  question: string;
  impact: "low" | "med" | "high";
  context: string;
  options: { id: string; label: string }[];
  recommendedOptionId?: string;
  operation: "work" | "merge" | "install" | "sign-in" | "destructive" | "system-settings" | "spend";
};
type DecisionIdentity = {
  goalId: string; requestId: string; userMessageId: string; projectId: string;
  ownerMonoId: string; managerId: string; requestingMonoId: string; generation: number;
  requestSessionId: string; requesterSessionId: string; requestText: string;
  requestBinding: ReturnType<typeof managerRequestBinding>;
  requesterBinding: ReturnType<typeof managerRequestBinding>;
  taskId?: string; dispatchId?: string;
};
export type MonoDecision = DecisionPayload & {
  /** Absent preserves exact legacy delivery bytes and receipts. */
  eventProtocol?: 2;
  id: string; projectId: string; requestingMonoId: string;
  escalationChain: { id: string; level: "worker" | DecisionLevel }[];
  recommenderId?: string;
  status: "pending" | "decided" | "delegated";
  deciderLevel: DecisionLevel;
  currentLevel: number;
  createdAt: number; updatedAt: number; decidedAt?: number;
  selectedOptionId?: string; decidedBy?: string;
  delegatedByUser?: boolean;
  resolutionVersion: number;
  deliveryState: "current" | "stale";
  history: { version: number; action: string; actorId: string; level: DecisionLevel | "worker"; at: number }[];
  identity: DecisionIdentity;
  source: CrewMessage;
};
export type DecisionDelivery = {
  senderId: string; recipientId: string; event: ManagerWakeEvent;
};
export type DecisionReceipt = { decisionId: string; remaining: DecisionDelivery[] };
export type DecisionQuarantine = { at: number; reason: "unreadable-decision-history"; raw: string };
export type DecisionCommand =
  | { action: "ingest"; goalId: string; message: CrewMessage }
  | { action: "escalate" | "delegate"; decisionId: string; expectedVersion: number }
  | { action: "resolve"; decisionId: string; optionId: string; expectedVersion: number }
  | { action: "raise-impact"; decisionId: string; impact: DecisionPayload["impact"]; expectedVersion: number }
  | { action: "remind"; decisionId: string; expectedVersion: number }
  | { action: "autonomy"; projectId: string; value: ProjectAutonomy };
export type DecisionSnapshot = {
  roster: readonly Mono[];
  requestSession: Session;
  requesterSession: Session;
  run: OrchestrationRun;
  /** Trusted engine/request generation; never read this from message text. */
  generation: number;
  /** Original retained CC-GOAL record and pending cancellation, resolved by trusted host. */
  goal: MonoManagerGoal;
  cancelling: boolean;
};
export type DecisionHost = {
  actor: { kind: "user" } | { kind: "mono"; id: string };
  /** Live registered projects, independent of goals, runs and open conversations. */
  roster(): readonly Mono[];
  current(decision?: MonoDecision): DecisionSnapshot;
  /** Existing authenticated team/CC5D path: dedupe exact event ID/body durably,
   * recheck validate immediately before publication, then acknowledge. */
  deliver(delivery: DecisionDelivery, validate: () => void): Promise<void>;
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid decision object");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 4000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw Error("Invalid decision text");
  return value;
};
const oneOf = <T extends string>(value: unknown, values: readonly T[]): T => {
  if (!values.includes(value as T)) throw Error("Invalid decision classification");
  return value as T;
};
const timestamp = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const projectAutonomy = (value: unknown = "high-impact-only") =>
  oneOf(value, ["high-impact-only", "medium-and-up", "everything"] as const);

/** Legacy Windows spellings share policy; ask more when retained copies conflict. */
export function decisionProjectAutonomy(autonomy: GoalLedger["autonomy"], projectId: string): ProjectAutonomy {
  const values = Object.entries(autonomy ?? {}).filter(([project]) => pathKey(project) === pathKey(projectId))
    .map(([, value]) => projectAutonomy(value));
  return values.includes("everything") ? "everything" : values.includes("medium-and-up") ? "medium-and-up" : "high-impact-only";
}

export type DecisionAutonomyChange = {
  type: "autonomy-change"; projectId: string; actorId: "user"; at: number;
  replaced: { projectId: string; value: ProjectAutonomy }[]; value: ProjectAutonomy;
};

export type DecisionTeamAction = Exclude<DecisionCommand, { action: "ingest" | "autonomy" | "delegate" }>;

/** Existing team.message text protocol: identity and retry ID come only from its authenticated envelope. */
export function parseDecisionAction(value: unknown): DecisionTeamAction {
  const raw = object(value);
  if (raw.version !== 1 || raw.type !== "decision-action" ||
      !["resolve", "escalate", "raise-impact", "remind"].includes(String(raw.action)))
    throw Error("Team messages cannot impersonate user decision gestures");
  const extra = raw.action === "resolve" ? "optionId" : raw.action === "raise-impact" ? "impact" : undefined;
  if (Object.keys(raw).some(key => !["version", "type", "action", "decisionId", "expectedVersion", extra].includes(key)))
    throw Error("Invalid decision action fields");
  text(raw.decisionId, 256);
  if (!timestamp(raw.expectedVersion)) throw Error("Invalid decision action version");
  if (raw.action === "resolve") text(raw.optionId, 64);
  if (raw.action === "raise-impact") oneOf(raw.impact, ["low", "med", "high"]);
  const { version: _version, type: _type, ...command } = raw;
  return command as DecisionTeamAction;
}

/** JSON occupies the existing team.message text field; summaries are never parsed as authority. */
export function parseDecisionPayload(value: unknown): DecisionPayload {
  const raw = object(value);
  if (Object.keys(raw).some(key => !["version", "type", "question", "impact", "context", "options", "recommendedOptionId", "operation"].includes(key)) ||
      raw.version !== 1 || raw.type !== "decision") throw Error("Unsupported structured decision");
  text(raw.question, 300); text(raw.context, 2000);
  oneOf(raw.impact, ["low", "med", "high"]);
  oneOf(raw.operation, ["work", "merge", "install", "sign-in", "destructive", "system-settings", "spend"]);
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 6) throw Error("Choose two to six decision options");
  const options = raw.options.map(value => {
    const option = object(value);
    if (Object.keys(option).some(key => !["id", "label"].includes(key))) throw Error("Invalid decision option");
    return { id: text(option.id, 64), label: text(option.label, 240) };
  });
  if (new Set(options.map(option => option.id)).size !== options.length ||
      raw.recommendedOptionId !== undefined && !options.some(option => option.id === raw.recommendedOptionId)) throw Error("Invalid decision recommendation/options");
  return structuredClone(raw) as DecisionPayload;
}

/** Shared runtime/prompt policy; a decision never authorizes executing an operation. */
export function bossMayDecide(decision: Pick<MonoDecision, "operation" | "impact" | "delegatedByUser">, autonomy: ProjectAutonomy): boolean {
  return decision.operation === "work" && (!!decision.delegatedByUser || autonomy !== "everything" &&
    decision.impact !== "high" && !(autonomy === "medium-and-up" && decision.impact === "med"));
}

/** Derive the prompt matrix from the same rule used by resolution. */
export function decisionAuthorityGuidance(role?: Mono["role"]): string {
  if (role === "member") return "Decisions: ask your Manager once via structured team.message; schema/caps: app rules team. Summarize reports; answers are evidence for the original goal only.";
  const policies = (["high-impact-only", "medium-and-up", "everything"] as const).map(autonomy => {
    const impacts = (["low", "med", "high"] as const).filter(impact => bossMayDecide({ operation: "work", impact }, autonomy));
    return `${autonomy}: Boss may decide ${impacts.length ? impacts.join("/") + " impact work" : "only explicitly user-delegated work"}`;
  });
  return `Within original authority. ${policies.join("; ")}. Managers: only low work below that threshold. Else app team.message to your actual superior: {memberId,kind:"question",requiresReply:true,text:JSON.stringify({version:1,type:"decision",question,impact,context,options:[{id,label},{id,label}],recommendedOptionId,operation})}. Caps: question300/context2000/options2-6/label240/message6000. Truthful operation: work|merge|install|sign-in|destructive|system-settings|spend; protected actions still need user approval; decisions never execute. Identity is runtime-only. Reports: summaries. Answers: evidence for the original goal only. Never claim higher-level decisions. Keep working. team.message actions: {version:1,type:"decision-action",action,decisionId,expectedVersion}; resolve adds optionId, raise-impact adds impact, escalate/remind add none. Keep ID/version; retry exact requestId+body; no user actor/delegate/autonomy.`;
}

function reportingChain(roster: readonly Mono[], requestingMonoId: string, projectId: string) {
  const chain: MonoDecision["escalationChain"] = [];
  let member = roster.find(mono => mono.id === requestingMonoId && mono.archivedAt == null);
  while (member) {
    if (chain.some(entry => entry.id === member!.id) || !member.role ||
        member.role !== "orchestrator" && !member.projects.some(project => pathKey(project) === pathKey(projectId))) throw Error("Invalid decision reporting chain");
    const level = member.role === "member" ? "worker" : member.role === "orchestrator" ? "boss" : "manager";
    if (chain.length && !((chain[chain.length - 1].level === "worker" && level === "manager") ||
        (chain[chain.length - 1].level === "manager" && level === "boss"))) throw Error("Invalid decision reporting relationship");
    chain.push({ id: member.id, level });
    if (level === "boss") break;
    member = roster.find(mono => mono.id === member!.reportsTo && mono.archivedAt == null);
  }
  if (chain[chain.length - 1]?.level !== "boss") throw Error("Decision needs an actual reporting Boss");
  return [...chain, { id: "user", level: "user" as const }];
}

function captureIdentity(goal: MonoManagerGoal, requesterId: string, snapshot: DecisionSnapshot): DecisionIdentity {
  const { requestSession, requesterSession, roster, run, generation } = snapshot;
  const owner = roster.find(mono => mono.id === goal.monoId && mono.archivedAt == null);
  const requester = roster.find(mono => mono.id === requesterId && mono.archivedAt == null);
  const manager = roster.find(mono => mono.id === run.ownerMonoId && mono.role === "manager" && mono.archivedAt == null);
  const task = requester?.role === "member" ? run.tasks.find(task => task.memberId === requesterId && task.sessionId === requesterSession.id) : undefined;
  const dispatch = run.dispatches?.find(dispatch => dispatch.id === task?.activeDispatchId && dispatch.taskId === task.id && dispatch.sessionId === task.sessionId);
  if (!owner || owner.sessionId !== requestSession.id || !requester || snapshot.cancelling || goal.state === "cancelled" || goal.state === "done" ||
      !requestSession.blocks.some(block => block.id === goal.userMessageId && isManagerUserRequest(block)) ||
      !manager || !manager.projects.some(project => pathKey(project) === pathKey(goal.projectId)) ||
      !(owner.role === "manager" && owner.id === manager.id || owner.role === "orchestrator" && owner.id === manager.reportsTo) ||
      goal.managerId !== run.leadId || !["active"].includes(run.status) || run.recovering ||
      pathKey(run.workspace?.projectCwd ?? run.cwd) !== pathKey(goal.projectId) ||
      !Number.isSafeInteger(generation) || generation < 0 ||
      requester.role === "member" && (!task || task.monoGoalId !== goal.id || task.status !== "running" ||
        !dispatch || dispatch.state !== "running" || requester.reportsTo !== manager.id) ||
      requester.role === "manager" && (requester.id !== manager.id || requester.sessionId !== requesterSession.id) ||
      requester.role === "orchestrator" && (requester.id !== owner.id || manager.reportsTo !== requester.id || requester.sessionId !== requesterSession.id))
    throw Error("Decision has no current original request/dispatch authority");
  const requestBinding = managerRequestBinding(requestSession), requesterBinding = managerRequestBinding(requesterSession);
  if (!managerRequestBindingCurrent(requestSession, requestBinding) || !managerRequestBindingCurrent(requesterSession, requesterBinding))
    throw Error("Decision request binding is held");
  return { goalId: goal.id, requestId: goal.requestId, userMessageId: goal.userMessageId,
    projectId: goal.projectId, ownerMonoId: goal.monoId, managerId: goal.managerId,
    requestingMonoId: requesterId, generation, requestSessionId: requestSession.id, requesterSessionId: requesterSession.id,
    requestText: requestSession.blocks.find(block => block.id === goal.userMessageId)!.text,
    requestBinding, requesterBinding, ...(task ? { taskId: task.id, dispatchId: dispatch!.id } : {}) };
}

export class StaleDecision extends Error {}
export function assertDecisionCurrent(decision: MonoDecision, host: DecisionHost): void {
  if (decision.deliveryState === "stale") throw new StaleDecision("Decision work authority was retired");
  const snapshot = host.current(decision);
  const goal = snapshot.goal;
  try {
    if (JSON.stringify(captureIdentity(goal, decision.requestingMonoId, snapshot)) !== JSON.stringify(decision.identity) ||
        JSON.stringify(reportingChain(snapshot.roster, decision.requestingMonoId, decision.projectId)) !== JSON.stringify(decision.escalationChain))
      throw Error("Decision authority changed");
  } catch (error) { throw new StaleDecision(error instanceof Error ? error.message : "Decision authority changed"); }
}

export function compactDecisionHistory(ledger: GoalLedger): GoalLedger {
  const resolved = ledger.decisions?.filter(entry => entry.status === "decided" && !Object.values(ledger.receipts).some(receipt => receipt.decision?.decisionId === entry.id && receipt.decision.remaining.length))
    .sort((a, b) => b.decidedAt! - a.decidedAt!) ?? [];
  const pruned = new Set(resolved.slice(200).map(entry => entry.id));
  return pruned.size ? { ...ledger, decisions: ledger.decisions!.filter(entry => !pruned.has(entry.id)), decisionsPruned: (ledger.decisionsPruned ?? 0) + pruned.size } : ledger;
}

function delivery(decision: MonoDecision, index: number, kind: "question" | "escalation" | "decision", senderId: string): DecisionDelivery {
  const recipientId = decision.escalationChain[index].id;
  const content = decision.eventProtocol === 2
    ? { type: "decision", decisionId: decision.id, expectedVersion: decision.resolutionVersion, question: decision.question,
        impact: decision.impact, operation: decision.operation, options: decision.options, recommendedOptionId: decision.recommendedOptionId,
        optionId: decision.selectedOptionId, context: decision.context.slice(0, 400), contextTruncated: decision.context.length > 400 }
    : { type: "decision", decisionId: decision.id, question: decision.question,
        optionId: decision.selectedOptionId, senderId, recipientId, identity: decision.identity };
  const event: ManagerWakeEvent = { id: `decision:${decision.id}:${decision.resolutionVersion}:${kind}:${index}`, kind, at: decision.updatedAt,
    requestId: decision.identity.requestId, goalId: decision.identity.goalId,
    taskId: decision.identity.taskId, dispatchId: decision.identity.dispatchId,
    text: JSON.stringify(content) };
  text(event.text);
  event.signature = JSON.stringify([senderId, recipientId, event.kind, event.text]);
  return { senderId, recipientId, event };
}

/** Reconstruct only the exact authenticated hop retained by this resolution version. */
export function retainedDecisionDelivery(decision: MonoDecision, eventId: string): DecisionDelivery | undefined {
  const prefix = `decision:${decision.id}:${decision.resolutionVersion}:`;
  if (!eventId.startsWith(prefix)) return;
  const match = /^(question|escalation|decision):(\d+)$/.exec(eventId.slice(prefix.length));
  if (!match) return;
  const kind = match[1] as "question" | "escalation" | "decision", index = Number(match[2]);
  const action = decision.history[decision.resolutionVersion];
  if (!action || index >= decision.escalationChain.length) return;
  if (kind === "decision") {
    if (action.action !== "resolve" || decision.status !== "decided" || index >= decision.currentLevel) return;
    return delivery(decision, index, kind, decision.escalationChain[index + 1].id);
  }
  if (kind === "question" ? action.action !== "ingest" || index !== 1 :
      !["escalate", "delegate", "remind"].includes(action.action) || index !== decision.currentLevel) return;
  return delivery(decision, index, kind, action.actorId);
}

/** Reject corrupt present state; never silently replace it with an empty ledger. */
export function validateDecisionHistory(ledger: GoalLedger, ownerId?: string): void {
  validateDecisionQuarantine(ledger);
  if (ledger.decisionsPruned !== undefined && !timestamp(ledger.decisionsPruned)) throw Error("Invalid decision archive count");
  if (ledger.autonomy !== undefined) {
    const autonomy = object(ledger.autonomy);
    for (const [project, value] of Object.entries(autonomy)) { text(project); projectAutonomy(value); }
  }
  if (ledger.decisions !== undefined && !Array.isArray(ledger.decisions)) throw Error("Invalid decision history");
  const ids = new Set<string>();
  for (const decision of ledger.decisions ?? []) {
    const raw = object(decision);
    if (decision.eventProtocol !== undefined && decision.eventProtocol !== 2) throw Error("Unsupported decision event protocol");
    parseDecisionPayload(Object.fromEntries(["version", "type", "question", "impact", "context", "options", "recommendedOptionId", "operation"]
      .filter(key => raw[key] !== undefined).map(key => [key, raw[key]])));
    text(decision.id); text(decision.projectId); text(decision.requestingMonoId);
    oneOf(decision.status, ["pending", "decided", "delegated"]); oneOf(decision.deciderLevel, ["manager", "boss", "user"]);
    const identity = object(decision.identity);
    for (const key of ["goalId", "requestId", "userMessageId", "projectId", "ownerMonoId", "managerId", "requestingMonoId", "requestSessionId", "requesterSessionId", "requestText"]) text(identity[key], 8000);
    object(identity.requestBinding); object(identity.requesterBinding);
    if (identity.taskId !== undefined) { text(identity.taskId); text(identity.dispatchId); }
    if (!timestamp(identity.generation) || !timestamp(decision.createdAt) || !timestamp(decision.updatedAt) ||
        decision.updatedAt < decision.createdAt || !Array.isArray(decision.escalationChain) || decision.escalationChain.length < 2 ||
        ownerId !== undefined && decision.escalationChain.find(entry => entry.level === "manager")?.id !== ownerId ||
        !Number.isInteger(decision.currentLevel) || decision.currentLevel < 1 || decision.currentLevel >= decision.escalationChain.length ||
        decision.escalationChain[decision.currentLevel].level !== decision.deciderLevel ||
        decision.escalationChain[decision.escalationChain.length - 1]?.id !== "user" || decision.escalationChain[decision.escalationChain.length - 1]?.level !== "user" ||
        decision.escalationChain[0].id !== decision.requestingMonoId || decision.identity.projectId !== decision.projectId ||
        decision.identity.requestingMonoId !== decision.requestingMonoId || ids.has(decision.id) ||
        !timestamp(decision.resolutionVersion) || !["current", "stale"].includes(decision.deliveryState) ||
        !Array.isArray(decision.history) || decision.history.length > 256 || decision.history.length !== decision.resolutionVersion + 1 ||
        decision.status === "decided" && (!timestamp(decision.decidedAt) || !decision.options.some(option => option.id === decision.selectedOptionId) ||
          decision.decidedBy !== decision.escalationChain[decision.currentLevel].id)) throw Error("Invalid decision history");
    for (const entry of decision.escalationChain) { text(entry.id); oneOf(entry.level, ["worker", "manager", "boss", "user"]); }
    for (const [version, entry] of decision.history.entries()) {
      if (entry.version !== version || !timestamp(entry.at)) throw Error("Invalid decision log");
      text(entry.actorId); oneOf(entry.level, ["worker", "manager", "boss", "user"]);
      oneOf(entry.action, ["ingest", "escalate", "delegate", "resolve", "raise-impact", "remind"]);
    }
    if (decision.delegatedByUser !== undefined && (decision.delegatedByUser !== true ||
        !decision.history.some(entry => entry.action === "delegate" && entry.actorId === "user" && entry.level === "user")))
      throw Error("Invalid decision delegation authority");
    object(decision.source); text(decision.source.id); text(decision.source.text, 6000);
    const source = parseDecisionPayload(JSON.parse(decision.source.text));
    if (decision.source.id !== decision.id || decision.source.senderId !== decision.requestingMonoId ||
        ["low", "med", "high"].indexOf(decision.impact) < ["low", "med", "high"].indexOf(source.impact) ||
        ["question", "context", "operation", "options", "recommendedOptionId"].some(key =>
          JSON.stringify(raw[key]) !== JSON.stringify(source[key as keyof DecisionPayload])) ||
        (decision.recommenderId !== undefined) !== (decision.recommendedOptionId !== undefined) ||
        decision.recommenderId !== undefined && decision.recommenderId !== decision.requestingMonoId)
      throw Error("Invalid immutable decision source");
    ids.add(decision.id);
  }
  for (const receipt of Object.values(ledger.receipts)) {
    if (!receipt.decision) continue;
    text(receipt.decision.decisionId);
    const decision = ledger.decisions?.find(decision => decision.id === receipt.decision!.decisionId);
    if (!Array.isArray(receipt.decision.remaining) || receipt.decision.remaining.length && !decision) throw Error("Invalid decision receipt");
    for (const message of receipt.decision.remaining) {
      object(message); text(message.senderId); text(message.recipientId);
      object(message.event); text(message.event.id); text(message.event.text);
      const index = decision!.escalationChain.findIndex(entry => entry.id === message.recipientId);
      if (index < 0 || !["question", "escalation", "decision"].includes(message.event.kind) ||
          JSON.stringify(message) !== JSON.stringify(retainedDecisionDelivery(decision!, message.event.id)))
        throw Error("Invalid decision receipt identity");
    }
  }
}

function validateDecisionQuarantine(ledger: GoalLedger): void {
  if (ledger.decisionQuarantine === undefined) return;
  if (!Array.isArray(ledger.decisionQuarantine)) throw Error("Invalid decision quarantine; history retained");
  for (const quarantine of ledger.decisionQuarantine) {
    object(quarantine);
    if (!timestamp(quarantine.at) || quarantine.reason !== "unreadable-decision-history" || typeof quarantine.raw !== "string")
      throw Error("Invalid decision quarantine; history retained");
  }
}

/** Move the whole invalid domain out of authority, retaining parsed evidence in the same ledger. */
export function quarantineDecisionHistory(ledger: GoalLedger, ownerId?: string): GoalLedger {
  validateDecisionQuarantine(ledger);
  try { validateDecisionHistory(ledger, ownerId); return ledger; } catch { /* Preserve the invalid active domain below. */ }
  const retained = structuredClone(ledger);
  const raw: Record<string, unknown> = {};
  for (const key of ["decisions", "autonomy", "decisionsPruned"] as const) {
    if (Object.prototype.hasOwnProperty.call(retained, key)) raw[key] = retained[key];
    delete retained[key];
  }
  raw.receipts = Object.fromEntries(Object.entries(retained.receipts).flatMap(([id, receipt]) => {
    if (!Object.prototype.hasOwnProperty.call(receipt, "decision")) return [];
    const decision = receipt.decision;
    delete receipt.decision;
    return [[id, decision]];
  }));
  retained.decisionQuarantine = [...(retained.decisionQuarantine ?? []),
    { at: Date.now(), reason: "unreadable-decision-history", raw: JSON.stringify(raw) }];
  validateDecisionHistory(retained, ownerId);
  return retained;
}

export async function recoverDecisionReceipt(ownerId: string, requestId: string, host: DecisionHost, access: DecisionAccess) {
  let ledger = access.read();
  let receipt = ledger.receipts[requestId];
  if (!receipt?.decision) return;
  while (receipt.decision?.remaining.length) {
    const decision = ledger.decisions!.find(decision => decision.id === receipt.decision!.decisionId)!;
    const validate = () => assertDecisionCurrent(decision, host);
    try { validate(); } catch (error) {
      if (!(error instanceof StaleDecision)) throw error;
      await access.save(ownerId, { ...ledger, decisions: ledger.decisions!.map(entry => entry.id === decision.id ? { ...entry, deliveryState: "stale" } : entry),
        receipts: { ...ledger.receipts, [requestId]: { ...receipt, decision: { ...receipt.decision, remaining: [] } } } });
      return;
    }
    const message = structuredClone(receipt.decision.remaining[0]);
    try {
      await host.deliver(message, validate);
      validate();
    } catch (error) {
      try { validate(); } catch (changed) {
        if (!(changed instanceof StaleDecision)) throw changed;
        await access.save(ownerId, { ...access.read(), decisions: access.read().decisions!.map(entry => entry.id === decision.id ? { ...entry, deliveryState: "stale" } : entry),
          receipts: { ...access.read().receipts, [requestId]: { ...receipt, decision: { ...receipt.decision, remaining: [] } } } });
        return;
      }
      throw error;
    }
    ledger = access.read();
    receipt = { ...ledger.receipts[requestId], decision: { ...receipt.decision, remaining: receipt.decision.remaining.slice(1) } };
    await access.save(ownerId, { ...ledger, receipts: { ...ledger.receipts, [requestId]: receipt } });
  }
}
type DecisionAccess = {
  read(): GoalLedger;
  save(ownerId: string, ledger: GoalLedger): Promise<void>;
};

/** Uses the existing goal-ledger serial writer and receipts, never a second queue. */
export async function handleDecisionCommand(ownerId: string, requestId: string, input: DecisionCommand, host: DecisionHost, access: DecisionAccess) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw Error("Invalid decision requestId");
  const command = structuredClone(input);
  const fields = {
    ingest: ["action", "goalId", "message"], autonomy: ["action", "projectId", "value"],
    resolve: ["action", "decisionId", "optionId", "expectedVersion"],
    escalate: ["action", "decisionId", "expectedVersion"], delegate: ["action", "decisionId", "expectedVersion"],
    "raise-impact": ["action", "decisionId", "impact", "expectedVersion"], remind: ["action", "decisionId", "expectedVersion"],
  };
  if (!Object.prototype.hasOwnProperty.call(fields, command.action) || Object.keys(command).some(key => !fields[command.action].includes(key))) throw Error("Invalid decision action fields");
  let ledger = access.read();
  const assertProject = () => {
    if (command.action !== "autonomy") return;
    if (host.actor.kind !== "user") throw Error("Only the user changes project autonomy");
    text(command.projectId); projectAutonomy(command.value);
    const manager = host.roster().find(mono => mono.id === ownerId && mono.role === "manager" && mono.archivedAt == null);
    if (!manager?.projects.some(project => pathKey(project) === pathKey(command.projectId))) throw Error("Unknown decision project for this Manager");
  };
  if (command.action === "autonomy") assertProject();
  else if (command.action === "ingest" && host.current().run.ownerMonoId !== ownerId) throw Error("Use the originating Manager's decision ledger");
  const signature = JSON.stringify(["decision", host.actor, command]);
  const prior = Object.prototype.hasOwnProperty.call(ledger.receipts, requestId) ? ledger.receipts[requestId] : undefined;
  if (prior) {
    if (prior.signature !== signature) throw Error("Request ID already used with different input");
    if (prior.decision) {
      await recoverDecisionReceipt(ownerId, requestId, host, access);
    }
    return structuredClone(prior.result);
  }
  if (Object.keys(ledger.receipts).length >= 4000) throw Error("Goal receipt capacity reached; history retained");
  if (command.action === "autonomy") {
    const replaced = Object.entries(ledger.autonomy ?? {}).filter(([project]) => pathKey(project) === pathKey(command.projectId));
    const autonomy = Object.fromEntries(Object.entries(ledger.autonomy ?? {}).filter(([project]) => pathKey(project) !== pathKey(command.projectId)));
    ledger = { ...ledger, autonomy: { ...autonomy, [pathKey(command.projectId)]: command.value } };
    const result: DecisionAutonomyChange | ProjectAutonomy = new Set(replaced.map(([, value]) => value)).size > 1
      ? { type: "autonomy-change", projectId: pathKey(command.projectId), actorId: "user", at: Date.now(),
          replaced: replaced.map(([projectId, value]) => ({ projectId, value })), value: command.value }
      : command.value;
    assertProject();
    await access.save(ownerId, { ...ledger, receipts: { ...ledger.receipts, [requestId]: { signature, result } } });
    assertProject();
    return result;
  }
  let decision: MonoDecision;
  let messages: DecisionDelivery[];
  const now = Date.now();
  if (command.action === "ingest") {
    const message = command.message;
    const payload = parseDecisionPayload(JSON.parse(text(message.text, 6000)));
    const snapshot = host.current();
    const goal = snapshot.goal;
    if (goal.id !== command.goalId || host.actor.kind !== "mono" || host.actor.id !== message.senderId ||
        !["question", "escalation"].includes(message.kind ?? "") || message.requiresReply === false || !timestamp(message.at)) throw Error("Invalid structured decision source");
    const identity = captureIdentity(goal, message.senderId, snapshot);
    const chain = reportingChain(snapshot.roster, message.senderId, goal.projectId);
    if (message.recipientId !== chain[1].id || message.managerId !== snapshot.run.ownerMonoId ||
        !message.id.startsWith(`${snapshot.requesterSession.id}:`) || message.id.length > 256) throw Error("Decision must follow its actual reporting chain");
    if (ledger.decisions?.some(entry => entry.id === message.id)) throw Error("Decision event already retained; retry its original request");
    if (ledger.decisionQuarantine?.some(entry => {
      try {
        const raw = JSON.parse(entry.raw);
        return Array.isArray(raw.decisions) && raw.decisions.some((record: { id?: unknown }) => record?.id === message.id);
      } catch { return false; }
    })) throw Error("Use a new decision ID after quarantine");
    decision = { ...payload, eventProtocol: 2, id: message.id, projectId: goal.projectId, requestingMonoId: message.senderId,
      escalationChain: chain, identity, source: message, status: "pending", currentLevel: 1,
      deciderLevel: chain[1].level as DecisionLevel, createdAt: now, updatedAt: now,
      resolutionVersion: 0, deliveryState: "current", history: [{ version: 0, action: "ingest", actorId: message.senderId, level: chain[0].level, at: now }],
      ...(payload.recommendedOptionId ? { recommenderId: message.senderId } : {}) };
    messages = [delivery(decision, 1, "question", message.senderId)];
  } else {
    const retained = ledger.decisions?.find(entry => entry.id === command.decisionId);
    if (!retained || retained.status === "decided") throw Error("Decision is not pending");
    if (retained.escalationChain.find(entry => entry.level === "manager")?.id !== ownerId) throw Error("Use the originating Manager's decision ledger");
    if (command.expectedVersion !== retained.resolutionVersion) throw Error("Decision action is stale");
    decision = structuredClone(retained);
    let stale = false;
    try { assertDecisionCurrent(decision, host); } catch (error) {
      if (!(error instanceof StaleDecision) || host.actor.kind !== "user" || command.action !== "resolve") throw error;
      stale = true;
    }
    if (Object.values(ledger.receipts).some(receipt => receipt.decision?.decisionId === decision.id && receipt.decision.remaining.length)) throw Error("Retry retained decision delivery first");
    const current = decision.escalationChain[decision.currentLevel];
    const actor = host.actor;
    const reminding = command.action === "remind" && current.level === "user" && actor.kind === "mono" &&
      decision.escalationChain.some(entry => entry.id === actor.id && entry.level === "boss");
    if (!reminding && (current.level === "user" ? host.actor.kind !== "user" : host.actor.kind !== "mono" || host.actor.id !== current.id)) throw Error("Only the current decider may act");
    if (decision.history.length >= 256) throw Error("Decision log capacity reached; history retained");
    decision.resolutionVersion++;
    decision.history.push({ version: decision.resolutionVersion, action: command.action,
      actorId: host.actor.kind === "user" ? "user" : host.actor.id, level: reminding ? "boss" : current.level, at: now });
    decision.updatedAt = now;
    if (command.action === "resolve") {
      const autonomy = decisionProjectAutonomy(ledger.autonomy, decision.projectId);
      if (current.level !== "user" && (!bossMayDecide(decision, autonomy) || current.level === "manager" && decision.impact !== "low")) throw Error("Escalate this decision to its required authority");
      if (!decision.options.some(option => option.id === command.optionId)) throw Error("Choose a retained decision option");
      decision = { ...decision, status: "decided", selectedOptionId: command.optionId, decidedBy: current.id, decidedAt: now };
      messages = [];
      if (stale) decision.deliveryState = "stale";
      else for (let index = decision.currentLevel - 1; index >= 0; index--) messages.push(delivery(decision, index, "decision", decision.escalationChain[index + 1].id));
    } else if (command.action === "delegate") {
      if (host.actor.kind !== "user" || current.level !== "user" || decision.operation !== "work") throw Error("Only the user may delegate a work decision to the Boss");
      decision = { ...decision, status: "delegated", delegatedByUser: true, currentLevel: decision.currentLevel - 1, deciderLevel: "boss" };
      messages = [delivery(decision, decision.currentLevel, "escalation", "user")];
    } else if (command.action === "raise-impact") {
      oneOf(command.impact, ["low", "med", "high"]);
      if (["low", "med", "high"].indexOf(command.impact) < ["low", "med", "high"].indexOf(decision.impact)) throw Error("Decision impact cannot be lowered");
      decision.impact = command.impact;
      messages = [];
    } else if (command.action === "remind") {
      if (!reminding) throw Error("Only the Boss may remind the user");
      messages = [delivery(decision, decision.currentLevel, "escalation", host.actor.kind === "mono" ? host.actor.id : "user")];
    } else if (command.action === "escalate") {
      if (current.level === "user") throw Error("Already escalated to user");
      decision.currentLevel++;
      decision.deciderLevel = decision.escalationChain[decision.currentLevel].level as DecisionLevel;
      decision.status = "pending";
      messages = [delivery(decision, decision.currentLevel, "escalation", current.id)];
    } else throw Error("Unknown decision action");
  }
  if (decision.deliveryState !== "stale") assertDecisionCurrent(decision, host);
  const result = { decisionId: decision.id, resolutionVersion: decision.resolutionVersion, status: decision.status };
  ledger = { ...ledger, decisions: [...(ledger.decisions ?? []).filter(entry => entry.id !== decision.id), decision],
    receipts: { ...ledger.receipts, [requestId]: { signature, result, decision: { decisionId: decision.id, remaining: messages } } } };
  await access.save(ownerId, ledger);
  await recoverDecisionReceipt(ownerId, requestId, host, access);
  return result;
}
