import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listMonos, monosSnapshot, subscribeMonos } from "../../monos/model/mono";
import { monoManagerGoals } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { goalElapsedLabel, goalTokenLabel, selectGoalViews, type GoalTarget, type GoalView, type GoalViewModel } from "../model/goalView";
import { GoalChain } from "./GoalChain";
import "./missionControl.css";

// CC7C shell hook: share the existing full-view/back/escape lifecycle.
export const MISSION_CONTROL_SCOPE = "command-center:mission-control";

export function MissionControlNav({ onOpen, compact = false }: {
  onOpen: () => void; compact?: boolean;
}) {
  return <button type="button" onClick={onOpen} title="Mission control" aria-label="Mission control"
    className={`flex shrink-0 items-center gap-2 rounded-md text-[13px] text-content/65 hover:bg-content/8 hover:text-content focus-visible:outline-accent ${compact ? "mx-auto size-8 justify-center" : "mx-2 my-1 h-8 px-2"}`}>
    <span aria-hidden="true">◎</span>{!compact && "Mission control"}
  </button>;
}

function GoalRow({ view, onOpenTarget }: { view: GoalView; onOpenTarget: (target: GoalTarget) => void }) {
  return <article className="mc-goal" aria-label={view.goal.title}>
    <header className="mc-goal-header">
      <div><h2>{view.goal.title}</h2><p className="mc-goal-meta"><span>{view.project}</span>
        <span>Wall elapsed · {goalElapsedLabel(view.wallElapsedMs)}</span><span>{view.goal.state === "cancelled" ? "Cancelled" : view.goal.state === "done" ? "Done" : view.goal.state.replace("-", " ")}</span></p></div>
      <div className="mc-goal-tokens"><strong>{goalTokenLabel(view.metrics)}</strong><span>Input including cache + output · cost unavailable</span></div>
    </header>
    {view.rosterIssue && <p className="mc-roster-issue">{view.rosterIssue}</p>}
    <GoalChain view={view} onOpenTarget={onOpenTarget} />
  </article>;
}

export function MissionControlView({ view, onOpenTarget, onClose, open = true }: {
  view: GoalViewModel; onOpenTarget: (target: GoalTarget) => void | Promise<void>; onClose: () => void; open?: boolean;
}) {
  const [project, setProject] = useState("");
  const [navigationError, setNavigationError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  const projects = [...new Map([...view.live, ...view.finished].map(goal => [goal.projectId, goal.project])).entries()];
  const live = view.live.filter(goal => !project || goal.projectId === project);
  const finished = view.finished.filter(goal => !project || goal.projectId === project);
  const openTarget = (target: GoalTarget) => {
    setNavigationError(undefined);
    void Promise.resolve().then(() => onOpenTarget(target)).catch(error => setNavigationError(error instanceof Error ? error.message : String(error)));
  };
  return <section className="mission-control" aria-labelledby="mission-control-title" hidden={!open} inert={!open || undefined}>
    <header className="mc-toolbar"><div><p className="mc-eyebrow">Command center</p><h1 id="mission-control-title">Mission control</h1>
      <p className="mc-subtitle">Live goals and the people moving them forward.</p></div>
      <button type="button" className="mc-button" onClick={onClose}>Back to conversation</button>
    </header>
    <div className="mc-scroll">
      {navigationError && <p className="mc-navigation-error" role="alert">Could not open conversation: {navigationError}</p>}
      {!!view.attention.length && <aside className="mc-attention" aria-label="Attention">
        <div><strong>{view.attention.length} {view.attention.length === 1 ? "item needs" : "items need"} you</strong>
          <p>Across all projects · requests and storage or usage blockers in live goal conversations.</p></div>
        <button type="button" className="mc-button" onClick={() => openTarget(view.attention[0].target!)}>Open conversation →</button>
      </aside>}
      <div className="mc-list-heading"><h2>Live goals <span>· {live.length}</span></h2><label>Project
        <select aria-label="Filter goals by project" value={project} onChange={event => setProject(event.target.value)}>
          <option value="">All projects</option>{projects.map(([id, name]) => <option key={id} value={id} title={id}>
            {projects.filter(([, other]) => other === name).length > 1 ? `${name} · ${id}` : name}
          </option>)}
        </select></label></div>
      <p className="mc-coverage">Recorded tokens are scoped to each goal. Shared turns can appear in several goals; these totals overlap.</p>
      {live.map(goal => <GoalRow key={goal.goal.id} view={goal} onOpenTarget={openTarget} />)}
      {!live.length && <p className="mc-empty">{project ? "No live goals in this project." : "No live goals yet. Assign a goal in your Orchestrator conversation to begin."}</p>}
      <details className="mc-finished"><summary>Finished · {finished.length}</summary>
        {finished.map(goal => <GoalRow key={goal.goal.id} view={goal} onOpenTarget={openTarget} />)}
        {!finished.length && <p className="mc-empty">No finished goals in this view.</p>}
      </details>
    </div>
  </section>;
}

export function MissionControl({ sessions, runs, onOpenTarget, onClose, open }: {
  sessions: readonly Session[]; runs: readonly OrchestrationRun[];
  onOpenTarget: (target: GoalTarget) => void | Promise<void>; onClose: () => void; open: boolean;
}) {
  const rosterSnapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const goalsSnapshot = useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const roster = useMemo(() => listMonos(), [rosterSnapshot]);
  const goals = useMemo(() => monoManagerGoals.goals(), [goalsSnapshot]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const view = useMemo(() => selectGoalViews({ goals, roster, runs, sessions, now }), [goals, roster, runs, sessions, now]);
  return <MissionControlView view={view} onOpenTarget={onOpenTarget} onClose={onClose} open={open} />;
}
