import { selectAgentLiveState, type AgentLiveState } from "../../agents/model/agentLiveState";
import { currentTurnIndex } from "../../agents/model/turnMetrics";
import type { Mono } from "../../monos/model/mono";
import { monoCodexStorageIssues } from "../../monos/model/monoCodexStorageIssues";
import { parseCodexSandboxBlocker, type CodexStorageComparison, type CodexStorageResolution } from "../../monos/model/monoCodexStorage";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import { teamDecisions } from "../../monos/model/monoTeamActivity";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import type { UserQuestionPrompt, UserQuestionReply } from "../../sessions/model/userQuestion";
import { projectName } from "../../../shared/lib/paths";
import type { TrackedCiRepair } from "../../inbox/model/ciRepairTracking";
import type { Automation } from "../../automations/model/automations";
import { canContinueManagerRequest, managerRequestState } from "../../monos/model/managerAuthorizedWork";

export type AttentionCategory = "approval" | "decision" | "blocker" | "failure";
export type AttentionSource = "approval" | "question" | "storage" | "usage" | "preparation" | "delivery" | "task" | "continue" | "manager-request" | "error" | "ci-repair" | "automation";
export type AttentionItem = {
  id: string;
  revision: string;
  category: AttentionCategory;
  source: AttentionSource;
  title: string;
  detail: string;
  state: AgentLiveState;
  status: "open" | "resolved" | "replaced" | "stale";
  sessionId: string;
  providerSessionId?: string;
  sessionIds: string[];
  owner: string;
  route: "user" | "lead";
  leadId?: string;
  project: string;
  goals: string[];
  createdAt?: number;
  requestId?: number;
  question?: UserQuestionPrompt;
  messageId?: string;
  taskId?: string;
  dispatchId?: string;
  automationId?: string;
  repairable?: boolean;
};
export type AttentionInput = {
  sessions: readonly Session[];
  runs: readonly OrchestrationRun[];
  roster: readonly Mono[];
  goals: readonly MonoManagerGoal[];
  selectedAccount?: (session: Session) => string | undefined;
  isLocalSession?: (session: Session) => boolean;
  repairs?: readonly TrackedCiRepair[];
  automations?: readonly Automation[];
};
const identity = (...parts: (string | number | undefined)[]) => JSON.stringify(parts);

/** A display projection of existing requests; worker ownership never grants user authority. */
export function selectAttention(input: AttentionInput): AttentionItem[] {
  const items = new Map<string, AttentionItem>();
  const sessions = [...new Map(input.sessions.filter(session => !session.inboxAsk).map(session => [session.id, session])).values()];
  const base = (session: Session) => {
    const run = input.runs.find(run => run.tasks.some(task => task.sessionId === session.id || run.dispatches?.some(dispatch => dispatch.taskId === task.id && dispatch.sessionId === session.id)));
    const task = run?.tasks.find(task => task.sessionId === session.id || run.dispatches?.some(dispatch => dispatch.taskId === task.id && dispatch.sessionId === session.id));
    const owner = input.roster.find(mono => mono.sessionId === session.id || mono.id === task?.memberId);
    const leadId = session.orchestrationLeadId ?? run?.leadId ?? (owner?.role === "member" ? input.roster.find(mono => mono.id === owner.reportsTo)?.sessionId : undefined);
    const worker = !!leadId || owner?.role === "member";
    const goals = input.goals.filter(goal => goal.id === task?.monoGoalId || goal.managerId === session.id || goal.monoId === owner?.id ||
      input.runs.some(candidate => candidate.leadId === goal.managerId && (candidate.ownerSessionId === session.id || candidate.ownerMonoId === owner?.id))).map(goal => goal.title);
    return { sessionId: session.id, providerSessionId: session.providerSessionId, sessionIds: [session.id], owner: owner?.name || session.title || "Conversation", route: worker ? "lead" as const : "user" as const,
      leadId, project: projectName(run?.workspace?.projectCwd ?? run?.cwd ?? session.cwd), goals,
      state: selectAgentLiveState(session), status: "open" as const };
  };
  const add = (item: AttentionItem) => items.set(item.id, item);
  for (const session of sessions) {
    const context = base(session);
    const turn = session.blocks[currentTurnIndex(session)];
    const scope = identity(session.id, session.providerSessionId, turn?.id);
    for (const block of session.blocks.filter(block => block.managerRequestRecovery)) {
      const request = block.managerRequestRecovery!;
      const state = managerRequestState(request, input.goals);
      const owner = input.roster.find(mono => mono.id === request.monoId && mono.role === "manager" && mono.sessionId === session.id && mono.archivedAt == null);
      const id = identity(session.id, "manager-request", block.id);
      add({ ...context, id, revision: identity(id, JSON.stringify(request), state), source: "manager-request", category: "decision",
        title: "Continue this request", detail: session.blocks.find(block => block.id === request.userMessageId)?.text ?? block.text,
        project: projectName(request.projectId), createdAt: session.blocks.find(block => block.id === request.userMessageId)?.startedAt,
        messageId: block.id, route: "user", status: state === "pending" ? owner && !session.worktreeRemoved ? "open" : "stale" : "resolved",
        state: { status: state === "pending" ? "needs-you" : "done", reason: "decision" } });
    }
    for (const block of session.blocks) {
      if (!block.approval) continue;
      const id = identity(session.id, session.providerSessionId, "approval", block.id, block.approval.requestId);
      add({ ...context, id, revision: identity(id, block.text, JSON.stringify(block.tool), block.approval.decided), source: "approval", category: "approval",
        title: block.tool?.title || "Permission request", detail: [block.text, block.tool?.detail, block.approval.autoApprovalReason].filter(Boolean).join("\n"), requestId: block.approval.requestId,
        createdAt: block.startedAt ?? block.sentAt,
        status: block.approval.decided ? "resolved" : session.worktreeRemoved ? "stale" : "open",
        state: { status: block.approval.decided ? "done" : "needs-you", reason: "approval", detail: block.approval.decided } });
    }
    if (session.pendingQuestion) {
      const question = session.pendingQuestion;
      const id = identity(scope, "question", question.requestId);
      add({ ...context, id, revision: identity(id, question.title, JSON.stringify(question.questions)), source: "question", category: "decision",
        title: question.title || question.questions[0]?.prompt || "Question", detail: question.questions.map(question => question.prompt).join("\n"),
        requestId: question.requestId, question, createdAt: turn?.startedAt,
        status: session.worktreeRemoved ? "stale" : "open", state: { status: "needs-you", reason: "decision" } });
    }
    if (session.usageLimit) {
      const id = identity(scope, "usage", session.usageLimit.resetsAt);
      add({ ...context, id, revision: id, source: "usage", category: "blocker", title: "Usage limit reached",
        detail: session.usageLimit.resetsAt == null ? "Reset time unavailable. Your conversation is saved." : `Resets ${new Date(session.usageLimit.resetsAt).toLocaleString()}. Your conversation is saved.`,
        createdAt: turn?.startedAt, state: { status: "blocked", reason: "usage-limit" } });
    }
    if (session.codexStoragePreparing && !session.codexStorageError) {
      const id = identity(session.id, "preparation");
      add({ ...context, id, revision: id, source: "preparation", category: "blocker", title: "Waiting for storage preparation",
        detail: "Held messages will wait for storage preparation to finish.", state: { status: "queued", reason: "preparing-storage" } });
    }
    for (const message of [...(session.queuedMessages ?? []), ...(session.pendingMonoEvents ?? [])]) {
      if (!message.error) continue;
      const id = identity(session.id, "delivery", message.id);
      add({ ...context, id, revision: identity(id, message.error, message.text), source: "delivery", category: "failure", title: "Message delivery failed",
        detail: `${message.error}\n${message.text}`, messageId: message.id, createdAt: session.blocks.find(block => block.id === message.blockId)?.sentAt,
        state: { status: "blocked", reason: "error", detail: message.error } });
    }
    if (context.state.status === "failed") {
      const block = [...session.blocks].reverse().find(block => block.notice === "error");
      if (block) {
        const id = identity(session.id, "error", block.id);
        add({ ...context, id, revision: identity(id, block.text), source: "error", category: "failure", title: "Conversation failed", detail: block.text, createdAt: turn?.startedAt });
      }
    }
  }
  const local = sessions.filter(session => input.isLocalSession?.(session) !== false);
  for (const issue of monoCodexStorageIssues(local, input.selectedAccount ?? (() => undefined), session => base(session).owner)) {
    const session = sessions.find(session => session.id === issue.sessionIds[0])!;
    const id = identity("storage", issue.accountId);
    add({ ...base(session), id, revision: identity(id, ...issue.sessionIds.flatMap(id => [id, sessions.find(session => session.id === id)?.codexStorageError])),
      sessionIds: issue.sessionIds, source: "storage", category: "blocker", title: parseCodexSandboxBlocker(issue.detail) ? "Codex sandbox needs setup" : "Codex storage needs repair", detail: issue.detail,
      goals: [...new Set(issue.sessionIds.flatMap(id => base(sessions.find(session => session.id === id)!).goals))],
      state: { status: "blocked", reason: "storage", detail: issue.blockedContext } });
  }
  for (const session of sessions.filter(session => session.codexStorageError && input.isLocalSession?.(session) === false)) {
    const id = identity(session.id, "remote-storage");
    add({ ...base(session), id, revision: identity(id, session.codexStorageError), source: "storage", category: "blocker",
      title: "Remote Codex storage needs repair", detail: session.codexStorageError!, repairable: false,
      state: { status: "blocked", reason: "storage", detail: "Inspect recovery on the remote host." } });
  }
  for (const decision of teamDecisions(input.roster, sessions, input.runs)) {
    if (!decision.resume) continue;
    const id = identity(decision.resume.leadId, "continue");
    add({ ...base(decision.session), id, revision: identity(id, decision.resume.reason), source: "continue", category: "decision",
      title: "Manager needs your decision to continue", detail: decision.resume.reason, leadId: decision.resume.leadId,
      state: { status: "needs-you", reason: "decision", detail: decision.resume.reason } });
  }
  for (const run of input.runs) for (const task of run.tasks) {
    const dispatchId = task.activeDispatchId ?? task.lastDispatchId;
    const dispatch = run.dispatches?.find(dispatch => dispatch.id === dispatchId);
    const state = selectAgentLiveState(undefined, { task, tasks: run.tasks, runStatus: run.status, pauseReason: run.lastPauseReason });
    if (!["failed", "blocked", "interrupted"].includes(task.status) && !dispatch?.cleanupError && task.delivery?.ci !== "fail") continue;
    const id = identity(run.leadId, "task", task.id, dispatchId);
    add({ id, revision: identity(id, task.status, task.error, dispatch?.cleanupError, task.delivery?.head, task.delivery?.ci), source: "task", category: "failure",
      title: task.title, detail: task.error || dispatch?.cleanupError || task.checksSummary || "Task needs inspection before retrying.", state,
      status: "open", sessionId: dispatch?.sessionId ?? task.sessionId, sessionIds: [dispatch?.sessionId ?? task.sessionId], owner: task.memberName || "Worker", route: "lead",
      leadId: run.leadId, project: projectName(run.workspace?.projectCwd ?? run.cwd),
      goals: input.goals.filter(goal => goal.id === task.monoGoalId).map(goal => goal.title), taskId: task.id, dispatchId,
      createdAt: dispatch?.finishedAt ?? dispatch?.startedAt });
  }
  for (const run of input.runs) for (const dispatch of run.dispatches ?? []) {
    const task = run.tasks.find(task => task.id === dispatch.taskId);
    if (!task || dispatch.id === (task.activeDispatchId ?? task.lastDispatchId) || !["failed", "blocked", "interrupted"].includes(dispatch.state)) continue;
    const id = identity(run.leadId, "task", task.id, dispatch.id);
    add({ id, revision: identity(id, dispatch.error, dispatch.state), source: "task", category: "failure", title: task.title,
      detail: dispatch.error || dispatch.result || "Previous attempt failed.", state: { status: "failed", reason: "error" }, status: "replaced",
      sessionId: dispatch.sessionId, sessionIds: [dispatch.sessionId], owner: task.memberName || "Worker", route: "lead", leadId: run.leadId,
      project: projectName(run.workspace?.projectCwd ?? run.cwd), goals: input.goals.filter(goal => goal.id === task.monoGoalId).map(goal => goal.title),
      taskId: task.id, dispatchId: dispatch.id, createdAt: dispatch.finishedAt ?? dispatch.startedAt });
  }
  for (const repair of input.repairs ?? []) {
    if (!["failed", "interrupted", "completed", "not-needed", "cancelled"].includes(repair.phase)) continue;
    const id = identity("ci-repair", repair.id);
    add({ id, revision: identity(id, repair.headOid, repair.phase), source: "ci-repair", category: "failure",
      title: `CI repair ${repair.phase} · ${repair.repo} #${repair.number}`, detail: `Head ${repair.headOid}\n${repair.checks.map(check => `${check.workflow} · ${check.name}`).join("\n")}`,
      status: ["failed", "interrupted"].includes(repair.phase) ? "open" : "resolved", state: { status: repair.phase === "failed" ? "failed" : repair.phase === "interrupted" ? "blocked" : "done" },
      sessionId: repair.sessionId, sessionIds: [repair.sessionId], owner: "CI repair", route: "lead", leadId: repair.managerId,
      project: projectName(repair.cwd), goals: input.goals.filter(goal => goal.id === repair.goalId).map(goal => goal.title), createdAt: repair.startedAt });
  }
  for (const automation of input.automations ?? []) {
    if (automation.lastRunStatus !== "failed") continue;
    const id = identity("automation", automation.id, automation.lastRunAt, automation.lastSessionId);
    add({ id, revision: identity(id, automation.lastRunError), source: "automation", category: "failure", title: `${automation.name} · automation failed`,
      detail: automation.lastRunError || "Open Automations to inspect the failed run before starting another.", status: "open", state: { status: "failed", reason: "error" },
      sessionId: automation.lastSessionId ?? "", sessionIds: automation.lastSessionId ? [automation.lastSessionId] : [], automationId: automation.id,
      owner: automation.name, route: "user", project: projectName(automation.cwd), goals: [], createdAt: automation.lastRunAt });
  }
  return [...items.values()].sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") ||
    Number(a.category !== "blocker") - Number(b.category !== "blocker") || (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity) || a.id.localeCompare(b.id));
}

export type AttentionAction = "allow" | "deny" | "answer" | "repair" | "compare" | "reveal" | "resume" | "resume-at-reset" | "retry-delivery" | "continue" | "inspect";
export type AttentionCallbacks = {
  approval: (sessionId: string, requestId: number, decision: "allow" | "deny") => void | Promise<void>;
  question: (sessionId: string, requestId: number, reply: UserQuestionReply) => void | Promise<void>;
  questionInteraction?: (sessionId: string, requestId: number) => void;
  repair: (sessionId: string, resolution?: CodexStorageResolution) => Promise<void>;
  compare?: (sessionId: string) => Promise<CodexStorageComparison>;
  reveal?: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => void | Promise<void>;
  resumeAtReset: (sessionId: string, enabled: boolean) => void | Promise<void>;
  retryDelivery: (sessionId: string) => void | Promise<void>;
  continueManager: (leadId: string, event?: Event) => Promise<void>;
  continueRequest?: (sessionId: string, blockId: string) => Promise<void>;
  inspect: (sessionId: string) => void | Promise<void>;
  inspectAutomation?: (automationId: string) => void | Promise<void>;
};

/** Recheck the exact source immediately before invoking the existing execution callback. */
export async function executeAttentionAction(item: AttentionItem, action: AttentionAction, input: AttentionInput, callbacks: AttentionCallbacks,
  payload?: { reply?: UserQuestionReply; resolution?: CodexStorageResolution; enabled?: boolean; event?: Event }) {
  if (action === "inspect") {
    if (item.source === "automation" && callbacks.inspectAutomation) return callbacks.inspectAutomation(item.automationId!);
    if (!item.sessionId) throw Error("Conversation unavailable. Open Automations to inspect the failed run.");
    return callbacks.inspect(item.sessionId);
  }
  const fresh = selectAttention(input).find(candidate => candidate.id === item.id);
  if (!fresh || fresh.status !== "open" || fresh.revision !== item.revision) throw Error("This request changed or is no longer available. Inspect the current request.");
  if (fresh.route === "lead" && ["allow", "deny", "answer", "continue"].includes(action)) throw Error("This request belongs to the lead. Open the lead conversation.");
  const session = input.sessions.find(session => session.id === item.sessionId);
  if (!session || session.worktreeRemoved) throw Error("The conversation is unavailable. Select a working copy first.");
  if (["repair", "resume", "retry-delivery"].includes(action) && (session.busy || session.codexStoragePreparing)) throw Error("Wait for the current operation to finish before retrying.");
  switch (action) {
    case "allow": case "deny":
      if (item.source !== "approval") throw Error("Approval unavailable");
      return callbacks.approval(item.sessionId, item.requestId!, action);
    case "answer":
      if (item.source !== "question" || !payload?.reply) throw Error("Answer unavailable");
      return callbacks.question(item.sessionId, item.requestId!, payload.reply);
    case "repair":
      if (item.source !== "storage" || input.isLocalSession?.(session) === false) throw Error("Storage issue unavailable for local repair");
      return callbacks.repair(item.sessionId, payload?.resolution);
    case "compare":
      if (item.source !== "storage" || !callbacks.compare || input.isLocalSession?.(session) === false) throw Error("Comparison unavailable");
      return callbacks.compare(item.sessionId);
    case "reveal":
      if (item.source !== "storage" || !callbacks.reveal || input.isLocalSession?.(session) === false) throw Error("Recovery folder unavailable");
      return callbacks.reveal(item.sessionId);
    case "resume": case "resume-at-reset":
      if (item.source !== "usage" || session.codexStorageError) throw Error("Resolve storage before resuming");
      return action === "resume" ? callbacks.resume(item.sessionId) : callbacks.resumeAtReset(item.sessionId, payload?.enabled ?? true);
    case "retry-delivery":
      if (item.source !== "delivery" || session.codexStorageError || session.usageLimit || session.sendingQueuedMessageId ||
        session.editingQueuedMessageId || session.queueStatus !== "paused" || session.queuedMessages?.[0]?.id !== item.messageId) throw Error("Open the conversation to review this delivery before retrying.");
      return callbacks.retryDelivery(item.sessionId);
    case "continue":
      if (item.source === "manager-request") {
        if (!callbacks.continueRequest || !canContinueManagerRequest(session)) throw Error("Finish the current operation or pending decision before continuing this request.");
        return callbacks.continueRequest(item.sessionId, item.messageId!);
      }
      if (item.source !== "continue") throw Error("Manager continuation unavailable");
      return payload?.event ? callbacks.continueManager(item.leadId!, payload.event) : callbacks.continueManager(item.leadId!);
  }
}

export type AttentionReceipt = { status: "pending" | "sent" | "success" | "error"; message: string; revision?: string; submitted?: boolean };

/** Missing requests are stale unless the source or a submitted answer confirms resolution. */
export function attentionHistory(previous: readonly AttentionItem[], current: readonly AttentionItem[], receipts: Readonly<Record<string, AttentionReceipt>>, input?: AttentionInput): AttentionItem[] {
  const live = new Map(current.map(item => [item.id, item]));
  const missing = previous.flatMap(item => {
    const next = live.get(item.id);
    if (!next) return [item];
    if (item.status === "open" && next.status === "open" && next.revision !== item.revision)
      return [{ ...item, id: identity(item.id, "replaced", item.revision), status: "replaced" as const }];
    return [];
  });
  return missing.map(item => {
    if (item.status === "resolved" || item.status === "replaced") return item;
    const replacement = current.some(candidate => candidate.source === item.source && candidate.sessionId === item.sessionId && candidate.status === "open");
    const session = input?.sessions.find(session => session.id === item.sessionId && session.providerSessionId === item.providerSessionId);
    const cleared = item.source === "question" ? session && !session.pendingQuestion
      : item.source === "storage" ? item.sessionIds.every(id => input?.sessions.some(session => session.id === id && !session.codexStorageError && !session.codexStoragePreparing))
      : item.source === "usage" ? session && !session.usageLimit
      : item.source === "continue" ? input?.runs.some(run => run.leadId === item.leadId && run.status === "active") : false;
    const receipt = receipts[item.id];
    const confirmed = !replacement && (receipt?.status === "sent" || receipt?.submitted) && (!receipt.revision || receipt.revision === item.revision) && cleared;
    return { ...item, status: replacement ? "replaced" : confirmed ? "resolved" : "stale" };
  });
}
