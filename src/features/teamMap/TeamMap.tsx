import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { PixelMascot } from "../projects/ui/PixelMascot";
import {
  listMonos,
  monoLook,
  monoStatusLabel,
  monoTeamWorkingLabel,
  monosSnapshot,
  subscribeMonos,
} from "../monos/model/mono";
import {
  crewMessages,
  crewMessagesSnapshot,
  subscribeCrewMessages,
} from "../monos/model/monoCrewEvents";
import { monoManagerGoals } from "../monos/model/monoManagerGoals";
import type { Session } from "../sessions/model/session";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import type { GitPr } from "../../platform/tauri/fs";
import { projectName } from "../../shared/lib/paths";
import { Minus, Plus, X } from "../../shared/ui/icons";
import {
  buildTeamMap,
  teamMapEvents,
  teamMapEventAnimation,
  teamMapEventEdges,
  teamMapKeyboardNode,
  teamMapFeed,
  teamMapEdgePath,
} from "./model";
import { treeLayout, TREE_NODE_WIDTH as TEAM_MAP_NODE_WIDTH, TREE_NODE_HEIGHT as TEAM_MAP_NODE_HEIGHT } from "./treeLayout";
import { fitTeamMap, focusTeamMap, teamMapCompact } from "./camera";
import "./teamMap.css";
import "./treeMap.css";
import { OrbitMap } from "./OrbitMap";
import { EdgePulse } from "./EdgePulse";
import { loadOrbitPreferences, saveOrbitPreferences } from "./orbit";

export type TeamMapProps = {
  sessions: readonly Session[];
  runs: readonly OrchestrationRun[];
  statuses: ReadonlyMap<string, GitPr | null>;
  scope?: string;
  onOpenMono: (id: string) => void;
  onClose: () => void;
};
type Props = TeamMapProps & { onToggleView?: () => void; onSelectMono?: (id: string) => void; selectedMonoId?: string; onDismissSelection?: () => boolean };
type MapEvent = ReturnType<typeof teamMapEvents>[number];
const labels = {
  working: "Working",
  "needs-you": "Needs you",
  "pr-ready": "PR ready",
  idle: "Idle",
};

export function TreeMap({
  sessions,
  runs,
  statuses,
  scope,
  onOpenMono,
  onClose,
  onToggleView,
  onSelectMono,
  selectedMonoId,
  onDismissSelection,
}: Props) {
  const rosterSnapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const messageSnapshot = useSyncExternalStore(
    subscribeCrewMessages,
    crewMessagesSnapshot,
  );
  const goalsSnapshot = useSyncExternalStore(
    monoManagerGoals.subscribe,
    monoManagerGoals.snapshot,
  );
  const roster = useMemo(() => listMonos(), [rosterSnapshot]);
  const messages = useMemo(() => crewMessages(), [messageSnapshot]);
  const goals = useMemo(() => monoManagerGoals.goals(), [goalsSnapshot]);
  const [wholeOrg, setWholeOrg] = useState(false);
  const [focusedPod, setFocusedPod] = useState<string | undefined>(scope);
  const activeScope = wholeOrg ? undefined : scope;
  const scopedMono = roster.find((mono) => mono.id === activeScope);
  const scopedProject = scopedMono?.role === "manager"
    ? scopedMono.managerProject ?? scopedMono.projects[0] ?? ""
    : "";
  const [projectFilter, setProject] = useState<string>();
  const project = projectFilter ?? scopedProject;
  const [needsYou, setNeedsYou] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState(() => loadOrbitPreferences().order);
  const [undoOrder, setUndoOrder] = useState<string[]>();
  const [dropTarget, setDropTarget] = useState<string>();
  const projectDrag = useRef<string>(undefined);
  const [hovered, setHovered] = useState<string>();
  const [highlight, setHighlight] = useState<MapEvent>();
  const [focused, setFocused] = useState<string>();
  const [pulses, setPulses] = useState<MapEvent[]>([]);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 1100, height: 1250 });
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const seen = useRef<Set<string>>(undefined);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const drag = useRef<{ x: number; y: number; camera: typeof camera }>(
    undefined,
  );
  const input = {
    roster,
    runs,
    sessions,
    statuses,
    scope: activeScope,
    project: project || undefined,
    collapsed,
    viewport: size,
  };
  const map = useMemo(
    () => treeLayout(buildTeamMap(input), order),
    [roster, runs, sessions, statuses, activeScope, project, collapsed, size, order],
  );
  const allEvents = useMemo(
    () => teamMapEvents({ roster, runs, sessions, statuses, messages, goals }),
    [roster, runs, sessions, statuses, messages, goals],
  );
  const events = useMemo(
    () => teamMapEvents({ ...input, messages, goals }),
    [roster, runs, sessions, statuses, activeScope, project, messages, goals],
  );
  const feed = useMemo(() => teamMapFeed(events, roster), [events, roster]);
  const nodeById = new Map(map.nodes.map((node) => [node.mono.id, node]));
  const podBounds = map.pods.find((pod) => pod.id === focusedPod);
  const tabStop = nodeById.has(focused ?? "") ? focused : map.nodes[0]?.id;
  const projects = [
    ...new Set(
      roster
        .filter(
          (mono) =>
            !mono.archivedAt &&
            mono.role === "manager" &&
            (!activeScope || mono.id === activeScope),
        )
        .flatMap((mono) => mono.managerProject ?? mono.projects[0] ?? []),
    ),
  ];
  const activeEdges = new Set(
    highlight ? teamMapEventEdges(highlight, map.edges) : [],
  );
  const activeNodes = new Set(
    highlight
      ? [
          highlight.source,
          highlight.target,
          ...map.edges
            .filter((edge) => activeEdges.has(edge.id))
            .flatMap((edge) => [edge.source, edge.target]),
        ]
      : [],
  );
  for (let id = selectedMonoId ?? focused; id && nodeById.has(id); id = nodeById.get(id)?.parentId) {
    activeNodes.add(id);
    const parent = nodeById.get(id)?.parentId;
    if (parent) activeEdges.add(`${parent}->${id}`);
  }

  const projectIds = [...new Set([...order, ...roster.filter(mono => mono.role === "manager" && !mono.archivedAt).sort((a, b) => monoLook(a).name.localeCompare(monoLook(b).name) || a.id.localeCompare(b.id)).map(mono => mono.id)])];
  const fit = () => {
    if (!viewport.current) return;
    const { clientWidth: width, clientHeight: height } = viewport.current;
    setCamera(podBounds
      ? focusTeamMap(width, height, podBounds)
      : { zoom: 1, x: Math.max(24, (width - map.width) / 2), y: 24 });
    viewport.current.scrollTo?.({ left: 0, top: 0 });
  };
  const showWholeOrg = () => {
    setFocusedPod(undefined);
    setWholeOrg(true);
    setProject("");
  };
  const focusPod = (id: string) => {
    setFocusedPod(id);
    setHovered(undefined);
    const pod = map.pods.find((pod) => pod.id === id);
    if (pod && viewport.current) setCamera(focusTeamMap(viewport.current.clientWidth, viewport.current.clientHeight, pod));
  };
  const reorder = (target: string) => {
    const source = projectDrag.current;
    projectDrag.current = undefined;
    setDropTarget(undefined);
    if (!source || source === target) return;
    const ids = projectIds.filter(id => id !== source);
    if (!ids.includes(target)) return;
    ids.splice(ids.indexOf(target), 0, source);
    saveOrder(ids);
  };
  const saveOrder = (next: string[]) => {
    setUndoOrder(order);
    setOrder(next);
    saveOrbitPreferences({ ...loadOrbitPreferences(), order: next });
  };
  const zoomBy = (amount: number) => {
    setCamera((previous) => {
      const zoom = Math.min(2, Math.max(0.2, previous.zoom * amount));
      const x = (viewport.current?.clientWidth ?? 0) / 2;
      const y = (viewport.current?.clientHeight ?? 0) / 2;
      return {
        zoom,
        x: x - ((x - previous.x) * zoom) / previous.zoom,
        y: y - ((y - previous.y) * zoom) / previous.zoom,
      };
    });
  };
  const focusNode = (id: string) => {
    const node = nodeById.get(id);
    if (!node || !viewport.current) return;
    setFocused(id);
    onSelectMono?.(id);
    buttons.current.get(id)?.focus({ preventScroll: true });
    buttons.current.get(id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  useEffect(() => {
    if (!selectedMonoId) return;
    buttons.current.get(selectedMonoId)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [selectedMonoId, size]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => {
      motion.removeEventListener("change", update);
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (onDismissSelection?.()) return;
      if (focusedPod || activeScope) showWholeOrg();
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, focusedPod, activeScope, onDismissSelection]);
  useEffect(() => {
    const resize = () => {
      if (!viewport.current) return;
      const { clientWidth: width, clientHeight: height } = viewport.current;
      if (width && height) setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { fit(); }, [map.width, map.height, map.nodes.length, size, focusedPod, podBounds?.x, podBounds?.y, podBounds?.width, podBounds?.height, collapsed, project, activeScope]);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      if (window.matchMedia("(max-width: 680px)").matches || !event.deltaY || (!event.ctrlKey && !event.metaKey))
        return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(allEvents.map((event) => event.id));
      return;
    }
    const arrivals = events.filter((event) => !seen.current!.has(event.id));
    seen.current = new Set(allEvents.map((event) => event.id));
    if (!arrivals.length) return;
    setPulses((previous) => [...previous, ...arrivals].slice(-12));
    const timer = setTimeout(() => {
      const ids = new Set(arrivals.map((event) => event.id));
      setPulses((previous) => previous.filter((event) => !ids.has(event.id)));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
  }, [events, allEvents]);

  const edgePath = (source: string, target: string, reverse = false) => {
    const edge = map.edges.find((edge) => edge.source === source && edge.target === target);
    return edge ? teamMapEdgePath(edge, reverse) : "";
  };

  return (
    <section
      className="team-map-shell tree-map"
      aria-labelledby="team-map-title"
    >
      <header className="team-map-toolbar">
        <div>
          <h1 id="team-map-title">Team map</h1>
          <p>
            {scopedMono
              ? monoLook(scopedMono).name +
                "’s team"
              : project ? `${projectName(project)} team`
              : "Your team, working together"}
          </p>
        </div>
        <div className="team-map-filters">
          {onToggleView && <button type="button" onClick={onToggleView}>Orbit</button>}
          <button type="button" title="Restore readable spacing and keep your project order" onClick={() => { setFocusedPod(undefined); setCamera({ zoom: 1, x: Math.max(24, (size.width - map.width) / 2), y: 24 }); viewport.current?.scrollTo?.({ left: 0, top: 0 }); }}>Arrange</button>
          <label>
            <span className="sr-only">Project</span>
            <select
              aria-label="Project"
              value={project}
              disabled={Boolean(scopedProject)}
              onChange={(event) => { setProject(event.target.value); setFocusedPod(undefined); }}
            >
              <option value="">All projects</option>
              {projects.map((path) => (
                <option key={path} value={path}>
                  {projectName(path)}
                </option>
              ))}
            </select>
          </label>
          {(activeScope || focusedPod) && (
            <button type="button" onClick={showWholeOrg}>Whole org</button>
          )}
          <button
            type="button"
            aria-pressed={needsYou}
            onClick={() => setNeedsYou(!needsYou)}
          >
            Needs you
          </button>
          <button type="button" autoFocus aria-label="Close team map" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
      </header>
      <div className="team-map-legend" aria-label="Status legend">
        {Object.entries(labels).map(([status, label]) => (
          <span key={status} data-status={status}>
            <i />
            {label}
          </span>
        ))}
        <span>↓ assigned · ↑ reporting back · ↔ review</span>
        <span className="team-map-hint">
          Drag project headers to reorder · arrows to explore
        </span>
      </div>
      <div
        ref={viewport}
        className="team-map-viewport"
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            window.matchMedia("(max-width: 680px)").matches ||
            (event.target as HTMLElement).closest("button, select")
          )
            return;
          drag.current = { x: event.clientX, y: event.clientY, camera };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            setCamera({
              ...drag.current.camera,
              x: drag.current.camera.x + event.clientX - drag.current.x,
              y: drag.current.camera.y + event.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        {!map.nodes.length ? (
          <div className="team-map-empty">
            <h2>Your team will appear here</h2>
            <p>
              Add a project and its Manager, or create a Mono from the sidebar.
            </p>
          </div>
        ) : (
          <div className="tree-map-stage" style={{ width: Math.max(size.width, camera.x + map.width * camera.zoom + 24), height: Math.max(size.height, camera.y + map.height * camera.zoom + 24) }}><div
            className="team-map-canvas"
            data-compact={teamMapCompact(camera.zoom) && !window.matchMedia("(max-width: 680px)").matches}
            data-orientation={map.orientation}
            data-panning={Boolean(drag.current)}
            role="group"
            aria-label="Mono hierarchy"
            style={{
              width: map.width,
              height: map.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
              "--node-width": `${TEAM_MAP_NODE_WIDTH}px`,
              "--node-height": `${TEAM_MAP_NODE_HEIGHT}px`,
              "--map-zoom": camera.zoom,
            } as CSSProperties}
          >
            <svg
              className="team-map-edges"
              width={map.width}
              height={map.height}
            >
              {map.edges.map((edge) => {
                const target = nodeById.get(edge.target)!;
                return (
                  <g
                    key={edge.id}
                    data-highlighted={activeEdges.has(edge.id)}
                    data-flow={edge.flow}
                    data-reduced-motion={reducedMotion || undefined}
                    data-dimmed={
                      (needsYou && target.status !== "needs-you") || undefined
                    }
                    className="team-map-edge"
                    role="img"
                    aria-label={edge.tooltip}
                  >
                    <title>{edge.tooltip}</title>
                    <path className="team-map-edge-hit" d={edgePath(edge.source, edge.target)} />
                    <path className="team-map-edge-route" d={edgePath(edge.source, edge.target)} />
                    {edge.flow && <path className="team-map-edge-flow" d={teamMapEdgePath({ points: edge.points.slice(-2) })} />}
                  </g>
                );
              })}
              {pulses.flatMap((event) => {
                const animation = teamMapEventAnimation(event, reducedMotion);
                let cursor = event.source;
                return teamMapEventEdges(event, map.edges).map((id, index) => {
                  const edge = map.edges.find((edge) => edge.id === id)!;
                  const reverse = edge.target === cursor;
                  cursor = reverse ? edge.source : edge.target;
                  return (
                    <g
                      key={`${event.id}:${id}`}
                      className={`team-map-pulse ${animation.dashed ? "team-map-return" : ""}`}
                      data-event-id={event.id}
                      data-dimmed={
                        (needsYou &&
                          nodeById.get(edge.target)?.status !== "needs-you") ||
                        undefined
                      }
                    >
                      <path
                        d={edgePath(edge.source, edge.target)}
                        className="team-map-pulse-track"
                      />
                      <EdgePulse
                        path={edgePath(edge.source, edge.target, reverse)}
                        delay={index * 1.5}
                        reducedMotion={reducedMotion}
                        x={reverse ? edge.points[0].x : edge.points[edge.points.length - 1].x}
                        y={reverse ? edge.points[0].y : edge.points[edge.points.length - 1].y}
                      />
                    </g>
                  );
                });
              })}
            </svg>
            {map.pods.map(pod => {
              const manager = nodeById.get(pod.id)!;
              return <div key={pod.id} className="tree-project" data-drop-target={dropTarget === pod.id} style={{ left: pod.x, top: pod.y, width: pod.width, height: pod.height }}>
                <button type="button" className="tree-project-header" draggable
                  aria-label={`Focus ${manager.project ? projectName(manager.project) : monoLook(manager.mono).name} team`}
                  title="Drag to reorder projects. Alt + Left or Right moves this project."
                  onClick={() => { focusPod(pod.id); onSelectMono?.(pod.id); }}
                  onDragStart={event => { projectDrag.current = pod.id; event.dataTransfer.setData("text/plain", pod.id); event.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={event => { if (!projectDrag.current) return; event.preventDefault(); setDropTarget(pod.id); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={event => { event.preventDefault(); reorder(pod.id); }}
                  onDragEnd={() => { projectDrag.current = undefined; setDropTarget(undefined); }}
                  onKeyDown={event => {
                    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                    event.preventDefault();
                    const ids = map.pods.map(pod => pod.id);
                    const index = ids.indexOf(pod.id), next = index + (event.key === "ArrowLeft" ? -1 : 1);
                    if (next < 0 || next >= ids.length) return;
                    [ids[index], ids[next]] = [ids[next], ids[index]];
                    const visible = new Set(ids);
                    const saved = projectIds;
                    let slot = 0;
                    const merged = saved.map(id => visible.has(id) ? ids[slot++] : id);
                    saveOrder(merged);
                  }}>
                  <span className="tree-project-grip" aria-hidden="true">⠿</span>
                  <span className="tree-project-mark" aria-hidden="true">{(manager.project ? projectName(manager.project) : monoLook(manager.mono).name).slice(0, 2).toUpperCase()}</span>
                  <strong>{manager.project ? projectName(manager.project) : monoLook(manager.mono).name}</strong>
                  <span>{pod.memberIds.length + manager.hiddenCount} workers</span>
                </button>
              </div>;
            })}
            {map.nodes.map((node, index) => {
              const mono = node.mono,
                look = monoLook(mono);
              const dim = needsYou && node.status !== "needs-you";
              let depth = 0;
              for (let parent = node.parentId; parent && nodeById.has(parent); parent = nodeById.get(parent)?.parentId) depth++;
              return (
                <div
                  key={mono.id}
                  data-id={mono.id}
                  className="team-map-node"
                  data-role={mono.role || "mono"}
                  data-selected={(selectedMonoId ?? focused) === mono.id}
                  data-status={node.status}
                  data-dimmed={dim}
                  data-highlighted={activeNodes.has(mono.id)}
                  style={
                    {
                      left: node.x,
                      top: node.y,
                      "--node-color": mono.color,
                      "--node-depth": depth,
                    } as CSSProperties
                  }
                  onMouseEnter={() => { if (!onSelectMono) setHovered(mono.id); }}
                  onMouseLeave={() => setHovered(undefined)}
                >
                  {!mono.role &&
                    (index === 0 || map.nodes[index - 1].mono.role) && (
                      <span className="team-map-cluster">Other Monos</span>
                    )}
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) buttons.current.set(mono.id, element);
                      else buttons.current.delete(mono.id);
                    }}
                    className="team-map-node-open"
                    tabIndex={tabStop === mono.id ? 0 : -1}
                    aria-label={`${look.name}, ${mono.specialty || mono.role || "Mono"}, ${node.status === "pr-ready" ? labels[node.status] : monoStatusLabel(node.state)}${node.state.teamWorking ? `, ${monoTeamWorkingLabel(node.state)}` : ""}. Open chat`}
                    aria-describedby={
                      hovered === mono.id
                        ? `team-map-tip-${mono.id}`
                        : undefined
                    }
                    onFocus={() => {
                      setFocused(mono.id);
                      if (!onSelectMono) setHovered(mono.id);
                    }}
                    onBlur={() => setHovered(undefined)}
                    onClick={() => {
                      setHovered(undefined);
                      if (onSelectMono) { onSelectMono(mono.id); return; }
                      onClose();
                      onOpenMono(mono.id);
                    }}
                    onKeyDown={(event) => {
                      if (!event.key.startsWith("Arrow")) return;
                      event.preventDefault();
                      const narrow =
                        window.matchMedia("(max-width: 680px)").matches;
                      const next = narrow
                        ? map.nodes[
                            Math.max(
                              0,
                              Math.min(
                                map.nodes.length - 1,
                                index +
                                  (["ArrowUp", "ArrowLeft"].includes(event.key)
                                    ? -1
                                    : 1),
                              ),
                            )
                          ]?.id
                        : teamMapKeyboardNode(map.nodes, mono.id, event.key);
                      if (next) focusNode(next);
                    }}
                  >
                    <span className="team-map-node-heading">
                      <span className="team-map-ring">
                        <PixelMascot
                          name={look.mascot}
                          color={look.color}
                          still
                          className="size-7"
                        />
                      </span>
                      <span className="team-map-identity">
                        <strong title={look.name}>{look.name}</strong>
                        <span className="tree-agent-status" title={mono.specialty || mono.role || "Mono"}>
                          <i aria-hidden="true" />
                          <span>{node.status === "pr-ready" ? labels[node.status] : monoStatusLabel(node.state)}</span>
                        </span>
                      </span>
                    </span>
                    <span className="team-map-status-chip">{labels[node.status]}</span>
                    <span
                      className="team-map-task"
                      title={node.title || node.state.activity}
                    >
                      {node.summary ||
                        (node.state.teamWorking ? `${monoTeamWorkingLabel(node.state)} · ${node.title}` : node.status === "working" && node.title
                          ? `Now: ${node.title}`
                          : node.title ||
                            node.state.activity ||
                            "Ready for the next task")}
                    </span>
                  </button>
                  {mono.role === "manager" && (
                    <button
                      type="button"
                      className="team-map-collapse"
                      aria-label={`${collapsed.has(mono.id) ? "Expand" : "Collapse"} ${look.name}’s team`}
                      aria-expanded={!collapsed.has(mono.id)}
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(mono.id)) next.delete(mono.id);
                          else next.add(mono.id);
                          return next;
                        })
                      }
                    >
                      {collapsed.has(mono.id) ? "+" : "−"}
                    </button>
                  )}
                  {hovered === mono.id && (
                    <div
                      role="tooltip"
                      id={`team-map-tip-${mono.id}`}
                      className="team-map-tooltip"
                    >
                      <strong>{look.name}</strong>
                      <dl>
                        <dt>Current task</dt>
                        <dd>{node.title || "No active task"}</dd>
                        <dt>Last report</dt>
                        <dd>{node.lastReport || "No report yet"}</dd>
                        <dt>Model</dt>
                        <dd>{node.model}</dd>
                        <dt>Permissions</dt>
                        <dd>{node.permissions}</dd>
                      </dl>
                    </div>
                  )}
                </div>
              );
            })}
          </div></div>
        )}
        <div className="team-map-zoom">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.2)}
          >
            <Minus className="size-3.5" />
          </button>
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.2)}
          >
            <Plus className="size-3.5" />
          </button>
          <button type="button" onClick={() => { setCamera(fitTeamMap(size.width, size.height, map.width, map.height)); viewport.current?.scrollTo?.({ left: 0, top: 0 }); }}>
            Fit to view
          </button>
        </div>
      </div>
      <footer className="team-map-timeline" aria-label="Recent crew events">
        <span className="team-map-feed-label">Crew feed</span>
        {feed.length ? (
          feed
            .slice(0, 16)
            .map((event) => (
              <button
                key={event.id}
                type="button"
                title={event.sentence}
                onMouseEnter={() => setHighlight(event)}
                onMouseLeave={() => setHighlight(undefined)}
                onFocus={() => setHighlight(event)}
                onBlur={() => setHighlight(undefined)}
                onClick={() => {
                  setHighlight(event);
                  let id = nodeById.has(event.target)
                    ? event.target
                    : event.source;
                  if (!nodeById.has(id))
                    id =
                      roster.find((mono) => mono.id === event.target)
                        ?.reportsTo ?? id;
                  if (nodeById.has(id)) focusNode(id);
                }}
              >
                {[event.source, event.target].map((id, index) => {
                  const mono = roster.find((mono) => mono.id === id);
                  const look = mono && monoLook(mono);
                  return look ? <PixelMascot key={`${id}:${index}`} name={look.mascot} color={look.color} still className="size-4 shrink-0" /> : null;
                })}
                <span className="team-map-feed-kind">{event.kind}{event.count > 1 ? ` ×${event.count}` : ""}</span>
                {event.sentence}
              </button>
            ))
        ) : (
          <p>Delegations and reports will appear here as your team works.</p>
        )}
      </footer>
      {undoOrder && <div className="tree-reorder-toast" role="status">Project order updated <button type="button" onClick={() => { setOrder(undoOrder); saveOrbitPreferences({ ...loadOrbitPreferences(), order: undoOrder }); setUndoOrder(undefined); }}>Undo reorder</button></div>}
    </section>
  );
}

export function TeamMap(props: TeamMapProps) {
  const [view, setView] = useState(() => loadOrbitPreferences().view);
  const toggle = () => {
    const next = view === "orbit" ? "tree" : "orbit";
    setView(next);
    saveOrbitPreferences({ ...loadOrbitPreferences(), view: next });
  };
  return view === "tree"
    ? <TreeMap {...props} onToggleView={toggle} />
    : <OrbitMap {...props} onToggleView={toggle} />;
}
