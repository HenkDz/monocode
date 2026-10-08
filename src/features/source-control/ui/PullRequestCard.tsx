import { useContext, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { pullRequestLabel, type WorktreePr } from "../model/pullRequests";
import { formatRelativeTime } from "../../inbox/model/githubTasks";

/** Ordinary sessions and follow-up team PRs share the worktree's verified list. */
export function PullRequestCard({
  entry,
  sessionId,
}: {
  entry: WorktreePr;
  sessionId: string;
}) {
  const [error, setError] = useState<string>();
  const actions = useContext(OrchestrationActions);
  const { pr } = entry;
  const link = entry.links.find((link) => link.sessionId === sessionId);
  const forgeLabel = pullRequestLabel(entry);
  const label =
    link?.taskId &&
    forgeLabel === "Ready to merge" &&
    (!link.acceptedHead || link.acceptedHead !== pr.headOid)
      ? "Awaiting team review"
      : forgeLabel;
  const button =
    "rounded-md px-2.5 py-1.5 text-xs hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40";
  const open = (url: string) => {
    void openUrl(url).catch((reason) => setError(String(reason)));
  };
  return (
    <section
      id={`session-pr-${sessionId}-${pr.number}`}
      tabIndex={-1}
      aria-label={`${label}: ${pr.title}`}
      className="min-w-0 rounded-xl border border-content/20 bg-content/5 p-3 font-sans text-xs focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    >
      <div className="flex min-w-0 items-center gap-2 font-medium">
        <span
          className={`shrink-0 rounded-md bg-content/5 px-1.5 py-0.5 ${label === "Ready to merge" ? "text-emerald-600 dark:text-emerald-400" : label === "Merged" ? "text-violet-600 dark:text-violet-400" : "text-content/60"}`}
        >
          {label}
        </span>
        <h3
          className="min-w-0 flex-1 truncate text-sm font-medium text-content"
          title={pr.title}
        >
          {pr.title}
        </h3>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-content/80 [&>span]:rounded-md [&>span]:bg-content/5 [&>span]:px-1.5 [&>span]:py-0.5">
        <span>PR #{pr.number}</span>
        {pr.baseRefName && pr.headRefName && (
          <span>
            {pr.baseRefName} ← {pr.headRefName}
          </span>
        )}
        <span>
          <span className="text-emerald-700 dark:text-emerald-400">
            +{pr.additions ?? "?"}
          </span>{" "}
          <span className="text-rose-700 dark:text-rose-400">
            −{pr.deletions ?? "?"}
          </span>
        </span>
        <span>
          {entry.unavailable
            ? "Status unavailable"
            : pr.checksStatus === "success"
              ? "Checks passed"
              : pr.checksStatus === "none"
                ? "No checks"
                : pr.checksStatus === "failure"
                  ? "Checks failed"
                  : pr.checksStatus === "pending"
                    ? "Checks pending"
                    : "Checks unknown"}
        </span>
        <span>
          {pr.reviewDecision
            ? pr.reviewDecision.replace(/_/g, " ").toLowerCase()
            : pr.reviewDecision === undefined
              ? "Review unknown"
              : "No review decision"}
        </span>
        {pr.mergeable && <span>{pr.mergeable.toLowerCase()}</span>}
        {link && (
          <time
            className="text-content/50"
            dateTime={new Date(link.at).toISOString()}
          >
            {formatRelativeTime(new Date(link.at).toISOString())}
          </time>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          className={`${button} bg-content/8 font-medium`}
          onClick={() => open(pr.url)}
        >
          Open PR
        </button>
        <button
          type="button"
          className={button}
          onClick={() => open(`${pr.url}/files`)}
        >
          Open diff
        </button>
        <button
          type="button"
          className={button}
          disabled={!actions}
          onClick={() => (actions?.openWorker ?? actions?.open)?.(sessionId)}
        >
          Go to worktree
        </button>
        <span
          className="self-center truncate text-content/50"
          title={entry.cwd}
        >
          {entry.cwd.split(/[\\/]/).pop()}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </section>
  );
}
