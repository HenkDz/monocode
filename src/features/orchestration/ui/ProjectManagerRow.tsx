import { useState, useSyncExternalStore } from "react";
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
    <div className="ml-5 mb-0.5">
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
        <span>Manager</span>
        {label && (
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
