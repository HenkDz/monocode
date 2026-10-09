import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  ChevronRight,
} from "../../../shared/ui/icons";
import { listMonos, subscribeMonos, monoLook } from "../../monos/model/mono";
import {
  cardSessionsSnapshot,
  subscribeCardSessions,
} from "../../monos/model/monoCards";
import { orchestrator } from "../../orchestration/model/orchestration";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { useGithubPrChecks } from "../../inbox/hooks/useGithubPrChecks";
import {
  summarizePrChecks,
  latestPrChecks,
} from "../../inbox/model/githubPrChecks";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import {
  pullRequests,
  recordPullRequest,
  usePullRequests,
  prIdentity,
  type WorktreePr,
} from "../../source-control/model/pullRequests";
import {
  buildPullRequestRows,
  groupPullRequestRows,
  filterPullRequestRows,
  openPullRequests,
  pullRequestRepo,
  type PullRequestContext,
  type PullRequestScope,
  type PullRequestFilters,
  type PullRequestRow,
} from "../model/pullRequestView";

type Props = PullRequestContext & {
  scope?: PullRequestScope;
  compact?: boolean;
  entries?: readonly WorktreePr[];
  onOpen?: (entry: WorktreePr) => void;
  now?: number;
};

function PrChecksRefresh({ entry }: { entry: WorktreePr }) {
  const repo = pullRequestRepo(entry.pr.url);
  const view = useGithubPrChecks({
    cwd: entry.cwd,
    repo,
    number: entry.pr.number,
    enabled: entry.pr.state === "open",
    open: true,
  });
  useEffect(() => {
    if (
      !view.checks ||
      view.error ||
      !entry.pr.headOid ||
      view.checks.headOid !== entry.pr.headOid
    )
      return;
    const summary = summarizePrChecks({
      loading: false,
      error: null,
      checks: latestPrChecks(view.checks.checks),
    });
    const checksStatus =
      summary.kind === "pass"
        ? "success"
        : summary.kind === "fail"
          ? "failure"
          : summary.kind === "pending"
            ? "pending"
            : view.checks.checks.length
              ? "unknown"
              : "none";
    const current = pullRequests().find(
      (value) =>
        value.cwd === entry.cwd &&
        prIdentity(value.pr.url) === prIdentity(entry.pr.url),
    );
    if (
      current &&
      !current.unavailable &&
      current.pr.headOid === view.checks.headOid &&
      current.pr.checksStatus !== checksStatus
    )
      recordPullRequest(current.cwd, { ...current.pr, checksStatus });
  }, [entry, view.checks, view.error]);
  return null;
}

export function PullRequestsList({
  scope = {},
  compact = false,
  entries: providedEntries,
  sessions,
  runs: providedRuns,
  roster: providedRoster,
  onOpen = (entry) => openPullRequests({ urls: [entry.pr.url] }),
  now,
}: Props) {
  const storedEntries = usePullRequests();
  const storedRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const cardSessions = useSyncExternalStore(
    subscribeCardSessions,
    cardSessionsSnapshot,
    cardSessionsSnapshot,
  );
  const [storedRoster, setRoster] = useState(listMonos);
  useEffect(() => subscribeMonos(() => setRoster(listMonos())), []);
  const entries = providedEntries ?? storedEntries;
  const roster = providedRoster ?? storedRoster;
  const rows = useMemo(
    () =>
      buildPullRequestRows(entries, {
        sessions,
        runs: providedRuns ?? storedRuns,
        roster,
        cardSessions,
      }),
    [entries, sessions, providedRuns, storedRuns, roster, cardSessions],
  );
  const [filters, setFilters] = useState<PullRequestFilters>({
    ownership: "all",
  });
  const [mergedOpen, setMergedOpen] = useState(false);
  const groups = groupPullRequestRows(rows, filters, scope, now);
  const scopedRows = filterPullRequestRows(rows, {}, scope);
  const projects = [
    ...new Map(
      scopedRows.map((row) => [row.project, row.projectName]),
    ).entries(),
  ];
  const agents = [
    ...new Map(
      scopedRows.flatMap((row) => [
        [row.author.id, row.author.name] as const,
        ...row.monoIds
          .filter((id) => id !== row.author.id)
          .map(
            (id) =>
              [
                id,
                roster.find((mono) => mono.id === id)
                  ? `${monoLook(roster.find((mono) => mono.id === id)!).name} team`
                  : id,
              ] as const,
          ),
      ]),
    ).entries(),
  ];
  const container = useRef<HTMLDivElement>(null);
  const selectClass =
    "h-7 min-w-0 max-w-40 rounded border border-content/10 bg-background-base px-2 text-xs text-content/70";
  return (
    <div
      ref={container}
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Pull requests"
      onKeyDown={(event) => {
        if (
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
          !(event.target instanceof HTMLElement) ||
          !event.target.matches("[data-pr-row]")
        )
          return;
        const buttons = Array.from(
          container.current?.querySelectorAll<HTMLButtonElement>(
            "[data-pr-row]",
          ) ?? [],
        );
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(
                    buttons.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      <div
        className={`flex flex-wrap items-center gap-2 border-b border-content/8 ${compact ? "p-3" : "px-5 py-3"}`}
      >
        <input
          aria-label="Search pull requests"
          placeholder="Search pull requests"
          value={filters.search ?? ""}
          onChange={(event) =>
            setFilters({ ...filters, search: event.target.value })
          }
          className="h-7 min-w-28 flex-1 rounded border border-content/10 bg-transparent px-2 text-xs outline-none focus:border-accent"
        />
        <select
          aria-label="Project"
          className={selectClass}
          value={filters.project ?? ""}
          onChange={(event) =>
            setFilters({ ...filters, project: event.target.value })
          }
        >
          <option value="">All projects</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Agent or team"
          className={selectClass}
          value={filters.agent ?? ""}
          onChange={(event) =>
            setFilters({ ...filters, agent: event.target.value })
          }
        >
          <option value="">All agents</option>
          {agents.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="PR ownership"
          className={selectClass}
          value={filters.ownership}
          onChange={(event) =>
            setFilters({
              ...filters,
              ownership: event.target.value as PullRequestFilters["ownership"],
            })
          }
        >
          <option value="mine">Mine</option>
          <option value="team">Team</option>
          <option value="all">All</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-content/60">
          <input
            type="checkbox"
            checked={!!filters.closed}
            onChange={(event) =>
              setFilters({ ...filters, closed: event.target.checked })
            }
          />
          Closed
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <section
            key={group.label}
            aria-label={`${group.label}, ${group.rows.length} pull requests`}
          >
            {group.label === "Recently merged" ? (
              <button
                type="button"
                aria-expanded={mergedOpen || !!scope.urls}
                onClick={() => setMergedOpen(!mergedOpen)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-content/60"
              >
                <ChevronRight
                  className={`size-3 transition-transform ${mergedOpen || scope.urls ? "rotate-90" : ""}`}
                />
                {scope.urls ? "Merged" : group.label}
                <span className="tabular-nums text-content/40">
                  {group.rows.length}
                </span>
              </button>
            ) : (
              <h2 className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-content/60">
                {group.label}
                <span className="tabular-nums text-content/40">
                  {group.rows.length}
                </span>
              </h2>
            )}
            {(group.label !== "Recently merged" || mergedOpen || scope.urls) &&
              group.rows.map((row) => (
                <CompactPullRequestRow
                  key={prIdentity(row.entry.pr.url)}
                  row={row}
                  compact={compact}
                  onOpen={() => onOpen(row.entry)}
                />
              ))}
          </section>
        ))}
        {!groups.some((group) => group.rows.length) && (
          <p className="px-4 py-6 text-sm text-content/45">
            No pull requests match.
          </p>
        )}
      </div>
      {!providedEntries &&
        scopedRows
          .filter((row) => row.entry.pr.state === "open")
          .map((row) => (
            <PrChecksRefresh
              key={`${row.entry.cwd}:${row.entry.pr.url}`}
              entry={row.entry}
            />
          ))}
    </div>
  );
}

function CompactPullRequestRow({
  row,
  compact,
  onOpen,
}: {
  row: PullRequestRow;
  compact: boolean;
  onOpen: () => void;
}) {
  const { pr } = row.entry;
  const Icon =
    pr.state === "merged"
      ? GitMerge
      : pr.state === "closed"
        ? GitPullRequestClosed
        : GitPullRequest;
  const time =
    pr.closedAt ??
    pr.updatedAt ??
    (row.entry.links[0]?.at
      ? new Date(row.entry.links[0].at).toISOString()
      : null);
  const checks = row.entry.unavailable
    ? "Status unavailable"
    : pr.checksStatus === "success"
      ? "Checks passed"
      : pr.checksStatus === "failure"
        ? "Checks failing"
        : pr.checksStatus === "pending"
          ? "Checks running"
          : pr.checksStatus === "none"
            ? "No checks"
            : "";
  return (
    <button
      type="button"
      data-pr-row
      aria-label={`PR #${pr.number}: ${pr.title}, ${row.label}`}
      onClick={onOpen}
      className={`flex w-full items-center gap-3 border-t border-content/5 px-4 text-left text-xs hover:bg-content/5 focus-visible:outline-2 focus-visible:outline-accent ${compact ? "py-2.5" : "min-h-11 py-2"}`}
    >
      <Icon
        aria-hidden
        className={`size-3.5 shrink-0 ${pr.state === "merged" ? "text-violet-500" : row.label === "Ready to merge" ? "text-emerald-500" : row.label === "Conflicts" || row.label === "Checks failed" ? "text-rose-500" : "text-content/45"}`}
      />
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-content/45">#{pr.number}</span>
          <strong
            className="truncate font-medium text-content"
            title={pr.title}
          >
            {pr.title}
          </strong>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-content/50">
          <span className="min-w-0 truncate">{row.label}</span>
          {pr.baseRefName && pr.headRefName && (
            <span className="truncate">
              {pr.baseRefName} ← {pr.headRefName}
            </span>
          )}
          <span className="shrink-0">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{pr.additions ?? "?"}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{pr.deletions ?? "?"}
            </span>
          </span>
          {checks && <span className="truncate">{checks}</span>}
          {pr.reviewDecision === "APPROVED" && <span>Approved</span>}
        </span>
      </span>
      <span className="flex min-w-0 max-w-32 shrink flex-col items-end gap-1 text-[11px] text-content/50">
        <span className="flex max-w-full items-center gap-1">
          {row.author.mascot && (
            <PixelMascot
              name={row.author.mascot}
              color={row.author.color ?? "#888888"}
              still
              className="size-4 shrink-0"
            />
          )}
          <span className="truncate">{row.author.name}</span>
        </span>
        <span className="max-w-full truncate" title={row.project}>
          {row.projectName}
          {time ? ` · ${formatRelativeTime(time)}` : ""}
        </span>
      </span>
    </button>
  );
}
