import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ManagerAvatar } from "./ManagerAvatar";
import { githubPrDiff, type GithubPrDiff } from "../../inbox/model/githubTasks";
import { useGithubPrChecks } from "../../inbox/hooks/useGithubPrChecks";
import { summarizePrChecks } from "../../inbox/model/githubPrChecks";
import { parseGithubWorkItemUrl } from "../../sessions/model/sessionWorkItem";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { managerPrReady, taskPrStatus } from "../model/projectManager";
import { orchestrator } from "../model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../model/orchestrationState";

export function ProjectManagerReview({ run }: { run: OrchestrationRun }) {
  const statuses = usePrStatusCache();
  return (
    <div className="space-y-2 px-4 py-2">
      {run.tasks
        .filter((task) => managerPrReady(task, taskPrStatus(task, statuses)))
        .map((task) => (
          <ReadyCard
            key={`${task.id}:${task.acceptedDispatchId}`}
            run={run}
            task={task}
          />
        ))}
    </div>
  );
}

function ReadyCard({
  run,
  task,
}: {
  run: OrchestrationRun;
  task: OrchestrationTask;
}) {
  const [editing, setEditing] = useState(false);
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
      aria-label={`Ready to merge: ${task.title}`}
      className="rounded-xl border border-content/20 bg-content/5 p-4 font-sans text-xs shadow-sm"
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
        <ManagerAvatar project={run.cwd} status="ready" />
        <span>Ready to merge</span>
      </div>
      <h3 className="text-sm font-semibold text-content">{task.title}</h3>
      <p
        title={task.workspace?.checkoutCwd}
        className="mt-1 truncate font-mono text-[11px] text-content/60"
      >
        {task.workspace?.branch}
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
        <button
          type="button"
          className={button}
          disabled={pending}
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          Send back
        </button>
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
