import {
  GithubPrActions,
  type GithubPrConfirmation,
} from "../../inbox/ui/GithubPrActions";
import type { GithubPrAction } from "../../inbox/model/githubTasks";
import { pathKey } from "../../../shared/lib/paths";
import {
  gitPrActionByUrl,
  gitPrStatusByUrl,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import {
  markPullRequestUnavailable,
  prIdentity,
  pullRequestReady,
  pullRequests,
  recordPullRequest,
  type WorktreePr,
} from "../model/pullRequests";

export function WorktreePrActions({
  entry,
  sessionId,
  taskId,
}: {
  entry: WorktreePr;
  sessionId: string;
  taskId?: string;
}) {
  const { pr, cwd } = entry;
  const target = new URL(pr.url);
  const repo = `${target.host}/${target.pathname.split("/").slice(1, 3).join("/")}`;
  const link = entry.links.find((link) => link.sessionId === sessionId);
  const reviewTask = taskId ?? link?.taskId;
  const canMerge =
    pullRequestReady(entry) &&
    !!pr.headOid &&
    !!pr.baseRefName &&
    entry.links.every(link => !link.taskId || link.acceptedHead === pr.headOid) &&
    (!reviewTask ||
      (link?.taskId === reviewTask && link.acceptedHead === pr.headOid));
  const run = async (
    action: GithubPrAction,
    confirmed: GithubPrConfirmation,
  ) => {
    if (["merge", "squash", "rebase"].includes(action)) {
      const current =
        pullRequests().find(
          (item) =>
            pathKey(item.cwd) === pathKey(cwd) &&
            prIdentity(item.pr.url) === prIdentity(pr.url),
        ) ?? entry;
      const currentLink = current.links.find(
        (link) => link.sessionId === sessionId,
      );
      if (
        !pullRequestReady(current) ||
        pullRequests().some(item => prIdentity(item.pr.url) === prIdentity(pr.url) &&
          item.links.some(link => link.taskId && link.acceptedHead !== confirmed.headOid)) ||
        (reviewTask &&
          (currentLink?.taskId !== reviewTask ||
            currentLink.acceptedHead !== confirmed.headOid))
      )
        throw new Error(
          "Checks or review changed. Refresh and review this pull request before merging.",
        );
    }
    try {
      const next = await gitPrActionByUrl(
        cwd,
        pr.url,
        action,
        confirmed.headOid,
        confirmed.baseRef || undefined,
      );
      recordPullRequest(cwd, next);
      return next;
    } catch (error) {
      try {
        const latest = await gitPrStatusByUrl(cwd, pr.url);
        if (latest) recordPullRequest(cwd, latest);
        else markPullRequestUnavailable(cwd, pr.url);
      } catch {
        markPullRequestUnavailable(cwd, pr.url);
      }
      throw error;
    } finally {
      notifyGitChanged();
    }
  };
  return (
    <GithubPrActions
      item={{
        projectPath: cwd,
        repo,
        number: pr.number,
        state: pr.state,
        draft: !!pr.isDraft,
      }}
      baseRef={pr.baseRefName ?? ""}
      headRef={pr.headRefName ?? ""}
      headOid={pr.headOid}
      mergeDisabled={!canMerge}
      onAction={run}
    />
  );
}
