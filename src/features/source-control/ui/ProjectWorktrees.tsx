import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { orchestrator } from "../../orchestration/model/orchestration";
import { isProjectManager, managerWorktreeStatus } from "../../orchestration/model/projectManager";
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
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";

/** Older idle sessions fold behind "Show more"; anything active stays listed. */
const SESSION_LIMIT = 5;
/** Worktrees page in this many at a time; the focused or busy ones always show. */
const WORKTREE_PAGE = 5;

type Props = {
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
  const managerRuns = useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot, orchestrator.snapshot);
  const prStatuses = usePrStatusCache();
  const focus = useWorktreeFocus(project);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [worktreeLimit, setWorktreeLimit] = useState(WORKTREE_PAGE);
  const [creating, setCreating] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyPending, setHistoryPending] = useState(true);
  const [menu, setMenu] = useState<{
    tree: Worktree;
    x: number;
    y: number;
    trigger: HTMLElement;
  }>();
  const [actionError, setActionError] = useState<string>();
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
  const focusedPath = !isProjectManager(activeSessionId ?? "") && sameProjectPath(project, currentProject)
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
  const listedTrees = trees.filter(
    (tree, index) =>
      index < worktreeLimit ||
      (!!focusedPath && sameProjectPath(focusedPath, tree.path)) ||
      !!managerWorktreeStatus(managerRuns, tree.path, undefined, prStatuses) ||
      (groups.get(pathKey(tree.path)) ?? []).some(needsAttention),
  );
  const hiddenTrees = trees.length - listedTrees.length;
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
      <div className="flex h-7 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 text-xs text-content/60">
          Worktrees
        </span>
        <button
          type="button"
          className={smallButton}
          disabled={!data || !!error}
          aria-label={`New worktree in ${projectName(project)}`}
          title="New worktree"
          onClick={() => setCreating(true)}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
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
      {listedTrees.map((tree) => {
        const key = pathKey(tree.path);
        const sessions = groups.get(key) ?? [];
        const expanded = !collapsed.has(key);
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
        const label = tree.branch ?? `Detached ${tree.head.slice(0, 7)}`;
        const workerStatus = managerWorktreeStatus(managerRuns, tree.path, approvalSessionIds, prStatuses);
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
            className={`my-1 rounded-md border border-transparent hover:border-content/15 hover:bg-content/5 focus-within:border-content/15 focus-within:bg-content/5 ${menu?.tree.path === tree.path ? "border-content/15 bg-content/5" : ""}`}
          >
            <div
              className="group/worktree relative flex h-7 items-center gap-1 rounded-md px-1"
              data-actions-open={menu?.tree.path === tree.path || undefined}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const trigger =
                  event.currentTarget.querySelector<HTMLButtonElement>(
                    "[data-worktree-menu]",
                  )!;
                setMenu({ tree, x: event.clientX, y: event.clientY, trigger });
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
              <button
                type="button"
                disabled={tree.missing}
                aria-current={selected ? "true" : undefined}
                aria-label={`Open worktree ${label}`}
                aria-busy={selected && switchPending}
                title={`${prettyCwd(tree.path)}\n${progress}${tree.dirty ? "\nUncommitted changes" : ""}`}
                onClick={() => onSelectWorktree(project, tree)}
                className={`flex h-full min-w-0 flex-1 items-center gap-2 text-left text-xs transition-[padding] duration-150 motion-reduce:transition-none group-hover/worktree:pr-14 group-focus-within/worktree:pr-14 group-data-[actions-open=true]/worktree:pr-14 [@media(hover:none)]:pr-14 disabled:opacity-40 ${selected ? "text-content" : "text-content/65"}`}
              >
                <WorktreePrIcon tree={tree} enabled={enabled} />
                <span
                  className={`min-w-0 truncate ${selected ? "font-medium" : ""}`}
                >
                  {label}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-content/40">
                  {tree.isMain ? "primary" : ""}
                </span>
                {workerStatus ? <span className="shrink-0 text-[11px] text-content/60">{workerStatus}</span> : activeProgress ? (
                  <span
                    className={`max-w-[110px] truncate text-[11px] ${sessions.some((session) => approvalSessionIds.has(session.id)) ? "text-amber-400" : "text-content/60"}`}
                  >
                    {progress}
                  </span>
                ) : !expanded && sessions.length ? (
                  <span
                    className="text-[11px] tabular-nums text-content/45"
                    title={progress}
                  >
                    {sessions.length}
                  </span>
                ) : null}
              </button>
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
                  setMenu({ tree, x: rect.left, y: rect.bottom, trigger });
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
                    !waiting && !busy && unseenFinishedIds.has(session.id);
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
                    <div key={session.id} data-worktree-session={session.id}>
                      <button
                        type="button"
                        disabled={tree.missing}
                        aria-label={`${title}, ${status}`}
                        aria-current={
                          session.id === activeSessionId ? "true" : undefined
                        }
                        title={
                          activity
                            ? `${title}\n${status}: ${activity}`
                            : `${title}\n${status}`
                        }
                        onClick={() =>
                          onSelectSession(session.id, { project, tree })
                        }
                        className={`flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left disabled:opacity-40 ${session.id === activeSessionId ? "bg-selection text-content" : "text-content/70 hover:bg-content/5"}`}
                      >
                        <HarnessIcon
                          harness={session.harness}
                          className="size-3 shrink-0 text-content/50"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs">
                            {title}
                          </span>
                          {waiting || busy || done ? (
                            <span
                              className={`block truncate text-[11px] ${waiting ? "text-amber-400" : "text-content/60"}`}
                            >
                              {waiting ? status : activity || status}
                            </span>
                          ) : null}
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
                    {hiddenCount > 0 ? `Show ${hiddenCount} more` : "Show less"}
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
      {hiddenTrees > 0 || worktreeLimit > WORKTREE_PAGE ? (
        <div className="flex gap-1 px-1">
          {hiddenTrees > 0 ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left text-[11px] text-content/50 hover:bg-content/5 hover:text-content"
              onClick={() => setWorktreeLimit((limit) => limit + WORKTREE_PAGE)}
            >
              Show {Math.min(WORKTREE_PAGE, hiddenTrees)} more worktree
              {Math.min(WORKTREE_PAGE, hiddenTrees) === 1 ? "" : "s"}
              <span className="text-content/35"> · {hiddenTrees} hidden</span>
            </button>
          ) : null}
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
            },
            {
              kind: "item",
              id: "reveal",
              label: "Reveal folder",
              disabled: menu.tree.missing,
            },
            { kind: "sep" },
            { kind: "item", id: "copy-path", label: "Copy Path" },
            { kind: "item", id: "copy-name", label: "Copy Worktree Name" },
            { kind: "sep" },
            {
              kind: "item",
              id: "toggle",
              label: collapsed.has(pathKey(menu.tree.path))
                ? "Expand sessions"
                : "Collapse sessions",
            },
            { kind: "item", id: "refresh", label: "Refresh worktrees" },
          ]}
          onClose={closeMenu}
          onPick={(id) => {
            const tree = menu.tree;
            closeMenu();
            setActionError(undefined);
            void (async () => {
              if (id === "open") onSelectWorktree(project, tree);
              else if (id === "new") {
                setCollapsed((current) => {
                  const next = new Set(current);
                  next.delete(pathKey(tree.path));
                  return next;
                });
                onNewSession(project, tree);
              } else if (id === "reveal") await revealPath(tree.path);
              else if (id === "copy-path") await copyText(tree.path);
              else if (id === "copy-name")
                await copyText(projectName(tree.path));
              else if (id === "toggle") toggle(tree.path);
              else if (id === "refresh") await refresh();
            })().catch((error) => setActionError(String(error)));
          }}
        />
      ) : null}
      {creating ? (
        <CreateWorktreeDialog
          cwd={project}
          baseCwd={focus?.path ?? project}
          defaultRoot={data?.defaultRoot}
          worktrees={data?.worktrees}
          sessionOptions
          onCancel={() => setCreating(false)}
          onCreated={async (tree, options) => {
            await refresh();
            onNewSession(project, tree, options?.session);
            if (!options?.keepOpen) setCreating(false);
          }}
        />
      ) : null}
    </div>
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
