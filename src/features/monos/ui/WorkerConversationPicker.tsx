import { useEffect, useId, useState } from "react";
import { workerPageTasks, type WorkerTaskTarget } from "../model/workerPage";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { coordinationSummary } from "../../sessions/model/transcriptPresentation";

export function WorkerConversationPicker({ ownerId, runs, target, onSelect }: {
  ownerId: string;
  runs: readonly OrchestrationRun[];
  target: WorkerTaskTarget | null;
  onSelect: (target: WorkerTaskTarget | null) => void;
}) {
  const tasks = workerPageTasks(runs, ownerId);
  const current = tasks.filter(({ task }) => ["queued", "running", "cancelling", "blocked", "interrupted"].includes(task.status));
  const [group, setGroup] = useState<"home" | "current" | "history">(target ? "current" : "home");
  const id = useId();
  useEffect(() => {
    setGroup(!target ? "home" : current.some(({ task }) => task.id === target.taskId && (!target.sessionId || task.sessionId === target.sessionId)) ? "current" : "history");
  }, [target?.taskId, target?.sessionId]);
  const history = tasks.flatMap(view => {
    const attempts = (view.run.dispatches ?? []).filter(d => d.taskId === view.task.id).sort((a, b) => a.startedAt - b.startedAt);
    return attempts.length ? attempts.map((dispatch, index) => ({ ...view, dispatch, attempt: attempts.length > 1 ? index + 1 : undefined }))
      : current.includes(view) ? [] : [{ ...view, attempt: undefined }];
  });
  const rows = group === "current" ? current.map(view => ({ ...view, attempt: undefined })) : history;
  return <section className="cc-worker-picker" aria-label="Worker conversations">
    <div role="tablist" aria-label="Conversation selection" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
    }}>
      {(["home", "current", "history"] as const).map(value => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-list`} aria-selected={group === value} tabIndex={group === value ? 0 : -1} onClick={() => { setGroup(value); if (value === "home") onSelect(null); }}>
        {value === "home" ? "Home" : value === "current" ? `Current (${current.length})` : "History"}
      </button>)}
    </div>
    <div id={`${id}-list`} role="tabpanel" aria-labelledby={`${id}-${group}`} className="cc-worker-assignments">
      {group !== "home" && (rows.length ? rows.map(({ task, dispatch, attempt }) => {
        const sessionId = group === "history" ? dispatch?.sessionId ?? task.sessionId : task.sessionId;
        const at = dispatch?.finishedAt ?? dispatch?.startedAt;
        return <button type="button" key={`${task.id}:${sessionId}`} aria-pressed={target?.taskId === task.id && (!target.sessionId || target.sessionId === sessionId)} onClick={() => onSelect({ taskId: task.id, sessionId })}>
          <strong>{coordinationSummary(task.title, 80)}</strong><span>{group === "history" ? dispatch?.state ?? task.status : task.status}{attempt != null ? ` · Attempt ${attempt}` : ""}{at != null ? ` · ${new Date(at).toLocaleString()}` : ""}</span>
        </button>;
      }) : <p>{group === "current" ? "No current assignments." : "No saved tasks."}</p>)}
    </div>
  </section>;
}
