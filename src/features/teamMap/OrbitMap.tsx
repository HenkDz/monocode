import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PixelMascot } from "../projects/ui/PixelMascot";
import { listMonos, monoLook, monoStatusLabel, monosSnapshot, subscribeMonos } from "../monos/model/mono";
import { monoManagerGoals } from "../monos/model/monoManagerGoals";
import { X } from "../../shared/ui/icons";
import { buildTeamMap } from "./model";
import { orbitProjects, loadOrbitPreferences, saveOrbitPreferences } from "./orbit";
import { goalProgress, mapOwnState, mapText, projectGoals, projectMemberTask } from "./commandMap";
import { ProjectDrawer } from "./ProjectDrawer";
import { BossGoalForm } from "./BossGoalForm";
import type { TeamMapProps } from "./TeamMap";
import "./commandMap.css";

export function OrbitMap({ sessions, runs, statuses, scope, onOpenMono, onClose, onToggleView, decisions, bossGoal }: TeamMapProps & { onToggleView: () => void }) {
  const rosterSnapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const goalsSnapshot = useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const roster = useMemo(() => listMonos(), [rosterSnapshot]);
  const goals = useMemo(() => monoManagerGoals.goals(), [goalsSnapshot]);
  const map = useMemo(() => buildTeamMap({ roster, runs, sessions, statuses }), [roster, runs, sessions, statuses]);
  const projects = useMemo(() => orbitProjects(map.nodes, loadOrbitPreferences().order).map(project => {
    const members = project.members.map(node => {
      const { state, task } = projectMemberTask(project, node.mono, runs, sessions);
      return { ...node, state, status: state.status, title: task?.title ?? state.activity ?? "No assigned task" };
    });
    const state = mapOwnState(project.manager.mono, runs, sessions);
    return { ...project, manager: { ...project.manager, state, status: state.status === "idle" && project.manager.status === "pr-ready" ? "pr-ready" as const : state.status }, members };
  }), [map.nodes, runs, sessions]);
  const boss = map.nodes.find(node => node.mono.role === "orchestrator");
  const bossState = boss && mapOwnState(boss.mono, runs, sessions);
  const [selected, setSelected] = useState<string | undefined>(() => projects.find(project => project.manager.id === scope || project.members.some(node => node.id === scope))?.manager.id);
  const [filter, setFilter] = useState("");
  const [needsYou, setNeedsYou] = useState(false);
  const [width, setWidth] = useState(1000);
  const viewport = useRef<HTMLDivElement>(null);
  const projectButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnProject = useRef<string | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null);
  const focusBeforeMap = useRef<Element | null>(document.activeElement);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const focused = projects.find(project => project.manager.id === selected);
  const columns = Math.max(1, Math.min(4, Math.floor(width / 220)));
  const stageWidth = Math.max(260, width);
  const points = projects.map((_, index) => {
    const count = Math.min(columns, projects.length - Math.floor(index / columns) * columns);
    const slot = index % columns;
    return { x: (slot + 0.5) * stageWidth / count, y: 330 + Math.floor(index / columns) * 250 + (count > 2 ? Math.sin(slot * Math.PI / (count - 1)) * 100 : 0) };
  });
  const stageHeight = Math.max(460, ...points.map(point => point.y + 200));
  const working = projects.reduce((count, project) => count + project.members.filter(node => node.status === "working").length + Number(project.manager.state.status === "working"), Number(bossState?.status === "working"));
  const inFlight = goals.filter(goal => !goal.archived && !["done", "cancelled"].includes(goal.state)).length;

  useEffect(() => {
    if (!scope) closeButton.current?.focus();
    const measure = () => setWidth(viewport.current?.clientWidth || 1000);
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => {
      observer.disconnect(); motion.removeEventListener("change", update);
      if (focusBeforeMap.current instanceof HTMLElement && focusBeforeMap.current.isConnected) focusBeforeMap.current.focus();
    };
  }, []);
  useEffect(() => {
    if (selected && !projects.some(project => project.manager.id === selected)) {
      setSelected(undefined); closeButton.current?.focus();
    }
  }, [projects, selected]);
  useEffect(() => {
    if (!selected && returnProject.current) {
      projectButtons.current.get(returnProject.current)?.focus();
      returnProject.current = undefined;
    }
  }, [selected]);

  const closeProject = () => {
    returnProject.current = selected;
    setSelected(undefined);
  };
  const openChat: TeamMapProps["onOpenMono"] = (id, target) => { onClose(); onOpenMono(id, target); };
  const openProject = (id: string) => {
    setSelected(id);
    saveOrbitPreferences({ ...loadOrbitPreferences(), focus: id });
  };
  const decisionCount = (project: (typeof projects)[number]) => decisions?.project(project.project, project.manager.id);

  return <section className="team-map-shell command-map" aria-labelledby="team-map-title" data-reduced-motion={reducedMotion}
    onKeyDown={event => {
      if (event.defaultPrevented || event.key !== "Escape" || focused || document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    }}>
    <header className="team-map-toolbar" inert={focused ? true : undefined}>
      <div><h1 id="team-map-title">Command map</h1><p>Outcomes, decisions, and the team behind them</p></div>
      <div className="team-map-filters"><button type="button" onClick={onToggleView}>Tree</button>
        <select aria-label="Project" value={filter} onChange={event => setFilter(event.target.value)}><option value="">All projects</option>{projects.map(project => <option key={project.manager.id} value={project.project}>{mapText(project.name, 80)}</option>)}</select>
        <button type="button" aria-pressed={needsYou} onClick={() => setNeedsYou(!needsYou)}>Needs you</button>
        <button ref={closeButton} type="button" aria-label="Close team map" onClick={onClose}><X className="size-4" /></button></div>
    </header>
    <div className="command-map-vitals" aria-label="Team vitals" inert={focused ? true : undefined}>
      <span><b>{working}</b> working</span><span><b>{decisions ? `${decisions.incomplete ? "≥" : ""}${inFlight}` : "—"}</b> goals in flight</span>
      <span><b>{decisions ? `${decisions.incomplete ? "≥" : ""}${decisions.handledToday}` : "—"}</b> decided by team today</span>
      <span><b>{decisions ? `${decisions.incomplete ? "≥" : ""}${decisions.needYou}` : "—"}</b> need you</span>
      {decisions && <small>{decisions.incomplete ? "Decision history incomplete · retained records" : "Decision counts use retained history"}</small>}
    </div>
    <div className="command-map-body" data-drawer-open={Boolean(focused)}>
      <div className="command-map-main" inert={focused ? true : undefined}>
        <div className="command-map-viewport" ref={viewport}>
          <div className="command-map-stage" style={{ width: stageWidth, minHeight: stageHeight }}>
            <svg className="command-map-links" width={stageWidth} height={stageHeight} aria-hidden="true">
              {boss && projects.map((project, index) => {
                const active = project.members.some(node => node.status === "working") || project.manager.state.status === "working";
                const point = points[index];
                return <path key={project.manager.id} data-working={active} d={`M ${stageWidth / 2} 164 C ${stageWidth / 2} ${point.y - 110}, ${point.x} ${point.y - 110}, ${point.x} ${point.y - 64}`} />;
              })}
            </svg>
            {boss ? <button type="button" className="command-map-boss" data-status={bossState?.status} onClick={() => openChat(boss.id)} aria-label={`Open chat with ${monoLook(boss.mono).name}`} style={{ left: stageWidth / 2 }}>
              <span className="command-map-avatar"><PixelMascot name={monoLook(boss.mono).mascot} color={monoLook(boss.mono).color} still className="size-12" />
                {decisions && decisions.needYou > 0 && <span className="command-map-badge" aria-label={`${decisions.needYou} escalations need you`}>{decisions.needYou}</span>}</span>
              <strong>Boss</strong><span>{mapText(monoStatusLabel(bossState!), 100)}</span>
            </button> : <div className="command-map-empty">Set up the Boss to coordinate your projects.</div>}
            {projects.map((project, index) => {
              const goal = projectGoals(project, goals)[0];
              const progress = goalProgress(project, goal, runs);
              const data = decisionCount(project);
              const active = project.members.filter(node => node.status === "working").length + Number(project.manager.state.status === "working");
              const look = monoLook(project.manager.mono);
              return <button key={project.manager.id} type="button" className="command-map-project" data-id={project.manager.id}
                data-status={data?.pending ? "needs-you" : active ? "working" : project.manager.status}
                data-dimmed={Boolean(filter && filter !== project.project || needsYou && !data?.pending)}
                ref={element => { if (element) projectButtons.current.set(project.manager.id, element); else projectButtons.current.delete(project.manager.id); }}
                aria-label={`Open ${project.name} project`} aria-haspopup="dialog" aria-expanded={selected === project.manager.id}
                style={{ left: points[index].x, top: points[index].y, "--project-color": look.color } as CSSProperties}
                onClick={() => openProject(project.manager.id)}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                  event.preventDefault();
                  const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
                  projectButtons.current.get(projects[Math.max(0, Math.min(projects.length - 1, index + delta))].manager.id)?.focus();
                }}>
                <span className="command-map-avatar"><PixelMascot name={look.mascot} color={look.color} still className="size-8" />
                  {data && data.pending > 0 && <span className="command-map-badge" aria-label={`${data.pending} pending decisions`}>{data.pending}</span>}</span>
                <strong>{mapText(project.name, 80)}</strong>
                <span className="command-map-pill"><i aria-hidden="true" />{active ? `${active} working` : mapText(monoStatusLabel(project.manager.state), 80)}</span>
                <span className="command-map-team" aria-label={`${project.members.length} members`}>{project.members.map(node => <i key={node.id} data-status={node.status} data-live-status={node.state.liveState?.status} title={`${monoLook(node.mono).name} · ${monoStatusLabel(node.state)}`} />)}</span>
                {progress ? <progress aria-label={`${project.name} accepted tasks`} max={progress.total} value={progress.accepted} /> : <span className="command-map-muted">Progress unavailable</span>}
                <span className="command-map-goal-line">{goal ? mapText(goal.title, 140) : !data || data.incomplete ? "Goal history unavailable" : "No recorded goal"}</span>
                <span className="command-map-muted">{data ? data.incomplete ? "Decision history incomplete" : `${data.pending + data.teamPending} pending decisions` : "Decisions unavailable"}</span>
              </button>;
            })}
            {!projects.length && <div className="command-map-empty command-map-no-projects">Your projects will appear here when they have a Manager.</div>}
          </div>
        </div>
        <BossGoalForm route={bossGoal} />
      </div>
      <aside className="command-map-rail" aria-label="Decisions" inert={focused ? true : undefined}>{decisions?.rail ?? <><h2>Decisions</h2><p className="command-map-muted">Decision history unavailable</p></>}</aside>
      {focused && <ProjectDrawer key={focused.manager.id} project={focused} goals={goals} runs={runs} sessions={sessions} decisions={decisionCount(focused)} onClose={closeProject} onOpenMono={openChat} />}
    </div>
  </section>;
}
