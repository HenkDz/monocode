import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GitPr } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import { listMonos, monosSnapshot, subscribeMonos } from "../../monos/model/mono";
import { monoManagerGoals } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { selectAttention, type AttentionInput } from "../model/attention";
import { useAttentionSources } from "../model/useAttentionSources";
import { selectCockpit, type CockpitAgent, type CockpitModel } from "../model/cockpit";
import { goalElapsedLabel, selectGoalViews, type GoalTarget, type GoalViewModel } from "../model/goalView";
import { selectGoalTimeline, type GoalTimeline } from "../model/timeline";
import { GoalChain } from "./GoalChain";
import { GoalProgress } from "./GoalProgress";
import "./missionControl.css";

export const MISSION_CONTROL_SCOPE = "command-center:mission-control";

export function MissionControlNav({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  return <button type="button" onClick={onOpen} title="Mission control" aria-label="Mission control"
    className={`flex shrink-0 items-center gap-2 rounded-md text-[13px] text-content/65 hover:bg-content/8 hover:text-content focus-visible:outline-accent ${compact ? "mx-auto size-8 justify-center" : "mx-2 my-1 h-8 px-2"}`}>
    <span aria-hidden="true">◎</span>{!compact && "Mission control"}
  </button>;
}

type Preferences = { project: string; state: string; density: "comfortable" | "compact" };
const preferenceKey = "monocode:mission-control-v2";
function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
    return { project: typeof saved.project === "string" ? saved.project : "", state: ["All states", "Working", "Needs attention", "Idle"].includes(saved.state) ? saved.state : "All states", density: saved.density === "compact" ? "compact" : "comfortable" };
  } catch { return { project: "", state: "All states", density: "comfortable" }; }
}
const emptyCockpit: CockpitModel = { agents: [], activity: [], active: 0, idle: 0, handoffSamples: 0, tokensPartial: false };
type ViewProps = {
  view: GoalViewModel; cockpit?: CockpitModel; attentionInput?: AttentionInput; attentionSourceError?: string;
  timeline?: (id: string) => GoalTimeline | undefined; command?: ReactNode;
  renderAttention?: (onClose: () => void) => ReactNode;
  onOpenTarget: (target: GoalTarget) => void | Promise<void>; onClose: () => void; open?: boolean;
};

export function MissionControlView({ view, cockpit = emptyCockpit, attentionInput, attentionSourceError, timeline, command, renderAttention, onOpenTarget, onClose, open = true }: ViewProps) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [panel, setPanel] = useState<string>();
  const [navigationError, setNavigationError] = useState<string>();
  const section = useRef<HTMLElement>(null);
  const descriptionId = useId();
  const { project, state, density } = preferences;
  const projects = [...new Map([...cockpit.agents.filter(agent => agent.projectId).map(agent => [pathKey(agent.projectId!), agent.project] as const), ...[...view.live, ...view.finished].map(goal => [pathKey(goal.projectId), goal.project] as const)]).entries()];
  const activeProject = projects.some(([id]) => id === project) ? project : "";
  useEffect(() => { try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* View choices still work without storage. */ } }, [preferences]);
  useEffect(() => { if (!open) setPanel(undefined); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || panel || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!["j", "k"].includes(event.key)) return;
      const cards = [...(section.current?.querySelectorAll<HTMLButtonElement>("[data-mc-roving]") ?? [])];
      if (!cards.length) return;
      event.preventDefault();
      const index = cards.indexOf(document.activeElement as HTMLButtonElement);
      cards[index < 0 ? event.key === "j" ? 0 : cards.length - 1 : (index + (event.key === "j" ? 1 : -1) + cards.length) % cards.length].focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, panel]);
  const openTarget = (target: GoalTarget) => {
    setNavigationError(undefined);
    void Promise.resolve().then(() => onOpenTarget(target)).catch(error => setNavigationError(error instanceof Error ? error.message : String(error)));
  };
  const matchesState = (status: string) => state === "All states" || (state === "Working" ? ["thinking", "running-tool", "compacting", "running"].includes(status)
    : state === "Needs attention" ? ["blocked", "needs-you", "failed"].includes(status) : status === "idle");
  const agents = cockpit.agents.filter(agent => (!activeProject || !agent.projectId || pathKey(agent.projectId) === activeProject) && matchesState(agent.state.status));
  const live = view.live.filter(goal => (!activeProject || pathKey(goal.projectId) === activeProject) && matchesState(goal.goal.state));
  const attention = attentionInput ? selectAttention(attentionInput).filter(item => item.status === "open") : [];
  const goal = [...view.live, ...view.finished].find(goal => goal.goal.id === panel);
  const closePanel = () => setPanel(undefined);
  const patch = (change: Partial<Preferences>) => setPreferences(previous => ({ ...previous, ...change }));
  const card = (agent: CockpitAgent, lead = false) => <button type="button" key={agent.id} className={`${lead ? "mc-org-lead" : "mc-agent-card"} agent-state-surface`}
    data-mc-roving data-state={agent.state.status} data-agent={agent.id} onClick={() => openTarget(agent.target)} aria-label={`Open ${agent.name}`} aria-describedby={`${descriptionId}-${agent.id}-activity ${descriptionId}-${agent.id}-state`}>
    <span className="mc-agent-top"><span className="mc-avatar" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span><span><strong>{agent.name}</strong><small>{agent.role}</small></span></span>
    <span id={`${descriptionId}-${agent.id}-activity`} className="mc-activity-text" title={agent.activity}>{agent.activity}</span>
    <span id={`${descriptionId}-${agent.id}-state`} className="mc-agent-bottom"><AgentStatusLabel state={agent.state} /><span className="mc-elapsed" title="Current observed turn time">{agent.elapsedMs == null ? "—" : goalElapsedLabel(agent.elapsedMs)}</span></span>
  </button>;
  return <section ref={section} className="mission-control" data-density={density} aria-labelledby="mission-control-title" hidden={!open} inert={!open || undefined}>
    <div className="mc-topbar"><span>Workspace <span>/</span> <strong>Mission control</strong></span><span><i />Updated just now</span></div>
    <div className="mc-scroll">
      <header className="mc-toolbar"><div><p className="mc-eyebrow">Command center</p><h1 id="mission-control-title">Mission control</h1><p className="mc-subtitle">Your team, at a glance.</p></div>
        <button type="button" className="mc-button" onClick={event => { event.currentTarget.focus(); setPanel("goals"); }}>Goals <span>{view.live.length}</span> →</button></header>
      {command}
      {navigationError && <p className="mc-navigation-error" role="alert">Could not open conversation: {navigationError}</p>}
      {attentionSourceError && <p className="mc-navigation-error" role="alert">{attentionSourceError}</p>}
      {!!attention.length && <aside className="mc-attention" aria-label="Organization attention"><div><strong>Needs attention</strong> <span>{attention.length}</span></div>
        {attention.slice(0, 2).map(item => <button type="button" key={item.id} onClick={event => {
          if (item.sessionId) openTarget(item.route === "lead" && item.leadId ? { requestSessionId: item.leadId } : { requestSessionId: item.sessionId });
          else { event.currentTarget.focus(); setPanel("attention"); }
        }}>
          <span><strong>{item.title}</strong><small>{item.project} · {item.owner}</small></span><span className="mc-attention-kind">{item.category} →</span></button>)}
        <button type="button" className="mc-attention-all" onClick={event => { event.currentTarget.focus(); setPanel("attention"); }}>View all →</button></aside>}
      <section className="mc-vitals" aria-label="Organization vitals">
        <div><strong>{cockpit.active}<small>/ {cockpit.agents.length} agents</small></strong><span>Active now</span></div>
        <div><strong>{cockpit.idle}</strong><span>Idle and available</span></div><div><strong>{view.live.length}</strong><span>Goals in flight</span></div>
        <div title={`Dispatch to recorded turn start · ${cockpit.handoffSamples} samples`}><strong>{cockpit.handoffMs == null ? "—" : goalElapsedLabel(cockpit.handoffMs)}</strong><span>Average hand-off</span></div>
        <div title="Unique loaded conversations and recorded turns today; input includes cache. Coverage can be incomplete."><strong>{cockpit.tokensToday == null ? "—" : `${cockpit.tokensPartial ? "≥ " : ""}${cockpit.tokensToday.toLocaleString()}`}</strong><span>Tokens today · recorded</span></div>
      </section>
      <div className="mc-filters"><div className="mc-segmented" aria-label="Project filter"><button type="button" aria-pressed={!activeProject} onClick={() => patch({ project: "" })}>All projects</button>
        {projects.map(([id, name]) => <button type="button" key={id} title={id} aria-pressed={activeProject === id} onClick={() => patch({ project: id })}>{name}</button>)}</div>
        <div className="mc-filter-tools"><select aria-label="All states" value={state} onChange={event => patch({ state: event.target.value })}>{["All states", "Working", "Needs attention", "Idle"].map(label => <option key={label}>{label}</option>)}</select>
          <div className="mc-segmented" aria-label="Density">{["comfortable", "compact"].map(value => <button type="button" key={value} aria-pressed={density === value} onClick={() => patch({ density: value as Preferences["density"] })}>{value === "comfortable" ? "Comfortable" : "Compact"}</button>)}</div></div>
      </div>
      {agents.filter(agent => !agent.projectId).map(agent => card(agent, true))}
      {projects.map(([id, name]) => { const group = agents.filter(agent => agent.projectId && pathKey(agent.projectId) === id); return group.length ? <section className="mc-agent-group" key={id} aria-label={`${name} agents`}>
        <div className="mc-section-heading"><h2>{name}<small>{group.length} agents</small></h2><span>Current turn / attempt time</span></div><div className="mc-agent-grid">{group.map(agent => card(agent))}</div></section> : null; })}
      {!agents.length && <p className="mc-empty">{cockpit.agents.length ? "No agents match these filters." : "Your team will appear here when agents are added."}</p>}
      <section className="mc-flight-strip" aria-label="In flight"><span>In flight</span>{live.map(goal => <button type="button" key={goal.goal.id} data-mc-roving data-goal={goal.goal.id} onClick={event => { event.currentTarget.focus(); setPanel(goal.goal.id); }}>
        <strong>{goal.goal.title}</strong><small>{goal.project} · {goal.goal.state.replace("-", " ")}</small><span className="mc-elapsed">{goal.wallElapsedMs == null ? "—" : goalElapsedLabel(goal.wallElapsedMs)}</span></button>)}
        {!live.length && <p>{view.live.length ? "No goals match these filters." : "No live goals. Ask a question or assign the next one above."}</p>}</section>
      <section className="mc-feed" aria-label="Recent activity"><div className="mc-section-heading"><h2>Recent activity</h2><span>Recorded outcomes</span></div>
        {cockpit.activity.map(item => <button type="button" className="mc-feed-item" key={item.id} onClick={() => openTarget(item.target)}><span className="mc-feed-icon" aria-hidden="true">{item.kind === "merge" ? "⑂" : "✓"}</span>
          <span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.at == null ? "—" : goalElapsedLabel(Math.max(0, Date.now() - item.at)) + " ago"}</time></button>)}
        {!cockpit.activity.length && <p className="mc-empty">Completed work and reviews will appear here.</p>}</section>
      <footer className="mc-footer"><button type="button" className="mc-link" onClick={onClose}>Back to conversation</button><span><kbd>j</kbd> <kbd>k</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close</span></footer>
    </div>
    {open && panel && <Modal title={panel === "attention" ? "Needs attention" : panel === "goals" ? "Goals" : goal?.goal.title ?? "Goal unavailable"} className="mc-drawer" onClose={closePanel}>
      <div className="mc-drawer-content">
        {panel === "attention" ? renderAttention?.(closePanel) ?? attention.map(item => <button type="button" className="mc-goal-row" key={item.id} onClick={() => openTarget({ requestSessionId: item.route === "lead" && item.leadId ? item.leadId : item.sessionId })}><strong>{item.title}</strong><small>{item.owner} · {item.detail}</small></button>)
          : panel === "goals" ? <><p className="mc-eyebrow">In flight · {view.live.length}</p>{[...view.live, ...view.finished].map(entry => <button type="button" key={entry.goal.id} className="mc-goal-row" onClick={() => setPanel(entry.goal.id)}>
            <strong>{entry.goal.title}</strong><small>{entry.project} · {entry.goal.state.replace("-", " ")}</small></button>)}{!view.live.length && <p className="mc-empty">No goals in flight. The team is ready for your next assignment.</p>}</>
          : goal ? <><p className="mc-eyebrow">{goal.project} / Goal</p><div className="mc-drawer-meta"><span>{goal.goal.state.replace("-", " ")}</span><span className="mc-elapsed">{goal.wallElapsedMs == null ? "—" : goalElapsedLabel(goal.wallElapsedMs)} wall elapsed</span></div>
            <p className="mc-activity-text">{goal.nodes.find(node => node.state?.detail)?.state?.detail ?? goal.nodes.find(node => node.activity)?.activity ?? "No current activity recorded."}</p>
            {goal.rosterIssue && <p className="mc-phase-detail">{goal.rosterIssue}</p>}
            <div className="mc-section-heading"><h3>Delegation chain</h3><span>Current assignments</span></div><GoalChain view={goal} onOpenTarget={openTarget} />
            <GoalProgress key={goal.goal.id} timeline={timeline?.(goal.goal.id)} onOpenTarget={openTarget} />
            <div className="mc-drawer-actions">{goal.nodes.find(node => node.role === "manager")?.target && <button type="button" className="mc-button mc-primary" onClick={() => openTarget(goal.nodes.find(node => node.role === "manager")!.target!)}>Message Manager</button>}
              {goal.nodes.find(node => node.role === "worker" && node.target)?.target && <button type="button" className="mc-button" onClick={() => openTarget(goal.nodes.find(node => node.role === "worker" && node.target)!.target!)}>Open member</button>}
              {goal.nodes.some(node => ["blocked", "needs-you", "failed"].includes(node.state?.status ?? "")) && <button type="button" className="mc-button" onClick={() => setPanel("attention")}>Resolve blocker</button>}</div>
          </> : <p role="status">This goal is no longer available. Close to return to Mission control.</p>}
        {navigationError && <p className="mc-navigation-error" role="alert">Could not open conversation: {navigationError}</p>}
      </div>
    </Modal>}
  </section>;
}

export function MissionControl({ sessions, runs, onOpenTarget, onClose, open, command, renderAttention, selectedAccount, isLocalSession, statuses }: {
  sessions: readonly Session[]; runs: readonly OrchestrationRun[]; onOpenTarget: ViewProps["onOpenTarget"]; onClose: () => void; open: boolean;
  command?: ReactNode; renderAttention?: ViewProps["renderAttention"]; selectedAccount?: AttentionInput["selectedAccount"]; isLocalSession?: AttentionInput["isLocalSession"]; statuses?: ReadonlyMap<string, GitPr | null>;
}) {
  const rosterSnapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const { repairs, automations, sourceError } = useAttentionSources(open);
  const goalsSnapshot = useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const roster = useMemo(() => listMonos(), [rosterSnapshot]);
  const goals = useMemo(() => monoManagerGoals.goals(), [goalsSnapshot]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!open) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [open]);
  const input = useMemo(() => ({ goals, roster, runs, sessions, now }), [goals, roster, runs, sessions, now]);
  const view = useMemo(() => selectGoalViews(input), [input]);
  const cockpit = useMemo(() => selectCockpit(input, statuses), [input, statuses]);
  const attentionInput = useMemo(() => ({ ...input, selectedAccount, isLocalSession, repairs, automations }), [input, selectedAccount, isLocalSession, repairs, automations]);
  return <MissionControlView view={view} cockpit={cockpit} attentionInput={attentionInput} attentionSourceError={sourceError} timeline={id => selectGoalTimeline({ ...input, goalId: id })}
    command={command} renderAttention={renderAttention} onOpenTarget={onOpenTarget} onClose={onClose} open={open} />;
}
