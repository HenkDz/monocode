import { useState, useSyncExternalStore } from "react";
import {
  dedicatedMono,
  listMonos,
  monoLook,
  monosSnapshot,
  MONO_STATUS_LABEL,
  monoStatusLabel,
  monoTeamWorkingLabel,
  subscribeMonos,
} from "../../monos/model/mono";
import { memberAvailability, memberTasks, monoLiveState } from "../../monos/model/monoNavigation";
import type { Session } from "../../sessions/model/session";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { ManagerAvatar } from "./ManagerAvatar";
import { orchestrator, orchestrationPathKey } from "../model/orchestration";
import type { ManagerAttention } from "../model/projectManager";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";

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
}) {
  const [opening, setOpening] = useState(false);
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
  return (
    <div className="relative mb-0.5">
      {onToggle && members.length > 0 && (
        <button
          type="button"
          aria-label="Toggle Manager team"
          aria-expanded={expanded}
          onClick={onToggle}
          className="absolute left-1 top-2 z-10 grid size-4 place-items-center rounded text-content/50 hover:text-content focus-visible:outline-accent"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
      )}
      <button
        type="button"
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
        className={`flex h-8 w-full items-center gap-1 rounded-md pl-5 pr-2 text-left text-xs focus-visible:outline-accent disabled:opacity-50 ${selected ? "bg-selection text-content" : "text-content/70 hover:bg-content/5 hover:text-content"}`}
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
        <span className="truncate">
          {look?.name ?? "Manager"}
        </span>
        {live && <span role="status" className="ml-auto shrink-0 text-[10px] text-content/50">{monoStatusLabel(live)}{live.teamWorking ? ` · ${monoTeamWorkingLabel(live)}` : ""}{waiting.length > 1 ? ` (${waiting.length})` : ""}</span>}
        {label && !live && (
          <span
            role="status"
            aria-label={`${label}${waiting.length > 1 ? ` (${waiting.length})` : ""}`}
            title={label}
            className="ml-auto flex items-center gap-1.5 text-[10px] text-content/50"
          >
            {waiting.length > 1 ? waiting.length : null}
          </span>
        )}
      </button>
      {expanded !== false &&
        members.map((member) => {
          const look = monoLook(member);
          const tasks = memberTasks(runs, member.id);
          const task = tasks.find(task => ["queued", "running", "cancelling"].includes(task.status)) ?? tasks[0];
          const availability = sessions ? monoLiveState(listMonos(), runs, sessions, member.id).status : memberAvailability(tasks, approvalSessionIds, busySessionIds, member.sessionId);
          const memberSelected = member.id === selectedMemberId;
          return (
            <button
              type="button"
              key={member.id}
              aria-current={memberSelected ? "page" : undefined}
              aria-label={`Open ${look.name}`}
              className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pl-9 pr-2 text-left text-xs focus-visible:outline-accent ${memberSelected ? "bg-selection text-content" : "text-content/60 hover:bg-content/5"}`}
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
              <span className="min-w-0 truncate">{look.name}</span>
              <span role="status" className={`ml-auto shrink-0 text-[10px] ${availability === "needs-you" ? "text-amber-700 dark:text-amber-400" : availability === "working" ? "text-accent" : "text-content/40"}`}>
                {MONO_STATUS_LABEL[availability]}
              </span>
            </button>
          );
        })}
      {error && (
        <p role="alert" className="px-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
