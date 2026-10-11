import { createContext, useContext, useId, useState, useSyncExternalStore } from "react";
import {
  dedicatedMono,
  listMonos,
  monoLook,
  monosSnapshot,
  monoState,
  monoLiveStatusLabel,
  monoTeamWorkingLabel,
  subscribeMonos,
} from "../../monos/model/mono";
import { memberTasks, monoLiveState } from "../../monos/model/monoNavigation";
import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import { AgentDetailTooltip } from "../../agents/ui/AgentDetailTooltip";
import { agentLiveStateTooltip } from "../../agents/model/agentLiveState";
import type { Session } from "../../sessions/model/session";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { ManagerAvatar } from "./ManagerAvatar";
import { orchestrator, orchestrationPathKey } from "../model/orchestration";
import type { ManagerAttention } from "../model/projectManager";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";
import { useProjectExpansion } from "../../projects/hooks/useProjectExpansion";

export const SidebarUnseenCounts = createContext<ReadonlyMap<string, number>>(new Map());

export function ProjectManagerRow({
  project,
  onOpen,
  attention = [],
  running = false,
  enabled = true,
  selected = false,
  expanded,
  onToggle,
  approvalSessionIds,
  busySessionIds,
  selectedMemberId,
  onOpenMember,
  sessions,
  unseenCounts,
}: {
  project: string;
  onOpen(project: string): Promise<void>;
  attention?: readonly ManagerAttention[];
  running?: boolean;
  enabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  ownedCount?: number;
  approvalSessionIds?: ReadonlySet<string>;
  busySessionIds?: ReadonlySet<string>;
  selectedMemberId?: string;
  onOpenMember?: (memberId: string) => Promise<void>;
  sessions?: readonly Session[];
  unseenCounts?: ReadonlyMap<string, number>;
}) {
  const [opening, setOpening] = useState(false);
  const [focusedMemberId, setFocusedMemberId] = useState<string>();
  const inheritedUnseenCounts = useContext(SidebarUnseenCounts);
  const unread = unseenCounts ?? inheritedUnseenCounts;
  const [idleExpanded, setIdleExpanded] = useProjectExpansion(project, "manager-idle-members", false);
  const idleGroupId = useId();
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const mono = dedicatedMono(project);
  const look = mono && monoLook(mono);
  const members = mono
    ? listMonos().filter(
        (member) => member.role === "member" && member.reportsTo === mono.id,
      )
    : [];
  const [error, setError] = useState<string>();
  const { data } = useProjectWorktrees(
    project,
    enabled && !project.startsWith("remote:"),
  );
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const run = runs.find(
    (run) =>
      run.projectManager &&
      (!mono || run.ownerMonoId === mono.id || run.leadId === mono.sessionId) &&
      orchestrationPathKey(run.cwd) === orchestrationPathKey(project),
  );
  if (project.startsWith("remote:") || !data?.worktrees.length) return null;
  const waiting = attention.filter(
    (item) =>
      orchestrationPathKey(item.project) === orchestrationPathKey(project),
  );
  const decision =
    waiting.some((item) => item.kind === "decision") ||
    run?.tasks.some((task) =>
      ["blocked", "failed", "interrupted"].includes(task.status),
    ) === true;
  const ready = waiting.some((item) => item.kind === "ready");
  const live = mono && sessions ? monoLiveState(listMonos(), runs, sessions, mono.id) : undefined;
  const label = decision
    ? waiting.some(item => item.kind === "decision") ? "Needs your decision" : "Needs attention"
    : ready
      ? "Ready to merge"
      : waiting.length
        ? "New reply"
        : running || run?.tasks.some((task) => task.status === "running")
          ? "Running"
          : undefined;
  const memberRows = members.map((member) => {
    const tasks = memberTasks(runs, member.id);
    const task = tasks.find(task => ["queued", "running", "cancelling"].includes(task.status)) ?? tasks[0];
    const ids = [member.sessionId, task?.sessionId];
    const state = sessions ? monoLiveState(listMonos(), runs, sessions, member.id) : monoState({
      blocks: ids.some(id => id && approvalSessionIds?.has(id)) ? [{ id: "approval", role: "approval", text: "", approval: { requestId: 0 } }] : [],
      busy: ids.some(id => id && busySessionIds?.has(id)),
    }, { task, tasks });
    const pinned = member.id === selectedMemberId || member.id === focusedMemberId || (unread.get(member.id) ?? 0) > 0
      || ids.some(id => id && (approvalSessionIds?.has(id) || busySessionIds?.has(id)
        || waiting.some(item => item.id === id)))
      || waiting.some(item => item.id === member.id)
      || (state.liveState?.status ?? state.status) !== "idle";
    return { member, task, state, pinned };
  });
  const idleCount = memberRows.filter(row => !row.pinned).length;
  return (
    <div className="relative mb-0.5">
      {onToggle && members.length > 0 && (
        <button
          type="button"
          data-sidebar-row
          aria-label="Toggle Manager team"
          aria-expanded={expanded}
          onClick={onToggle}
          className="absolute left-1 top-2 z-10 grid size-4 place-items-center rounded text-content/75 hover:text-content focus-visible:outline-accent"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
      )}
      <AgentDetailTooltip detail={live?.liveState && agentLiveStateTooltip(live.liveState)}>
      <button
        type="button"
        data-sidebar-row
        disabled={opening}
        aria-label="Open project manager"
        aria-busy={opening}
        aria-current={selected ? "page" : undefined}
        title={
          waiting.length
            ? [
                waiting.filter((item) => item.kind === "decision").length &&
                  `${waiting.filter((item) => item.kind === "decision").length} awaiting your decision`,
                waiting.filter((item) => item.kind === "ready").length &&
                  `${waiting.filter((item) => item.kind === "ready").length} ready to merge`,
                waiting.filter((item) => item.kind === "reply").length &&
                  `${waiting.filter((item) => item.kind === "reply").length} new replies`,
              ]
                .filter(Boolean)
                .join(" · ")
            : label || "Manager"
        }
        className={`flex h-8 w-full items-center gap-1 rounded-md pl-5 pr-2 text-left text-xs focus-visible:outline-accent disabled:opacity-50 @max-[240px]/sidebar:h-auto @max-[240px]/sidebar:min-h-8 @max-[240px]/sidebar:flex-wrap @max-[240px]/sidebar:py-1 ${selected ? "bg-selection text-content" : "text-content/75 hover:bg-content/5 hover:text-content"}`}
        onClick={() => {
          setOpening(true);
          setError(undefined);
          void onOpen(project)
            .catch((reason) => setError(String(reason)))
            .finally(() => setOpening(false));
        }}
      >
        {look ? (
          <PixelMascot
            name={look.mascot}
            color={look.color}
            still
            className="size-5 shrink-0"
            status={live?.status ?? (decision ? "needs-you" : label === "Running" ? "working" : "idle")}
          />
        ) : (
          <ManagerAvatar
            project={project}
            status={
              decision
                ? "decision"
                : ready
                  ? "ready"
                  : waiting.length
                    ? "reply"
                    : label
                      ? "running"
                      : undefined
            }
          />
        )}
        <span className="min-w-0 flex-1 truncate @max-[240px]/sidebar:overflow-visible @max-[240px]/sidebar:whitespace-normal @max-[240px]/sidebar:break-words">
          {look?.name ?? "Manager"}
        </span>
        {live && <span role="status" title={live.liveState?.detail} className="ml-auto shrink-0 text-[10px] text-content/75 @max-[240px]/sidebar:ml-6 @max-[240px]/sidebar:basis-full @max-[240px]/sidebar:shrink @max-[240px]/sidebar:whitespace-normal">{live.liveState ? <AgentStatusLabel state={live.liveState} /> : monoLiveStatusLabel(live)}{live.teamWorking ? ` · ${monoTeamWorkingLabel(live)}` : ""}{waiting.length > 1 ? ` (${waiting.length})` : ""}</span>}
        {label && !live && (
          <span
            role="status"
            aria-label={`${label}${waiting.length > 1 ? ` (${waiting.length})` : ""}`}
            title={label}
            className="ml-auto flex items-center gap-1.5 text-[10px] text-content/75 @max-[240px]/sidebar:ml-6 @max-[240px]/sidebar:basis-full"
          >
            {waiting.length > 1 ? waiting.length : null}
          </span>
        )}
      </button>
      </AgentDetailTooltip>
      <div id={idleGroupId}>
      {memberRows.filter(row => row.pinned || expanded !== false && idleExpanded).map(({ member, task, state }) => {
          const look = monoLook(member);
          const availability = state.status;
          const memberSelected = member.id === selectedMemberId;
          return (
            <AgentDetailTooltip key={member.id} detail={state.liveState && agentLiveStateTooltip(state.liveState)}>
            <button
              type="button"
              data-sidebar-row
              key={member.id}
              aria-current={memberSelected ? "page" : undefined}
              aria-label={`Open ${look.name}`}
              onFocus={() => setFocusedMemberId(member.id)}
              onBlur={() => setFocusedMemberId(undefined)}
              className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pl-9 pr-2 text-left text-xs focus-visible:outline-accent @max-[240px]/sidebar:h-auto @max-[240px]/sidebar:min-h-7 @max-[240px]/sidebar:flex-wrap @max-[240px]/sidebar:py-1 ${memberSelected ? "bg-selection text-content" : "text-content/75 hover:bg-content/5"}`}
              title={
                task
                  ? task.title
                  : look.name
              }
              onClick={() => { setError(undefined); void onOpenMember?.(member.id).catch(reason => setError(String(reason))); }}
            >
              <PixelMascot
                name={look.mascot}
                color={look.color}
                still
                className="size-4 shrink-0"
                status={availability}
              />
              <span className="min-w-0 flex-1 truncate @max-[240px]/sidebar:overflow-visible @max-[240px]/sidebar:whitespace-normal @max-[240px]/sidebar:break-words">{look.name}</span>
              <span role="status" className={`ml-auto shrink-0 text-[10px] @max-[240px]/sidebar:ml-5 @max-[240px]/sidebar:basis-full @max-[240px]/sidebar:shrink @max-[240px]/sidebar:whitespace-normal ${availability === "needs-you" ? "text-amber-700 dark:text-amber-400" : availability === "working" ? "text-content/75 dark:text-accent" : "text-content/75"}`}>
                {state.liveState ? <AgentStatusLabel state={state.liveState} /> : monoLiveStatusLabel(state)}
              </span>
            </button>
            </AgentDetailTooltip>
          );
        })}
      </div>
      {expanded !== false && idleCount > 0 && (
        <button
          type="button"
          data-sidebar-row
          aria-expanded={idleExpanded}
          aria-controls={idleGroupId}
          onClick={() => setIdleExpanded(!idleExpanded)}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setIdleExpanded(event.key === "ArrowRight");
            }
          }}
          className="flex h-7 w-full items-center gap-1.5 rounded-md pl-9 pr-2 text-left text-[11px] text-content/75 hover:bg-content/5 focus-visible:outline-accent"
        >
          {idleExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {idleCount} idle {idleCount === 1 ? "member" : "members"}
        </button>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
