import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  gitDiffIndex,
  subscribeGitChanged,
  revealPath,
  type GitDiffIndex,
} from "../../platform/tauri/fs";
import { sameProjectPath } from "../../features/projects/model/recents";
import { AgentStatusLabel } from "../../features/agents/ui/AgentStatusLabel";
import {
  selectAgentLiveState,
  agentLiveStateLabel,
} from "../../features/agents/model/agentLiveState";
import { monoManagerGoals } from "../../features/monos/model/monoManagerGoals";
import {
  listMonos,
  monoLook,
  subscribeMonos,
  monosSnapshot,
} from "../../features/monos/model/mono";
import { orchestrator } from "../../features/orchestration/model/orchestration";
import type { Session } from "../../features/sessions/model/session";
import { useProjectWorktrees } from "../../features/source-control/hooks/useProjectWorktrees";
import { usePrStatus } from "../../features/source-control/hooks/usePrStatus";
import type { Worktree } from "../../features/source-control/model/worktrees";
import {
  pullRequestLabel,
  usePullRequests,
} from "../../features/source-control/model/pullRequests";
import { WorktreePrActions } from "../../features/source-control/ui/WorktreePrActions";
import { WorktreeCreatePr } from "../../features/source-control/ui/ProjectWorktrees";
import { DeleteWorktreeDialog } from "../../features/source-control/ui/DeleteWorktreeDialog";
import type { UsageDashboardSnapshot } from "../../features/providers/model/usageDashboard";
import {
  clampUsedPercent,
  formatUsagePercent,
} from "../../features/providers/model/rateLimits";
import { GitBranch, Plus, X } from "../../shared/ui/icons";
import { workspaceTeam } from "./WorkspaceTeam";
import { displayPath, isEqualOrInside, pathKey } from "../../shared/lib/paths";
import { worktreeTaskSessions } from "../../features/source-control/model/worktreeSessions";
import { workbenchSessionTask } from "../../features/monos/model/monoNavigation";
import { ProjectAutonomyControl, type DecisionUiActions } from "../../features/commandCenter/ui/Decisions";
import { GoalTaskSummary } from "../../features/commandCenter/ui/GoalTaskSummary";
import { WorktreeQuickActions } from "../../features/source-control/ui/WorktreeQuickActions";

const button =
  "rounded-lg border border-stroke px-2.5 py-1.5 text-[11px] text-content/75 hover:bg-content/5 disabled:opacity-40";
const heading =
  "px-4 pb-1 pt-5 text-[10px] font-medium uppercase tracking-wider text-content/45";
const empty = "px-4 py-2 text-[12px] text-content/50";

export type WorkspaceContextTab = "goal" | "worktree" | "changes" | "prs" | "activity";
export function WorkspaceChanges({ path, onOpen }: { path: string; onOpen: () => void }) {
  const [result, setResult] = useState<{ path: string; index?: GitDiffIndex; error?: string }>();
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void gitDiffIndex(path).then(index => {
        if (!disposed && request === generation) setResult({ path, index });
      }, error => {
        if (!disposed && request === generation) setResult({ path, error: String(error) });
      });
    };
    refresh();
    const stop = subscribeGitChanged(refresh);
    return () => { disposed = true; stop(); };
  }, [path]);
  const current = result?.path === path ? result : undefined;
  return <section role="tabpanel" aria-label="Changed files" className="min-h-0 flex-1 overflow-y-auto p-4">
    <h2 className="mb-3 text-xs font-medium">Changed files</h2>
    {current?.error ? <p role="alert" className="text-xs text-danger">Could not refresh changes. {current.error}</p> : !current?.index ? <p role="status" className="text-xs text-content/50">Loading changes…</p> : current.index.files.length ? current.index.files.map(file => <button type="button" key={file.path} title={file.path} onClick={onOpen} className="flex w-full items-center gap-2 border-b border-stroke py-2 text-left text-xs hover:bg-content/5">
      <span className="shrink-0 font-mono text-content/50">{file.status === "added" || file.status === "untracked" ? "A" : file.status === "deleted" ? "D" : "M"}</span>
      <span className="min-w-0 flex-1 truncate">{displayPath(file.path, path)}</span>
      <span className="shrink-0 text-[10px]"><span className="text-green-700 dark:text-green-400">+{file.additions}</span> <span className="text-red-600 dark:text-red-400">−{file.deletions}</span></span>
    </button>) : <p className="text-xs text-content/50">No changes yet.</p>}
    <button type="button" className={`${button} mt-4`} onClick={onOpen}>Open diff</button>
  </section>;
}
export function WorkspaceContextTabs({
  tab,
  onChange,
  onClose,
  children,
}: {
  tab: WorkspaceContextTab;
  onChange: (tab: WorkspaceContextTab) => void;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-workspace-context>
      <div className="flex shrink-0 items-center border-b border-stroke pr-2">
        <div
          role="tablist"
          aria-label="Project context"
          className="flex min-w-0 flex-1 gap-1 px-2 py-2"
          onKeyDown={(event) => {
            const tabs: WorkspaceContextTab[] = ["goal", "worktree", "changes", "prs", "activity"];
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : event.key === "ArrowRight"
                    ? (tabs.indexOf(tab) + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (tabs.indexOf(tab) + tabs.length - 1) % tabs.length
                      : undefined;
            if (next == null) return;
            event.preventDefault();
            onChange(tabs[next]);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>("button")
              [next]?.focus();
          }}
        >
          {(
            [
              ["goal", "Goal"],
              ["worktree", "Worktree"],
              ["changes", "Changes"],
              ["prs", "PRs"],
              ["activity", "Activity"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              aria-selected={tab === id}
              onClick={() => onChange(id)}
              className={`rounded-md px-2 py-1.5 text-[11px] ${tab === id ? "bg-selection text-content" : "text-content/55 hover:bg-content/5"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Hide panel"
            title="Hide panel (Ctrl+B)"
            onClick={onClose}
            className="grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function WorkspaceUsage({
  snapshot,
  monoIds,
  compact = false,
}: {
  snapshot?: UsageDashboardSnapshot;
  monoIds?: ReadonlySet<string>;
  compact?: boolean;
}) {
  const accounts =
    snapshot?.groups.flatMap((group) =>
      group.accounts
        .filter(
          (account) =>
            !monoIds ||
            account.assignments.some((assignment) =>
              monoIds.has(assignment.monoId),
            ),
        )
        .map((account) => ({ ...account, providerLabel: group.label })),
    ) ?? [];
  if (compact) {
    const account = accounts.length === 1 ? accounts[0] : undefined;
    const quota = account?.limits?.weekly ?? account?.limits?.session;
    const remaining =
      account?.freshness === "fresh" &&
      quota &&
      Number.isFinite(quota.usedPercent)
        ? 100 - clampUsedPercent(quota.usedPercent)
        : undefined;
    return remaining == null ? (
      <span
        className="text-[10px] text-content/40"
        title="Open Usage for account-specific limits"
      >
        —
      </span>
    ) : (
      <span
        role="meter"
        aria-label={`${account!.providerLabel} ${account!.label} remaining`}
        aria-valuenow={remaining}
        aria-valuemin={0}
        aria-valuemax={100}
        title={`${account!.providerLabel} · ${account!.label}: ${formatUsagePercent(remaining)} left`}
        className="h-1 w-10 overflow-hidden rounded-full bg-content/10"
      >
        <span
          className="block h-full bg-accent"
          style={{ width: `${remaining}%` }}
        />
      </span>
    );
  }
  return (
    <div className="space-y-2 px-4 py-2 text-[11px] text-content/60">
      {!accounts.length && <p>Usage unavailable for this project.</p>}
      {accounts.map((account) => {
        const quota = account.limits?.weekly ?? account.limits?.session;
        const remaining =
          account.freshness === "fresh" &&
          quota &&
          Number.isFinite(quota.usedPercent)
            ? 100 - clampUsedPercent(quota.usedPercent)
            : undefined;
        return (
          <div key={account.key}>
            <div className="flex justify-between gap-2">
              <span className="truncate">
                {account.providerLabel} · {account.label}
              </span>
              <span className="shrink-0">
                {remaining == null
                  ? account.status.label
                  : `${formatUsagePercent(remaining)} left`}
              </span>
            </div>
            {remaining != null && (
              <div
                role="meter"
                aria-label={`${account.providerLabel} ${account.label} ${account.limits?.weekly ? "weekly" : "session"} remaining`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={remaining}
                className="mt-1 h-1 overflow-hidden rounded-full bg-content/10"
              >
                <div
                  className="h-full bg-accent"
                  style={{ width: `${remaining}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WorkspaceGoals({
  project,
  sessions,
  usage,
  onOpenMono,
  decisionActions,
  goalAction,
}: {
  project: string;
  sessions: readonly Session[];
  usage?: UsageDashboardSnapshot;
  onOpenMono: (id: string) => void;
  decisionActions?: DecisionUiActions;
  goalAction?: (goalId: string) => ReactNode;
}) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
  );
  const roster = listMonos();
  const team = workspaceTeam(roster, project);
  const manager = team.manager;
  const projectRuns = runs.filter((run) =>
    sameProjectPath(run.workspace?.projectCwd ?? run.cwd, project),
  );
  const assignments = projectRuns.flatMap((run) => run.tasks.map((task) => ({ run, task })));
  const tasks = assignments.map(({ task }) => task);
  const goals = monoManagerGoals
    .goals()
    .filter(
      (goal) =>
        !goal.archived &&
        (sameProjectPath(goal.projectId, project) ||
          projectRuns.some((run) => run.leadId === goal.managerId)),
    );
  const ids = new Set([
    ...(manager ? [manager.id] : []),
    ...team.members.map((mono) => mono.id),
  ]);
  return (
    <section
      role="tabpanel"
      aria-label="Goal & tasks"
      className="min-h-0 flex-1 overflow-y-auto pb-4"
    >
      {manager && decisionActions && <div className="px-4 pt-4"><ProjectAutonomyControl managerId={manager.id} projectId={project} value={monoManagerGoals.autonomy(manager.id, project)} actions={decisionActions} /></div>}
      <h2 className={heading}>Goal</h2>
      {goals.length ? (
        goals.map((goal) => {
          const scoped = tasks.filter((task) => task.monoGoalId === goal.id);
          const done = scoped.filter(
            (task) => task.status === "completed",
          ).length;
          return (
            <div
              key={goal.id}
              className="mx-4 mb-2 rounded-xl border border-stroke bg-content/3 p-3 text-[12px]"
            >
              <p className="font-medium">{goal.title}</p>
              <p className="mt-1 text-[11px] text-content/55">{goal.state}</p>
              {!!scoped.length && (
                <>
                  <progress
                    aria-label={`${goal.title}: tasks completed`}
                    value={done}
                    max={scoped.length}
                    className="mt-2 h-1 w-full accent-accent"
                  />
                  <p className="mt-1 text-[10px] text-content/50">
                    {done} of {scoped.length} tasks completed
                  </p>
                </>
              )}
              {goalAction?.(goal.id)}
            </div>
          );
        })
      ) : (
        <p className={empty}>No recorded goals for this project.</p>
      )}
      <h2 className={heading}>Tasks</h2>
      {tasks.length ? (
        assignments.map(({ run, task }) => {
          const state = selectAgentLiveState(
            sessions.find((session) => session.id === task.sessionId),
            { task, tasks: run.tasks, runStatus: run.status, pauseReason: run.lastPauseReason },
          );
          const owner = roster.find((mono) => mono.id === task.memberId);
          return (
            <div
              key={task.id}
              className="border-b border-stroke px-4 py-2.5 text-[12px]"
            >
              <GoalTaskSummary task={task} goalTitle={goals.find(goal => goal.id === task.monoGoalId)?.title} />
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-content/55">
                {owner ? (
                  <button
                    type="button"
                    className="hover:text-content"
                    onClick={() => onOpenMono(owner.id)}
                  >
                    {monoLook(owner).name}
                  </button>
                ) : (
                  <span>{task.memberName ?? "Owner unavailable"}</span>
                )}
                <span>·</span>
                <AgentStatusLabel state={state} />
              </div>
            </div>
          );
        })
      ) : (
        <p className={empty}>No recorded tasks yet.</p>
      )}
      <h2 className={heading}>This project decides</h2>
      <dl className="space-y-2 px-4 py-2 text-[11px] text-content/60">
        {!(manager && decisionActions) && <div className="flex justify-between gap-3">
          <dt>Ask me for</dt>
          <dd>Not configured</dd>
        </div>}
        <div className="flex justify-between gap-3">
          <dt>Decided by team today</dt>
          <dd>Not recorded</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Skills chosen by Manager</dt>
          <dd>
            {manager?.teamSkillsPolicy?.mode === "custom"
              ? `${manager.teamSkillsPolicy.enabled?.length ?? 0} configured`
              : "Not reported"}
          </dd>
        </div>
      </dl>
      <h2 className={heading}>Usage</h2>
      <WorkspaceUsage snapshot={usage} monoIds={ids} />
    </section>
  );
}

export function WorkspaceWorktrees({
  project,
  sessions = [],
  selectedPath,
  onSelect,
  onNew,
}: {
  project: string;
  sessions?: readonly Session[];
  selectedPath?: string;
  onSelect: (tree: Worktree) => void;
  onNew?: () => void;
}) {
  const { data, error } = useProjectWorktrees(
    project,
    !project.startsWith("remote:"),
  );
  return (
    <section aria-label="Worktrees" className="px-2 pb-3">
      <div className="flex h-7 items-center px-2 text-[11px] font-medium uppercase tracking-wide text-content/45">
        <h2 className="flex-1">Worktrees</h2>
        {onNew && (
          <button
            type="button"
            aria-label="New worktree"
            title="New worktree"
            onClick={onNew}
            className="grid size-5 place-items-center rounded hover:bg-content/10"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      {data?.worktrees.map((tree) => (
        <WorkspaceWorktreeRow
          key={tree.path}
          project={project}
          tree={tree}
          sessions={sessions}
          selected={!!selectedPath && sameProjectPath(tree.path, selectedPath)}
          onSelect={() => onSelect(tree)}
        />
      ))}
      {!data?.worktrees.length && (
        <p className="px-2 py-2 text-[11px] text-content/50">
          {error
            ? "Worktrees unavailable."
            : data
              ? "No worktrees yet."
              : project.startsWith("remote:")
                ? "Worktrees unavailable for this connection."
                : "Loading worktrees…"}
        </p>
      )}
    </section>
  );
}

function useWorktreeAssignment(project: string, tree: Worktree) {
  const runs = useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot);
  const worker = worktreeTaskSessions(project, [tree], runs).get(pathKey(tree.path))?.[0];
  const run = worker && runs.find(run => run.tasks.includes(worker.task));
  const task = worker && (workbenchSessionTask(run ? [run] : [], worker.sessionId)
    ?? (worker.sessionId === worker.task.sessionId ? worker.task : undefined));
  return { run, task, sessionId: worker?.sessionId };
}

function WorkspaceWorktreeRow({
  project,
  tree,
  sessions,
  selected,
  onSelect,
}: {
  project: string;
  tree: Worktree;
  sessions: readonly Session[];
  selected: boolean;
  onSelect: () => void;
}) {
  const { pr } = usePrStatus(
    tree.path,
    tree.branch,
    !tree.missing && !tree.prunable,
  );
  const records = usePullRequests();
  const entry =
    pr &&
    records.find(
      (entry) =>
        sameProjectPath(entry.cwd, tree.path) && entry.pr.url === pr.url,
    );
  const label = entry ? pullRequestLabel(entry) : pr?.state;
  const assignment = useWorktreeAssignment(project, tree);
  const session =
    sessions.find((session) => session.id === assignment.sessionId) ??
    sessions.find((session) => tree.sessionIds.includes(session.id));
  const state =
    assignment.task || session
      ? selectAgentLiveState(session, {
          task: assignment.task,
          tasks: assignment.run?.tasks,
          runStatus: assignment.run?.status,
          pauseReason: assignment.run?.lastPauseReason,
        })
      : undefined;
  return (
    <button
      type="button"
      data-sidebar-row
      aria-label={`Worktree ${tree.branch ?? "Detached HEAD"}${state ? `, ${agentLiveStateLabel(state)}` : ""}${pr ? `, PR #${pr.number}, ${label}` : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[11px] text-content/65 hover:bg-content/5 ${selected ? "bg-selection text-content" : ""}`}
    >
      {state && !tree.missing && !tree.prunable ? (
        <AgentStatusLabel
          state={state}
          className="[&_.agent-state-text]:sr-only"
        />
      ) : (
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${tree.missing || tree.prunable ? "bg-red-400" : tree.dirty ? "bg-amber-400" : "bg-content/30"}`}
        />
      )}
      <span className="min-w-0 flex-1 truncate text-left font-mono">
        {tree.branch ?? `Detached ${tree.head.slice(0, 7)}`}
      </span>
      {!isEqualOrInside(tree.path, project) && (
        <span title={tree.path} className="shrink-0 text-[9px] text-content/45">
          outside project
        </span>
      )}
      {pr && (
        <span className="max-w-[45%] truncate rounded bg-content/5 px-1.5 py-0.5 text-[9px]">
          #{pr.number} · {label}
        </span>
      )}
    </button>
  );
}

export function WorkspaceWorktree({
  project,
  path,
  sessions,
  onOpen,
  onChanges,
  onRemove,
  onRunScript,
}: {
  project: string;
  path?: string;
  onRunScript?: (project: string, path: string, name: string) => Promise<void>;
  sessions: readonly Session[];
  onOpen: (tree: Worktree) => void;
  onChanges: (path: string) => void;
  onRemove: (
    cwd: string,
    path: string,
    force: boolean,
    keepSessions: boolean,
  ) => Promise<void>;
}) {
  const { data, refresh } = useProjectWorktrees(
    project,
    !project.startsWith("remote:"),
  );
  const tree = data?.worktrees.find((tree) =>
    sameProjectPath(tree.path, path ?? project),
  );
  return (
    <section
      role="tabpanel"
      aria-label="Worktree"
      className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4"
    >
      {tree ? (
        <WorktreeDetails
          key={tree.path}
          project={project}
          tree={tree}
          sessions={sessions}
          onRunScript={onRunScript}
          onOpen={() => onOpen(tree)}
          onChanges={() => onChanges(tree.path)}
          onRemove={onRemove}
          onDeleted={() => void refresh()}
        />
      ) : (
        <p className="text-[12px] text-content/50">
          Select a worktree to see its changes and pull request.
        </p>
      )}
    </section>
  );
}

function WorktreeDetails({
  project,
  tree,
  sessions,
  onOpen,
  onChanges,
  onRemove,
  onDeleted,
  onRunScript,
}: {
  project: string;
  tree: Worktree;
  onRunScript?: (project: string, path: string, name: string) => Promise<void>;
  sessions: readonly Session[];
  onOpen: () => void;
  onChanges: () => void;
  onRemove: (
    cwd: string,
    path: string,
    force: boolean,
    keepSessions: boolean,
  ) => Promise<void>;
  onDeleted: () => void;
}) {
  const [index, setIndex] = useState<GitDiffIndex>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const { pr } = usePrStatus(
    tree.path,
    tree.branch,
    !tree.missing && !tree.prunable,
  );
  const records = usePullRequests();
  const entry =
    pr &&
    records.find(
      (entry) =>
        sameProjectPath(entry.cwd, tree.path) && entry.pr.url === pr.url,
    );
  const { task } = useWorktreeAssignment(project, tree);
  const owner = task?.memberId
    ? listMonos().find((mono) => mono.id === task.memberId)
    : undefined;
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void gitDiffIndex(tree.path).then(
        (value) => {
          if (!cancelled) {
            setIndex(value);
            setError(undefined);
          }
        },
        (reason) => {
          if (!cancelled) {
            setIndex(undefined);
            setError(String(reason));
          }
        },
      );
    };
    load();
    const stop = subscribeGitChanged(load);
    return () => {
      cancelled = true;
      stop();
    };
  }, [tree.path]);
  const unavailable = tree.missing || tree.prunable;
  return (
    <>
      {onRunScript ? <WorktreeQuickActions project={project} path={tree.path} unavailable={unavailable} onRun={onRunScript} /> : null}
      <h2 className="flex items-center gap-2 text-[13px] font-medium">
        <GitBranch className="size-4 shrink-0" />
        <span className="break-all">{tree.branch ?? "Detached HEAD"}</span>
      </h2>
      {!isEqualOrInside(tree.path, project) && (
        <p
          title={tree.path}
          className="mt-1 break-all text-[11px] text-content/55"
        >
          Lives in {tree.path}
          {tree.isMain ? " (the repo's main checkout)" : ""}
        </p>
      )}
      <dl className="my-4 space-y-2 text-[11px] text-content/60">
        <div className="flex justify-between gap-3">
          <dt>Owner</dt>
          <dd>
            {owner ? monoLook(owner).name : (task?.memberName ?? "Unassigned")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Base</dt>
          <dd>
            {task?.baseBranch ??
              pr?.baseRefName ??
              index?.defaultBranch ??
              "Unavailable"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Ahead / behind upstream</dt>
          <dd>
            {index?.upstream
              ? `${index.ahead} / ${index.behind}`
              : "Unavailable"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Local changes</dt>
          <dd>
            {index ? (
              <>
                {index.files.length} files ·{" "}
                <span className="text-green-700 dark:text-green-400">
                  +{index.additions}
                </span>{" "}
                <span className="text-red-600 dark:text-red-400">
                  −{index.deletions}
                </span>
              </>
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="mb-3 text-[11px] text-red-400">
          Could not refresh worktree details.{" "}
          <button type="button" onClick={onChanges} className="underline">
            Open changes
          </button>
        </p>
      )}
      {pr ? (
        <div className="rounded-xl border border-stroke bg-content/3 p-3 text-[12px]">
          <p className="mb-1 text-[10px] text-content/50">
            PR #{pr.number} · {entry ? pullRequestLabel(entry) : pr.state}
          </p>
          <h3 className="font-medium">{pr.title}</h3>
          <p className="mt-2 text-[11px] text-content/60">
            Review: {pr.reviewDecision || "Not reported"}
          </p>
          <p className="mt-1 text-[11px] text-content/60">
            Checks: {pr.checksStatus ?? "Unknown"}
          </p>
          <p className="my-3 text-[11px] text-content/60">
            Changes:{" "}
            {pr.additions == null || pr.deletions == null
              ? "Not reported"
              : `+${pr.additions} / −${pr.deletions}`}
          </p>
          {entry && (
            <WorktreePrActions
              entry={entry}
              sessionId={task?.sessionId ?? entry.links[0]?.sessionId ?? ""}
              taskId={task?.id}
            />
          )}
          <p className="mt-2 text-[10px] text-content/45">
            Merging always needs your approval.
          </p>
        </div>
      ) : (
        <div className="my-3 rounded-xl border border-stroke bg-content/3 p-3 text-[12px]">
          <h3 className="font-medium">No pull request yet</h3>
          <p className="mb-3 mt-1 text-[11px] text-content/55">
            Create one when this branch is ready for review.
          </p>
          <button
            type="button"
            className="rounded-lg bg-content px-3 py-1.5 text-[11px] font-medium text-background-base hover:opacity-85 disabled:opacity-40"
            disabled={unavailable || !tree.branch}
            onClick={() => setCreating(true)}
          >
            Create PR
          </button>
        </div>
      )}
      {index && index.files.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[10px] uppercase tracking-wide text-content/45">
            Changed files · local checkout
          </h3>
          {index.files.map((file) => {
            const relative = displayPath(file.path, tree.path);
            const split = relative.lastIndexOf("/");
            const added =
              file.status === "added" || file.status === "untracked";
            return (
              <button
                type="button"
                key={file.path}
                title={file.path}
                onClick={onChanges}
                className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 text-left text-[11px] hover:bg-content/5"
              >
                <span
                  data-file-status={file.status}
                  title={file.status}
                  aria-label={file.status}
                  className={`w-3 shrink-0 text-center font-mono text-[9px] ${added ? "text-green-700 dark:text-green-400" : file.status === "deleted" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}
                >
                  {added ? "A" : file.status === "deleted" ? "D" : "M"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-content/85">
                    {relative.slice(split + 1)}
                  </span>
                  {split >= 0 && (
                    <span className="block truncate text-[10px] text-content/40">
                      {relative.slice(0, split)}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px]">
                  <span className="text-green-700 dark:text-green-400">
                    +{file.additions}
                  </span>{" "}
                  <span className="text-red-600 dark:text-red-400">
                    −{file.deletions}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div
        role="group"
        aria-label="Worktree actions"
        className="mt-4 flex flex-wrap gap-2 border-t border-stroke pt-3"
      >
        {!onRunScript && <><button
          type="button"
          className={button}
          disabled={unavailable}
          onClick={onOpen}
        >
          Open workspace
        </button>
        <button
          type="button"
          className={button}
          disabled={unavailable}
          onClick={() => {
            void revealPath(tree.path).catch((reason) =>
              setError(String(reason)),
            );
          }}
        >
          Open folder
        </button></>}
        <button
          type="button"
          className={button}
          disabled={unavailable}
          onClick={onChanges}
        >
          Changes
        </button>
        <button
          type="button"
          className={button}
          disabled
          title="Updating from the base branch is not available in the current worktree commands."
        >
          Update from {index?.defaultBranch ?? "main"}
        </button>
        {!tree.isMain && (
          <button
            type="button"
            className={button}
            onClick={() => setArchiving(true)}
          >
            Archive worktree…
          </button>
        )}
      </div>
      {creating && (
        <WorktreeCreatePr tree={tree} onClose={() => setCreating(false)} />
      )}
      {archiving && (
        <DeleteWorktreeDialog
          cwd={project}
          tree={tree}
          sessionCount={
            sessions.filter((session) =>
              sameProjectPath(session.cwd, tree.path),
            ).length
          }
          allowDeleteSessions={false}
          onOpenChanges={onChanges}
          onRemove={(cwd, path, force) => onRemove(cwd, path, force, true)}
          onClose={() => setArchiving(false)}
          onDeleted={() => {
            setArchiving(false);
            onDeleted();
          }}
        />
      )}
    </>
  );
}
