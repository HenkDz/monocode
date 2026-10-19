import type { Mono } from "../monos/model/mono";
import type { MonoManagerGoals } from "../monos/model/monoManagerGoals";
import { selectDecisionView, type DecisionView } from "../commandCenter/model/decisionView";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../commandCenter/ui/Decisions";
import { pathKey } from "../../shared/lib/paths";
import type { CommandMapDecisions } from "./commandMap";

const incomplete = (view: DecisionView) => view.pruned > 0 || view.skipped > 0;

/** Call after the host hydrates the live Managers; actions remain the lite host's. */
export function commandMapDecisions(ledger: MonoManagerGoals, roster: readonly Mono[], actions: DecisionUiActions, now: number): CommandMapDecisions {
  const view = selectDecisionView(ledger, roster, now);
  return {
    needYou: view.pending.length,
    handledToday: view.handledToday,
    incomplete: incomplete(view),
    rail: <Decisions view={view} roster={roster} actions={actions} presentation="rail" />,
    project(projectId, managerId) {
      const managers = roster.filter(mono => mono.id === managerId && mono.role === "manager" && mono.archivedAt == null &&
        mono.projects.some(project => pathKey(project) === pathKey(projectId)));
      const scoped = selectDecisionView(ledger, managers, now, projectId);
      return {
        pending: scoped.pending.length,
        teamPending: scoped.teamPending,
        incomplete: !managers.length || incomplete(scoped),
        autonomy: managers.length ? <ProjectAutonomyControl managerId={managerId} projectId={projectId} value={ledger.autonomy(managerId, projectId)} actions={actions} />
          : <p className="command-map-muted">Autonomy unavailable</p>,
        cards: managers.length ? <Decisions view={scoped} roster={roster} actions={actions} presentation="rail" />
          : <p className="command-map-muted">Decision history unavailable</p>,
      };
    },
  };
}
