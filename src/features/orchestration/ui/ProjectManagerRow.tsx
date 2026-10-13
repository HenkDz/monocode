import { createContext, useContext, useState, useSyncExternalStore } from "react";
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
import { ManagerAvatar } from "./ManagerAvatar";
import { orchestrator, orchestrationPathKey } from "../model/orchestration";
import type { ManagerAttention } from "../model/projectManager";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";

export const SidebarUnseenCounts = createContext<ReadonlyMap<string, number>>(new Map());

export function ProjectManagerRow({
  project,
  onOpen,
  attention = [],
  running = false,
  enabled = true,
  selected = false,
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
    ? waiting.some(item => item.kind === "decision" && !item.authRequired) ? "Needs your decision" : waiting.some(item => item.authRequired) ? "Sign-in required" : "Needs attention"
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
  const renderMember = ({ member, task, state, pinned }: typeof memberRows[number]) => {
    const look = monoLook(member);
    const availability = state.status;
    const memberSelected = member.id === selectedMemberId;
    return (
      <AgentDetailTooltip key={member.id} detail={state.liveState && agentLiveStateTooltip(state.liveState)}>
        <button
          type="button"
          data-sidebar-row
          data-idle-member={!pinned || undefined}
          aria-current={memberSelected ? "page" : undefined}
          aria-label={`Open ${look.name}`}
          onFocus={pinned ? () => setFocusedMemberId(member.id) : undefined}
          onBlur={pinned ? () => setFocusedMemberId(undefined) : undefined}
          className={pinned
            ? `flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pl-5 pr-2 text-left text-xs focus-visible:outline-accent @max-[240px]/sidebar:h-auto @max-[240px]/sidebar:min-h-7 @max-[240px]/sidebar:flex-wrap @max-[240px]/sidebar:py-1 ${memberSelected ? "bg-selection text-content" : "text-content/75 hover:bg-content/5"}`
            : "flex max-w-full items-center gap-1 rounded-md border border-stroke px-1.5 py-1 text-[10px] text-content/75 hover:bg-content/5 focus-visible:outline-accent"}
          title={task?.title ?? `${look.name} · ${monoLiveStatusLabel(state)}`}
          onClick={() => { setError(undefined); void onOpenMember?.(member.id).catch(reason => setError(String(reason))); }}
        >
          <PixelMascot name={look.mascot} color={look.color} still className="size-4 shrink-0" status={availability} />
          <span className="min-w-0 flex-1 truncate @max-[240px]/sidebar:overflow-visible @max-[240px]/sidebar:whitespace-normal @max-[240px]/sidebar:break-words">{look.name}</span>
          <span role="status" aria-label={monoLiveStatusLabel(state)} className={pinned ? "ml-auto shrink-0 text-[10px] @max-[240px]/sidebar:[&_.agent-state-text]:sr-only" : "sr-only"}>
            {state.liveState ? <AgentStatusLabel state={state.liveState} /> : monoLiveStatusLabel(state)}
          </span>
        </button>
      </AgentDetailTooltip>
    );
  };
  return (
    <div className="relative mb-0.5">
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
        {live && <span role="status" aria-label={`${monoLiveStatusLabel(live)}${live.teamWorking ? ` · ${monoTeamWorkingLabel(live)}` : ""}${waiting.length > 1 ? ` (${waiting.length})` : ""}`} title={live.liveState && agentLiveStateTooltip(live.liveState)} className="ml-auto shrink-0 text-[10px] text-content/75 @max-[240px]/sidebar:[&_.agent-state-text]:sr-only">{live.liveState ? <AgentStatusLabel state={live.liveState} /> : monoLiveStatusLabel(live)}<span className="@max-[240px]/sidebar:sr-only">{live.teamWorking ? ` · ${monoTeamWorkingLabel(live)}` : ""}{waiting.length > 1 ? ` (${waiting.length})` : ""}</span></span>}
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
      <div>{memberRows.filter(row => row.pinned).map(renderMember)}</div>
      {idleCount > 0 && (
        <section aria-label="Available members" className="py-2 pl-5 pr-2">
          <p className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-content/75">Available <span className="tabular-nums">{idleCount} idle</span></p>
          <div className="flex flex-wrap gap-1.5">{memberRows.filter(row => !row.pinned).map(renderMember)}</div>
        </section>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
