import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { findMono, monoLook } from "../../monos/model/mono";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  HARNESSES,
  HARNESS_TITLE,
  type HarnessId,
} from "../../sessions/model/session";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import {
  listExternalEditors,
  openInExternalEditor,
  type ExternalEditor,
} from "../../../platform/tauri/fs";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { Modal } from "../../../shared/ui/Modal";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useActiveWorktrees } from "../hooks/useActiveWorktrees";
import {
  gitDiffIndex,
  gitPrCreate,
  gitPrStatus,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import { orchestrator } from "../../orchestration/model/orchestration";
import {
  isProjectManager,
  managerWorktreeStatus,
  managerQueueRank,
  managerTaskOutcome,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import type { LiveAgent } from "../../sessions/model/liveAgents";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { OrchestrationSidebarAgents } from "../../orchestration/ui/OrchestrationSidebarAgents";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { copyText } from "../../../platform/tauri/clipboard";
import { revealPath } from "../../../platform/tauri/fs";
import { sameProjectPath } from "../../projects/model/recents";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Check,
  GitBranch,
  GitPullRequest,
  GitPullRequestDraft,
  Loader,
  MoreHorizontal,
  Plus,
} from "../../../shared/ui/icons";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { usePrStatus, usePrStatusCache } from "../hooks/usePrStatus";
import { pullRequestLabel, usePullRequests, worktreePullRequests } from "../model/pullRequests";
import { useWorktreeFocus } from "../model/worktreeFocus";
import {
  worktreeProgress,
  worktreeSessionGroups,
  worktreeTaskSessions,
} from "../model/worktreeSessions";
import type { Worktree, WorktreeSessionOptions } from "../model/worktrees";
import { useProjectExpansion } from "../../projects/hooks/useProjectExpansion";

/** Older idle sessions fold behind "Show more"; anything active stays listed. */
const SESSION_LIMIT = 5;
/** Worktrees page in this many at a time; the focused or busy ones always show. */
const WORKTREE_PAGE = 5;

type Props = {
  onAddAsSeparateProject?: (tree: Worktree) => void | Promise<void>;
  renderManager?: (expanded: boolean, onToggle: () => void, ownedCount: number) => ReactNode;
  onRemove?: (
    cwd: string,
    path: string,
    force: boolean,
    keepSessions: boolean,
  ) => Promise<void>;
  onOpenTerminal?: (path: string) => void;
  onOpenChanges?: (path: string) => void;
  onGiveToManager?: (
    project: string,
    tree: Worktree,
    goal: string,
  ) => Promise<void>;
  project: string;
  currentProject: string;
  enabled: boolean;
  history: readonly SessionSummary[];
  openSessions: readonly SessionSummary[];
  busySessionIds: ReadonlySet<string>;
  approvalSessionIds: ReadonlySet<string>;
  unseenFinishedIds: ReadonlySet<string>;
  liveAgents: readonly LiveAgent[];
  activeSessionId?: string;
  selectionEnabled?: boolean;
  switchPending?: boolean;
  switchError?: string;
  onLoadHistory: (project: string) => Promise<boolean>;
  onSelectWorktree: (project: string, tree: Worktree) => void;
  onNewSession: (
    project: string,
    tree: Worktree,
    options?: WorktreeSessionOptions,
  ) => void;
  onSelectSession: (
    sessionId: string,
    workspace: { project: string; tree: Worktree },
  ) => void;
};

export function ProjectWorktrees({
  onAddAsSeparateProject,
  renderManager,
  onRemove,
  onOpenTerminal,
  onOpenChanges,
  onGiveToManager,
  project,
  currentProject,
  enabled,
  history,
  openSessions,
  busySessionIds,
  approvalSessionIds,
  unseenFinishedIds,
  liveAgents,
  activeSessionId,
  selectionEnabled = true,
  switchPending,
  switchError,
  onLoadHistory,
  onSelectWorktree,
  onNewSession,
  onSelectSession,
}: Props) {
  const { data, error, refresh } = useProjectWorktrees(project, enabled);
  const orchestrationActions = useContext(OrchestrationActions);
  const managerRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const prStatuses = usePrStatusCache();
  const prRecords = usePullRequests();
  const focus = useWorktreeFocus(project);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [worktreeLimit, setWorktreeLimit] = useState(WORKTREE_PAGE);
  const [historyError, setHistoryError] = useState(false);
  const [historyPending, setHistoryPending] = useState(true);
  const [menu, setMenu] = useState<{
    tree: Worktree;
    x: number;
    y: number;
    trigger: HTMLElement;
  }>();
  const [actionError, setActionError] = useState<string>();
  const [editors, setEditors] = useState<ExternalEditor[]>([]);
  const [deleting, setDeleting] = useState<Worktree>();
  const [giving, setGiving] = useState<Worktree>();
  const [goal, setGoal] = useState("");
  const [givingBusy, setGivingBusy] = useState(false);
  const [creatingPr, setCreatingPr] = useState<Worktree>();
  const [teamExpanded, setTeamExpanded] = useProjectExpansion(project, "manager-team", true);
  const [taskExpanded, setTaskExpanded] = useProjectExpansion(project, "task-worktrees", false);
  const [doneExpanded, setDoneExpanded] = useProjectExpansion(project, "finished-worktrees", false);
  const [activeOnly] = useActiveWorktrees(project);
  useEffect(() => {
    if (!menu) return;
    let disposed = false;
    void listExternalEditors()
      .then((items) => {
        if (!disposed) setEditors(items ?? []);
      })
      .catch(() => {
        if (!disposed) setEditors([]);
      });
    return () => {
      disposed = true;
    };
  }, [menu]);
  const closeMenu = () => {
    menu?.trigger.focus();
    setMenu(undefined);
  };
  useEffect(() => {
    if (!enabled) setMenu(undefined);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const load = async () => {
      const loaded = await onLoadHistory(project);
      if (!disposed) {
        setHistoryError(!loaded);
        setHistoryPending(false);
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      disposed = true;
      window.removeEventListener("focus", load);
    };
  }, [enabled, project, onLoadHistory]);
  const groups = useMemo(
    () =>
      worktreeSessionGroups(
        project,
        data?.worktrees ?? [],
        history,
        openSessions,
        managerRuns,
      ),
    [project, data, history, openSessions, managerRuns],
  );
  const agents = new Map(liveAgents.map((agent) => [agent.id, agent]));
  // A task's harness is its latest assignment; a reassigned task's older
  // sessions ran elsewhere, so prefer each session's own record.
  const known = new Map([...history, ...openSessions].map((session) => [session.id, session]));
  const trees = data?.worktrees ?? [];
  const workers = useMemo(
    () => worktreeTaskSessions(project, data?.worktrees ?? [], managerRuns),
    [project, data, managerRuns],
  );
  const teamTasks = new Set(managerRuns.filter(run => run.ownerMonoId).flatMap(run => run.tasks));
  const teamByPath = new Map([...workers].map(([key, sessions]) => [key,
    sessions.filter(({ sessionId, task }) =>
      teamTasks.has(task) && sessionId === task.sessionId &&
      (busySessionIds.has(sessionId) || task.status === "running" || task.status === "cancelling"),
    ).filter((worker, index, all) =>
      all.findIndex(other => (other.task.memberId ?? other.sessionId) === (worker.task.memberId ?? worker.sessionId)) === index,
    ),
  ]));
  const focusedPath =
    selectionEnabled &&
    !isProjectManager(activeSessionId ?? "") &&
    sameProjectPath(project, currentProject)
      ? (focus?.path ?? project)
      : undefined;
  const needsAttention = (session: SessionSummary) =>
    session.id === activeSessionId ||
    approvalSessionIds.has(session.id) ||
    busySessionIds.has(session.id) ||
    unseenFinishedIds.has(session.id) ||
    session.orchestration?.tasks.some(
      (task) =>
        task.needsInput ||
        (session.orchestration?.live &&
          ["running", "queued", "cancelling"].includes(task.status)),
    );
  const taskByPath = new Map(
    trees.flatMap((tree) => {
      if (tree.isMain) return [];
      const key = pathKey(tree.path);
      const task = workers.get(key)?.find(({ task }) => task.workspacePolicy !== "shared")?.task;
      return task ? [[key, task] as const] : [];
    }),
  );
  const rank = (tree: Worktree) => {
    const task = taskByPath.get(pathKey(tree.path));
    return task ? managerQueueRank(task, taskPrStatus(task, prStatuses)) : 2;
  };
  const filteredTrees = trees.filter(
    (tree) =>
      !activeOnly ||
      !!teamByPath.get(pathKey(tree.path))?.length ||
      (groups.get(pathKey(tree.path)) ?? []).some(needsAttention) ||
      (!!focusedPath && sameProjectPath(focusedPath, tree.path)) ||
      (tree.branch &&
        rank(tree) !== 3 &&
        (!!tree.dirty ||
          !!managerWorktreeStatus(
            managerRuns,
            tree.path,
            approvalSessionIds,
            prStatuses,
          ))),
  );
  const regularPage = new Set(
    filteredTrees
      .filter((tree) => !renderManager || !taskByPath.has(pathKey(tree.path)))
      .slice(0, worktreeLimit)
      .map((tree) => pathKey(tree.path)),
  );
  const listedTrees = filteredTrees.filter(
    (tree) =>
      regularPage.has(pathKey(tree.path)) ||
      !!teamByPath.get(pathKey(tree.path))?.length ||
      (!!renderManager && taskByPath.has(pathKey(tree.path))) ||
      (!!focusedPath && sameProjectPath(focusedPath, tree.path)) ||
      !!managerWorktreeStatus(managerRuns, tree.path, undefined, prStatuses) ||
      (groups.get(pathKey(tree.path)) ?? []).some(needsAttention),
  );
  const hiddenTrees = filteredTrees.length - listedTrees.length;
  const filteredOut = trees.length - filteredTrees.length;
  const sections = renderManager
    ? [
        {
          name: "Your worktrees",
          groups: [{ name: "Your worktrees", trees: listedTrees.filter(tree => !taskByPath.has(pathKey(tree.path))), expanded: true }],
          expanded: true,
        },
        {
          name: "Task worktrees",
          groups: [
            { name: "Active task worktrees", trees: listedTrees.filter(tree => taskByPath.has(pathKey(tree.path)) && rank(tree) !== 3).sort((a, b) => rank(a) - rank(b)), expanded: true },
            { name: "Finished", trees: listedTrees.filter(tree => taskByPath.has(pathKey(tree.path)) && rank(tree) === 3), expanded: doneExpanded },
          ],
          expanded: taskExpanded,
        },
      ]
    : [{ name: "Your worktrees", groups: [{ name: "Your worktrees", trees: listedTrees, expanded: true }], expanded: true }];
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      const key = pathKey(path);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const smallButton =
    "grid size-6 shrink-0 place-items-center rounded-md text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-40";
  const worktreeAction = `${smallButton} absolute top-1/2 -translate-y-1/2 pointer-events-none opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/worktree:pointer-events-auto group-hover/worktree:opacity-100 group-focus-within/worktree:pointer-events-auto group-focus-within/worktree:opacity-100 group-data-[actions-open=true]/worktree:pointer-events-auto group-data-[actions-open=true]/worktree:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100`;
  return (
    <div
      className="ml-5 pb-1"
      aria-label={`Worktrees for ${projectName(project)}`}
    >
      {!data && !error ? (
        <p className="flex items-center gap-2 px-2 py-1 text-xs text-content/60">
          <Loader className="size-3 animate-spin" />
          Loading worktrees…
        </p>
      ) : null}
      {error || switchError || actionError ? (
        <p role="alert" className="break-words px-2 py-1 text-xs text-red-400">
          {actionError || switchError || error}
          {error ? (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
      {historyError ? (
        <p role="alert" className="px-2 py-1 text-xs text-red-400">
          Could not load sessions.{" "}
          <button
            type="button"
            className="underline"
            onClick={() =>
              void onLoadHistory(project).then((loaded) =>
                setHistoryError(!loaded),
              )
            }
          >
            Retry
          </button>
        </p>
      ) : null}
      {renderManager?.(teamExpanded, () => setTeamExpanded(!teamExpanded),
        trees.filter(tree => taskByPath.has(pathKey(tree.path))).length,
      )}
      {sections.map((section) => (
        <div
          key={section.name}
          role="group"
          aria-label={section.name}
        >
          {section.name === "Task worktrees" ? (
            <button
              type="button"
              aria-label="Toggle Task worktrees"
              aria-expanded={taskExpanded}
              title={section.groups.map(group => `${group.trees.length} ${group.name === "Finished" ? "finished" : "active"}`).join(" · ")}
              onClick={() => {
                const expanded = !taskExpanded;
                setTaskExpanded(expanded);
              }}
              className="mt-1 flex h-7 w-full items-center gap-1 rounded px-2 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content focus-visible:outline-accent"
            >
              {taskExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Task worktrees · {section.groups[0].trees.length} active
            </button>
          ) : <p className="mt-1 flex h-7 items-center px-5 text-[11px] text-content/50">Your worktrees</p>}
          <div
            data-worktree-group-list
            hidden={!section.expanded}
            className={
              section.name === "Your worktrees"
                ? ""
                : "ml-3 pl-1"
            }
          >
            {section.groups.map(group => (
              <div key={group.name} role={group.name === "Finished" ? "group" : undefined} aria-label={group.name === "Finished" ? "Finished" : undefined}>
                {group.name === "Finished" && group.trees.length > 0 && (
                  <button type="button" aria-label="Toggle Finished worktrees" aria-expanded={doneExpanded} onClick={() => setDoneExpanded(!doneExpanded)} className="flex h-7 w-full items-center gap-1 rounded px-2 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content focus-visible:outline-accent">
                    {doneExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    Finished · {group.trees.length}
                  </button>
                )}
                <div hidden={!group.expanded}>
            {group.trees.map((tree) => {
              const key = pathKey(tree.path);
              const userSessions = groups.get(key) ?? [];
              const taskTree = section.name === "Task worktrees";
              const workerSessions = workers.get(key) ?? [];
              const workerIds = new Set(workerSessions.map(worker => worker.sessionId));
              const sessions: SessionSummary[] = taskTree ? [
                ...workerSessions.map(({ sessionId, task, startedAt }): SessionSummary => ({
                  id: sessionId, cwd: project, worktreeCwd: tree.path,
                  title: task.title,
                  harness: known.get(sessionId)?.harness ?? task.harness,
                  model: known.get(sessionId)?.model ?? task.model,
                  runtimeMode: "supervised", createdAt: startedAt, updatedAt: startedAt,
                })),
                ...userSessions.filter(session => !workerIds.has(session.id)),
              ] : userSessions;
              const folded = taskTree && sessions.length === 1;
              const expandable = sessions.length > (taskTree ? 1 : 0);
              const expanded = expandable && !collapsed.has(key);
              const teammates = (taskTree ? [] : teamByPath.get(key) ?? []).map(worker => {
                const member = worker.task.memberId && findMono(worker.task.memberId);
                const look = member ? monoLook(member) : undefined;
                return { ...worker, look, name: look?.name ?? worker.task.memberName ?? "Teammate" };
              });
              const listed = showAll.has(key)
                ? sessions
                : sessions.filter(
                    (session, index) =>
                      index < SESSION_LIMIT || needsAttention(session),
                  );
              const hiddenCount = sessions.length - listed.length;
              const selected =
                !!focusedPath &&
                !(sessions.some(session => session.id === activeSessionId) && !folded) &&
                sameProjectPath(focus?.path ?? project, tree.path);
              const managerTask = taskByPath.get(key);
              const checkoutNotice = orchestrator.checkoutNotice("", { cwd: tree.path });
              const label =
                managerTask?.title ??
                tree.branch ??
                sessions.find((session) => session.title.trim())?.title ??
                tree.headSubject ??
                "Detached worktree";
              const done = group.name === "Finished";
              const outcome = managerTask && managerTaskOutcome(managerTask, taskPrStatus(managerTask, prStatuses));
              const workerStatus = taskTree && managerWorktreeStatus(
                managerRuns,
                tree.path,
                approvalSessionIds,
                prStatuses,
              );
              // Manager can report a PR before the GitHub status cache sees it.
              const openPrUrl =
                worktreePullRequests(tree.path, prRecords).find((pr) => pr.state === "open" && (!taskTree || pr.url === managerTask?.prUrl))?.url ??
                (workerStatus === "PR ready" ? managerTask?.prUrl : undefined);
              const progress = tree.missing
                ? "Missing folder"
                : worktreeProgress(
                    sessions,
                    busySessionIds,
                    approvalSessionIds,
                    unseenFinishedIds,
                  );
              const activeProgress =
                tree.missing ||
                sessions.some(
                  (session) =>
                    approvalSessionIds.has(session.id) ||
                    busySessionIds.has(session.id) ||
                    unseenFinishedIds.has(session.id),
                );
              return (
                <div
                  key={key}
                  data-worktree={tree.path}
                  className={`my-1 rounded-md border border-transparent hover:border-content/15 hover:bg-content/5 focus-within:border-content/15 focus-within:bg-content/5 ${done ? "opacity-60" : ""} ${folded && sessions[0].id === activeSessionId ? "bg-selection" : ""} ${menu?.tree.path === tree.path ? "border-content/15 bg-content/5" : ""}`}
                >
                  <div
                    className={`group/worktree relative flex ${taskTree ? "h-10" : "h-7"} items-center gap-1 rounded-md`}
                    data-actions-open={
                      menu?.tree.path === tree.path || undefined
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const trigger =
                        event.currentTarget.querySelector<HTMLButtonElement>(
                          "[data-worktree-menu]",
                        )!;
                      setMenu({
                        tree,
                        x: event.clientX,
                        y: event.clientY,
                        trigger,
                      });
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ContextMenu" &&
                        !(event.shiftKey && event.key === "F10")
                      )
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      const trigger = event.target as HTMLElement;
                      const rect = trigger.getBoundingClientRect();
                      setMenu({ tree, x: rect.left, y: rect.bottom, trigger });
                    }}
                  >
                    {expandable ? (
                      <button
                        type="button"
                        className="grid w-4 shrink-0 place-items-center text-content/40 hover:text-content focus-visible:outline-accent"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} sessions in ${label}`}
                        onClick={() => toggle(tree.path)}
                      >
                        {expanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <button
                      type="button"
                      disabled={tree.missing}
                      aria-current={selected ? "true" : undefined}
                      aria-label={`Open worktree ${label}`}
                      aria-busy={selected && switchPending}
                      title={`${label}\n${tree.branch ?? `Detached ${tree.head.slice(0, 7)}`}\n${prettyCwd(tree.path)}\n${outcome || workerStatus || progress}${checkoutNotice ? `\n${checkoutNotice}` : ""}${tree.dirty ? "\nUncommitted changes" : ""}`}
                      onClick={() =>
                        taskTree && sessions.length
                          ? onSelectSession(sessions[0].id, { project, tree })
                          : onSelectWorktree(project, tree)
                      }
                      className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left text-xs disabled:opacity-40 ${selected ? "text-content" : "text-content/65"}`}
                    >
                      <WorktreePrIcon tree={tree} enabled={enabled} taskPrUrl={taskTree ? managerTask?.prUrl ?? null : undefined} status={workerStatus || undefined} />
                      <span
                        className={`min-w-0 flex-1 ${taskTree ? "line-clamp-2 py-1 leading-4" : "truncate"} ${selected ? "font-medium" : ""}`}
                      >
                        {label}
                      </span>
                      <span className="shrink-0 text-[11px] text-content/40">
                        {tree.isMain ? "primary" : !tree.branch ? tree.head.slice(0, 7) : ""}
                      </span>
                      {!expanded && sessions.length > 1 ? (
                        <span
                          className="text-[11px] tabular-nums text-content/45"
                          title={progress}
                        >
                          {sessions.length}
                        </span>
                      ) : null}
                    </button>
                    {checkoutNotice && <span role="status" tabIndex={0} title={checkoutNotice} aria-label={checkoutNotice} className="shrink-0 rounded text-content/45 hover:text-content focus-visible:outline-accent"><CircleAlert className="size-3" /></span>}
                    {teammates.length > 0 && (
                      <div data-worktree-team className="flex min-w-0 max-w-[50%] items-center gap-1 pr-1">
                        {teammates.map(({ sessionId, task, look, name }) => (
                            <button key={sessionId} type="button" disabled={tree.missing}
                              aria-label={`Open ${name}'s session`} title={`${name} working here`}
                              onClick={() => onSelectSession(sessionId, { project, tree })}
                              className="shrink-0 rounded hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40">
                              <PixelMascot name={look?.mascot ?? task.memberMascot ?? "robot"} color={look?.color ?? task.memberColor ?? "#888"} still className="size-4" />
                            </button>
                        ))}
                        <button type="button" disabled={tree.missing}
                          onClick={() => onSelectSession(teammates[0].sessionId, { project, tree })}
                          className="truncate rounded text-[11px] text-content/65 hover:text-content focus-visible:outline-accent disabled:opacity-40">
                          {teammates.length === 1 ? `${teammates[0].name} working here` : `${teammates.length} teammates here`}
                        </button>
                      </div>
                    )}
                    <div data-worktree-metadata className="ml-auto flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden pr-1 text-[11px] text-content/50 group-hover/worktree:hidden group-focus-within/worktree:hidden group-data-[actions-open=true]/worktree:hidden [@media(hover:none)]:hidden">
                      {done ? (
                        <>
                        <span title={outcome || undefined} className={`truncate ${outcome === "Merged" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{outcome === "Closed (not merged)" ? "Closed" : outcome}</span>
                        <WorktreeDoneWarning tree={tree} enabled={enabled && !tree.missing} />
                        </>
                      ) : workerStatus || activeProgress ? (
                        <span className={`truncate ${workerStatus === "PR ready" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{workerStatus || progress}</span>
                      ) : null}
                      {!done && <WorktreeDiffStat path={tree.path} enabled={enabled && !tree.missing} showLines={!workerStatus && !activeProgress} />}
                    </div>
                    {/* Reserves room for the hover actions so in-flow items (notice, teammates) stay visible beside them. */}
                    <span aria-hidden data-worktree-actions-spacer className={`hidden shrink-0 group-hover/worktree:block group-focus-within/worktree:block group-data-[actions-open=true]/worktree:block [@media(hover:none)]:block ${openPrUrl ? "w-[5rem]" : "w-13"}`} />
                    {openPrUrl && (
                      <button
                        type="button"
                        className={`${worktreeAction} right-[3.75rem] text-emerald-500 hover:text-emerald-400`}
                        aria-label={`Open pull request for ${label}`}
                        title={`Open pull request
${openPrUrl}`}
                        onClick={() => void openUrl(openPrUrl).catch((error) => setActionError(String(error)))}
                      >
                        <GitPullRequest className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${worktreeAction} right-8`}
                      disabled={tree.missing}
                      aria-label={`New session in ${label}`}
                      title={`New session in ${label}`}
                      onClick={() => {
                        setCollapsed((current) => {
                          const next = new Set(current);
                          next.delete(key);
                          return next;
                        });
                        onNewSession(project, tree);
                      }}
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      data-worktree-menu
                      aria-label={`Actions for ${label}`}
                      aria-haspopup="menu"
                      aria-expanded={menu?.tree.path === tree.path}
                      className={`${worktreeAction} right-1`}
                      onClick={(event) => {
                        const trigger = event.currentTarget;
                        const rect = trigger.getBoundingClientRect();
                        setMenu({
                          tree,
                          x: rect.left,
                          y: rect.bottom,
                          trigger,
                        });
                      }}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </div>
                  {expanded ? (
                    <div className="ml-7">
                      {listed.map((session) => {
                        const waiting = approvalSessionIds.has(session.id);
                        const busy = !waiting && busySessionIds.has(session.id);
                        const done =
                          !waiting &&
                          !busy &&
                          unseenFinishedIds.has(session.id);
                        const status = waiting
                          ? "Needs input"
                          : busy
                            ? "Working"
                            : done
                              ? "Done"
                              : "Idle";
                        const title = sessionDisplayTitle(
                          session.title,
                          session.harness,
                        );
                        const activity = agents.get(session.id)?.activity;
                        return (
                          <div
                            key={session.id}
                            data-worktree-session={session.id}
                          >
                            <button
                              type="button"
                              disabled={tree.missing}
                              aria-label={`${title}, ${status}`}
                              aria-current={
                                session.id === activeSessionId
                                  ? "true"
                                  : undefined
                              }
                              title={
                                activity
                                  ? `${title}\n${status}: ${activity}`
                                  : `${title}\n${status}`
                              }
                              onClick={() =>
                                onSelectSession(session.id, { project, tree })
                              }
                              className={`flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left disabled:opacity-40 ${session.id === activeSessionId ? "bg-selection text-content" : "text-content/70 hover:bg-content/5"}`}
                            >
                              <HarnessIcon
                                harness={session.harness}
                                className="size-3 shrink-0 text-content/50"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs">
                                  {title}
                                </span>
                              </span>
                              {taskTree && !workerIds.has(session.id) && (
                                <span className="shrink-0 text-[11px] text-content/50">Yours</span>
                              )}
                              {waiting ? (
                                <CircleAlert className="mt-0.5 size-3 shrink-0 text-amber-400" />
                              ) : busy ? (
                                <Loader className="mt-0.5 size-3 shrink-0 animate-spin text-accent" />
                              ) : done ? (
                                <Check className="mt-0.5 size-3 shrink-0 text-emerald-400" />
                              ) : null}
                            </button>
                            {session.orchestration?.tasks.length ? (
                              <div className="px-2 pb-2">
                                <OrchestrationSidebarAgents
                                  leadId={session.id}
                                  summary={session.orchestration}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {hiddenCount > 0 || showAll.has(key) ? (
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
                          onClick={() =>
                            setShowAll((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          {hiddenCount > 0
                            ? `Show ${hiddenCount} more`
                            : "Show less"}
                        </button>
                      ) : null}
                      {!sessions.length && historyPending && !historyError ? (
                        <p className="px-2 py-1 text-[11px] text-content/45">
                          Loading sessions…
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {folded &&
                  sessions[0].orchestration?.tasks.length ? (
                    <div
                      data-worktree-session={sessions[0].id}
                      className="ml-7"
                    >
                      <OrchestrationSidebarAgents
                        leadId={sessions[0].id}
                        summary={sessions[0].orchestration}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {hiddenTrees > 0 || filteredOut > 0 || worktreeLimit > WORKTREE_PAGE ? (
        <div className="flex gap-1 px-1">
          {hiddenTrees > 0 ? (
            <button
              type="button"
              title="Worktrees are shown five at a time. The focused checkout and worktrees with sessions needing attention or unfinished Manager work stay visible."
              className="rounded-md px-2 py-1 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
              onClick={() => setWorktreeLimit((limit) => limit + WORKTREE_PAGE)}
            >
              Show {Math.min(WORKTREE_PAGE, hiddenTrees)} more
              <span className="text-content/35"> · {hiddenTrees} remaining</span>
            </button>
          ) : null}
          {filteredOut > 0 ? <span title="The active-only filter excludes worktrees without a focused checkout, sessions needing attention, dirty branch or unfinished Manager work." className="px-2 py-1 text-[11px] text-content/35">{filteredOut} inactive</span> : null}
          {worktreeLimit > WORKTREE_PAGE ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
              onClick={() => setWorktreeLimit(WORKTREE_PAGE)}
            >
              Show less
            </button>
          ) : null}
        </div>
      ) : null}
      {enabled && menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Worktree actions"
          header={
            <div className="truncate px-2 py-1 text-xs text-content/60">
              {menu.tree.branch ?? projectName(menu.tree.path)}
            </div>
          }
          items={[
            ...(taskByPath.has(pathKey(menu.tree.path)) ? [{
              kind: "item" as const,
              id: "review-manager",
              label: "Review in Manager",
              disabled: !orchestrationActions?.openManagerCard,
              description: !orchestrationActions?.openManagerCard ? "Manager review is unavailable" : undefined,
            }] : []),
            {
              kind: "item",
              id: "open",
              label: "Open worktree",
              disabled: menu.tree.missing,
              description: menu.tree.missing ? "Worktree folder is missing" : undefined,
            },
            ...(!menu.tree.isMain && onAddAsSeparateProject ? [{
              kind: "item" as const,
              id: "separate-project",
              label: "Add as separate project",
              disabled: menu.tree.missing,
              description: menu.tree.missing ? "Worktree folder is missing" : undefined,
            }] : []),
            {
              kind: "item",
              id: "new",
              label: "New session",
              disabled: menu.tree.missing,
              description: menu.tree.missing ? "Worktree folder is missing" : undefined,
              submenu: HARNESSES.filter(isHarnessAvailable).map((harness) => ({
                kind: "item",
                id: `new:${harness}`,
                label: HARNESS_TITLE[harness],
              })),
            },
            {
              kind: "item",
              id: "open-in",
              label: "Open in",
              disabled: menu.tree.missing,
              description: menu.tree.missing ? "Worktree folder is missing" : undefined,
              submenu: [
                { kind: "item", id: "reveal", label: "Explorer" },
                ...editors.map((editor) => ({
                  kind: "item" as const,
                  id: `editor:${editor.id}`,
                  label: editor.name,
                })),
                {
                  kind: "item",
                  id: "terminal",
                  label: "Terminal",
                  disabled: !onOpenTerminal,
                  description: !onOpenTerminal ? "Terminal is unavailable" : undefined,
                },
              ],
            },
            {
              kind: "item",
              id: "manager",
              label: "Give to Manager…",
              disabled:
                menu.tree.isMain || menu.tree.missing || !onGiveToManager,
              description: menu.tree.isMain ? "Primary checkout can't be given to Manager" : menu.tree.missing ? "Worktree folder is missing" : !onGiveToManager ? "Manager is unavailable" : undefined,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "pr",
              label: "Create PR",
              disabled: menu.tree.missing || !menu.tree.branch,
              description: menu.tree.missing ? "Worktree folder is missing" : !menu.tree.branch ? "No branch: this worktree is on a detached commit" : undefined,
            },
            ...worktreePullRequests(menu.tree.path, prRecords).filter(pr => pr.state === "open").map(pr => ({
              kind: "item" as const,
              id: `pr-url:${pr.url}`,
              label: `${pr.state === "open" ? pr.isDraft ? "Draft" : "Open" : pr.state === "merged" ? "Merged" : "Closed"} PR #${pr.number}: ${pr.title}`,
            })),
            ...(worktreePullRequests(menu.tree.path, prRecords).some(pr => pr.state !== "open") ? [{
              kind: "item" as const,
              id: "settled-prs",
              label: "Merged / closed PRs",
              submenu: worktreePullRequests(menu.tree.path, prRecords).filter(pr => pr.state !== "open").map(pr => ({ kind: "item" as const, id: `pr-url:${pr.url}`, label: `${pr.state === "merged" ? "Merged" : "Closed"} PR #${pr.number}: ${pr.title}` })),
            }] : []),
            { kind: "item", id: "copy-path", label: "Copy path" },
            {
              kind: "item",
              id: "copy-name",
              label: "Copy branch",
              disabled: !menu.tree.branch,
              description: !menu.tree.branch ? "No branch: this worktree is on a detached commit" : undefined,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "toggle",
              label: collapsed.has(pathKey(menu.tree.path))
                ? "Expand sessions"
                : "Collapse sessions",
            },
            { kind: "item", id: "refresh", label: "Refresh worktrees" },
            { kind: "sep" },
            {
              kind: "item",
              id: "remove",
              label: "Remove worktree…",
              danger: true,
              disabled:
                menu.tree.isMain ||
                menu.tree.locked ||
                !onRemove,
              description: menu.tree.isMain ? "Primary checkout can't be removed" : menu.tree.locked ? "Worktree is locked" : !onRemove ? "Worktree removal is unavailable" : undefined,
            },
          ]}
          onClose={closeMenu}
          onPick={(id) => {
            const tree = menu.tree;
            closeMenu();
            setActionError(undefined);
            void (async () => {
              if (id === "review-manager") {
                const task = taskByPath.get(pathKey(tree.path));
                const run = managerRuns.find((run) => run.projectManager && sameProjectPath(run.cwd, project) && run.tasks.includes(task!));
                if (run && task) orchestrationActions?.openManagerCard?.(run.leadId, task.id);
              } else if (id === "open") onSelectWorktree(project, tree);
              else if (id === "separate-project") await onAddAsSeparateProject?.(tree);
              else if (id.startsWith("new:")) {
                setCollapsed((current) => {
                  const next = new Set(current);
                  next.delete(pathKey(tree.path));
                  return next;
                });
                onNewSession(project, tree, {
                  harness: id.slice(4) as HarnessId,
                });
              } else if (id === "reveal") await revealPath(tree.path);
              else if (id.startsWith("editor:"))
                await openInExternalEditor(id.slice(7), tree.path);
              else if (id === "terminal") onOpenTerminal?.(tree.path);
              else if (id === "manager") {
                setGoal("");
                setGiving(tree);
              } else if (id === "remove" && !tree.isMain) setDeleting(tree);
              else if (id === "pr") {
                const pr = await gitPrStatus(tree.path);
                if (pr?.state === "open") await openUrl(pr.url);
                else setCreatingPr(tree);
              } else if (id.startsWith("pr-url:")) await openUrl(id.slice(7));
              else if (id === "copy-path") await copyText(tree.path);
              else if (id === "copy-name") await copyText(tree.branch ?? "");
              else if (id === "toggle") toggle(tree.path);
              else if (id === "refresh") await refresh();
            })().catch((error) => setActionError(String(error)));
          }}
        />
      ) : null}
      {deleting && onRemove && (
        <DeleteWorktreeDialog
          cwd={project}
          tree={deleting}
          sessionCount={(groups.get(pathKey(deleting.path)) ?? []).length}
          allowDeleteSessions={false}
          onOpenChanges={onOpenChanges ? () => onOpenChanges(deleting.path) : undefined}
          onRemove={(cwd, path, force) => onRemove(cwd, path, force, true)}
          onDeleteBranch={(force) =>
            invoke<void>("git_worktree_branch_remove", {
              cwd: project,
              branch: deleting.branch,
              force,
            })
          }
          onClose={() => {
            setDeleting(undefined);
            void refresh();
          }}
          onDeleted={() => {
            setDeleting(undefined);
            void refresh();
          }}
        />
      )}
      {creatingPr && (
        <WorktreeCreatePr
          tree={creatingPr}
          onClose={() => setCreatingPr(undefined)}
        />
      )}
      {giving && (
        <Modal
          title="Give to Manager"
          size="sm"
          onClose={() => {
            if (!givingBusy) setGiving(undefined);
          }}
        >
          <form
            className="space-y-3 p-4 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              if (!goal.trim() || givingBusy) return;
              setGivingBusy(true);
              setActionError(undefined);
              void onGiveToManager?.(project, giving, goal.trim())
                .then(() => setGiving(undefined))
                .catch((reason) => setActionError(String(reason)))
                .finally(() => setGivingBusy(false));
            }}
          >
            <p className="text-content/60">
              Use existing worktree: {giving.branch}
            </p>
            <label className="block">
              Task
              <textarea
                autoFocus
                required
                value={goal}
                disabled={givingBusy}
                onChange={(event) => setGoal(event.target.value)}
                className="mt-2 w-full rounded border border-stroke bg-transparent p-2"
              />
            </label>
            {actionError && (
              <p role="alert" className="text-red-400">
                {actionError}
              </p>
            )}
            <button
              type="submit"
              disabled={givingBusy || !goal.trim()}
              className="rounded bg-content/10 px-3 py-2 disabled:opacity-40"
            >
              {givingBusy ? "Sending…" : "Send to Manager"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function WorktreeCreatePr({
  tree,
  onClose,
}: {
  tree: Worktree;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(tree.branch ?? "");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    void gitDiffIndex(tree.path)
      .then((index) => {
        if (!disposed) setBase(index.defaultBranch ?? "");
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [tree.path]);
  return (
    <Modal
      title="Create pull request"
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-3 p-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(undefined);
          void (async () => {
            const existing = await gitPrStatus(tree.path);
            if (existing?.state === "open") {
              await openUrl(existing.url);
              onClose();
              return;
            }
            const index = await gitDiffIndex(tree.path);
            if (
              index.branch !== tree.branch ||
              !index.headPushed ||
              index.files.length ||
              index.branch === base.trim()
            )
              throw new Error(
                "Commit and publish this branch first, keep the checkout clean, and choose a different base. Nothing was pushed or created.",
              );
            const url = await gitPrCreate(
              tree.path,
              title.trim(),
              body,
              base.trim(),
              tree.branch!,
            );
            notifyGitChanged();
            await openUrl(url);
            onClose();
          })()
            .catch((reason) => setError(String(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <p className="text-content/60">
          {tree.branch} · Creates a PR from already-published commits. Does not
          push or merge.
        </p>
        <label className="block">
          Title
          <input
            required
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border border-stroke bg-transparent p-2"
          />
        </label>
        <label className="block">
          Base branch
          <input
            required
            value={base}
            disabled={busy}
            onChange={(e) => setBase(e.target.value)}
            className="mt-1 w-full rounded border border-stroke bg-transparent p-2"
          />
        </label>
        <label className="block">
          Description
          <textarea
            value={body}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
            className="mt-1 w-full rounded border border-stroke bg-transparent p-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !title.trim() || !base.trim()}
          className="rounded bg-content/10 px-3 py-2 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create PR"}
        </button>
      </form>
    </Modal>
  );
}

function WorktreeDoneWarning({ tree, enabled }: { tree: Worktree; enabled: boolean }) {
  const stats = useProjectDiffStats(tree.path, enabled && !!tree.dirty);
  const warnings = [
    tree.dirty
      ? `${stats?.files ? `${stats.files} changed file${stats.files === 1 ? "" : "s"}` : "Uncommitted changes"} would be lost if this worktree is removed.`
      : "",
    tree.dirty && stats?.untracked ? `${stats.untracked} untracked file${stats.untracked === 1 ? "" : "s"}.` : "",
    tree.unpushed
      ? `${tree.unpushed} unpushed commit${tree.unpushed === 1 ? "" : "s"}. Keep or push the branch before deleting it.`
      : "",
  ].filter(Boolean).join("\n");
  if (!warnings) return null;
  return (
    <span role="img" aria-label={warnings} title={warnings} className="flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
      <CircleAlert className="size-3" />
      {tree.unpushed || stats?.files || null}
    </span>
  );
}

function WorktreeDiffStat({
  path,
  enabled,
  showLines = true,
}: {
  path: string;
  enabled: boolean;
  showLines?: boolean;
}) {
  const stats = useProjectDiffStats(path, enabled);
  if (!stats) return null;
  return (
    <>
      {!!stats.untracked && stats.untracked === stats.files && (
        <span aria-label={`${stats.untracked} untracked file${stats.untracked === 1 ? "" : "s"}`} title={`${stats.untracked} untracked file${stats.untracked === 1 ? "" : "s"}`} className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">
          untracked
        </span>
      )}
      {showLines && (!!stats.additions || !!stats.deletions) && (
        <span
          aria-label={`${stats.additions} additions, ${stats.deletions} deletions`}
          className="flex shrink-0 gap-1 text-[11px] tabular-nums"
        >
          {!!stats.additions && <span className="text-diff-add-fg">+{stats.additions}</span>}
          {!!stats.deletions && <span className="text-diff-del-fg">−{stats.deletions}</span>}
        </span>
      )}
    </>
  );
}

function WorktreePrIcon({
  tree,
  enabled,
  taskPrUrl,
  status,
}: {
  tree: Worktree;
  enabled: boolean;
  taskPrUrl?: string | null;
  status?: string;
}) {
  const { prs } = usePrStatus(tree.path, tree.branch, enabled && !tree.missing);
  const open = prs.filter(pr => pr.state === "open" && (taskPrUrl === undefined || pr.url === taskPrUrl));
  const pr = open[0];
  const labels = open.map(pr => pullRequestLabel({ cwd: tree.path, pr, links: [], verifiedAt: 0 }));
  const label = !pr ? "No open PR" : labels.includes("Checks failed") ? "checks failing" : labels.includes("Conflicts") ? "merge conflicts" : labels.every(label => label === "Ready to merge") ? "PR ready" : `${open.length} open ${open.length === 1 ? "PR" : "PRs"}`;
  const Icon = pr ? pr.isDraft ? GitPullRequestDraft : GitPullRequest : GitBranch;
  return <span className="flex shrink-0 items-center gap-1" role="img" aria-label={label} title={open.map(pr => `Open PR #${pr.number}: ${pr.title}`).join("\n") || label}>
    <Icon className={`size-3 ${pr ? "text-emerald-400/90" : "text-content/45"}`} />
    {pr && label !== status && <span className="text-[10px] text-content/50">{label}</span>}
  </span>;
}
