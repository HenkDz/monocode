import type { Mono } from "../../monos/model/mono";
import type { MonoDecision } from "../../monos/model/monoDecisions";
import type { MonoManagerGoals, MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { teamDecisions } from "../../monos/model/monoTeamActivity";
import { pathKey } from "../../../shared/lib/paths";
import type { GoalNextStep } from "./goalNextAction";
import { selectAttention, type AttentionInput, type AttentionItem } from "./attention";

/** Stable request identity is shared by counts and cards; prose never identifies an approval. */
export function selectNeedsUser(roster: readonly Mono[], sessions: readonly Session[], runs: readonly OrchestrationRun[], view: DecisionView, steps: readonly GoalNextStep[] = [], input?: AttentionInput) {
  const team = teamDecisions(roster, sessions, runs);
  const attention = selectAttention(input ?? { roster, sessions, runs, goals: [] });
  const attentionKey = (item: AttentionItem) => item.source === "approval" || item.source === "question" ? `${item.sessionId}:${item.source}:${item.requestId}`
    : item.source === "continue" ? `${item.leadId}:continue` : item.source === "manager-request" ? `manager-request:${item.sessionId}:${item.messageId?.replace(/^manager-request-/, "")}` : item.id;
  const open = attention.filter(item => item.status === "open");
  const pending = [...new Map(view.pending.map(item => [`decision:${item.managerId}:${item.decision.id}`, item])).values()];
  const known = new Set([...open.map(attentionKey), ...pending.map(item => `decision:${item.managerId}:${item.decision.id}`)]);
  const goals = [...new Map(steps.filter(step => step.action !== "chat" && !known.has(step.key)).map(step => [step.key, step])).values()];
  const sources = [...open.map(item => ({ key: item.id, project: runs.find(run => run.leadId === item.leadId)?.cwd ?? sessions.find(session => item.sessionIds.includes(session.id))?.cwd ?? input?.automations?.find(entry => entry.id === item.automationId)?.cwd ?? item.project })),
    ...pending.map(item => ({ key: `decision:${item.managerId}:${item.decision.id}`, project: item.decision.projectId })),
    ...goals.map(step => ({ key: step.key, project: step.projectId }))];
  return { team, pending, goals, attention, sources, count: sources.length };
}

export type OwnedDecision = { managerId: string; decision: MonoDecision };
export type DecisionView = { pending: OwnedDecision[]; log: OwnedDecision[]; teamPending: number; handledToday: number; pruned: number; skipped: number };
export function endedDecisionSources(goals: readonly MonoManagerGoal[], runs: readonly OrchestrationRun[]): Set<string> {
  return new Set([
    ...goals.filter(goal => goal.state === "done" || goal.state === "cancelled").map(goal => goal.id),
    ...runs.flatMap(run => run.tasks.filter(task => task.status === "cancelled").map(task => task.id)),
  ]);
}
export function decisionCountsByProject(roster: readonly Mono[], sessions: readonly Session[], runs: readonly OrchestrationRun[], view: DecisionView, steps: readonly GoalNextStep[] = [], input?: AttentionInput): Map<string, number> {
  const counts = new Map<string, Set<string>>();
  for (const { project, key: id } of selectNeedsUser(roster, sessions, runs, view, steps, input).sources) {
    const key = pathKey(project);
    const sources = counts.get(key) ?? new Set<string>();
    sources.add(id); counts.set(key, sources);
  }
  return new Map([...counts].map(([key, sources]) => [key, sources.size]));
}
export function selectDecisionView(ledger: MonoManagerGoals, roster: readonly Mono[], now: number, projectId?: string): DecisionView {
  const managers = roster.filter(mono => mono.role === "manager" && mono.archivedAt == null && (projectId === undefined || mono.projects.some(project => pathKey(project) === pathKey(projectId))));
  const all = managers.flatMap(manager => ledger.decisions(manager.id).map(decision => ({ managerId: manager.id, decision })))
    .filter(({ decision }) => projectId === undefined || pathKey(decision.projectId) === pathKey(projectId));
  const waiting = ({ decision }: OwnedDecision) => decision.status === "waiting" && decision.noLongerNeededAt == null && !decision.readOnly;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return {
    pending: all.filter(item => waiting(item) && item.decision.answererId === "user").sort((a, b) => a.decision.createdAt - b.decision.createdAt),
    log: all.filter(item => !waiting(item)).sort((a, b) => (b.decision.answeredAt ?? b.decision.noLongerNeededAt ?? b.decision.createdAt) - (a.decision.answeredAt ?? a.decision.noLongerNeededAt ?? a.decision.createdAt)),
    teamPending: all.filter(item => waiting(item) && item.decision.answererId !== "user").length,
    handledToday: all.filter(({ decision }) => decision.status === "answered" && decision.answeredBy !== "user" && decision.answeredAt! >= today.getTime() && decision.answeredAt! <= now).length,
    pruned: managers.reduce((count, manager) => count + ledger.decisionsPruned(manager.id), 0),
    skipped: managers.reduce((count, manager) => count + ledger.decisionsSkipped(manager.id), 0),
  };
}
export function decisionActorName(roster: readonly Mono[], id: string): string {
  if (id === "user") return "You";
  const mono = roster.find(mono => mono.id === id);
  return (mono?.name ?? mono?.specialty ?? (mono?.role === "orchestrator" ? "Boss" : mono?.role === "manager" ? "Manager" : "Teammate")).slice(0, 64);
}
