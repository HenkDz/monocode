import { useEffect, useState, type ComponentProps } from "react";
import { ArrowLeft, GitPullRequest } from "../../../shared/ui/icons";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { projectName } from "../../../shared/lib/paths";
import { InboxDetail } from "../../inbox/ui/InboxView";
import type { InboxItem } from "../../inbox/model/githubTasks";
import type { RecentProject } from "../../projects/model/recents";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { WorktreePrActions } from "../../source-control/ui/WorktreePrActions";
import {
  usePullRequests,
  prIdentity,
  type WorktreePr,
} from "../../source-control/model/pullRequests";
import {
  buildPullRequestRows,
  openPullRequests,
  pullRequestRepo,
  type PullRequestContext,
  type PullRequestScope,
} from "../model/pullRequestView";
import { PullRequestsList } from "./PullRequestsList";

export function pullRequestInboxItem(entry: WorktreePr): InboxItem {
  return {
    provider: "github",
    kind: "pr",
    projectPath: entry.cwd,
    repo: pullRequestRepo(entry.pr.url),
    number: entry.pr.number,
    title: entry.pr.title,
    url: entry.pr.url,
    state: entry.pr.state,
    updatedAt: entry.pr.updatedAt ?? new Date(entry.verifiedAt).toISOString(),
    draft: !!entry.pr.isDraft,
    labels: [],
    assignees: [],
  };
}

type DetailProps = ComponentProps<typeof InboxDetail>;
type Props = PullRequestContext &
  Pick<
    DetailProps,
    "repairSessions" | "onRepairChecks" | "onRepairNotNeeded" | "onOpenSession"
  > & {
    recents?: readonly RecentProject[];
    scope?: PullRequestScope;
    urls?: readonly string[];
    onClose?: () => void;
    onToggleSidebar?: () => void;
    besideRail?: boolean;
    compactRail?: boolean;
    sessionSummaries?: readonly SessionSummary[];
  };

export function PullRequestsView({
  sessions,
  runs,
  roster,
  recents = [],
  scope = {},
  urls,
  onClose,
  onToggleSidebar,
  besideRail,
  compactRail,
  sessionSummaries = [],
  repairSessions,
  onRepairChecks,
  onRepairNotNeeded,
  onOpenSession,
}: Props) {
  const entries = usePullRequests();
  const targetUrls = urls ?? scope.urls;
  const [selectedUrl, setSelectedUrl] = useState<string | null>(
    targetUrls?.length === 1 ? targetUrls[0] : null,
  );
  useEffect(
    () => setSelectedUrl(targetUrls?.length === 1 ? targetUrls[0] : null),
    [targetUrls],
  );
  const selected = buildPullRequestRows(entries, {
    sessions,
    runs,
    roster,
  }).find(
    (row) =>
      selectedUrl && prIdentity(row.entry.pr.url) === prIdentity(selectedUrl),
  )?.entry;
  const effectiveScope = urls ? { ...scope, urls } : scope;
  const projects = recents.map((project) => ({
    path: project.path,
    name: projectName(project.path),
    logoPath: null,
    mascotName: null,
    mascotColor: "#888888",
  }));
  const related = selected
    ? sessionSummaries.filter((session) =>
        selected.links.some((link) => link.sessionId === session.id),
      )
    : [];
  const sessionId =
    selected?.links.find(
      (link) =>
        link.taskId &&
        (!link.acceptedHead || link.acceptedHead !== selected.pr.headOid),
    )?.sessionId ??
    selected?.links.find((link) => link.taskId)?.sessionId ??
    selected?.links[0]?.sessionId ??
    "";
  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
      data-pr-view
    >
      <header
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : (
          <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        )}
        {selected ? (
          <button
            type="button"
            aria-label="Back to pull requests"
            onClick={() => setSelectedUrl(null)}
            className="rounded p-1.5 text-content/60 hover:bg-content/8"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <GitPullRequest
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <h1 className="min-w-0 truncate">
            Pull requests{selected ? ` · #${selected.pr.number}` : ""}
          </h1>
        </div>
        {Object.keys(effectiveScope).length > 0 && (
          <button
            type="button"
            onClick={() => openPullRequests()}
            className="rounded px-2 py-1 text-xs text-content/50 hover:bg-content/8"
          >
            All pull requests
          </button>
        )}
        {IS_MAC ? null : <WindowControls />}
      </header>
      {selected ? (
        <InboxDetail
          key={selected.pr.url}
          item={pullRequestInboxItem(selected)}
          cwd={selected.cwd}
          projects={projects}
          revision={selected.verifiedAt}
          relatedSessions={related}
          repairSessions={repairSessions}
          onRepairChecks={onRepairChecks}
          onRepairNotNeeded={onRepairNotNeeded}
          onOpenSession={onOpenSession}
          prActions={
            <WorktreePrActions entry={selected} sessionId={sessionId} />
          }
        />
      ) : (
        <PullRequestsList
          sessions={sessions}
          runs={runs}
          roster={roster}
          scope={effectiveScope}
          onOpen={(entry) => setSelectedUrl(entry.pr.url)}
        />
      )}
    </main>
  );
}
