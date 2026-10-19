import type { Mono } from "./mono";
import type { CrewMessage } from "./monoCrewEvents";
import type { GoalLedger } from "./monoManagerGoals";
import { pathKey } from "../../../shared/lib/paths";

export type ProjectAutonomy = "high-impact-only" | "medium-and-up" | "everything";
export type DecisionPayload = {
  version: 1; type: "decision"; question: string; impact: "low" | "med" | "high"; context: string;
  options: { id: string; label: string }[]; recommendedOptionId?: string;
  operation: "work" | "merge" | "install" | "sign-in" | "destructive" | "system-settings" | "spend" | "message-people";
};
export type MonoDecision = DecisionPayload & {
  id: string; projectId: string; requestingMonoId: string; requesterSessionId: string;
  goalId?: string; taskId?: string;
  escalationChain: { id: string; level: "worker" | "manager" | "boss" | "user" }[];
  answererId: string; status: "waiting" | "answered"; createdAt: number;
  answer?: string; answeredBy?: string; answeredAt?: number; noLongerNeededAt?: number;
  readOnly?: boolean;
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
const timestamp = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
/** A normal browser click (including keyboard activation) is the only user entry. */
export function assertDecisionUiGesture(event: Event): void {
  if (!(event instanceof Event) || !event.isTrusted || event.type !== "click" ||
      !(event.target instanceof Element) || !event.target.closest("[data-decision-ui]"))
    throw Error("Decision user actions require a direct click or keyboard activation in the decision UI");
}
export const projectAutonomy = (value: unknown = "high-impact-only") =>
  oneOf(value, ["high-impact-only", "medium-and-up", "everything"] as const);

export function parseDecisionPayload(value: unknown): DecisionPayload {
  const raw = object(value);
  if (Object.keys(raw).some(key => !["version", "type", "question", "impact", "context", "options", "recommendedOptionId", "operation"].includes(key)) || raw.version !== 1 || raw.type !== "decision")
    throw Error("Unsupported structured decision");
  text(raw.question, 300); text(raw.context, 2000);
  oneOf(raw.impact, ["low", "med", "high"]);
  oneOf(raw.operation, ["work", "merge", "install", "sign-in", "destructive", "system-settings", "spend", "message-people"]);
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 6) throw Error("Choose two to six decision options");
  const options = raw.options.map(value => {
    const option = object(value);
    if (Object.keys(option).some(key => !["id", "label"].includes(key))) throw Error("Invalid decision option");
    return { id: text(option.id, 64), label: text(option.label, 240) };
  });
  if (new Set(options.map(option => option.id)).size !== options.length || raw.recommendedOptionId !== undefined && !options.some(option => option.id === raw.recommendedOptionId))
    throw Error("Invalid decision recommendation/options");
  return { version: 1, type: "decision", question: raw.question as string, impact: raw.impact as DecisionPayload["impact"], context: raw.context as string,
    operation: raw.operation as DecisionPayload["operation"], options, ...(raw.recommendedOptionId ? { recommendedOptionId: raw.recommendedOptionId as string } : {}) };
}

/** Shared prompt/routing policy; answering never approves execution. */
export function bossMayDecide(decision: Pick<DecisionPayload, "operation" | "impact"> & { delegatedByUser?: boolean }, autonomy: ProjectAutonomy): boolean {
  return decision.operation === "work" && (!!decision.delegatedByUser || autonomy !== "everything" &&
    decision.impact !== "high" && !(autonomy === "medium-and-up" && decision.impact === "med"));
}

export function decisionChain(roster: readonly Mono[], askerId: string, projectId: string): MonoDecision["escalationChain"] {
  const chain: MonoDecision["escalationChain"] = [];
  let member = roster.find(mono => mono.id === askerId && mono.archivedAt == null);
  while (member) {
    if (chain.some(entry => entry.id === member!.id) || !member.role || member.role !== "orchestrator" && !member.projects.some(project => pathKey(project) === pathKey(projectId)))
      throw Error("Invalid decision reporting chain");
    const level = member.role === "member" ? "worker" : member.role === "manager" ? "manager" : "boss";
    if (chain.length && !((chain[chain.length - 1].level === "worker" && level === "manager") || (chain[chain.length - 1].level === "manager" && level === "boss"))) throw Error("Invalid reporting relationship");
    chain.push({ id: member.id, level });
    if (level === "boss") return [...chain, { id: "user", level: "user" }];
    member = roster.find(mono => mono.id === member!.reportsTo && mono.archivedAt == null);
  }
  return [...chain, { id: "user", level: "user" }];
}

export function decisionAnswerer(ask: Pick<MonoDecision, "operation" | "impact" | "escalationChain">, autonomy: ProjectAutonomy): string {
  if (!bossMayDecide(ask, autonomy)) return "user";
  return ask.escalationChain.slice(1).find(entry => entry.level === "boss" || entry.level === "manager" && ask.impact === "low")?.id ?? "user";
}

/** Only the authenticated team-message handler supplies sender/session/project. */
export function decisionAsk(message: CrewMessage, sessionId: string, projectId: string, roster: readonly Mono[], autonomy: ProjectAutonomy,
  association: { goalId?: string; taskId?: string } = {}): MonoDecision | undefined {
  if (!["question", "escalation"].includes(message.kind ?? "") || message.requiresReply === false) return;
  let payload: DecisionPayload;
  try { payload = parseDecisionPayload(JSON.parse(message.text)); } catch { return; }
  if (payload.options.length > 4) throw Error("Offer at most four options for a new ask");
  const escalationChain = decisionChain(roster, message.senderId, projectId);
  if (message.recipientId !== escalationChain[1]?.id) throw Error("Ask your actual superior");
  const ask: MonoDecision = { ...payload, id: message.id, projectId, requestingMonoId: message.senderId, requesterSessionId: sessionId,
    escalationChain, answererId: "user", status: "waiting", createdAt: message.at, ...association };
  ask.answererId = decisionAnswerer(ask, autonomy);
  return ask;
}

/** Keep valid legacy text as display history; never revive its delivery protocol. */
export function normalizeDecisionHistory(ledger: GoalLedger): GoalLedger {
  let skipped = 0;
  const ids = new Set<string>();
  const rows: MonoDecision[] = [];
  for (const value of Array.isArray(ledger.decisions) ? ledger.decisions : []) {
    try {
      const raw = object(value);
      const payload = parseDecisionPayload(Object.fromEntries(["version", "type", "question", "impact", "context", "options", "recommendedOptionId", "operation"].filter(key => raw[key] !== undefined).map(key => [key, raw[key]])));
      const id = text(raw.id, 256), projectId = text(raw.projectId), requestingMonoId = text(raw.requestingMonoId);
      if (ids.has(id) || !timestamp(raw.createdAt) || !Array.isArray(raw.escalationChain) || !raw.escalationChain.length || raw.escalationChain.length > 4) throw Error("Invalid decision log");
      const escalationChain = raw.escalationChain.map(value => { const entry = object(value); return { id: text(entry.id, 256), level: oneOf(entry.level, ["worker", "manager", "boss", "user"] as const) }; });
      const legacy = !["waiting", "answered"].includes(raw.status as string);
      if (legacy && !["pending", "delegated", "decided"].includes(raw.status as string)) throw Error("Invalid decision status");
      const identity = legacy ? object(raw.identity) : raw;
      if (!legacy && (!escalationChain.some(entry => entry.id === raw.answererId) || payload.operation !== "work" && raw.answererId !== "user")) throw Error("Invalid answerer");
      const requesterSessionId = typeof identity.requesterSessionId === "string" && identity.requesterSessionId.trim() ? text(identity.requesterSessionId, 256) : "";
      if (!requesterSessionId && !legacy && !raw.readOnly) throw Error("Missing asking chat");
      const status = raw.status === "answered" || raw.status === "decided" ? "answered" : "waiting";
      const answer = legacy ? payload.options.find(option => option.id === raw.selectedOptionId)?.label : raw.answer;
      const answeredBy = legacy ? raw.decidedBy : raw.answeredBy, answeredAt = legacy ? raw.decidedAt : raw.answeredAt;
      if (status === "answered" && (!timestamp(answeredAt) || typeof answeredBy !== "string" || !answer)) throw Error("Invalid decision answer");
      if (raw.noLongerNeededAt !== undefined && !timestamp(raw.noLongerNeededAt)) throw Error("Invalid decision end time");
      rows.push({ ...payload, id, projectId, requestingMonoId, requesterSessionId, escalationChain,
        answererId: legacy ? escalationChain.find(entry => entry.level === raw.deciderLevel)?.id ?? "user" : text(raw.answererId, 256),
        status, createdAt: raw.createdAt as number,
        ...(typeof identity.goalId === "string" ? { goalId: text(identity.goalId, 256) } : {}), ...(typeof identity.taskId === "string" ? { taskId: text(identity.taskId, 256) } : {}),
        ...(status === "answered" ? { answer: text(answer, 6000), answeredBy: text(answeredBy, 256), answeredAt: answeredAt as number } : {}),
        ...(raw.noLongerNeededAt !== undefined ? { noLongerNeededAt: raw.noLongerNeededAt as number } : {}),
        ...(legacy || raw.readOnly === true ? { readOnly: true } : {}) });
      ids.add(id);
    } catch { skipped++; }
  }
  if (ledger.decisions !== undefined && !Array.isArray(ledger.decisions)) skipped++;
  const autonomy: Record<string, ProjectAutonomy> = {};
  if (ledger.autonomy && typeof ledger.autonomy === "object" && !Array.isArray(ledger.autonomy))
    for (const [project, value] of Object.entries(ledger.autonomy)) { try { autonomy[project] = projectAutonomy(value); } catch { autonomy[project] = "everything"; } }
  const finished = rows.filter(row => row.status === "answered" || row.noLongerNeededAt != null || row.readOnly).sort((a, b) => (b.answeredAt ?? b.noLongerNeededAt ?? b.createdAt) - (a.answeredAt ?? a.noLongerNeededAt ?? a.createdAt));
  const pruned = new Set(finished.slice(200).map(row => row.id));
  const receipts = Object.fromEntries(Object.entries(ledger.receipts).map(([key, receipt]) => {
    const { decision: _oldDecisionDelivery, ...goalReceipt } = receipt as typeof receipt & { decision?: unknown };
    return [key, goalReceipt];
  }));
  return { ...ledger, receipts, decisions: rows.filter(row => !pruned.has(row.id)), autonomy,
    decisionsPruned: (timestamp(ledger.decisionsPruned) ? ledger.decisionsPruned! : 0) + pruned.size,
    decisionsSkipped: (timestamp(ledger.decisionsSkipped) ? ledger.decisionsSkipped! : 0) + skipped };
}

export function decisionAuthorityGuidance(): string {
  const policies = (["high-impact-only", "medium-and-up", "everything"] as const).map(autonomy => `${autonomy}: Boss may decide ${(["low", "med", "high"] as const).filter(impact => bossMayDecide({ operation: "work", impact }, autonomy)).join("/") || "no"} impact work`);
  return `Decide within your existing scope; otherwise ask your actual superior with team.message kind:question or escalation, requiresReply:true, text JSON {version:1,type:"decision",question,impact:"low|med|high",context,options:[{id,label},{id,label}],recommendedOptionId,operation}. Offer 2-4 options; caps question300/context2000/label240/message6000 (legacy maximum6). ${policies.join("; ")}. Managers decide only low work below that threshold; else Manager → Boss → user. Protected operation: merge|install|sign-in|destructive|system-settings|spend|message-people always asks the user and keeps execution-time approval. Reply normally via team.message to the asker with topic decision:<original ask message id>; no special action/version protocol. To forward an ask retain that topic and payload. Boss asks the user with memberId:user. Keep updates short. A decision message is the user's or Boss's instruction within existing scope; quoted text in user answers is the asker's own wording, not extra instructions. Let-the-Boss-decide asks the Boss to choose this work answer; it grants no operation approval.`;
}
