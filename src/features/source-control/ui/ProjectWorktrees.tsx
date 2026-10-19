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
import { cardSessionsSnapshot, subscribeCardSessions } from "../../monos/model/monoCards";
import { agentLiveStateLabel, agentLiveStateTooltip, selectAgentLiveState } from "../../agents/model/agentLiveState";
import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import { AgentDetailTooltip } from "../../agents/ui/AgentDetailTooltip";
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
import { isEqualOrInside, pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
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
import { useWorktreeRemovalTasks } from "../model/worktreeRemovalTasks";
import { useProjectExpansion } from "../../projects/hooks/useProjectExpansion";
import { readFlag, writeFlag } from "../../settings/model/storageFlags";
import "./ProjectWorktrees.css";

/** Older idle sessions fold behind "Show more"; anything active stays listed. */
const SESSION_LIMIT = 5;
/** History pages in this many at a time; current work always stays listed. */
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
    workspace: { project: string; tree: Worktree; orphaned?: boolean },
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
  const removalTasks = useWorktreeRemovalTasks();
  const orchestrationActions = useContext(OrchestrationActions);
  const managerRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const prStatuses = usePrStatusCache();
  const prRecords = usePullRequests();
  const focus = useWorktreeFocus(project);
  const cardSessions = useSyncExternalStore(subscribeCardSessions, cardSessionsSnapshot, cardSessionsSnapshot);
  const [sessionExpansion, setSessionExpansion] = useState<Map<string, boolean>>(() => new Map());
  const [focusedTreePath, setFocusedTreePath] = useState<string>();
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [historyPage, setHistoryPage] = useState(0);
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
  const [doneExpanded, setDoneExpanded] = useProjectExpansion(project, "finished-worktrees", false);
  const [activeOnly, setActiveOnly] = useActiveWorktrees(project);
  useEffect(() => setHistoryPage(0), [project]);
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
    if (menu && removalTasks.some(task => task.pending && pathKey(task.path) === pathKey(menu.tree.path))) setMenu(undefined);
  }, [menu, removalTasks]);
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
  const selectSession = (sessionId: string, tree: Worktree) => {
    const session = known.get(sessionId);
    onSelectSession(sessionId, { project, tree,
      // A removed session checkout now runs in its retained parent.
      ...(session?.worktreeCwd && !trees.some(entry => isEqualOrInside(session.worktreeCwd!, entry.path))
        ? { orphaned: true } : {}),
    });
  };
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
  const needsAttentionId = (id: string) => {
    const state = cardSessions.get(id)?.liveState;
    const agent = agents.get(id);
    return !!id && (id === activeSessionId || approvalSessionIds.has(id) || busySessionIds.has(id) ||
      unseenFinishedIds.has(id) || !!(agent && (!agent.done || agent.needsApproval)) ||
      !!(state && state.status !== "idle" && state.status !== "done"));
  };
  const openIds = new Set(openSessions.map(session => session.id));
  const needsAttention = (session: SessionSummary) =>
    needsAttentionId(session.id) || session.pinned || session.draft ||
    session.orchestration?.tasks.some(
      (task) =>
        task.needsInput ||
        !["completed", "cancelled"].includes(task.status),
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
  const currentPaths = new Set(trees.filter(tree => {
    const key = pathKey(tree.path);
    return tree.isMain || tree.dirty || (tree.unpushed ?? 0) > 0 || tree.missing ||
      key === focusedTreePath ||
      (!!focusedPath && sameProjectPath(focusedPath, tree.path)) ||
      removalTasks.some(task => pathKey(task.path) === key && task.pending) ||
      (groups.get(key) ?? []).some(session => needsAttention(session) || openIds.has(session.id)) ||
      (workers.get(key) ?? []).some(({ sessionId, task }) => needsAttentionId(sessionId) ||
        managerQueueRank(task, taskPrStatus(task, prStatuses)) !== 3);
  }).map(tree => pathKey(tree.path)));
  const listedTrees = trees.filter(tree => currentPaths.has(pathKey(tree.path)));
  const historicalTrees = trees.filter(tree => !currentPaths.has(pathKey(tree.path)));
  const historyExpanded = doneExpanded && !activeOnly;
  const historyPages = Math.max(1, Math.ceil(historicalTrees.length / WORKTREE_PAGE));
  const page = Math.min(historyPage, historyPages - 1);
  const historyTrees = activeOnly ? [] : historicalTrees.slice(page * WORKTREE_PAGE, (page + 1) * WORKTREE_PAGE);
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
            { name: "Retained task worktrees", trees: listedTrees.filter(tree => taskByPath.has(pathKey(tree.path)) && rank(tree) === 3), expanded: true },
          ],
          expanded: true,
        },
      ]
    : [{ name: "Your worktrees", groups: [{ name: "Your worktrees", trees: listedTrees, expanded: true }], expanded: true }];
  if (historicalTrees.length) sections.push({ name: "History", groups: [{ name: "History", trees: historyTrees, expanded: true }], expanded: historyExpanded });
  const expansionKey = (path: string) => `monocode:worktree-sessions-expanded:${pathKey(project)}:${pathKey(path)}`;
  const sessionsExpanded = (path: string) => sessionExpansion.get(expansionKey(path)) ?? readFlag(expansionKey(path)) ?? true;
  const setSessionsExpanded = (path: string, expanded: boolean) => {
    const key = expansionKey(path);
    writeFlag(key, expanded);
    setSessionExpansion(current => new Map(current).set(key, expanded));
  };
  const toggle = (path: string) => setSessionsExpanded(path, !sessionsExpanded(path));
  const smallButton =
    "grid size-6 shrink-0 place-items-center rounded-md text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-40";
  const worktreeAction = `${smallButton} absolute top-1/2 -translate-y-1/2 pointer-events-none opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/worktree:pointer-events-auto group-hover/worktree:opacity-100 group-focus-within/worktree:pointer-events-auto group-focus-within/worktree:opacity-100 group-data-[actions-open=true]/worktree:pointer-events-auto group-data-[actions-open=true]/worktree:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 @max-[180px]/sidebar:static @max-[180px]/sidebar:translate-y-0 @max-[180px]/sidebar:pointer-events-auto @max-[180px]/sidebar:opacity-100`;
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
      {renderManager?.(true, () => {},
        trees.filter(tree => taskByPath.has(pathKey(tree.path))).length,
      )}
      {trees.length > 0 && <div className="mb-1 mt-2 px-2">
        <p className="mb-1.5 flex items-center justify-between text-[11px] text-content/75">Worktrees <span className="tabular-nums">{trees.length}</span></p>
        <div role="group" aria-label="Worktree filter" className="flex w-fit gap-0.5 rounded-md bg-content/5 p-0.5"
          onKeyDown={event => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              const all = event.key === "ArrowRight";
              setDoneExpanded(all);
              setActiveOnly(!all);
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[all ? 1 : 0]?.focus();
            }
          }}>
          {[false, true].map(all => <button key={String(all)} type="button" data-sidebar-row aria-pressed={historyExpanded === all}
            onClick={() => { setDoneExpanded(all); setActiveOnly(!all); }}
            className="rounded px-2 py-1 text-[11px] text-content/75 aria-pressed:bg-background-base aria-pressed:text-content hover:text-content focus-visible:outline-accent">{all ? "All" : "Active"}</button>)}
        </div>
      </div>}
      {sections.map((section) => (
        <div
          key={section.name}
          role="group"
          aria-label={section.name}
        >
          {section.name === "Task worktrees" ? (
            <p
              title={section.groups.map(group => `${group.trees.length} ${group.name === "Retained task worktrees" ? "retained" : "active"}`).join(" · ")}
              className="mt-1 flex min-h-7 items-center px-2 text-[11px] text-content/75"
            >
              Task worktrees · {section.groups[0].trees.length} active{section.groups[1].trees.length ? ` · ${section.groups[1].trees.length} retained` : ""}
            </p>
          ) : section.name === "History" ? (
            historyExpanded && <p className="mt-1 flex h-7 items-center px-5 text-[11px] text-content/75">Earlier work · {historicalTrees.length}</p>
          ) : <p className="mt-1 flex h-7 items-center px-5 text-[11px] text-content/70">Your worktrees</p>}
          <div
            data-worktree-group-list
            hidden={!section.expanded}
            className={
              section.name !== "History"
                ? ""
                : "ml-3 pl-1"
            }
          >
            {section.groups.map(group => (
              <div key={group.name}>
                <div hidden={!group.expanded}>
            {group.trees.map((tree) => {
              const key = pathKey(tree.path);
              const removing = removalTasks.some(task => pathKey(task.path) === key && task.pending);
              const userSessions = groups.get(key) ?? [];
              const taskTree = !!renderManager && taskByPath.has(key);
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
              const expandable = !taskTree && sessions.length > 0;
              const expanded = expandable && sessionsExpanded(tree.path);
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
                !(sessions.some(session => session.id === activeSessionId) && !taskTree) &&
                sameProjectPath(focus?.path ?? project, tree.path);
              const managerTask = taskByPath.get(key);
              const checkoutNotice = orchestrator.checkoutNotice("", { cwd: tree.path });
              const label =
                managerTask?.title ??
                tree.branch ??
                sessions.find((session) => session.title.trim())?.title ??
                tree.headSubject ??
                "Detached worktree";
              const done = !!managerTask && rank(tree) === 3;
              const outcome = managerTask && managerTaskOutcome(managerTask, taskPrStatus(managerTask, prStatuses));
              const workerStatus = taskTree && managerWorktreeStatus(
                managerRuns,
                tree.path,
                approvalSessionIds,
                prStatuses,
              );
              const liveState = [...sessions.map(session => session.id), ...workerSessions.map(worker => worker.sessionId)]
                .map(id => cardSessions.get(id)?.liveState)
                .find(state => state && state.status !== "idle" && state.status !== "done");
              const taskState = liveState ?? (sessions.some(session => approvalSessionIds.has(session.id))
                ? { status: "needs-you" as const, reason: "approval" as const, detail: "Waiting for user input" }
                : selectAgentLiveState({ blocks: [], busy: sessions.some(session => busySessionIds.has(session.id)) }, { task: managerTask }));
              const member = managerTask?.memberId ? findMono(managerTask.memberId) : undefined;
              const memberName = member ? monoLook(member).name : managerTask?.memberName ?? "Unassigned";
              const unread = taskTree && sessions.some(session => unseenFinishedIds.has(session.id));
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
              const taskStatus = tree.missing ? "Missing folder"
                : liveState || !["idle", "done"].includes(taskState.status) ? agentLiveStateLabel(taskState) : outcome || workerStatus || agentLiveStateLabel(taskState);
              const rowDetail = `${label}\n${tree.branch ?? `Detached ${tree.head.slice(0, 7)}`}\n${prettyCwd(tree.path)}\n${taskTree ? `${memberName} · ${taskStatus}\n${agentLiveStateTooltip(taskState)}` : liveState ? agentLiveStateTooltip(liveState) : outcome || workerStatus || progress}${checkoutNotice ? `\n${checkoutNotice}` : ""}${tree.dirty ? "\nUncommitted changes" : ""}`;
              return (
                <div
                  key={key}
                  data-worktree={tree.path}
                  data-task-worktree={taskTree || undefined}
                  onFocusCapture={() => { if (section.name !== "History") setFocusedTreePath(key); }}
                  onBlurCapture={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedTreePath(undefined);
                  }}
                  inert={removing || undefined}
                  aria-busy={removing || undefined}
                  className={`my-1 rounded-md border border-transparent hover:border-content/15 hover:bg-content/5 focus-within:border-content/15 focus-within:bg-content/5 ${taskTree && sessions.some(session => session.id === activeSessionId) ? "bg-selection" : ""} ${menu?.tree.path === tree.path ? "border-content/15 bg-content/5" : ""}`}
                >
                  <div
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
                  <div
                    data-worktree-header
                    className={`group/worktree relative flex ${taskTree ? "h-10" : "h-7"} items-center gap-1 rounded-md @max-[180px]/sidebar:h-auto @max-[180px]/sidebar:flex-wrap`}
                    data-actions-open={menu?.tree.path === tree.path || undefined}
                  >
                    {expandable ? (
                      <button
                        type="button"
                        data-sidebar-row
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
                    ) : !taskTree ? (
                      <span className="w-4 shrink-0" />
                    ) : null}
                    <AgentDetailTooltip detail={taskTree ? rowDetail : liveState && agentLiveStateTooltip(liveState)}>
                    <button
                      type="button"
                      data-sidebar-row
                      disabled={tree.missing || removing}
                      aria-current={selected || taskTree && sessions.some(session => session.id === activeSessionId) ? "true" : undefined}
                      aria-expanded={expandable ? expanded : undefined}
                      aria-label={`Open worktree ${label}`}
                      aria-busy={selected && switchPending}
                      title={rowDetail}
                      // A row with sessions to list only shows or hides them.
                      onClick={() =>
                        expandable
                          ? toggle(tree.path)
                          : taskTree && sessions.length
                            ? selectSession(sessions.find(session => session.id === activeSessionId)?.id ?? sessions[0].id, tree)
                            : onSelectWorktree(project, tree)
                      }
                      className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left text-xs @max-[180px]/sidebar:min-h-7 @max-[180px]/sidebar:flex-[1_1_calc(100%_-_20px)] ${removing ? "disabled:opacity-70" : "disabled:opacity-40"} ${selected ? "text-content" : "text-content/70"}`}
                    >
                      {taskTree ? <>
                        <span data-agent-state={taskState.status} className="agent-state" aria-label={agentLiveStateLabel(taskState)}><span aria-hidden="true" className="agent-state-cue" /></span>
                        <span className="min-w-0 flex-1 py-2">
                          <span data-worktree-label className="block truncate text-[11px] font-medium leading-4">{label}</span>
                          <span data-worktree-summary className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-content/70">
                            <span data-worktree-member className="max-w-full break-words rounded border border-stroke px-1 py-px text-[9px] text-content">{memberName}</span>
                            <span data-worktree-metadata className="flex min-w-0 items-center gap-1">
                              <span className="break-words" title={outcome || undefined}>{taskStatus}</span>
                              {done ? <WorktreeDoneWarning tree={tree} enabled={enabled && !tree.missing} /> : null}
                            </span>
                            <WorktreePrIcon tree={tree} enabled={enabled} taskPrUrl={managerTask?.prUrl ?? null} status={workerStatus || undefined} />
                            {tree.dirty && <span data-worktree-dirty title="Uncommitted changes" className="shrink-0 text-amber-700 dark:text-amber-400">Changes</span>}
                            {unread && <span data-worktree-unread className="shrink-0 text-accent">New reply</span>}
                          </span>
                          {removing && <span className="block text-[10px] text-content/70">Deleting…</span>}
                        </span>
                      </> : <>
                      <WorktreePrIcon tree={tree} enabled={enabled} taskPrUrl={taskTree ? managerTask?.prUrl ?? null : undefined} status={workerStatus || undefined} />
                      <span
                        data-worktree-label
                        className={`min-w-4 flex-1 truncate ${selected ? "font-medium" : ""}`}
                      >
                        {label}
                      </span>
                      <span data-worktree-badge className="min-w-0 truncate text-[11px] text-content/70">
                        {removing ? <span className="inline-flex items-center gap-1.5 rounded-full bg-content/10 px-2 py-0.5 text-[10px] font-medium text-content/80"><Loader className="size-3 animate-spin motion-reduce:animate-none" />Deleting…</span> : tree.isMain ? "primary" : !tree.branch ? tree.head.slice(0, 7) : ""}
                      </span>
                      {!expanded && sessions.length > 1 ? (
                        <span
                          className="text-[11px] tabular-nums text-content/70"
                          title={progress}
                        >
                          {sessions.length}
                        </span>
                      ) : null}
                      </>}
                    </button>
                    </AgentDetailTooltip>
                    {checkoutNotice && <span role="status" tabIndex={0} title={checkoutNotice} aria-label={checkoutNotice} className="shrink-0 rounded text-content/45 hover:text-content focus-visible:outline-accent"><CircleAlert className="size-3" /></span>}
                    {!taskTree && <div data-worktree-metadata className="ml-auto flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden pr-1 text-[11px] text-content/70 group-hover/worktree:hidden group-focus-within/worktree:hidden group-data-[actions-open=true]/worktree:hidden [@media(hover:none)]:hidden @max-[180px]/sidebar:hidden!">
                      {liveState ? <AgentStatusLabel state={liveState} className="truncate text-content/70" /> : done ? (
                        <>
                        <span title={outcome || undefined} className={`truncate ${outcome === "Merged" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{outcome === "Closed (not merged)" ? "Closed" : outcome}</span>
                        <WorktreeDoneWarning tree={tree} enabled={enabled && !tree.missing} />
                        </>
                      ) : workerStatus || activeProgress ? (
                        <span className={`truncate ${workerStatus === "PR ready" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{workerStatus || progress}</span>
                      ) : null}
                      {!done && <WorktreeDiffStat path={tree.path} enabled={enabled && !tree.missing} showLines={!workerStatus && !activeProgress} />}
                    </div>}
                    <div data-worktree-actions className="contents @max-[180px]/sidebar:flex @max-[180px]/sidebar:basis-full @max-[180px]/sidebar:justify-end @max-[180px]/sidebar:gap-1 @max-[180px]/sidebar:pb-1">
                    {/* Reserves room for the hover actions beside the branch and badges. */}
                    <span aria-hidden data-worktree-actions-spacer className={`hidden shrink-0 group-hover/worktree:block group-focus-within/worktree:block group-data-[actions-open=true]/worktree:block [@media(hover:none)]:block @max-[180px]/sidebar:hidden! ${openPrUrl ? "w-[5rem]" : "w-13"}`} />
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
                        setSessionsExpanded(tree.path, true);
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
                  </div>
                  {teammates.length > 0 && (
                    <div data-worktree-team className="ml-7 mr-1 flex min-w-0 flex-wrap items-center gap-1 pb-1">
                      {teammates.map(({ sessionId, task, look, name }) => (
                        <button key={sessionId} type="button" disabled={tree.missing}
                          aria-label={`Open ${name}'s session`} title={`${name} working here`}
                          onClick={() => onSelectSession(sessionId, { project, tree })}
                          className="shrink-0 rounded hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40">
                          <PixelMascot name={look?.mascot ?? task.memberMascot ?? "robot"} color={look?.color ?? task.memberColor ?? "#888"} still className="size-4" />
                        </button>
                      ))}
                      <button type="button" disabled={tree.missing}
                        title={teammates.length === 1 ? `${teammates[0].name} working here` : `${teammates.length} teammates here`}
                        onClick={() => onSelectSession(teammates[0].sessionId, { project, tree })}
                        className="min-w-0 flex-1 truncate rounded text-left text-[11px] text-content/70 hover:text-content focus-visible:outline-accent disabled:opacity-40">
                        {teammates.length === 1 ? `${teammates[0].name} working here` : `${teammates.length} teammates here`}
                      </button>
                    </div>
                  )}
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
                        const state = cardSessions.get(session.id)?.liveState ?? selectAgentLiveState({
                          blocks: waiting ? [{ id: "approval", role: "approval", text: "", approval: { requestId: 0 } }] : [],
                          busy: busySessionIds.has(session.id),
                        }, {
                          task: workerSessions.find(worker => worker.sessionId === session.id)?.task,
                        });
                        const status = agentLiveStateLabel(state);
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
                            <AgentDetailTooltip detail={state.status !== "idle" ? agentLiveStateTooltip(state) : undefined}>
                            <button
                              type="button"
                              data-sidebar-row
                              disabled={tree.missing}
                              aria-label={`${title}, ${status}`}
                              aria-current={
                                session.id === activeSessionId
                                  ? "true"
                                  : undefined
                              }
                              title={
                                activity
                                  ? `${title}\n${agentLiveStateTooltip(state)}: ${activity}`
                                  : `${title}\n${agentLiveStateTooltip(state)}`
                              }
                              onClick={() => selectSession(session.id, tree)}
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
                                <span className="shrink-0 text-[11px] text-content/70">Yours</span>
                              )}
                              {state.status !== "idle" && <AgentStatusLabel state={state} className="shrink-0 text-[10px] text-content/70" />}
                              {waiting ? (
                                <CircleAlert className="mt-0.5 size-3 shrink-0 text-amber-400" />
                              ) : busy ? (
                                <Loader className="mt-0.5 size-3 shrink-0 animate-spin text-accent" />
                              ) : done ? (
                                <Check className="mt-0.5 size-3 shrink-0 text-emerald-400" />
                              ) : null}
                            </button>
                            </AgentDetailTooltip>
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
                          className="w-full rounded-md px-2 py-1 text-left text-[11px] text-content/70 hover:bg-content/5 hover:text-content"
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
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {historyExpanded && historyPages > 1 ? (
        <div aria-label="Worktree pages" className="mt-1 flex items-center justify-between px-2 text-[11px] text-content/75">
          <button type="button" data-sidebar-row aria-label="Previous worktree page" disabled={page === 0} className={smallButton} onClick={() => setHistoryPage(page - 1)}>←</button>
          <span className="tabular-nums">{page + 1} / {historyPages}</span>
          <button type="button" data-sidebar-row aria-label="Next worktree page" disabled={page === historyPages - 1} className={smallButton} onClick={() => setHistoryPage(page + 1)}>→</button>
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
            ...(taskByPath.has(pathKey(menu.tree.path)) ? [{
              kind: "item" as const,
              id: "sessions",
              label: "Conversations",
              disabled: menu.tree.missing,
              submenu: [
                ...(workers.get(pathKey(menu.tree.path)) ?? []).map(({ sessionId, task, startedAt }) => ({ kind: "item" as const, id: `session:${sessionId}`, label: `${known.get(sessionId)?.title || task.title} · ${sessionId === task.sessionId ? "Latest worker" : "Earlier worker"}${startedAt ? ` · ${new Date(startedAt).toLocaleString()}` : ""}` })),
                ...(groups.get(pathKey(menu.tree.path)) ?? []).filter(session => !(workers.get(pathKey(menu.tree.path)) ?? []).some(worker => worker.sessionId === session.id)).map(session => ({ kind: "item" as const, id: `session:${session.id}`, label: `Yours · ${sessionDisplayTitle(session.title, session.harness)}` })),
              ],
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
            ...(!taskByPath.has(pathKey(menu.tree.path)) ? [{
              kind: "item" as const,
              id: "toggle",
              label: sessionsExpanded(menu.tree.path) ? "Collapse sessions" : "Expand sessions",
            }] : []),
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
              } else if (id.startsWith("session:")) selectSession(id.slice(8), tree);
              else if (id === "open") onSelectWorktree(project, tree);
              else if (id === "separate-project") await onAddAsSeparateProject?.(tree);
              else if (id.startsWith("new:")) {
                setSessionsExpanded(tree.path, true);
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
            setDeleting(current => current?.path === deleting.path ? undefined : current);
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

export function WorktreeCreatePr({
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
    {pr && label !== status && <span className="text-[10px] text-content/50 @max-[240px]/sidebar:hidden">{label}</span>}
  </span>;
}
