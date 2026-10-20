import type { Mono } from "../monos/model/mono";
import type { MonoManagerGoals } from "../monos/model/monoManagerGoals";
import { selectDecisionView, type DecisionView } from "../commandCenter/model/decisionView";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../commandCenter/ui/Decisions";
import { pathKey } from "../../shared/lib/paths";
import type { CommandMapDecisions } from "./commandMap";
import type { GoalNextStep } from "../commandCenter/model/goalNextAction";

const incomplete = (view: DecisionView) => view.pruned > 0 || view.skipped > 0;

/** Call after the host hydrates the live Managers; actions remain the lite host's. */
export function commandMapDecisions(ledger: MonoManagerGoals, roster: readonly Mono[], actions: DecisionUiActions, now: number,
  goals?: { steps: readonly GoalNextStep[]; render(step: GoalNextStep): ReactNode }) : CommandMapDecisions {
  const view = selectDecisionView(ledger, roster, now);
  return {
    needYou: view.pending.length + (goals?.steps.length ?? 0),
    handledToday: view.handledToday,
    incomplete: incomplete(view),
    rail: <Decisions view={view} roster={roster} actions={actions} presentation="rail" goalActions={goals?.steps.map(goals.render)} goalActionCount={goals?.steps.length} />,
    project(projectId, managerId) {
      const managers = roster.filter(mono => mono.id === managerId && mono.role === "manager" && mono.archivedAt == null &&
        mono.projects.some(project => pathKey(project) === pathKey(projectId)));
      const scoped = selectDecisionView(ledger, managers, now, projectId);
      const steps = managers.length ? goals?.steps.filter(step => step.managerMonoId === managerId && pathKey(step.projectId) === pathKey(projectId)) ?? [] : [];
      return {
        pending: scoped.pending.length + steps.length,
        teamPending: scoped.teamPending,
        incomplete: !managers.length || incomplete(scoped),
        autonomy: managers.length ? <ProjectAutonomyControl managerId={managerId} projectId={projectId} value={ledger.autonomy(managerId, projectId)} actions={actions} />
          : <p className="command-map-muted">Autonomy unavailable</p>,
        goalAction: goalId => { const step = steps.find(step => step.goalId === goalId); return step && goals?.render(step); },
        cards: managers.length ? <Decisions view={scoped} roster={roster} actions={actions} presentation="rail" goalActions={steps.map(step => goals?.render(step))} goalActionCount={steps.length} />
          : <p className="command-map-muted">Decision history unavailable</p>,
      };
    },
  };
}
import type { ReactNode } from "react";
