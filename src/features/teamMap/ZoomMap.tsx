import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { projectKey } from "../../shared/lib/paths";
import { X } from "../../shared/ui/icons";
import { WorkDisclosure } from "../../shared/ui/WorkDisclosure";
import { selectTaskMetrics } from "../agents/model/agentMetrics";
import { TaskMetricsLine } from "../agents/ui/TaskMetricsLine";
import { listMonos, monoLook, monoStatusLabel, monosSnapshot, subscribeMonos } from "../monos/model/mono";
import { monoManagerGoals, type MonoManagerGoal } from "../monos/model/monoManagerGoals";
import { crewMessages, crewMessagesSnapshot, subscribeCrewMessages } from "../monos/model/monoCrewEvents";
import { coordinationSummary, presentationText } from "../sessions/model/transcriptPresentation";
import { PixelMascot } from "../projects/ui/PixelMascot";
import { OrgArtifactLinks } from "../artifacts/ui/OrgArtifactLinks";
import { WorktreePrActions } from "../source-control/ui/WorktreePrActions";
import { usePullRequests } from "../source-control/model/pullRequests";
import { BossGoalForm } from "./BossGoalForm";
import { mapOwnState, mapText, projectGoals, projectMemberTask } from "./commandMap";
import { buildTeamMap } from "./model";
import { orbitProjects, loadOrbitPreferences, type OrbitProject } from "./orbit";
import { WorkTrace } from "./ProjectDrawer";
import { mapCamera, projectCamera, projectMapTasks, projectPoint, TASK_FLOW, TASK_LABEL, zoomCamera, type MapCamera, type MapTask } from "./zoomMapModel";
import type { TeamMapProps } from "./TeamMap";
import "./zoomMap.css";

type Selection = { kind: "task"; key: string } | { kind: "goal"; id: string } | { kind: "mono"; id: string };
const sortedTasks = (tasks: readonly MapTask[]) => [...tasks].sort((a, b) => {
  const rank = (entry: MapTask) => { const index = TASK_FLOW.indexOf(entry.state as typeof TASK_FLOW[number]); return index < 0 ? TASK_FLOW.length : index; };
  return rank(a) - rank(b);
});
const taskCount = (tasks: readonly MapTask[]) => `${tasks.filter(entry => entry.state === "done").length} of ${tasks.length} tasks done`;

function Segments({ tasks, onHover }: { tasks: readonly MapTask[]; onHover?: (key?: string) => void }) {
  return <span className="zoom-map-segments" aria-label={taskCount(tasks)}>{sortedTasks(tasks).map(entry => <span key={entry.key} data-state={entry.state}
    title={`${entry.title} — ${TASK_LABEL[entry.state]} · ${entry.task.memberName ?? "Not assigned yet"}`} tabIndex={onHover ? 0 : undefined}
    onMouseEnter={() => onHover?.(entry.key)} onMouseLeave={() => onHover?.()} onFocus={() => onHover?.(entry.key)} onBlur={() => onHover?.()} />)}</span>;
}

function TaskChips({ entry }: { entry: MapTask }) {
  return <span className="zoom-map-chips">{(entry.dispatch?.workspace ?? entry.task.workspace)?.branch && <span>⎇ {(entry.dispatch?.workspace ?? entry.task.workspace)!.branch}</span>}
    {entry.task.prUrl && <span>PR {entry.pr ? `#${entry.pr.number}` : entry.task.prUrl.split("/").at(-1)}</span>}</span>;
}

function TaskDetail({ entry, sessions, onOpenMono }: { entry: MapTask; sessions: TeamMapProps["sessions"]; onOpenMono: (id: string) => void }) {
  const [attemptId, setAttemptId] = useState("");
  const history = entry.run.dispatches?.filter(attempt => attempt.taskId === entry.task.id) ?? [];
  const selected = history.find(attempt => attempt.id === attemptId) ?? entry.dispatch;
  const historical = !!selected && selected.id !== entry.dispatch?.id;
  const evidence = sessions.find(session => session.id === (selected?.sessionId ?? entry.session?.id));
  // The evidence reader is keyed by the recorded attempt, never the Mono's durable chat.
  return <>
    <h2>{entry.title}</h2><p className="zoom-map-muted">{TASK_LABEL[entry.state]} · {entry.task.memberName ?? "Not assigned yet"}</p>
    <p>{entry.latest}</p><TaskChips entry={entry} />
    <TaskMetricsLine metrics={selectTaskMetrics(entry.task, entry.run.dispatches ?? [], entry.session ? [entry.session] : [])} state={entry.live} />
    <WorkDisclosure>
      {history.length > 0 && <select aria-label="Work attempt" value={selected?.id ?? ""} onChange={event => setAttemptId(event.target.value)}>{history.map(attempt => <option key={attempt.id} value={attempt.id}>{attempt.id === entry.dispatch?.id ? "Current" : "Saved"} · {attempt.id} · {attempt.state}</option>)}</select>}
      <p>{historical ? "Saved attempt" : "Current assignment"} · Task {entry.task.id} · dispatch {selected?.id ?? "unavailable"}</p>
      <pre>{presentationText(entry.task.prompt)}</pre>
      {(historical ? selected?.result : entry.task.result) && <p>{presentationText((historical ? selected?.result : entry.task.result)!)}</p>}
      {entry.task.error && <p role="alert">{entry.task.error}</p>}
      <OrgArtifactLinks monoId={entry.task.memberId ?? entry.run.ownerMonoId ?? ""} links={[
        { id: entry.task.reportArtifactId, label: "Report" }, { id: entry.task.reviewArtifactId ?? entry.task.reviewVerdict?.artifactId, label: "Review" }, { id: entry.task.prSummaryArtifactId, label: "PR summary" },
      ]} />
      {evidence ? <WorkTrace key={evidence.id} session={evidence} recordedModel={selected?.turnModel} /> : <p>Recorded conversation is not loaded. Open conversation to inspect it.</p>}
    </WorkDisclosure>
    {(entry.task.memberId ?? entry.run.ownerMonoId) && <button type="button" onClick={() => onOpenMono((entry.task.memberId ?? entry.run.ownerMonoId)!)}>Open conversation</button>}
  </>;
}

export function ZoomMap({ sessions, runs, statuses, scope, onOpenMono, onClose, decisions, bossGoal, onSendManager, onToggleView }: TeamMapProps & { onToggleView: () => void }) {
  const rosterRevision = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const goalRevision = useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const crewRevision = useSyncExternalStore(subscribeCrewMessages, crewMessagesSnapshot);
  const prs = usePullRequests();
  const roster = useMemo(() => listMonos(), [rosterRevision]);
  const goals = useMemo(() => monoManagerGoals.goals(), [goalRevision]);
  const nodes = useMemo(() => buildTeamMap({ roster, runs, sessions, statuses }).nodes, [roster, runs, sessions, statuses]);
  const projects = useMemo(() => orbitProjects(nodes, loadOrbitPreferences().order), [nodes]);
  const [focusedId, setFocusedId] = useState(() => projects.find(project => project.manager.id === scope || project.members.some(node => node.id === scope))?.manager.id);
  const [selection, setSelection] = useState<Selection>();
  const [highlight, setHighlight] = useState<string>();
  const [flash, setFlash] = useState<string>();
  const [approach, setApproach] = useState<string>();
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const [camera, setCamera] = useState<MapCamera>(() => mapCamera(size, projects.length));
  const [moving, setMoving] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const viewport = useRef<HTMLDivElement>(null), rail = useRef<HTMLElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ x: number; y: number; camera: MapCamera }>(undefined);
  const wheelLock = useRef(0), flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focused = projects.find(project => project.manager.id === focusedId);
  const index = projects.findIndex(project => project === focused);
  const fitted = focused ? projectCamera(size, projectPoint(index)) : undefined;
  const base = fitted?.camera ?? mapCamera(size, projects.length);
  const cameraRef = useRef(camera); cameraRef.current = camera;
  const projectTasks = projects.map(project => ({ project, tasks: projectMapTasks(project, runs, sessions, statuses) }));
  const allTasks = projectTasks.flatMap(row => row.tasks);
  const tasks = focused ? projectTasks[index].tasks : allTasks;
  const ready = allTasks.filter(entry => entry.state === "ready");
  const visibleReady = tasks.filter(entry => entry.state === "ready");
  const selectedTask = selection?.kind === "task" ? tasks.find(entry => entry.key === selection.key) : undefined;
  const selectedGoal = selection?.kind === "goal" && focused ? projectGoals(focused, goals).find(goal => goal.id === selection.id) : undefined;
  const selectedMono = selection?.kind === "mono" ? nodes.find(node => node.id === selection.id) : undefined;
  const boss = nodes.find(node => node.mono.role === "orchestrator");
  const bossX = Math.min(4, Math.max(1, projects.length)) * 190 + 40;
  const count = decisions ? decisions.needYou + ready.length : undefined;
  const goalList = focused ? projectGoals(focused, goals) : projects.flatMap(project => projectGoals(project, goals));
  const openChat = (id: string) => { onClose(); onOpenMono(id); };
  const leave = () => { const id = focusedId; setFocusedId(undefined); setSelection(undefined); setHighlight(undefined); wheelLock.current = Date.now() + 700; if (id) buttons.current.get(id)?.focus(); };
  const enter = (id: string) => { setFocusedId(id); setSelection(undefined); setHighlight(undefined); setApproach(undefined); wheelLock.current = Date.now() + 900; };
  const zoomToProject = (projectId: string) => { const project = projects.find(project => projectKey(project.project) === projectKey(projectId)); if (project) enter(project.manager.id); };
  const scopedDecisions = focused && decisions?.project(focused.project, focused.manager.id, zoomToProject);
  const messages = useMemo(() => crewMessages(), [crewRevision]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayFeed = messages.filter(message => message.at >= today.getTime() && message.at <= Date.now() && (!focused || message.managerId === focused.manager.id || message.managerId === focused.manager.mono.managerEngineId)).slice(-4).reverse();

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setSize({ width: element.clientWidth || 1200, height: element.clientHeight || 760 });
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setMoving(false); setCamera(base); }, [focusedId, size.width, size.height, projects.length]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    query.addEventListener("change", change); return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => { if (focusedId && !focused) { setFocusedId(undefined); setSelection(undefined); } }, [focusedId, focused]);
  const live = useRef({ focused, base, projects, size }); live.current = { focused, base, projects, size };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("textarea,select,[data-map-scroll]")) return;
      event.preventDefault();
      if (Date.now() < wheelLock.current) return;
      const { focused, base, projects, size } = live.current;
      const rect = element.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      const current = cameraRef.current;
      const fit = mapCamera(size, projects.length).scale;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const scale = Math.max(fit * .8, Math.min(focused ? base.scale * 2 : fit * 14, current.scale * Math.exp(-delta * .0015)));
      if (focused && delta > 0 && scale < base.scale * .72) { leave(); return; }
      const next = zoomCamera(current, x, y, scale);
      if (!focused) {
        const wx = (x - next.x) / scale, wy = (y - next.y) / scale;
        const near = projects.map((project, index) => ({ project, distance: Math.hypot(projectPoint(index).x - wx, projectPoint(index).y - wy) })).sort((a, b) => a.distance - b.distance)[0];
        setApproach(scale > fit * 1.2 && near?.distance < 380 ? near.project.manager.id : undefined);
        if (delta < 0 && scale > fit * 1.9 && near?.distance < 380) { enter(near.project.manager.id); return; }
      }
      setMoving(true); cameraRef.current = next; setCamera(next);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const selectTask = (entry: MapTask) => {
    setSelection({ kind: "task", key: entry.key });
    const card = [...(rail.current?.querySelectorAll<HTMLElement>("[data-task-id],[data-session-id]") ?? [])].find(card => card.dataset.taskId === entry.task.id || !!entry.session && card.dataset.sessionId === entry.session.id);
    if (entry.state === "ready" || card) {
      setSelection(undefined); setHighlight(entry.key); setFlash(entry.key);
      requestAnimationFrame(() => {
        const target = card ?? [...(rail.current?.querySelectorAll<HTMLElement>("[data-merge-task]") ?? [])].find(card => card.dataset.mergeTask === entry.key);
        target?.scrollIntoView?.({ block: "nearest" }); target?.focus();
      });
      clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(undefined), 2200);
    }
  };
  const card = (entry: MapTask) => {
    const mono = roster.find(mono => mono.id === entry.task.memberId), look = mono && monoLook(mono);
    return <button type="button" key={entry.key} className="zoom-map-task" data-state={entry.state} data-task={entry.task.id}
      data-selected={selectedTask?.key === entry.key || highlight === entry.key} data-highlight={highlight === entry.key} onClick={() => selectTask(entry)}>
      <strong>{entry.title}{entry.state === "ready" && <em> · needs you</em>}</strong>
      <span className="zoom-map-task-owner">{look && <PixelMascot name={look.mascot} color={look.color} still className="size-4" />}{look?.name ?? entry.task.memberName ?? "Not assigned yet"}{entry.state === "working" && ["thinking", "running-tool", "compacting"].includes(entry.live.status) && <i className="zoom-map-live" />}</span>
      <TaskChips entry={entry} />
    </button>;
  };

  function board(project: OrbitProject, entries: MapTask[]) {
    const lanes: { goal?: MonoManagerGoal; tasks: MapTask[] }[] = projectGoals(project, goals).map(goal => ({ goal, tasks: entries.filter(entry => entry.task.monoGoalId === goal.id) }));
    const unmatched = entries.filter(entry => !lanes.some(lane => lane.goal?.id === entry.task.monoGoalId));
    if (unmatched.length) lanes.push({ tasks: unmatched });
    return <div className="zoom-map-board">
      <div className="zoom-map-team" aria-label={`${project.name} team`}>{[project.manager, ...project.members].map(node => {
        const look = monoLook(node.mono);
        const state = node.mono.role === "manager" ? mapOwnState(node.mono, runs, sessions) : projectMemberTask(project, node.mono, runs, sessions).state;
        const active = entries.filter(entry => entry.task.memberId === node.id && !["done", "cancelled", "closed", "failed", "interrupted"].includes(entry.state));
        return <button type="button" className="zoom-map-mono" key={node.id} onClick={() => { setSelection({ kind: "mono", id: node.id }); setHighlight(undefined); }}>
          <span className="zoom-map-mini-avatar"><PixelMascot name={look.mascot} color={look.color} still className="size-7" /><i data-status={state.status} />{active.length > 1 && <b className="zoom-map-multiplicity">×{active.length}</b>}</span>
          <span><strong>{look.name} <small>{node.mono.role === "manager" ? "Manager" : node.mono.specialty || "Mono"}</small></strong><span>{mapText(state.activity || monoStatusLabel(state), 90)}</span></span>
        </button>;
      })}</div>
      <div className="zoom-map-columns"><span>Goal</span>{TASK_FLOW.slice(0, 4).map(state => <span key={state}><i data-state={state} />{TASK_LABEL[state]}</span>)}</div>
      {lanes.map((lane, laneIndex) => <section className="zoom-map-lane" key={lane.goal?.id ?? "unassigned"} aria-label={lane.goal?.title ?? "Tasks without recorded goal"}>
        <div className="zoom-map-goal"><h3>{lane.goal ? coordinationSummary(lane.goal.title, 90) : "Tasks without recorded goal"}</h3>
          {lane.goal && ["done", "cancelled"].includes(lane.goal.state) && <small>{lane.goal.state === "done" ? "Goal finished" : "Goal cancelled"}</small>}
          <p>{lane.tasks.length ? taskCount(lane.tasks) : "No recorded tasks"}</p><Segments tasks={lane.tasks} onHover={setHighlight} />
          {lane.goal && <button type="button" onClick={() => { setSelection({ kind: "goal", id: lane.goal!.id }); setHighlight(undefined); }}>Open goal →</button>}
        </div>
        {TASK_FLOW.slice(0, 4).map(state => <div className="zoom-map-cell" key={state} aria-label={`${TASK_LABEL[state]} tasks`}>{lane.tasks.filter(entry => entry.state === state).map(card)}</div>)}
        {lane.tasks.some(entry => !TASK_FLOW.slice(0, 4).includes(entry.state as typeof TASK_FLOW[number])) && <div className="zoom-map-finished" aria-label={`Finished and stopped tasks ${laneIndex + 1}`}>
          {lane.tasks.filter(entry => !TASK_FLOW.slice(0, 4).includes(entry.state as typeof TASK_FLOW[number])).map(entry => <div key={entry.key}><small data-state={entry.state}>{TASK_LABEL[entry.state]}</small>{card(entry)}</div>)}
        </div>}
      </section>)}
      {!lanes.length && <p className="zoom-map-empty">{decisions?.incomplete || !decisions ? "Goal history unavailable" : "No recorded goal yet"}. Tell the Manager what you want.</p>}
    </div>;
  }

  return <section className="team-map-shell zoom-map" aria-label="Command map" data-reduced-motion={reducedMotion}
    onKeyDown={event => {
      if (event.defaultPrevented || event.key !== "Escape" || (event.target as Element).closest("textarea,input,select") || document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
      event.preventDefault(); event.stopPropagation();
      if (selection || highlight) { setSelection(undefined); setHighlight(undefined); }
      else if (focused) leave(); else onClose();
    }}>
    <div className="zoom-map-main">
      <header className="zoom-map-top"><h1>Command map</h1><div className="command-map-vitals" aria-label="Team vitals">
        <span><b>{allTasks.filter(entry => entry.state === "working").length}</b> working</span>
        <span><b>{decisions ? `${decisions.incomplete ? "≥" : ""}${goalList.filter(goal => !["done", "cancelled"].includes(goal.state)).length}` : "—"}</b> goals in flight</span>
        <span><b>{decisions ? `${decisions.incomplete ? "≥" : ""}${decisions.handledToday}` : "—"}</b> decided by team today</span>
        <span><b>{count ?? "—"}</b> need you</span></div>
        <nav aria-label="Map navigation">{focused && <><button type="button" onClick={leave}>Map</button><span>/ {focused.name}</span></>}<button type="button" onClick={onToggleView}>Tree</button><button type="button" aria-label="Close team map" onClick={onClose}><X className="size-4" /></button></nav>
      </header>
      <div className="zoom-map-viewport" ref={viewport} data-focused={focused?.manager.id ?? ""} aria-label="Zoomable project canvas"
        onPointerDown={event => {
          if (event.button !== 0 || (event.target as Element).closest("button,a,input,textarea,select,[tabindex]")) return;
          drag.current = { x: event.clientX, y: event.clientY, camera }; event.currentTarget.setPointerCapture(event.pointerId); setMoving(true);
        }} onPointerMove={event => { if (!drag.current) return; const next = { ...drag.current.camera, x: drag.current.camera.x + event.clientX - drag.current.x, y: drag.current.camera.y + event.clientY - drag.current.y }; cameraRef.current = next; setCamera(next); }}
        onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
        <p className="zoom-map-hint">{focused ? "Scroll to zoom · drag to pan · Map or Esc to return" : "Click a project or scroll towards it · drag to pan"}</p>
        <div className="zoom-map-world" data-moving={moving} style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          <svg className="zoom-map-links" width={1600} height={Math.max(1000, Math.ceil(projects.length / 4) * 310 + 500)} aria-hidden="true" data-dimmed={!!focused}>
            <path d={`M${bossX},160 L${bossX},208`} />{projects.map((project, i) => { const point = projectPoint(i); const active = projectTasks[i].tasks.some(entry => entry.state === "working") || mapOwnState(project.manager.mono, runs, sessions).status === "working"; return <path key={project.manager.id} data-working={active} d={`M${bossX},296 C${bossX},390 ${point.x},365 ${point.x},${point.y - 70}`} />; })}
          </svg>
          <button type="button" className="zoom-map-you" style={{ left: bossX, top: 130 }} onClick={leave}>You <b>{count ?? "—"}</b></button>
          {boss && <button type="button" className="zoom-map-boss" data-dimmed={!!focused} style={{ left: bossX, top: 240 }} onClick={() => openChat(boss.id)}><PixelMascot name={monoLook(boss.mono).mascot} color={monoLook(boss.mono).color} still className="size-14" /><strong>Boss</strong><small>{monoStatusLabel(mapOwnState(boss.mono, runs, sessions))}</small></button>}
          {projects.map((project, i) => {
            const point = projectPoint(i), look = monoLook(project.manager.mono), entries = projectTasks[i].tasks;
            const data = decisions?.project(project.project, project.manager.id), active = entries.filter(entry => entry.state === "working").length;
            const projectNeeds = (data?.pending ?? 0) + entries.filter(entry => entry.state === "ready").length;
            return <div key={project.manager.id}>
              <button type="button" className="zoom-map-project" aria-label={`Open ${project.name} project`} aria-expanded={focused === project} aria-controls={`board-${project.manager.id}`} data-dimmed={!!focused && focused !== project} data-focused={focused === project} data-approach={approach === project.manager.id}
                ref={element => { if (element) buttons.current.set(project.manager.id, element); else buttons.current.delete(project.manager.id); }}
                style={{ left: point.x, top: point.y, "--project-color": look.color } as CSSProperties} onClick={() => enter(project.manager.id)}>
                <span className="zoom-map-avatar"><PixelMascot name={look.mascot} color={look.color} still className="size-9" />{projectNeeds > 0 && <b>{projectNeeds}</b>}</span><strong>{project.name}</strong>
                <span className="zoom-map-summary"><span className="zoom-map-pill">{projectNeeds ? "Needs you" : active ? `${active} working` : monoStatusLabel(mapOwnState(project.manager.mono, runs, sessions))}</span>
                  {projectGoals(project, goals).slice(0, 2).map(goal => { const tasks = entries.filter(entry => entry.task.monoGoalId === goal.id); return <span className="zoom-map-goal-line" key={goal.id}><span title={goal.title}>{coordinationSummary(goal.title, 65)}</span><small>{tasks.length ? taskCount(tasks).replace(" tasks", "") : "No recorded tasks"}</small><Segments tasks={tasks} /></span>; })}
                  {!projectGoals(project, goals).length && <small>{!data || data.incomplete ? "Goal history unavailable" : "No recorded goal"}</small>}
                </span>
              </button>
              <div id={`board-${project.manager.id}`} className="zoom-map-board-wrap" hidden={focused !== project} style={{ left: point.x - (focused === project ? fitted!.width : 1000) / 8, top: point.y + 32, width: focused === project ? fitted!.width : 1000 }}>{focused === project && board(project, entries)}</div>
            </div>;
          })}
          {!projects.length && <p className="zoom-map-empty">Your projects will appear here when they have a Manager.</p>}
        </div>
      </div>
      <div className="zoom-map-camera-controls" aria-label="Camera controls"><button type="button" aria-label="Zoom in" onClick={() => { setMoving(true); setCamera(zoomCamera(camera, size.width / 2, size.height / 2, Math.min(base.scale * 2, camera.scale * 1.2))); }}>+</button><button type="button" aria-label="Zoom out" onClick={() => { const scale = camera.scale / 1.2; if (focused && scale < base.scale * .72) leave(); else { setMoving(true); setCamera(zoomCamera(camera, size.width / 2, size.height / 2, scale)); } }}>−</button><button type="button" aria-label="Show whole map" onClick={() => { leave(); setCamera(mapCamera(size, projects.length)); }}>⊞</button></div>
      <BossGoalForm route={bossGoal} manager={focused ? { id: focused.manager.id, name: monoLook(focused.manager.mono).name, send: onSendManager ? text => onSendManager(focused.manager.id, focused.project, text) : undefined } : undefined} />
      <footer className="zoom-map-today" aria-label="Today"><b>Today</b>{todayFeed.length ? todayFeed.map(message => <span key={message.id} title={message.text}>{coordinationSummary(message.summary ?? message.text, 150)}</span>) : <span>No recorded team updates today.</span>}</footer>
    </div>
    <aside className="zoom-map-rail" ref={rail} aria-label="Needs you and details" data-flash={!!flash}>
      {selection && (selectedTask || selectedGoal || selectedMono) ? <><button type="button" className="zoom-map-back" onClick={() => { setSelection(undefined); setHighlight(undefined); }}>← Needs you</button><div className="zoom-map-detail" key={JSON.stringify(selection)}>
        {selectedTask && <TaskDetail entry={selectedTask} sessions={sessions} onOpenMono={openChat} />}
        {selectedGoal && <><h2>{coordinationSummary(selectedGoal.title, 120)}</h2><p>{taskCount(tasks.filter(entry => entry.task.monoGoalId === selectedGoal.id))}</p><Segments tasks={tasks.filter(entry => entry.task.monoGoalId === selectedGoal.id)} />
          <p className="zoom-map-breakdown">{Object.entries(TASK_LABEL).flatMap(([state, label]) => { const count = tasks.filter(entry => entry.task.monoGoalId === selectedGoal.id && entry.state === state).length; return count ? [`${count} ${label.toLowerCase()}`] : []; }).join(" · ")}</p>
          {scopedDecisions && decisions?.project(focused!.project, focused!.manager.id).goalAction?.(selectedGoal.id)}
          <WorkDisclosure><pre>{presentationText(selectedGoal.title)}</pre>{tasks.filter(entry => entry.task.monoGoalId === selectedGoal.id).map(entry => <p key={entry.key}>{entry.title} · {entry.latest}</p>)}</WorkDisclosure>{scopedDecisions && <div>{scopedDecisions.autonomy}</div>}</>}
        {selectedMono && <><h2>{monoLook(selectedMono.mono).name}</h2><p>{selectedMono.mono.specialty ?? selectedMono.mono.role}</p><p>{monoStatusLabel(selectedMono.state)}</p>{tasks.filter(entry => entry.task.memberId === selectedMono.id).map(entry => <button type="button" key={entry.key} onClick={() => selectTask(entry)}>{entry.title} · {TASK_LABEL[entry.state]}</button>)}<button type="button" onClick={() => openChat(selectedMono.id)}>Open conversation</button></>}
      </div></> : <>
        <h2>Needs you {focused && <small>in {focused.name}</small>}</h2>
        {focused && <button type="button" className="zoom-map-back" onClick={leave}>← Everything else that needs you</button>}
        {visibleReady.map(entry => { const record = prs.find(record => projectKey(record.cwd) === projectKey(entry.task.workspace?.checkoutCwd ?? "") && record.pr.url === entry.pr?.url && !record.unavailable); return <article className="zoom-map-merge" key={entry.key} tabIndex={-1} data-merge-task={entry.key} data-selected={flash === entry.key}>
          <small>{entry.task.memberName ?? "Mono"} → {entry.run.projectName ?? "Manager"} → You</small><h3>Review &amp; merge · {entry.title}</h3><p>Approved current head · checks pass. Merging is your call.</p>
          {record ? <WorktreePrActions entry={record} sessionId={entry.dispatch?.sessionId ?? entry.task.sessionId} taskId={entry.task.id} /> : <p>Open conversation to refresh the recorded PR review.</p>}
          <button type="button" onClick={() => openChat(entry.task.memberId ?? entry.run.ownerMonoId!)}>Open conversation</button>
          {!focused && <button type="button" onClick={() => { const project = projectTasks.find(row => row.tasks.some(task => task.key === entry.key)); if (project) enter(project.project.manager.id); }}>Zoom to project →</button>}
        </article>; })}
        {scopedDecisions ? scopedDecisions.cards : decisions?.railFor?.(zoomToProject) ?? decisions?.rail ?? <p className="zoom-map-muted">Decision history unavailable</p>}
      </>}
    </aside>
  </section>;
}
