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
  monoState,
  monosSnapshot,
  subscribeMonos,
} from "../monos/model/mono";
import {
  crewMessages,
  crewMessagesSnapshot,
  subscribeCrewMessages,
} from "../monos/model/monoCrewEvents";
import { monoManagerGoals } from "../monos/model/monoManagerGoals";
import { MessageSquare, X } from "../../shared/ui/icons";
import {
  buildTeamMap,
  teamMapEvents,
  teamMapFeed,
  teamMapEventAnimation,
  teamMapMatches,
  type TeamMapNode,
  type TeamMapEvent,
} from "./model";
import {
  orbitProjects,
  orbitDefaultFocus,
  orbitPage,
  orbitRotation,
  orbitLayout,
  orbitMembers,
  ORBIT_PAGE_SIZE,
  orbitKeyboardProject,
  loadOrbitPreferences,
  saveOrbitPreferences,
} from "./orbit";
import { EdgePulse } from "./EdgePulse";
import type { TeamMapProps } from "./TeamMap";
import "./orbit.css";

const labels = {
  working: "Working",
  "needs-you": "Needs you",
  "pr-ready": "PR ready",
  idle: "Idle",
};
function Mascot({ node, tiny = false }: { node: TeamMapNode; tiny?: boolean }) {
  const look = monoLook(node.mono);
  return (
    <span
      className={tiny ? "orbit-tiny-mascot" : "team-map-ring"}
      data-status={node.status}
      title={`${look.name} · ${labels[node.status]}`}
    >
      <PixelMascot
        name={look.mascot}
        color={look.color}
        still
        className={tiny ? "size-4" : "size-7"}
      />
    </span>
  );
}

export function OrbitMap({
  sessions,
  runs,
  statuses,
  scope,
  onOpenMono,
  onClose,
  onToggleView,
}: TeamMapProps & { onToggleView: () => void }) {
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
  const map = useMemo(
    () => buildTeamMap({ roster, runs, sessions, statuses }),
    [roster, runs, sessions, statuses],
  );
  const [order, setOrder] = useState(() => loadOrbitPreferences().order);
  const projects = useMemo(
    () => orbitProjects(map.nodes, order),
    [map.nodes, order],
  );
  const [focusedId, setFocusedId] = useState<string | undefined>(() =>
    orbitDefaultFocus(projects, scope, loadOrbitPreferences().focus),
  );
  const [expanded, setExpanded] = useState(true);
  const [needsYou, setNeedsYou] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(1100);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [pulses, setPulses] = useState<TeamMapEvent[]>([]);
  const [highlight, setHighlight] = useState<TeamMapEvent>();
  const viewport = useRef<HTMLDivElement>(null);
  const memberButtons = useRef(new Map<string, HTMLButtonElement>());
  const capsuleButtons = useRef(new Map<string, HTMLButtonElement>());
  const centerButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<string>(undefined);
  const seen = useRef<Set<string>>(undefined);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const focusedProject = projects.find(
    (entry) => entry.manager.id === focusedId,
  );
  const visible = orbitPage(projects, undefined, page);
  const layout = orbitLayout(visible.projects.length, width, rotation);
  const members = orbitMembers(focusedProject?.members ?? []);
  const rowCenters = members.map(
    (node, index) =>
      members
        .slice(0, index)
        .reduce(
          (height, member) => height + (member.status === "idle" ? 48 : 64),
          0,
        ) + (node.status === "idle" ? 24 : 32),
  );
  const rowsHeight = members.reduce(
    (height, member) => height + (member.status === "idle" ? 48 : 64),
    0,
  );
  const orchestrator = map.nodes.find(
    (node) => node.mono.role === "orchestrator",
  );
  const orchestratorSession = sessions.find(
    (session) => session.id === orchestrator?.mono.sessionId,
  );
  const centerNode = orchestrator && {
    ...orchestrator,
    status: orchestratorSession
      ? monoState(orchestratorSession).status
      : ("idle" as const),
  };
  const otherMonos = map.nodes.filter(
    (node) =>
      node !== orchestrator &&
      !projects.some(
        (entry) =>
          entry.manager.id === node.id ||
          entry.members.some((member) => member.id === node.id),
      ),
  );
  const events = useMemo(
    () => teamMapEvents({ roster, runs, sessions, statuses, messages, goals }),
    [roster, runs, sessions, statuses, messages, goals],
  );
  const feed = useMemo(() => teamMapFeed(events, roster), [events, roster]);
  const workingBelow = map.nodes.filter(
    (node) => node !== orchestrator && node.status === "working",
  ).length;
  const attention = projects.filter((entry) => entry.counts["needs-you"] > 0);

  const openChat = (id: string) => {
    onClose();
    onOpenMono(id);
  };
  const focusProject = (id: string, keyboard = false) => {
    const index = projects.findIndex((entry) => entry.manager.id === id);
    if (index < 0) return;
    const nextPage = Math.floor(index / ORBIT_PAGE_SIZE);
    const count = Math.min(
      ORBIT_PAGE_SIZE,
      projects.length - nextPage * ORBIT_PAGE_SIZE,
    );
    setPage(nextPage);
    setRotation((current) =>
      orbitRotation(current, index % ORBIT_PAGE_SIZE, count),
    );
    setFocusedId(id);
    setExpanded(true);
    saveOrbitPreferences({ ...loadOrbitPreferences(), focus: id });
    if (keyboard)
      requestAnimationFrame(() => capsuleButtons.current.get(id)?.focus());
  };
  const reorder = (target: string) => {
    const source = drag.current;
    drag.current = undefined;
    if (!source || source === target) return;
    const ids = projects
      .map((entry) => entry.manager.id)
      .filter((id) => id !== source);
    ids.splice(ids.indexOf(target), 0, source);
    setOrder(ids);
    saveOrbitPreferences({ ...loadOrbitPreferences(), order: ids });
  };
  const keydown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("select, input, textarea"))
      return;
    const capsule = (event.target as HTMLElement).closest<HTMLElement>(
      ".orbit-capsule",
    );
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      ".orbit-member-row",
    );
    if (event.key === "Enter" && (capsule || row)) {
      event.preventDefault();
      const id = (capsule ?? row)?.dataset.id;
      if (id) openChat(id);
    } else if (
      ["ArrowLeft", "ArrowRight"].includes(event.key) &&
      projects.length
    ) {
      event.preventDefault();
      const next = orbitKeyboardProject(projects, focusedId, event.key);
      if (next) focusProject(next, true);
    } else if (["ArrowUp", "ArrowDown"].includes(event.key) && members.length) {
      event.preventDefault();
      setExpanded(true);
      const index = members.findIndex(
        (member) => member.id === row?.dataset.id,
      );
      const next =
        event.key === "ArrowDown"
          ? Math.min(index + 1, members.length - 1)
          : index <= 0
            ? -1
            : index - 1;
      requestAnimationFrame(() =>
        next < 0
          ? capsuleButtons.current.get(focusedId ?? "")?.focus()
          : memberButtons.current.get(members[next].id)?.focus(),
      );
    }
  };
  useEffect(() => {
    const id = scope
      ? orbitDefaultFocus(projects, scope)
      : (focusedProject?.manager.id ?? orbitDefaultFocus(projects));
    if (id) focusProject(id);
  }, [projects.map((entry) => entry.manager.id).join("|"), scope]);
  useEffect(() => {
    const resize = () => {
      if (viewport.current?.clientWidth) {
        const style = getComputedStyle(viewport.current);
        setWidth(
          viewport.current.clientWidth -
            (parseFloat(style.paddingLeft) || 0) -
            (parseFloat(style.paddingRight) || 0),
        );
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (viewport.current) observer.observe(viewport.current);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", update);
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (expanded && focusedProject) {
        setExpanded(false);
        capsuleButtons.current.get(focusedId!)?.focus();
      } else onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [expanded, focusedId, focusedProject, onClose]);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(events.map((event) => event.id));
      return;
    }
    const arrivals = events.filter((event) => !seen.current!.has(event.id));
    seen.current = new Set(events.map((event) => event.id));
    if (!arrivals.length) return;
    setPulses((previous) => [...previous, ...arrivals].slice(-12));
    const timer = setTimeout(() => {
      const ids = new Set(arrivals.map((event) => event.id));
      setPulses((previous) => previous.filter((event) => !ids.has(event.id)));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
  }, [events]);

  const matchesProject = (entry: (typeof projects)[number]) =>
    (!projectFilter || entry.project === projectFilter) &&
    (!needsYou || entry.counts["needs-you"] > 0);
  const eventProject = (event: TeamMapEvent) =>
    projects.find((entry) =>
      [entry.manager, ...entry.members].some(
        (node) => node.id === event.source || node.id === event.target,
      ),
    );
  const highlighted = (id: string) =>
    highlight?.source === id || highlight?.target === id;
  const rowActive = (id: string) =>
    pulses.some((event) => event.source === id || event.target === id);
  const chatAction = (node: TeamMapNode) => (
    <button
      type="button"
      className="orbit-chat"
      aria-label={`Open chat with ${monoLook(node.mono).name}`}
      title={`Open chat with ${monoLook(node.mono).name}`}
      onClick={() => openChat(node.id)}
    >
      <MessageSquare className="size-4" />
    </button>
  );
  const memberRow = (node: TeamMapNode) => (
    <div
      key={node.id}
      className="orbit-member-row"
      data-status={node.status}
      data-id={node.id}
      data-dimmed={!teamMapMatches(node, needsYou, projectFilter || undefined)}
      data-active={rowActive(node.id)}
      data-highlighted={highlighted(node.id)}
    >
      <button
        type="button"
        ref={(element) => {
          if (element) memberButtons.current.set(node.id, element);
          else memberButtons.current.delete(node.id);
        }}
        aria-label={`${monoLook(node.mono).name}, ${node.status}. Open chat`}
        onClick={() => openChat(node.id)}
        title={`${node.permissions}\n${node.lastReport}`}
      >
        <Mascot node={node} />
        <span className="orbit-member-name">
          <strong>{monoLook(node.mono).name}</strong>
          <span title={node.mono.specialty || node.mono.role || "Mono"}>
            {node.mono.specialty || node.mono.role || "Mono"}
          </span>
        </span>
        <span className="orbit-member-task" title={node.title}>
          {node.status === "working"
            ? `Now: ${node.title}`
            : node.status === "idle"
              ? "Ready for the next task"
              : node.title}
        </span>
        <span className="team-map-model" title={node.model}>
          {node.model}
        </span>
        <span className="orbit-member-status">{labels[node.status]}</span>
      </button>
      {chatAction(node)}
    </div>
  );

  return (
    <section
      className="team-map-shell orbit-map"
      data-reduced-motion={reducedMotion}
      aria-labelledby="team-map-title"
      onKeyDown={keydown}
    >
      <header className="team-map-toolbar">
        <div>
          <h1 id="team-map-title">Team map</h1>
          <p>Your projects in orbit · one team in focus</p>
        </div>
        <div className="team-map-filters">
          <button type="button" onClick={onToggleView}>
            Tree
          </button>
          <select
            aria-label="Project"
            value={projectFilter}
            onChange={(event) => {
              setProjectFilter(event.target.value);
              const entry = projects.find(
                (entry) => entry.project === event.target.value,
              );
              if (entry) focusProject(entry.manager.id);
            }}
          >
            <option value="">All projects</option>
            {projects.map((entry) => (
              <option key={entry.manager.id} value={entry.project}>
                {entry.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-pressed={needsYou}
            onClick={() => setNeedsYou(!needsYou)}
          >
            Needs you
          </button>
          <button
            type="button"
            autoFocus
            aria-label="Close team map"
            onClick={onClose}
          >
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
          ←/→ projects · ↑/↓ teammates · drag capsules to reorder
        </span>
      </div>
      <div className="orbit-scroll" ref={viewport}>
        {!map.nodes.length ? (
          <div className="team-map-empty">
            <h2>Your team will appear here</h2>
            <p>
              Add a project and its Manager, or create a Mono from the sidebar.
            </p>
          </div>
        ) : (
          <>
            <div
              className="orbit-stage"
              style={
                {
                  width: layout.width,
                  height: layout.height,
                  "--orbit-radius": `${layout.radiusY}px`,
                  "--orbit-scale": layout.scale,
                } as CSSProperties
              }
            >
              <div
                className="orbit-ring"
                hidden={visible.projects.length <= 2}
                aria-hidden="true"
                style={{
                  left: layout.center.x,
                  top: layout.center.y,
                  width: layout.radiusX * 2,
                  height: layout.radiusY * 2,
                }}
              />
              <div
                className="orbit-spokes"
                style={{
                  left: layout.center.x,
                  top: layout.center.y,
                  transform: `rotate(${rotation}deg)`,
                }}
              >
                {visible.projects.map((entry, index) => {
                  const angle = (index * 360) / visible.projects.length;
                  const activity = pulses.filter(
                    (event) =>
                      eventProject(event)?.manager.id === entry.manager.id,
                  );
                  return (
                    <svg
                      key={entry.manager.id}
                      className="orbit-spoke"
                      data-dimmed={!matchesProject(entry)}
                      width="20"
                      height={layout.radiusY}
                      viewBox={`-10 0 20 ${layout.radiusY}`}
                      style={{ transform: `rotate(${angle}deg)` }}
                    >
                      <title>{`Orchestrator ↔ ${monoLook(entry.manager.mono).name}: goals down, reports back`}</title>
                      <path
                        className="orbit-spoke-line"
                        d={`M 0 0 L 0 ${layout.radiusY}`}
                      />
                      {activity
                        .filter(
                          (event) =>
                            teamMapEventAnimation(event, reducedMotion)
                              .direction === "up" ||
                            event.source === orchestrator?.id ||
                            event.target === orchestrator?.id,
                        )
                        .map((event) => {
                          const up =
                            teamMapEventAnimation(event, reducedMotion)
                              .direction === "up";
                          const fromMember = entry.members.some(
                            (node) => node.id === event.source,
                          );
                          const path = up
                            ? `M 0 ${layout.radiusY} L 0 0`
                            : `M 0 0 L 0 ${layout.radiusY}`;
                          return (
                            <g
                              key={event.id}
                              className={`team-map-pulse ${up ? "team-map-return" : ""}`}
                              data-event-id={event.id}
                            >
                              <title>{event.label}</title>
                              <EdgePulse
                                path={path}
                                delay={
                                  up &&
                                  fromMember &&
                                  expanded &&
                                  focusedId === entry.manager.id
                                    ? 1.5
                                    : 0
                                }
                                reducedMotion={reducedMotion}
                                x={0}
                                y={up ? 0 : layout.radiusY}
                              />
                            </g>
                          );
                        })}
                    </svg>
                  );
                })}
              </div>
              {centerNode && (
                <div
                  className="orbit-center"
                  data-status={centerNode.status}
                  data-highlighted={highlighted(centerNode.id)}
                  style={{
                    left: layout.center.x,
                    top: layout.center.y,
                    transform: `scale(${layout.scale})`,
                  }}
                >
                  <button
                    type="button"
                    ref={centerButton}
                    aria-label={`Open chat with ${monoLook(centerNode.mono).name}`}
                    onClick={() => openChat(centerNode.id)}
                  >
                    <Mascot node={centerNode} />
                    <strong>{monoLook(centerNode.mono).name}</strong>
                    <span>
                      {labels[centerNode.status]} · {workingBelow} working below
                    </span>
                    <span
                      className="orbit-attention"
                      title={attention.map((entry) => entry.name).join(", ")}
                    >
                      {attention.length
                        ? `Needs you · in ${attention.map((entry) => entry.name).join(", ")}`
                        : "All projects in view"}
                    </span>
                  </button>
                  {chatAction(centerNode)}
                </div>
              )}
              {visible.projects.map((entry, index) => {
                const angle =
                  (index * 360) / visible.projects.length + rotation;
                const selected = entry.manager.id === focusedId;
                const active = pulses.some(
                  (event) =>
                    eventProject(event)?.manager.id === entry.manager.id,
                );
                return (
                  <div
                    key={entry.manager.id}
                    className="orbit-slot"
                    style={{
                      left: layout.center.x,
                      top: layout.center.y,
                      transform: `rotate(${angle}deg) translateY(${layout.radiusY}px)`,
                    }}
                  >
                    <div
                      className="orbit-upright"
                      style={{
                        transform: `rotate(${-angle}deg) scale(${layout.scale * (selected ? 1.06 : 1)})`,
                      }}
                    >
                      <div
                        className="orbit-capsule"
                        data-id={entry.manager.id}
                        data-focused={selected}
                        data-dimmed={!matchesProject(entry)}
                        data-status={entry.manager.status}
                        data-active={active}
                        data-highlighted={highlighted(entry.manager.id)}
                        draggable
                        onDragStart={(event) => {
                          drag.current = entry.manager.id;
                          event.dataTransfer.setData(
                            "text/plain",
                            entry.manager.id,
                          );
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          reorder(entry.manager.id);
                        }}
                        onDragEnd={() => {
                          drag.current = undefined;
                        }}
                      >
                        <button
                          type="button"
                          className="orbit-capsule-focus"
                          aria-label={`Focus ${entry.name} team`}
                          aria-pressed={selected}
                          ref={(element) => {
                            if (element)
                              capsuleButtons.current.set(
                                entry.manager.id,
                                element,
                              );
                            else
                              capsuleButtons.current.delete(entry.manager.id);
                          }}
                          onClick={() => focusProject(entry.manager.id)}
                        >
                          <span className="orbit-capsule-heading">
                            <Mascot node={entry.manager} />
                            <span>
                              <strong title={entry.name}>{entry.name}</strong>
                              <span title={monoLook(entry.manager.mono).name}>
                                {monoLook(entry.manager.mono).name}
                              </span>
                            </span>
                          </span>
                          <span className="orbit-counts">
                            {(
                              ["working", "needs-you", "pr-ready"] as const
                            ).map((status) => (
                              <span key={status} data-status={status}>
                                <i />
                                {entry.counts[status]}{" "}
                                {labels[status].toLowerCase()}
                              </span>
                            ))}
                          </span>
                          <span className="orbit-crew">
                            {entry.members.map((member) => (
                              <Mascot key={member.id} node={member} tiny />
                            ))}
                            {!entry.members.length && (
                              <span>No teammates yet</span>
                            )}
                          </span>
                        </button>
                        {chatAction(entry.manager)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {visible.pages > 1 && (
              <nav className="orbit-pages" aria-label="Project pages">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() =>
                    focusProject(
                      projects[(page - 1) * ORBIT_PAGE_SIZE].manager.id,
                    )
                  }
                >
                  Previous projects
                </button>
                <span>
                  {visible.page + 1} / {visible.pages}
                </span>
                <button
                  type="button"
                  disabled={page >= visible.pages - 1}
                  onClick={() =>
                    focusProject(
                      projects[(page + 1) * ORBIT_PAGE_SIZE].manager.id,
                    )
                  }
                >
                  Next projects
                </button>
              </nav>
            )}
            {focusedProject && (
              <section
                className="orbit-team"
                aria-label={`${focusedProject.name} team`}
              >
                <header>
                  <div>
                    <h2>{focusedProject.name}</h2>
                    <span>
                      {members.length} teammates ·{" "}
                      {focusedProject.counts.working} working ·{" "}
                      {focusedProject.counts["needs-you"]} need you
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={
                      expanded ? "Collapse focused team" : "Expand focused team"
                    }
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? "Collapse" : "Expand"}
                  </button>
                </header>
                {expanded && (
                  <div key={focusedId} className="orbit-team-rows">
                    <svg
                      className="orbit-drops"
                      width="100%"
                      height={Math.max(64, rowsHeight)}
                      viewBox={`0 0 800 ${Math.max(64, rowsHeight)}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {pulses
                        .filter(
                          (event) =>
                            eventProject(event)?.manager.id === focusedId,
                        )
                        .flatMap((event) => {
                          const index = members.findIndex(
                            (node) =>
                              node.id === event.source ||
                              node.id === event.target,
                          );
                          if (index < 0) return [];
                          const up =
                            teamMapEventAnimation(event, reducedMotion)
                              .direction === "up";
                          const y = rowCenters[index];
                          const path = up
                            ? `M 16 ${y} L 16 8 Q 16 -80 400 -80`
                            : `M 400 -80 Q 16 -80 16 8 L 16 ${y}`;
                          return [
                            <g
                              key={event.id}
                              className={`team-map-pulse ${up ? "team-map-return" : ""}`}
                              data-event-id={event.id}
                            >
                              <EdgePulse
                                path={path}
                                delay={0}
                                reducedMotion={reducedMotion}
                                x={up ? 400 : 16}
                                y={up ? 0 : y}
                              />
                            </g>,
                          ];
                        })}
                    </svg>
                    {members.map(memberRow)}
                    {!members.length && (
                      <p className="orbit-no-members">
                        This Manager has no teammates yet. Open their chat to
                        plan the team.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
            {otherMonos.length > 0 && (
              <section className="orbit-team" aria-label="Other Monos">
                <header>
                  <h2>Other Monos</h2>
                </header>
                {otherMonos.map(memberRow)}
              </section>
            )}
          </>
        )}
      </div>
      <footer className="team-map-timeline" aria-label="Crew feed">
        <span className="team-map-feed-label">Crew feed</span>
        {feed.length ? (
          feed.slice(0, 40).map((event) => (
            <button
              type="button"
              key={event.id}
              title={event.sentence}
              onMouseEnter={() => setHighlight(event)}
              onMouseLeave={() => setHighlight(undefined)}
              onFocus={() => setHighlight(event)}
              onBlur={() => setHighlight(undefined)}
              onClick={() => {
                const entry = eventProject(event);
                if (entry) focusProject(entry.manager.id, true);
                else centerButton.current?.focus();
              }}
            >
              {[event.source, event.target].map((id, index) => {
                const node = map.nodes.find((node) => node.id === id);
                return node ? (
                  <Mascot key={`${id}:${index}`} node={node} tiny />
                ) : null;
              })}
              <span className="team-map-feed-kind">
                {event.kind}
                {event.count > 1 ? ` ×${event.count}` : ""}
              </span>
              {event.sentence}
            </button>
          ))
        ) : (
          <p>Delegations and reports will appear here as your team works.</p>
        )}
      </footer>
    </section>
  );
}
