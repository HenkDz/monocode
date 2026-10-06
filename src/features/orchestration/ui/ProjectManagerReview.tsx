import { useContext, useEffect, useState } from "react";
import { OrchestrationActions } from "./OrchestrationActions";
import { ExternalLink as ArrowUpRight } from "../../../shared/ui/icons";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ManagerAvatar } from "./ManagerAvatar";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { githubPrDiff, type GithubPrDiff } from "../../inbox/model/githubTasks";
import { useGithubPrChecks } from "../../inbox/hooks/useGithubPrChecks";
import { summarizePrChecks } from "../../inbox/model/githubPrChecks";
import { parseGithubWorkItemUrl } from "../../sessions/model/sessionWorkItem";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import {
  managerPrReady,
  managerTaskMerged,
  taskPrStatus,
} from "../model/projectManager";
import { orchestrator } from "../model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../model/orchestrationState";

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
              const card = document.getElementById(
                `manager-review-${tasks[0].id}`,
              );
              card?.scrollIntoView({ block: "center" });
              card?.focus({ preventScroll: true });
            } else actions?.openWorker?.(tasks[0].sessionId);
          }}
        >
          {tasks.length} {label}
        </button>
      ))}
    </nav>
  );
}

export function ProjectManagerReview({ run }: { run: OrchestrationRun }) {
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
    const card = document.getElementById(`manager-review-${task.id}`);
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (actions?.reviewTarget)
      document
        .getElementById(`manager-review-${actions.reviewTarget.taskId}`)
        ?.scrollIntoView({ block: "center" });
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
              .closest("section")
              ?.id.replace("manager-review-", ""),
          );
        }
      }}
    >
      {run.recoveryNotice && (
        <p role="status" className="text-xs text-content/60">
          {run.recoveryNotice}
        </p>
      )}
      {run.status === "paused" && !run.recovering && (
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
      {run.tasks
        .filter(
          (task) =>
            managerPrReady(task, taskPrStatus(task, statuses)) ||
            managerTaskMerged(task, taskPrStatus(task, statuses)),
        )
        .map((task) => (
          <ReadyCard
            key={`${task.id}:${task.acceptedDispatchId}`}
            run={run}
            task={task}
            merged={managerTaskMerged(task, taskPrStatus(task, statuses))}
            onNext={ready.length ? () => next(task.id) : undefined}
          />
        ))}
    </div>
  );
}

export function ReadyCard({
  run,
  task,
  merged,
  onNext,
}: {
  run: OrchestrationRun;
  task: OrchestrationTask;
  merged: boolean;
  onNext?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const actions = useContext(OrchestrationActions);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const target = parseGithubWorkItemUrl(task.prUrl || "");
  const repo = target?.repo || "";
  const number = target?.number || 0;
  const [diff, setDiff] = useState<GithubPrDiff>();
  const [diffError, setDiffError] = useState(false);
  const checks = useGithubPrChecks({
    cwd: run.cwd,
    repo,
    number,
    enabled: !!number,
    open: true,
  });
  const overall = summarizePrChecks({
    loading: checks.loading,
    error: checks.error,
    checks: checks.checks?.checks ?? null,
  });
  useEffect(() => {
    let disposed = false;
    setDiff(undefined);
    setDiffError(false);
    if (number)
      void githubPrDiff(run.cwd, repo, number, { maxAgeMs: 30_000 })
        .then((value) => {
          if (!disposed) setDiff(value);
        })
        .catch(() => {
          if (!disposed) setDiffError(true);
        });
    return () => {
      disposed = true;
    };
  }, [run.cwd, repo, number]);
  const button =
    "rounded-md px-2.5 py-1.5 text-xs hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40";
  const sendBack = async () => {
    if (!message.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (orchestrator.run(run.leadId)?.status !== "active")
        await orchestrator.start(
          run.leadId,
          run.allowedHarnesses,
          run.maxWorkers,
          undefined,
          true,
        );
      await orchestrator.handle(run.leadId, crypto.randomUUID(), "message", {
        taskId: task.id,
        text: message.trim(),
      });
      setEditing(false);
      setMessage("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      id={`manager-review-${task.id}`}
      tabIndex={-1}
      aria-label={`${merged ? "Merged" : "Ready to merge"}: ${task.title}`}
      className="rounded-xl border border-content/20 bg-content/5 p-4 font-sans text-xs shadow-sm"
    >
      <div
        className={`mb-2 flex items-center gap-2 font-medium ${merged ? "text-violet-600 dark:text-violet-400" : "text-emerald-600 dark:text-emerald-400"}`}
      >
        {task.memberMascot && task.memberColor ? (
          <PixelMascot
            name={task.memberMascot}
            color={task.memberColor}
            still
            className="size-5"
          />
        ) : (
          <ManagerAvatar
            project={run.cwd}
            status={merged ? undefined : "ready"}
          />
        )}
        <span>{merged ? "Merged" : "Ready to merge"}</span>
      </div>
      <h3 className="text-sm font-semibold text-content">{task.title}</h3>
      <p className="mt-1 text-content/60">
        {task.memberName ? `${task.memberName} · ` : ""}Reviewed by{" "}
        {task.reviewedBy ?? "Manager"}
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        <button
          type="button"
          disabled={!actions?.openWorker}
          onClick={() => actions?.openWorker?.(task.sessionId)}
          title={task.workspace?.checkoutCwd}
          className="truncate rounded font-mono text-[11px] text-content/60 hover:underline focus-visible:outline-accent"
        >
          {task.workspace?.branch}
        </button>
        <button
          type="button"
          aria-label="Go to worktree"
          title="Go to worktree"
          disabled={!actions?.openWorker}
          onClick={() => actions?.openWorker?.(task.sessionId)}
          className="rounded p-1 hover:bg-content/10 focus-visible:outline-accent"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-content/50">
        {HARNESS_TITLE[task.harness]} · {task.model}
      </p>
      <div className="my-3 flex flex-wrap gap-2 text-content/80 [&>span]:rounded-md [&>span]:border [&>span]:border-content/10 [&>span]:px-2 [&>span]:py-1">
        <span>PR #{number || "?"}</span>
        <span>
          {diff ? (
            <>
              <span className="text-emerald-700 dark:text-emerald-400">
                +{diff.additions}
              </span>{" "}
              <span className="text-rose-700 dark:text-rose-400">
                −{diff.deletions}
              </span>
              {` · ${diff.files.length} ${diff.files.length === 1 ? "file" : "files"}`}
            </>
          ) : diffError ? (
            "Diff unavailable"
          ) : (
            "Loading diff…"
          )}
        </span>
        <span
          title={overall.description}
          className={
            {
              pass: "text-emerald-700 dark:text-emerald-400",
              fail: "text-rose-700 dark:text-rose-400",
              error: "text-rose-700 dark:text-rose-400",
              pending: "text-amber-700 dark:text-amber-400",
              loading: "text-content/60",
              neutral: "text-content/60",
            }[overall.kind]
          }
        >
          {overall.kind === "pass"
            ? `✓ ${checks.checks?.checks.length} checks`
            : overall.kind === "fail"
              ? `✗ ${overall.failed} failed`
              : overall.description}
        </span>
      </div>
      <details className="text-content/75">
        <summary className="cursor-pointer rounded py-1 focus-visible:outline-accent">
          Manager's review
        </summary>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">
          {task.checksSummary ||
            "Manager accepted this result. See the conversation for review and checks."}
        </p>
      </details>
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          className={`${button} bg-content font-medium text-background-base hover:bg-content/85`}
          onClick={() =>
            void openUrl(task.prUrl!).catch((reason) =>
              setError(String(reason)),
            )
          }
        >
          Open PR
        </button>
        <button
          type="button"
          className={button}
          onClick={() =>
            void openUrl(`${task.prUrl}/files`).catch((reason) =>
              setError(String(reason)),
            )
          }
        >
          Open diff
        </button>
        {merged ? (
          <button
            type="button"
            className={button}
            disabled={!actions?.removeManagerWorktree || !task.workspace}
            onClick={() => {
              if (task.workspace)
                void actions
                  ?.removeManagerWorktree?.(run.cwd, task.workspace.checkoutCwd)
                  .catch((reason) => setError(String(reason)));
            }}
          >
            Remove worktree
          </button>
        ) : (
          <button
            type="button"
            className={button}
            disabled={pending}
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
          >
            Send back
          </button>
        )}
        {onNext && (
          <button
            type="button"
            className={button}
            title="Next PR (Alt+Shift+N while reviewing cards)"
            onClick={onNext}
          >
            Next
          </button>
        )}
      </div>
      {editing && (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendBack();
          }}
        >
          <label className="block text-content/60">
            Changes to request
            <textarea
              autoFocus
              rows={2}
              value={message}
              disabled={pending}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-1 w-full resize-y rounded-md border border-stroke bg-transparent p-2 text-content focus-visible:outline-accent"
            />
          </label>
          <button
            type="submit"
            className={button}
            disabled={pending || !message.trim()}
          >
            {pending ? "Sending…" : "Send to worker"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
