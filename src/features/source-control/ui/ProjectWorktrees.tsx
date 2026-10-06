import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
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
import { prStatusKey } from "../hooks/usePrStatus";
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
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader,
  MoreHorizontal,
  Plus,
} from "../../../shared/ui/icons";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { usePrStatus, usePrStatusCache } from "../hooks/usePrStatus";
import { useWorktreeFocus } from "../model/worktreeFocus";
import {
  worktreeProgress,
  worktreeSessionGroups,
} from "../model/worktreeSessions";
import type { Worktree, WorktreeSessionOptions } from "../model/worktrees";

/** Older idle sessions fold behind "Show more"; anything active stays listed. */
const SESSION_LIMIT = 5;
/** Worktrees page in this many at a time; the focused or busy ones always show. */
const WORKTREE_PAGE = 5;

type Props = {
  renderManager?: (expanded: boolean, onToggle: () => void, ownedCount: number) => ReactNode;
  onRemove?: (
    cwd: string,
    path: string,
    force: boolean,
    keepSessions: boolean,
  ) => Promise<void>;
  onOpenTerminal?: (path: string) => void;
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
  renderManager,
  onRemove,
  onOpenTerminal,
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
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(false);
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
      ),
    [project, data, history, openSessions],
  );
  const agents = new Map(liveAgents.map((agent) => [agent.id, agent]));
  const trees = data?.worktrees ?? [];
  const focusedPath =
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
    managerRuns
      .filter((run) => run.projectManager && sameProjectPath(run.cwd, project))
      .flatMap((run) => run.tasks)
      .filter((task) => task.workspace)
      .map((task) => [pathKey(task.workspace!.checkoutCwd), task]),
  );
  const rank = (tree: Worktree) => {
    const task = taskByPath.get(pathKey(tree.path));
    return task ? managerQueueRank(task, taskPrStatus(task, prStatuses)) : 2;
  };
  const filteredTrees = trees.filter(
    (tree) =>
      !activeOnly ||
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
          name: "Manager queue",
          trees: listedTrees
            .filter(
              (tree) => taskByPath.has(pathKey(tree.path)) && rank(tree) !== 3,
            )
            .sort((a, b) => rank(a) - rank(b)),
          expanded: queueExpanded,
        },
        {
          name: "Done",
          trees: listedTrees.filter(
            (tree) => taskByPath.has(pathKey(tree.path)) && rank(tree) === 3,
          ),
          expanded: doneExpanded,
        },
        {
          name: "Worktrees",
          trees: listedTrees.filter(
            (tree) => !taskByPath.has(pathKey(tree.path)),
          ),
          expanded: true,
        },
      ]
    : [{ name: "Worktrees", trees: listedTrees, expanded: true }];
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
      {sections.map((section) => (
        <div
          key={section.name}
          role="group"
          aria-label={section.name}
          hidden={section.name === "Done" && !queueExpanded}
        >
          {section.name === "Manager queue" &&
            renderManager?.(queueExpanded, () => setQueueExpanded(!queueExpanded),
              trees.filter(tree => taskByPath.has(pathKey(tree.path))).length,
            )}
          {section.name === "Done" && section.trees.length > 0 && (
            <button
              type="button"
              aria-expanded={doneExpanded}
              onClick={() => setDoneExpanded(!doneExpanded)}
              className="ml-7 flex h-7 items-center gap-1 rounded px-2 text-[11px] text-content/50 hover:text-content"
            >
              {doneExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Done · {section.trees.length}
            </button>
          )}
          <div
            hidden={!section.expanded}
            className={
              section.name === "Worktrees"
                ? ""
                : "ml-7 border-l border-content/10 pl-1"
            }
          >
            {section.trees.map((tree) => {
              const key = pathKey(tree.path);
              const sessions = groups.get(key) ?? [];
              const expanded = sessions.length > 1 && !collapsed.has(key);
              const listed = showAll.has(key)
                ? sessions
                : sessions.filter(
                    (session, index) =>
                      index < SESSION_LIMIT || needsAttention(session),
                  );
              const hiddenCount = sessions.length - listed.length;
              const selected =
                !!focusedPath &&
                sameProjectPath(focus?.path ?? project, tree.path);
              const managerTask = [...managerRuns]
                .reverse()
                .filter((run) => run.projectManager)
                .flatMap((run) => [...run.tasks].reverse())
                .find(
                  (task) =>
                    task.workspace &&
                    pathKey(task.workspace.checkoutCwd) === key,
                );
              const label =
                managerTask?.title ??
                tree.branch ??
                `Detached ${tree.head.slice(0, 7)}`;
              const workerStatus = managerWorktreeStatus(
                managerRuns,
                tree.path,
                approvalSessionIds,
                prStatuses,
              );
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
                  className={`my-1 rounded-md border border-transparent hover:border-content/15 hover:bg-content/5 focus-within:border-content/15 focus-within:bg-content/5 ${sessions.length === 1 && sessions[0].id === activeSessionId ? "bg-selection" : ""} ${menu?.tree.path === tree.path ? "border-content/15 bg-content/5" : ""}`}
                >
                  <div
                    className="group/worktree relative flex h-7 items-center gap-1 rounded-md"
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
                    {sessions.length > 1 ? (
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
                      title={`${label}\n${tree.branch ?? "Detached"}\n${prettyCwd(tree.path)}\n${workerStatus || progress}${tree.dirty ? "\nUncommitted changes" : ""}`}
                      onClick={() =>
                        sessions.length === 1
                          ? onSelectSession(sessions[0].id, { project, tree })
                          : onSelectWorktree(project, tree)
                      }
                      className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left text-xs transition-[padding] duration-150 motion-reduce:transition-none group-hover/worktree:pr-14 group-focus-within/worktree:pr-14 group-data-[actions-open=true]/worktree:pr-14 [@media(hover:none)]:pr-14 disabled:opacity-40 ${selected ? "text-content" : "text-content/65"}`}
                    >
                      <WorktreePrIcon tree={tree} enabled={enabled} />
                      <span
                        className={`min-w-0 truncate ${selected ? "font-medium" : ""}`}
                      >
                        {label}
                      </span>
                      <span className="shrink-0 text-[11px] text-content/40">
                        {tree.isMain ? "primary" : ""}
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
                    <div data-worktree-metadata className="ml-auto flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden pr-1 text-[11px] text-content/50 group-hover/worktree:hidden group-focus-within/worktree:hidden group-data-[actions-open=true]/worktree:hidden [@media(hover:none)]:hidden">
                      {workerStatus || activeProgress ? (
                        <span className={`truncate ${workerStatus === "PR ready" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{workerStatus || progress}</span>
                      ) : <WorktreeDiffStat path={tree.path} enabled={enabled && !tree.missing} />}
                    </div>
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
                  {sessions.length === 1 &&
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
      {hiddenTrees > 0 || filteredOut > 0 || worktreeLimit > WORKTREE_PAGE ? (
        <div className="flex gap-1 px-1">
          {hiddenTrees > 0 ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
              onClick={() => setWorktreeLimit((limit) => limit + WORKTREE_PAGE)}
            >
              Show {Math.min(WORKTREE_PAGE, hiddenTrees)} more
              <span className="text-content/35"> · {hiddenTrees} hidden</span>
            </button>
          ) : null}
          {filteredOut > 0 ? <span className="px-2 py-1 text-[11px] text-content/35">{filteredOut} filtered out</span> : null}
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
            }] : []),
            {
              kind: "item",
              id: "open",
              label: "Open worktree",
              disabled: menu.tree.missing,
            },
            {
              kind: "item",
              id: "new",
              label: "New session",
              disabled: menu.tree.missing,
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
                },
              ],
            },
            {
              kind: "item",
              id: "manager",
              label: "Give to Manager…",
              disabled:
                menu.tree.isMain || menu.tree.missing || !onGiveToManager,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "pr",
              label:
                prStatuses.get(prStatusKey(menu.tree.path, menu.tree.branch))
                  ?.state === "open"
                  ? "Open PR"
                  : "Create PR",
              disabled: menu.tree.missing || !menu.tree.branch,
            },
            { kind: "item", id: "copy-path", label: "Copy path" },
            {
              kind: "item",
              id: "copy-name",
              label: "Copy branch",
              disabled: !menu.tree.branch,
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
                !menu.tree.branch ||
                !onRemove,
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
                const pr = prStatuses.get(prStatusKey(tree.path, tree.branch));
                if (pr?.state === "open") await openUrl(pr.url);
                else setCreatingPr(tree);
              } else if (id === "copy-path") await copyText(tree.path);
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
          onRemove={(cwd, path, force) => onRemove(cwd, path, force, true)}
          onDeleteBranch={() =>
            invoke<void>("git_worktree_branch_remove", {
              cwd: project,
              branch: deleting.branch,
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

function WorktreeDiffStat({
  path,
  enabled,
}: {
  path: string;
  enabled: boolean;
}) {
  const stats = useProjectDiffStats(path, enabled);
  if (!stats || (!stats.additions && !stats.deletions)) return null;
  return (
    <span
      aria-label={`${stats.additions} additions, ${stats.deletions} deletions`}
      className="flex shrink-0 gap-1 text-[11px] tabular-nums"
    >
      {!!stats.additions && <span className="text-diff-add-fg">+{stats.additions}</span>}
      {!!stats.deletions && <span className="text-diff-del-fg">−{stats.deletions}</span>}
    </span>
  );
}

function WorktreePrIcon({
  tree,
  enabled,
}: {
  tree: Worktree;
  enabled: boolean;
}) {
  const { pr } = usePrStatus(tree.path, tree.branch, enabled && !tree.missing);
  const mark =
    pr?.state === "merged"
      ? { Icon: GitMerge, color: "text-violet-400/90", label: "Merged" }
      : pr?.state === "closed"
        ? {
            Icon: GitPullRequestClosed,
            color: "text-rose-400/90",
            label: "Closed",
          }
        : pr?.state === "open"
          ? pr.isDraft
            ? {
                Icon: GitPullRequestDraft,
                color: "text-content/50",
                label: "Draft",
              }
            : {
                Icon: GitPullRequest,
                color: "text-emerald-400/90",
                label: "Open",
              }
          : {
              Icon: GitBranch,
              color: "text-content/45",
              label: "No PR status available",
            };
  const label = pr ? `${mark.label} PR #${pr.number}: ${pr.title}` : mark.label;
  return (
    <span className="flex shrink-0" role="img" aria-label={label} title={label}>
      <mark.Icon className={`size-3 ${mark.color}`} />
    </span>
  );
}
