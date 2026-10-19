import type { Mono } from "../../monos/model/mono";
import type { MonoDecision, DecisionQuarantine } from "../../monos/model/monoDecisions";
import type { MonoManagerGoals } from "../../monos/model/monoManagerGoals";
import { pathKey } from "../../../shared/lib/paths";

export type OwnedDecision = { managerId: string; decision: MonoDecision };
export type DecisionView = {
  pending: OwnedDecision[];
  log: OwnedDecision[];
  teamPending: number;
  handledToday: number;
  pruned: number;
  loading: string[];
  quarantine: { managerId: string; entries: DecisionQuarantine[] }[];
};

/** Shared by the Decisions page, project drawer and command-map rail. */
export function selectDecisionView(ledger: MonoManagerGoals, roster: readonly Mono[], now: number, projectId?: string): DecisionView {
  const managers = roster.filter(mono => mono.role === "manager" && mono.archivedAt == null &&
    (projectId === undefined || mono.projects.some(project => pathKey(project) === pathKey(projectId))));
  const all = managers.flatMap(manager => ledger.decisions(manager.id).map(decision => ({ managerId: manager.id, decision })))
    .filter(({ decision }) => projectId === undefined || pathKey(decision.projectId) === pathKey(projectId));
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const pending = all.filter(({ decision }) => decision.status !== "decided" && decision.deciderLevel === "user" && decision.deliveryState === "current")
    .sort((a, b) => a.decision.createdAt - b.decision.createdAt);
  return {
    pending,
    log: all.filter(({ decision }) => decision.status === "decided").sort((a, b) => b.decision.decidedAt! - a.decision.decidedAt!),
    teamPending: all.filter(({ decision }) => decision.status !== "decided" && decision.deciderLevel !== "user" && decision.deliveryState === "current").length,
    handledToday: all.filter(({ decision }) => decision.status === "decided" && decision.deciderLevel !== "user" &&
      decision.deliveryState === "current" && decision.decidedAt! >= today.getTime() && decision.decidedAt! <= now).length,
    pruned: managers.reduce((count, manager) => count + ledger.decisionsPruned(manager.id), 0),
    loading: managers.filter(manager => ledger.decisionHistoryState(manager.id) === "loading").map(manager => manager.id),
    quarantine: managers.map(manager => ({ managerId: manager.id, entries: ledger.decisionQuarantine(manager.id) })).filter(item => item.entries.length > 0),
  };
}

export function decisionActorName(roster: readonly Mono[], id: string): string {
  if (id === "user") return "You";
  const mono = roster.find(mono => mono.id === id);
  return (mono?.name ?? mono?.specialty ?? (mono?.role === "orchestrator" ? "Boss" : mono?.role === "manager" ? "Manager" : "Teammate")).slice(0, 64);
}

/** Quarantine previews are read-only display; none of these fields become authority. */
export function unreadableDecisionPreview(entry: DecisionQuarantine): { id: string; question: string }[] {
  try {
    const raw: unknown = JSON.parse(entry.raw);
    const decisions = raw && typeof raw === "object" && "decisions" in raw ? raw.decisions : undefined;
    if (!Array.isArray(decisions)) return [];
    return decisions.flatMap(value => value && typeof value === "object" && ["pending", "delegated"].includes(value.status) &&
      typeof value.id === "string" && value.id.length <= 256 && typeof value.question === "string"
      ? [{ id: value.id, question: value.question.slice(0, 300) }] : []);
  } catch { return []; }
}
