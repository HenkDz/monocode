import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { findMono, monoLook, type Mono } from "../model/mono";
import { memberTasks } from "../model/monoNavigation";
import { orchestrator } from "../../orchestration/model/orchestration";
import {
  managerTaskLifecycle,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { projectName } from "../../../shared/lib/paths";
import {
  cardSession,
  openCardSession,
  subscribeCardSessions,
} from "../model/monoCards";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";
import { Modal } from "../../../shared/ui/Modal";

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

/** Task snapshots are the durable work log; never copy streaming worker prose into another session. */
export function MemberWorkLog({ member }: { member: Mono }) {
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const statuses = usePrStatusCache();
  const actions = useContext(OrchestrationActions);
  const [openedTask, setOpenedTask] = useState<string>();
  const [, refresh] = useState(0);
  useEffect(
    () => subscribeCardSessions(() => refresh((value) => value + 1)),
    [],
  );
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
        const needsYou = !!cardSession(task.sessionId)?.needsInput;
        const [label, tone] = managerTaskLifecycle(
          task,
          taskPrStatus(task, statuses),
          needsYou,
        );
        const dispatch = runs
          .flatMap((run) => run.dispatches ?? [])
          .find(
            (item) =>
              item.id === (task.activeDispatchId ?? task.lastDispatchId),
          );
        const at = dispatch?.updatedAt ?? dispatch?.startedAt ?? task.prReadyAt;
        const cwd = task.workspace?.checkoutCwd;
        const prNumber = task.prUrl?.match(/\/pull\/(\d+)/)?.[1];
        const links = [
          { id: task.reportArtifactId, label: "Report" },
          {
            id: task.reviewArtifactId ?? task.reviewVerdict?.artifactId,
            label: "Review",
          },
          { id: task.prSummaryArtifactId, label: "PR summary" },
        ];
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
            <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left focus-visible:outline-accent">
              <span className="flex min-w-0 flex-1 basis-52 items-center gap-2">
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
              <button
                type="button"
                aria-haspopup="dialog"
                className={`${button} shrink-0 bg-content/8 font-medium`}
                onClick={() => setOpenedTask(task.id)}
              >
                Open
              </button>
            </div>
            <div className="px-3 pb-2">
              <OrgArtifactLinks monoId={member.id} links={links} />
            </div>
            {openedTask === task.id && (
              <Modal
                title={task.title}
                fitViewport
                onClose={() => setOpenedTask(undefined)}
              >
                <div
                  id={`member-task-${task.id}`}
                  className="space-y-3 p-4 text-xs"
                  onClickCapture={(event) => {
                    if (
                      event.target instanceof Element &&
                      event.target.closest("[data-org-artifact]")
                    )
                      setOpenedTask(undefined);
                  }}
                >
                  <OrgArtifactLinks monoId={member.id} links={links} />
                  {cwd && (
                    <p
                      title={cwd}
                      className="truncate font-mono text-content/60"
                    >
                      {task.workspace?.branch || projectName(cwd)}
                    </p>
                  )}
                  {!!task.checkoutBaseline?.inheritedChangedPaths?.length && (
                    <p className="text-content/60">
                      Started with{" "}
                      {task.checkoutBaseline.inheritedChangedPaths.length}{" "}
                      inherited changes
                    </p>
                  )}
                  {task.readOnly && (
                    <p className="text-content/60">
                      Read-only task
                      {task.readOnlyFallback
                        ? ` · ${task.readOnlyFallback}`
                        : ""}
                    </p>
                  )}
                  <div>
                    <h3 className="font-medium text-content/60">Assignment</h3>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {task.prompt}
                    </p>
                  </div>
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
                      onClick={() => {
                        setOpenedTask(undefined);
                        openCardSession(task.sessionId);
                      }}
                    >
                      Open worker session
                    </button>
                    {cwd && (!task.readOnly || task.readOnlyFallback) && (
                      <button
                        type="button"
                        className={button}
                        disabled={!actions?.openWorker}
                        onClick={() => {
                          setOpenedTask(undefined);
                          actions?.openWorker?.(task.sessionId);
                        }}
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
              </Modal>
            )}
          </article>
        );
      })}
    </section>
  );
}
