import type { Mono } from "../monos/model/mono";
import type { MonoManagerGoals } from "../monos/model/monoManagerGoals";
import { selectDecisionView, selectNeedsUser, type DecisionView } from "../commandCenter/model/decisionView";
import type { AttentionInput } from "../commandCenter/model/attention";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../commandCenter/ui/Decisions";
import { pathKey } from "../../shared/lib/paths";
import type { CommandMapDecisions } from "./commandMap";
import type { GoalNextStep } from "../commandCenter/model/goalNextAction";

const incomplete = (view: DecisionView) => view.pruned > 0 || view.skipped > 0;

/** Call after the host hydrates the live Managers; actions remain the lite host's. */
export function commandMapDecisions(ledger: MonoManagerGoals, roster: readonly Mono[], actions: DecisionUiActions, now: number,
  goals?: { steps: readonly GoalNextStep[]; render(step: GoalNextStep): ReactNode; input?: AttentionInput; attention?(projectId?: string): ReactNode }) : CommandMapDecisions {
  const view = selectDecisionView(ledger, roster, now);
  const needs = selectNeedsUser(roster, goals?.input?.sessions ?? [], goals?.input?.runs ?? [], view, goals?.steps, goals?.input);
  const rows = needs.goals;
  const extraCount = (steps: readonly GoalNextStep[], view: DecisionView) => steps.filter(step => !view.pending.some(item => step.key === `decision:${item.managerId}:${item.decision.id}`)).length;
  return {
    needYou: needs.count,
    handledToday: view.handledToday,
    incomplete: incomplete(view),
    rail: <Decisions view={view} roster={roster} actions={actions} presentation="rail" goalActions={rows.filter(step => !step.decisionId).map(step => goals?.render(step))} goalActionCount={extraCount(rows, view)} attention={goals?.attention?.()} attentionCount={needs.attention.filter(item => item.status === "open").length} />,
    project(projectId, managerId) {
      const managers = roster.filter(mono => mono.id === managerId && mono.role === "manager" && mono.archivedAt == null &&
        mono.projects.some(project => pathKey(project) === pathKey(projectId)));
      const scoped = selectDecisionView(ledger, managers, now, projectId);
      const steps = managers.length ? goals?.steps.filter(step => step.managerMonoId === managerId && pathKey(step.projectId) === pathKey(projectId)) ?? [] : [];
      const rows = needs.goals.filter(step => steps.some(candidate => candidate.key === step.key));
      const attentionCount = managers.length ? needs.sources.filter(source => pathKey(source.project) === pathKey(projectId) && needs.attention.some(item => item.id === source.key && item.status === "open")).length : 0;
      return {
        pending: scoped.pending.length + extraCount(rows, scoped) + attentionCount,
        teamPending: scoped.teamPending,
        incomplete: !managers.length || incomplete(scoped),
        autonomy: managers.length ? <ProjectAutonomyControl managerId={managerId} projectId={projectId} value={ledger.autonomy(managerId, projectId)} actions={actions} />
          : <p className="command-map-muted">Autonomy unavailable</p>,
        goalAction: goalId => { const step = steps.find(step => step.goalId === goalId); return step && goals?.render(step); },
        cards: managers.length ? <Decisions view={scoped} roster={roster} actions={actions} presentation="rail" goalActions={rows.filter(step => !step.decisionId && needs.goals.some(row => row.key === step.key)).map(step => goals?.render(step))} goalActionCount={extraCount(needs.goals.filter(row => pathKey(row.projectId) === pathKey(projectId)), scoped)} attention={goals?.attention?.(projectId)} attentionCount={attentionCount} />
          : <p className="command-map-muted">Decision history unavailable</p>,
      };
    },
  };
}
import type { ReactNode } from "react";
