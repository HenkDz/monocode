import { useContext, useEffect, useState } from "react";
import { OrchestrationActions } from "./OrchestrationActions";
import { ManagerAvatar } from "./ManagerAvatar";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { parseGithubWorkItemUrl } from "../../sessions/model/sessionWorkItem";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import {
  managerPrReady,
  managerTaskMerged,
  managerTaskFinished,
  taskPrStatus,
} from "../model/projectManager";
import {
  focusManagerReview,
  jumpToManagerReview,
} from "../model/projectManagerTimeline";
import { orchestrator } from "../model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../model/orchestrationState";
import { usePullRequests, prIdentity } from "../../source-control/model/pullRequests";
import { buildPullRequestRows, openPullRequests } from "../../pullRequests/model/pullRequestView";

export function ProjectManagerStatus({
  run,
  needsUser = false,
  onDecision,
}: {
  run: OrchestrationRun;
  needsUser?: boolean;
  onDecision?: () => void;
}) {
  const statuses = usePrStatusCache();
  const actions = useContext(OrchestrationActions);
  const groups = [
    {
      label: "running",
      tasks: run.tasks.filter((task) =>
        ["running", "cancelling"].includes(task.status),
      ),
    },
    {
      label: "ready",
      tasks: run.tasks.filter((task) =>
        managerPrReady(task, taskPrStatus(task, statuses)),
      ),
    },
    {
      label: "finished",
      tasks: run.tasks.filter(
        (task) =>
          task.status === "cancelled" ||
          managerTaskFinished(task, taskPrStatus(task, statuses)),
      ),
    },
  ];
  return (
    <nav
      aria-label="Manager queue status"
      className="flex shrink-0 flex-wrap gap-1 border-b border-content/10 px-4 py-1.5 text-xs text-content/60"
    >
      <button
        type="button"
        disabled={!needsUser && (run.status !== "paused" || run.recovering)}
        onClick={() =>
          run.status === "paused"
            ? document
                .getElementById("manager-continue")
                ?.scrollIntoView({ block: "center" })
            : onDecision?.()
        }
        className="rounded px-2 py-1 text-amber-600 dark:text-amber-400 disabled:opacity-40"
      >
        {needsUser || (run.status === "paused" && !run.recovering) ? 1 : 0}{" "}
        needs you
      </button>
      {groups.map(({ label, tasks }) => (
        <button
          key={label}
          type="button"
          disabled={!tasks.length}
          className="rounded px-2 py-1 hover:bg-content/8 disabled:opacity-40 focus-visible:outline-accent"
          onClick={() => {
            if (label === "ready") {
              jumpToManagerReview(tasks[0].id);
            } else actions?.openWorker?.(tasks[0].sessionId);
          }}
        >
          {tasks.length} {label}
        </button>
      ))}
    </nav>
  );
}

export function ReadyCard({
  run,
  task,
  merged,
  state,
}: {
  run: OrchestrationRun;
  task: OrchestrationTask;
  merged: boolean;
  state?: "Ready to merge" | "Merged" | "Closed" | "Sent back";
}) {
  const row = buildPullRequestRows(usePullRequests(), { runs: [run] }).find(
    (row) => prIdentity(row.entry.pr.url) === prIdentity(task.prUrl ?? ""),
  );
  const entry = row?.entry;
  const reviewed =
    !!entry?.pr.headOid &&
    (task.reviewedHead ?? task.delivery?.head) === entry.pr.headOid &&
    task.status === "completed" &&
    task.accepted &&
    !!task.lastDispatchId &&
    task.acceptedDispatchId === task.lastDispatchId;
  const forgeLabel = row?.label;
  const label =
    entry?.pr.state === "merged"
      ? "Merged"
      : entry?.pr.state === "closed"
        ? "Closed"
        : merged
          ? "Merged"
          : task.delivery?.state === "fixing-ci"
            ? "Fixing CI"
            : task.delivery?.state === "resolving-conflicts"
              ? "Resolving conflicts"
              : task.delivery?.state === "review-outdated"
                ? "Review outdated"
                : task.delivery?.state === "watching"
                  ? "Checks running"
                  : forgeLabel === "Ready to merge" && !reviewed
                    ? "Awaiting team review"
                    : (forgeLabel ?? state ?? "Awaiting review");
  const number =
    entry?.pr.number ?? parseGithubWorkItemUrl(task.prUrl ?? "")?.number;
  const verdict = task.trivial
    ? "Not reviewed (trivial)"
    : task.delivery?.state === "review-outdated" ||
        (task.reviewedBy && !reviewed)
      ? "Re-review requested"
      : task.reviewedBy?.startsWith("Not reviewed")
        ? task.reviewedBy
        : task.reviewedBy && reviewed
          ? `Reviewed by ${task.reviewedBy} ✓`
          : "Awaiting review";
  return (
    <button
      id={`manager-review-${task.id}`}
      type="button"
      aria-label={`${label}: ${task.title}`}
      title={task.title}
      className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left font-sans text-xs text-content/65 hover:bg-content/5 hover:text-content focus-visible:outline-accent"
      onClick={() => openPullRequests({ urls: task.prUrl ? [task.prUrl] : [] })}
    >
      {task.memberMascot && task.memberColor ? (
        <PixelMascot
          name={task.memberMascot}
          color={task.memberColor}
          still
          className="size-4 shrink-0"
        />
      ) : (
        <ManagerAvatar
          project={run.cwd}
          status={label === "Ready to merge" ? "ready" : undefined}
        />
      )}
      <span className="truncate">
        PR #{number ?? "?"} {label.toLowerCase()} · {verdict}
      </span>
      <span aria-hidden>›</span>
    </button>
  );
}

export function ProjectManagerReview({
  run,
  historical = false,
  noticesOnly = false,
}: {
  run: OrchestrationRun;
  historical?: boolean;
  noticesOnly?: boolean;
}) {
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string>();
  const statuses = usePrStatusCache();
  const actions = useContext(OrchestrationActions);
  const ready = run.tasks.filter((task) =>
    managerPrReady(task, taskPrStatus(task, statuses)),
  );
  const next = (id?: string) => {
    const task =
      ready[(ready.findIndex((task) => task.id === id) + 1) % ready.length];
    if (!task) return;
    jumpToManagerReview(task.id);
  };
  useEffect(() => {
    if (actions?.reviewTarget) focusManagerReview(actions.reviewTarget.taskId);
  }, [actions?.reviewTarget]);
  return (
    <div
      className="space-y-2 px-4 py-2"
      onKeyDown={(event) => {
        if (
          event.altKey &&
          event.shiftKey &&
          event.key.toLowerCase() === "n" &&
          !(event.target instanceof HTMLTextAreaElement) &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
          event.stopPropagation();
          next(
            (event.target as HTMLElement)
              .closest('[id^="manager-review-"]')
              ?.id.replace("manager-review-", ""),
          );
        }
      }}
    >
      {!historical && run.recoveryNotice && (
        <p role="status" className="text-xs text-content/60">
          {run.recoveryNotice}
        </p>
      )}
      {!historical && run.status === "paused" && !run.recovering && (
        <section
          id="manager-continue"
          aria-label="Manager needs your decision"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        >
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Manager needs your decision
          </p>
          <p className="mt-1 text-content/70">
            {run.error ||
              run.lastPauseReason ||
              "The Manager could not continue."}
          </p>
          <button
            type="button"
            disabled={continuing}
            className="mt-2 rounded px-2 py-1 text-amber-600 hover:bg-amber-500/10 focus-visible:outline-accent disabled:opacity-50"
            onClick={() => {
              setContinuing(true);
              setContinueError(undefined);
              void orchestrator
                .continueManager(run.leadId)
                .catch((error) => setContinueError(String(error)))
                .finally(() => setContinuing(false));
            }}
          >
            {continuing ? "Continuing…" : "Continue"}
          </button>
          {continueError && <p role="alert">{continueError}</p>}
        </section>
      )}
      {!noticesOnly &&
        run.tasks
          .filter(
            (task) =>
              (historical && !!task.prUrl) ||
              !!task.delivery ||
              managerPrReady(task, taskPrStatus(task, statuses)) ||
              managerTaskMerged(task, taskPrStatus(task, statuses)),
          )
          .map((task) => {
            const pr = taskPrStatus(task, statuses);
            const state =
              pr && pr.url === task.prUrl && pr.state === "merged"
                ? "Merged"
                : pr && pr.url === task.prUrl && pr.state === "closed"
                  ? "Closed"
                  : managerPrReady(task, pr)
                    ? "Ready to merge"
                    : "Sent back";
            return (
              <ReadyCard
                key={task.id}
                run={run}
                task={task}
                merged={managerTaskMerged(task, taskPrStatus(task, statuses))}
                state={state}
              />
            );
          })}
    </div>
  );
}
