import type { Mono } from "../monos/model/mono";
import type { MonoManagerGoals } from "../monos/model/monoManagerGoals";
import { selectDecisionView, type DecisionView } from "../commandCenter/model/decisionView";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../commandCenter/ui/Decisions";
import { pathKey } from "../../shared/lib/paths";
import type { CommandMapDecisions } from "./commandMap";
import { distinctGoalNextActions, type GoalNextStep } from "../commandCenter/model/goalNextAction";

const incomplete = (view: DecisionView) => view.pruned > 0 || view.skipped > 0;

/** Call after the host hydrates the live Managers; actions remain the lite host's. */
export function commandMapDecisions(ledger: MonoManagerGoals, roster: readonly Mono[], actions: DecisionUiActions, now: number,
  goals?: { steps: readonly GoalNextStep[]; render(step: GoalNextStep): ReactNode }) : CommandMapDecisions {
  const view = selectDecisionView(ledger, roster, now);
  const rows = distinctGoalNextActions(goals?.steps ?? []);
  const extraCount = (steps: readonly GoalNextStep[], view: DecisionView) => steps.filter(step => !view.pending.some(item => step.key === `decision:${item.managerId}:${item.decision.id}`)).length;
  return {
    needYou: view.pending.length + extraCount(rows, view),
    handledToday: view.handledToday,
    incomplete: incomplete(view),
    rail: <Decisions view={view} roster={roster} actions={actions} presentation="rail" goalActions={rows.filter(step => !step.decisionId).map(step => goals?.render(step))} goalActionCount={extraCount(rows, view)} />,
    project(projectId, managerId) {
      const managers = roster.filter(mono => mono.id === managerId && mono.role === "manager" && mono.archivedAt == null &&
        mono.projects.some(project => pathKey(project) === pathKey(projectId)));
      const scoped = selectDecisionView(ledger, managers, now, projectId);
      const steps = managers.length ? goals?.steps.filter(step => step.managerMonoId === managerId && pathKey(step.projectId) === pathKey(projectId)) ?? [] : [];
      const rows = distinctGoalNextActions(steps);
      return {
        pending: scoped.pending.length + extraCount(rows, scoped),
        teamPending: scoped.teamPending,
        incomplete: !managers.length || incomplete(scoped),
        autonomy: managers.length ? <ProjectAutonomyControl managerId={managerId} projectId={projectId} value={ledger.autonomy(managerId, projectId)} actions={actions} />
          : <p className="command-map-muted">Autonomy unavailable</p>,
        goalAction: goalId => { const step = steps.find(step => step.goalId === goalId); return step && goals?.render(step); },
        cards: managers.length ? <Decisions view={scoped} roster={roster} actions={actions} presentation="rail" goalActions={rows.filter(step => !step.decisionId).map(step => goals?.render(step))} goalActionCount={extraCount(rows, scoped)} />
          : <p className="command-map-muted">Decision history unavailable</p>,
      };
    },
  };
}
import type { ReactNode } from "react";
