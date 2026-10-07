import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { findMono, monoLook, type Mono } from "../model/mono";
import { memberTasks } from "../model/monoNavigation";
import { orchestrator } from "../../orchestration/model/orchestration";
import {
  managerPrReady,
  managerTaskFinished,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";
import type { GitPr } from "../../../platform/tauri/fs";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { projectName } from "../../../shared/lib/paths";
import { cardSession, openCardSession, subscribeCardSessions } from "../model/monoCards";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";

const expandedCards = new Map<string, boolean>();
const tones = {
  running:
    "border-l-accent [&_[data-task-status]]:bg-accent/10 [&_[data-task-status]]:text-accent",
  review:
    "border-l-amber-500 [&_[data-task-status]]:bg-amber-500/10 [&_[data-task-status]]:text-amber-700 dark:[&_[data-task-status]]:text-amber-400",
  changes:
    "border-l-orange-500 [&_[data-task-status]]:bg-orange-500/10 [&_[data-task-status]]:text-orange-700 dark:[&_[data-task-status]]:text-orange-400",
  ready:
    "border-l-emerald-500 [&_[data-task-status]]:bg-emerald-500/10 [&_[data-task-status]]:text-emerald-700 dark:[&_[data-task-status]]:text-emerald-400",
  merged:
    "border-l-emerald-500/40 [&_[data-task-status]]:bg-emerald-500/5 [&_[data-task-status]]:text-emerald-700 dark:[&_[data-task-status]]:text-emerald-400",
  failed:
    "border-l-red-500 [&_[data-task-status]]:bg-red-500/10 [&_[data-task-status]]:text-red-700 dark:[&_[data-task-status]]:text-red-400",
  muted:
    "border-l-content/20 [&_[data-task-status]]:bg-content/5 [&_[data-task-status]]:text-content/60",
};

function taskStatus(
  task: OrchestrationTask,
  pr?: GitPr | null,
): [string, keyof typeof tones] {
  if (task.status === "cancelled") return ["Cancelled", "muted"];
  if (managerTaskFinished(task, pr) && task.completionOutcome === "no-changes") return ["Completed (no changes)", "merged"];
  if (managerTaskFinished(task, pr))
    return pr?.state === "merged" ? ["Merged", "merged"] : ["Closed", "muted"];
  if (task.status === "running") return ["Running", "running"];
  if (task.status === "failed" || task.status === "blocked")
    return [task.status === "failed" ? "Failed" : "Blocked", "failed"];
  if (managerPrReady(task, pr)) return ["PR ready", "ready"];
  const verdict =
    task.status === "completed" &&
    task.reviewVerdict?.dispatchId ===
      (task.activeDispatchId ?? task.lastDispatchId)
      ? task.reviewVerdict
      : undefined;
  if (verdict?.decision === "changes") return ["Changes requested", "changes"];
  if (task.status === "completed")
    return (task.accepted &&
      !!task.lastDispatchId &&
      task.acceptedDispatchId === task.lastDispatchId) ||
      verdict?.decision === "approve"
      ? ["Approved", "ready"]
      : ["In review", "review"];
  return [
    task.status === "cancelling"
      ? "Cancelling"
      : task.status === "interrupted"
        ? "Interrupted"
        : "Queued",
    "muted",
  ];
}

/** Task snapshots are the durable work log; never copy streaming worker prose into another session. */
export function MemberWorkLog({ member }: { member: Mono }) {
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const statuses = usePrStatusCache();
  const actions = useContext(OrchestrationActions);
  const [expanded, setExpanded] = useState(() => new Map(expandedCards));
  const [, refresh] = useState(0);
  useEffect(() => subscribeCardSessions(() => refresh(value => value + 1)), []);
  const tasks = memberTasks(runs, member.id);
  const manager = findMono(member.reportsTo ?? ""),
    look = manager && monoLook(manager);
  const button =
    "rounded-md px-2.5 py-1.5 hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40";
  return (
    <section
      aria-label="Member work log"
      className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4"
    >
      {!tasks.length && (
        <p className="text-sm text-content/50">
          No assignments yet. {look?.name ?? "Your Manager"} assigns work here,
          or ask me something.
        </p>
      )}
      {tasks.map((task) => {
        const key = `${member.id}:${task.id}`,
          needsYou = !!cardSession(task.sessionId)?.needsInput,
          open = expanded.get(key) ?? needsYou;
        const [label, tone] = needsYou ? ["Needs you", "review"] as const : taskStatus(task, taskPrStatus(task, statuses));
        const dispatch = runs
          .flatMap((run) => run.dispatches ?? [])
          .find(
            (item) =>
              item.id === (task.activeDispatchId ?? task.lastDispatchId),
          );
        const at = dispatch?.updatedAt ?? dispatch?.startedAt ?? task.prReadyAt;
        const cwd = task.workspace?.checkoutCwd;
        const prNumber = task.prUrl?.match(/\/pull\/(\d+)/)?.[1];
        const verdict =
          task.status === "completed" &&
          task.reviewVerdict?.dispatchId ===
            (task.activeDispatchId ?? task.lastDispatchId)
            ? task.reviewVerdict
            : undefined;
        return (
          <article
            key={task.id}
            data-member-task={task.id}
            className={`min-w-0 overflow-hidden rounded-xl border border-content/20 border-l-2 bg-content/5 font-sans text-xs shadow-sm ${tones[tone]}`}
          >
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`member-task-${task.id}`}
              className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left focus-visible:outline-accent"
              onClick={() => {
                const next = !open;
                expandedCards.set(key, next);
                setExpanded((current) => new Map(current).set(key, next));
              }}
            >
              <span className="flex min-w-0 flex-1 basis-52 items-center gap-2">
                <span aria-hidden="true" className="shrink-0 text-content/50">
                  {open ? "▾" : "▸"}
                </span>
                <strong
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={task.title}
                >
                  {task.title}
                </strong>
                <span
                  data-task-status
                  className="shrink-0 rounded-md px-1.5 py-0.5"
                >
                  {label}
                </span>
              </span>
              <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-content/60">
                  {look && (
                    <PixelMascot
                      name={look.mascot}
                      color={look.color}
                      still
                      className="size-4 shrink-0"
                    />
                  )}
                  <span
                    className="max-w-28 truncate"
                    title={
                      task.origin === "user"
                        ? "From user"
                        : `From ${look?.name ?? "Manager"}`
                    }
                  >
                    From{" "}
                    {task.origin === "user"
                      ? "user"
                      : (look?.name ?? "Manager")}
                  </span>
                </span>
                {verdict && (
                  <span
                    title={verdict.notes}
                    className={`shrink-0 rounded-md px-1.5 py-0.5 ${verdict.decision === "approve" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-orange-500/10 text-orange-700 dark:text-orange-400"}`}
                  >
                    {verdict.decision === "approve" ? "Approved" : "Changes"}
                  </span>
                )}
                {task.prUrl && (
                  <span
                    title={task.prUrl}
                    className="shrink-0 rounded-md bg-content/5 px-1.5 py-0.5 text-content/60"
                  >
                    PR {prNumber ? `#${prNumber}` : "↗"}
                  </span>
                )}
                {at !== undefined && (
                  <time
                    dateTime={new Date(at).toISOString()}
                    className="shrink-0 text-content/50"
                  >
                    {formatRelativeTime(new Date(at).toISOString())}
                  </time>
                )}
              </span>
            </button>
            <OrgArtifactLinks monoId={member.id} links={[
              { id: task.reportArtifactId, label: "Report" },
              { id: task.reviewArtifactId ?? task.reviewVerdict?.artifactId, label: "Review" },
              { id: task.prSummaryArtifactId, label: "PR summary" },
            ]} />
            {open && (
              <div
                id={`member-task-${task.id}`}
                className="space-y-3 border-t border-content/10 p-3"
              >
                {cwd && (
                  <p title={cwd} className="truncate font-mono text-content/60">
                    {task.workspace?.branch || projectName(cwd)}
                  </p>
                )}
                {task.readOnly && <p className="text-content/60">Read-only task{task.readOnlyFallback ? ` · ${task.readOnlyFallback}` : ""}</p>}
                <details>
                  <summary className="w-fit cursor-pointer rounded text-content/60 focus-visible:outline-accent">
                    Assignment
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words">
                    {task.prompt}
                  </p>
                </details>
                {task.result && !task.reportArtifactId && (
                  <div>
                    <div className="mb-2 text-content/60">Report</div>
                    <AgentMarkdown
                      className="agent-chat-bubble-md mono-run-report"
                      text={task.result}
                      streaming={false}
                      cwd={cwd}
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-1 border-t border-content/10 pt-2">
                  <button
                    type="button"
                    className={button}
                    onClick={() => openCardSession(task.sessionId)}
                  >
                    Open worker session
                  </button>
                  {cwd && (!task.readOnly || task.readOnlyFallback) && (
                    <button
                      type="button"
                      className={button}
                      disabled={!actions?.openWorker}
                      onClick={() => actions?.openWorker?.(task.sessionId)}
                    >
                      Open worktree
                    </button>
                  )}
                  {task.prUrl && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => void openUrl(task.prUrl!)}
                    >
                      Open PR
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
