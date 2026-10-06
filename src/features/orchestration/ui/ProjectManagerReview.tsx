import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitPullRequest } from "../../../shared/ui/icons";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { managerPrReady, taskPrStatus } from "../model/projectManager";
import { orchestrator } from "../model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../model/orchestrationState";

export function ProjectManagerReview({
  run,
}: {
  run: OrchestrationRun;
}) {
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
      className="rounded-xl border border-content/12 bg-content/3 p-3 text-xs"
    >
      <div className="mb-2 flex items-center gap-2 text-emerald-400">
        <GitPullRequest className="size-4" />
        <span>Ready to merge</span>
      </div>
      <h3 className="font-medium text-content/90">{task.title}</h3>
      <p className="mt-1 break-all text-content/50">
        {task.workspace?.branch} · {task.workspace?.checkoutCwd}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-content/70">
        {task.checksSummary ||
          "Manager accepted this result. See the conversation for review and checks."}
      </p>
      <button
        type="button"
        className="mt-2 block max-w-full truncate text-accent underline"
        onClick={() =>
          void openUrl(task.prUrl!).catch((reason) => setError(String(reason)))
        }
      >
        {task.prUrl}
      </button>
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          className={button}
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
