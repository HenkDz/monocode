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
} from "./model";
import "./teamMap.css";

type Props = {
  sessions: readonly Session[];
  runs: readonly OrchestrationRun[];
  statuses: ReadonlyMap<string, GitPr | null>;
  scope?: string;
  onOpenMono: (id: string) => void;
  onClose: () => void;
};
type MapEvent = ReturnType<typeof teamMapEvents>[number];
const labels = {
  working: "Working",
  "needs-you": "Needs you",
  "pr-ready": "PR ready",
  idle: "Idle",
};

function EdgePulse({
  path,
  delay,
  reducedMotion,
  x,
  y,
}: {
  path: string;
  delay: number;
  reducedMotion: boolean;
  x: number;
  y: number;
}) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  const visibility = useRef<SVGSetElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      motion.current?.beginElementAt(delay);
      visibility.current?.beginElementAt(delay);
    });
    return () => cancelAnimationFrame(frame);
  }, [path, delay, reducedMotion]);
  return (
    <circle
      r="5"
      cx={reducedMotion ? x : 0}
      cy={reducedMotion ? y : 0}
      opacity={reducedMotion ? 1 : 0}
    >
      {!reducedMotion && (
        <animateMotion
          ref={motion}
          dur="1.5s"
          begin="indefinite"
          fill="freeze"
          path={path}
        />
      )}
      {!reducedMotion && (
        <set
          ref={visibility}
          attributeName="opacity"
          to="1"
          begin="indefinite"
          dur="1.5s"
          fill="freeze"
        />
      )}
    </circle>
  );
}

export function TeamMap({
  sessions,
  runs,
  statuses,
  scope,
  onOpenMono,
  onClose,
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
  const [project, setProject] = useState("");
  const [needsYou, setNeedsYou] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string>();
  const [highlight, setHighlight] = useState<MapEvent>();
  const [focused, setFocused] = useState<string>();
  const [pulses, setPulses] = useState<MapEvent[]>([]);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const dialog = useRef<HTMLDialogElement>(null);
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
    scope,
    project: project || undefined,
    collapsed,
  };
  const map = useMemo(
    () => buildTeamMap(input),
    [roster, runs, sessions, statuses, scope, project, collapsed],
  );
  const allEvents = useMemo(
    () => teamMapEvents({ roster, runs, sessions, statuses, messages, goals }),
    [roster, runs, sessions, statuses, messages, goals],
  );
  const events = useMemo(
    () => teamMapEvents({ ...input, messages, goals }),
    [roster, runs, sessions, statuses, scope, project, messages, goals],
  );
  const nodeById = new Map(map.nodes.map((node) => [node.mono.id, node]));
  const tabStop = nodeById.has(focused ?? "") ? focused : map.nodes[0]?.id;
  const projects = [
    ...new Set(
      roster
        .filter(
          (mono) =>
            !mono.archivedAt &&
            mono.role === "manager" &&
            (!scope || mono.id === scope),
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

  const fit = () => {
    if (!viewport.current) return;
    const { clientWidth: width, clientHeight: height } = viewport.current;
    const zoom = Math.min(
      1,
      Math.max(
        0.2,
        Math.min((width - 48) / map.width, (height - 48) / map.height),
      ),
    );
    setCamera({
      zoom,
      x: (width - map.width * zoom) / 2,
      y: (height - map.height * zoom) / 2,
    });
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
    if (window.matchMedia("(max-width: 680px)").matches) {
      const button = buttons.current.get(id);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    setCamera((previous) => ({
      ...previous,
      x: viewport.current!.clientWidth / 2 - (node.x + 120) * previous.zoom,
      y: viewport.current!.clientHeight / 2 - (node.y + 65) * previous.zoom,
    }));
    buttons.current.get(id)?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => {
      element.close();
      motion.removeEventListener("change", update);
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    fit();
    const observer = new ResizeObserver(fit);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [map.width, map.height, project, scope, collapsed]);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      if (window.matchMedia("(max-width: 680px)").matches || !event.deltaY)
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
    const a = nodeById.get(source),
      b = nodeById.get(target);
    if (!a || !b) return "";
    const start = { x: a.x + 120, y: a.y + 130 },
      end = { x: b.x + 120, y: b.y };
    const mid = (start.y + end.y) / 2;
    return reverse
      ? `M ${end.x} ${end.y} C ${end.x} ${mid}, ${start.x} ${mid}, ${start.x} ${start.y}`
      : `M ${start.x} ${start.y} C ${start.x} ${mid}, ${end.x} ${mid}, ${end.x} ${end.y}`;
  };

  return (
    <dialog
      ref={dialog}
      className="team-map-shell"
      aria-labelledby="team-map-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="team-map-toolbar">
        <div>
          <h1 id="team-map-title">Team map</h1>
          <p>
            {scope && roster.find((mono) => mono.id === scope)
              ? monoLook(roster.find((mono) => mono.id === scope)!).name +
                "’s team"
              : "Your team, working together"}
          </p>
        </div>
        <div className="team-map-filters">
          <label>
            <span className="sr-only">Project</span>
            <select
              aria-label="Project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((path) => (
                <option key={path} value={path}>
                  {projectName(path)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={needsYou}
            onClick={() => setNeedsYou(!needsYou)}
          >
            Needs you
          </button>
          <button type="button" aria-label="Close team map" onClick={onClose}>
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
        <span className="team-map-hint">
          Drag to pan · scroll to zoom · arrows to explore
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
          <div
            className="team-map-canvas"
            role="group"
            aria-label="Mono hierarchy"
            style={{
              width: map.width,
              height: map.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            <svg
              className="team-map-edges"
              width={map.width}
              height={map.height}
              aria-hidden="true"
            >
              {map.edges.map((edge) => {
                const source = nodeById.get(edge.source)!,
                  target = nodeById.get(edge.target)!;
                return (
                  <g
                    key={edge.id}
                    data-highlighted={activeEdges.has(edge.id)}
                    className="team-map-edge"
                  >
                    <path d={edgePath(edge.source, edge.target)} />
                    {edge.label && (
                      <foreignObject
                        x={(source.x + target.x) / 2 + 30}
                        y={(source.y + target.y) / 2 + 49}
                        width="180"
                        height="26"
                      >
                        <div className="team-map-edge-label" title={edge.label}>
                          {edge.label}
                        </div>
                      </foreignObject>
                    )}
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
                    >
                      <path
                        d={edgePath(edge.source, edge.target)}
                        className="team-map-pulse-track"
                      />
                      <EdgePulse
                        path={edgePath(edge.source, edge.target, reverse)}
                        delay={index * 1.5}
                        reducedMotion={reducedMotion}
                        x={nodeById.get(edge.target)!.x + 120}
                        y={nodeById.get(edge.target)!.y}
                      />
                    </g>
                  );
                });
              })}
            </svg>
            {map.nodes.map((node, index) => {
              const mono = node.mono,
                look = monoLook(mono);
              const dim = needsYou && node.status !== "needs-you";
              return (
                <div
                  key={mono.id}
                  className="team-map-node"
                  data-role={mono.role || "mono"}
                  data-status={node.status}
                  data-dimmed={dim}
                  data-highlighted={activeNodes.has(mono.id)}
                  style={
                    {
                      left: node.x,
                      top: node.y,
                      "--node-color": mono.color,
                      "--node-depth": (node.y - 48) / 216,
                    } as CSSProperties
                  }
                  onMouseEnter={() => setHovered(mono.id)}
                  onMouseLeave={() => setHovered(undefined)}
                >
                  {mono.role === "manager" && node.project && (
                    <span className="team-map-cluster">
                      {projectName(node.project)}
                    </span>
                  )}
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
                    aria-label={`${look.name}, ${mono.specialty || mono.role || "Mono"}, ${labels[node.status]}. Open chat`}
                    aria-describedby={
                      hovered === mono.id
                        ? `team-map-tip-${mono.id}`
                        : undefined
                    }
                    onFocus={() => {
                      setFocused(mono.id);
                      setHovered(mono.id);
                    }}
                    onBlur={() => setHovered(undefined)}
                    onClick={() => {
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
                        <strong>{look.name}</strong>
                        <span>
                          {mono.specialty ||
                            (mono.role === "member"
                              ? "Teammate"
                              : mono.role || "Mono")}
                        </span>
                      </span>
                      <span
                        className="team-map-status-dot"
                        title={labels[node.status]}
                      />
                    </span>
                    <span className="team-map-node-meta">
                      <span className="team-map-model" title={node.model}>
                        {node.model}
                      </span>
                      <span>{labels[node.status]}</span>
                    </span>
                    <span
                      className="team-map-task"
                      title={node.title || node.state.activity}
                    >
                      {node.summary ||
                        (node.status === "working" && node.title
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
          </div>
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
          <button type="button" onClick={fit}>
            Fit to view
          </button>
        </div>
      </div>
      <footer className="team-map-timeline" aria-label="Recent crew events">
        <span className="team-map-feed-label">Crew feed</span>
        {events.length ? (
          events
            .slice(-16)
            .reverse()
            .map((event) => (
              <button
                key={event.id}
                type="button"
                title={event.label}
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
                <span>{event.kind}</span>
                {event.label}
              </button>
            ))
        ) : (
          <p>Delegations and reports will appear here as your team works.</p>
        )}
      </footer>
    </dialog>
  );
}
