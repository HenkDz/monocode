import { useState, useSyncExternalStore } from "react";
import { MessageSquare } from "../../../shared/ui/icons";
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
}: {
  project: string;
  onOpen(project: string): Promise<void>;
  attention?: readonly ManagerAttention[];
  running?: boolean;
  enabled?: boolean;
  selected?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const { data } = useProjectWorktrees(project, enabled && !project.startsWith("remote:"));
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const run = runs.find(
    (run) =>
      run.projectManager &&
      orchestrationPathKey(run.cwd) === orchestrationPathKey(project),
  );
  if (project.startsWith("remote:") || !data?.worktrees.length) return null;
  const waiting = attention.filter(
    (item) =>
      orchestrationPathKey(item.project) === orchestrationPathKey(project),
  );
  const decision = waiting.some((item) => item.kind === "decision");
  const ready = waiting.some((item) => item.kind === "ready");
  const label = decision
    ? "Needs your decision"
    : ready
      ? "Ready to merge"
      : waiting.length
        ? "New reply"
        : running || run?.tasks.some((task) => task.status === "running")
          ? "Running"
          : undefined;
  return (
    <div>
      <button
        type="button"
        disabled={opening}
        aria-label="Open project manager"
        aria-busy={opening}
        aria-current={selected ? "page" : undefined}
        className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs focus-visible:outline-accent disabled:opacity-50 ${selected ? "bg-selection text-content" : "text-content/70 hover:bg-content/5 hover:text-content"}`}
        onClick={() => {
          setOpening(true);
          setError(undefined);
          void onOpen(project)
            .catch((reason) => setError(String(reason)))
            .finally(() => setOpening(false));
        }}
      >
        <MessageSquare className="size-3.5 shrink-0" />
        <span>Manager</span>
        {label && (
          <span
            role="status"
            aria-label={`${label}${waiting.length > 1 ? ` (${waiting.length})` : ""}`}
            title={label}
            className="ml-auto flex items-center gap-1.5 text-[10px] text-content/50"
          >
            <span
              className={`size-1.5 rounded-full ${decision ? "bg-amber-400" : ready ? "bg-emerald-400" : waiting.length ? "bg-accent" : "bg-content/30 motion-safe:animate-pulse"}`}
            />
            {waiting.length > 1 ? waiting.length : null}
          </span>
        )}
      </button>
      {run?.status === "paused" && (
        <button
          type="button"
          disabled={opening}
          className="ml-7 rounded px-1 text-[11px] text-content/60 hover:text-content focus-visible:outline-accent"
          onClick={() => {
            setOpening(true);
            setError(undefined);
            void orchestrator
              .start(
                run.leadId,
                run.allowedHarnesses,
                run.maxWorkers,
                undefined,
                true,
              )
              .catch((reason) => setError(String(reason)))
              .finally(() => setOpening(false));
          }}
        >
          Resume
        </button>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
