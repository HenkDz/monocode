import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { findMono, monoLook, type Mono } from "../model/mono";
import { memberTasks } from "../model/monoNavigation";
import { orchestrator } from "../../orchestration/model/orchestration";
import {
  managerTaskLifecycle,
  managerQueueRank,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { projectName } from "../../../shared/lib/paths";
import {
  cardSession,
  openCardSession,
  subscribeCardSessions,
} from "../model/monoCards";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";
import { Modal } from "../../../shared/ui/Modal";
import { selectAgentLiveState } from "../../agents/model/agentLiveState";
import {
  TaskMetricsLine,
  taskMetricsDetail,
} from "../../agents/ui/TaskMetricsLine";
import { AgentDetailTooltip } from "../../agents/ui/AgentDetailTooltip";
import { selectTaskMetrics } from "../../agents/model/agentMetrics";
import { MonoActivityTrail } from "../../sessions/ui/AgentTranscript";
import { TranscriptError } from "../../sessions/ui/TranscriptError";
import { transcriptError } from "../../sessions/model/transcriptError";
import { presentationText } from "../../sessions/model/transcriptPresentation";
import {
  memberActivityEvents,
  type ActivityFilter,
} from "../model/memberActivity";

/** Task snapshots are the durable work log; never copy streaming worker prose into another session. */
export function MemberWorkLog({
  member,
  activity,
}: {
  member: Mono;
  activity?: {
    filter: ActivityFilter;
    trail: ComponentProps<typeof MonoActivityTrail>;
  };
}) {
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const statuses = usePrStatusCache();
  const actions = useContext(OrchestrationActions);
  const [openedTask, setOpenedTask] = useState<{
    id: string;
    leadId?: string;
  }>();
  const [pendingTask, setPendingTask] = useState<string>();
  const [actionError, setActionError] = useState<{
    memberId: string;
    message: string;
  }>();
  const [filter, setFilter] = useState<"current" | "history" | "all">(
    "current",
  );
  const [page, setPage] = useState(0);
  const [activityLimit, setActivityLimit] = useState(80);
  useEffect(() => setActivityLimit(80), [member.id, activity?.filter]);
  const panelId = useId();
  const taskToggleRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setFilter("current");
    setPage(0);
    setOpenedTask(undefined);
    setActionError(undefined);
  }, [member.id]);
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [filter, page]);
  const [, refresh] = useState(0);
  useEffect(
    () => subscribeCardSessions(() => refresh((value) => value + 1)),
    [],
  );
  const taskRuns = new Map(
    runs.flatMap((run) => run.tasks.map((task) => [task, run] as const)),
  );
  const tasks = memberTasks(runs, member.id)
    .map((task) => {
      const run = taskRuns.get(task);
      const session = cardSession(task.sessionId);
      const needsYou =
        !["completed", "cancelled", "failed"].includes(task.status) &&
        !!session?.needsInput;
      const pr = taskPrStatus(task, statuses);
      const rank = managerQueueRank(task, pr);
      const live =
        ["running", "cancelling"].includes(task.status) ||
        (["queued", "blocked", "interrupted"].includes(task.status) &&
          ["blocked", "queued", "needs-you"].includes(
            session?.liveState?.status ?? "",
          ));
      let state =
        (live &&
        !["idle", "done", "waiting-review", "waiting-on-member"].includes(
          session?.liveState?.status ?? "",
        )
          ? session?.liveState
          : undefined) ??
        selectAgentLiveState(undefined, {
          task:
            task.status === "completed"
              ? {
                  ...task,
                  accepted:
                    task.accepted &&
                    !!task.lastDispatchId &&
                    task.acceptedDispatchId === task.lastDispatchId,
                }
              : task,
          tasks: run?.tasks,
          runStatus: run?.status,
          pauseReason: run?.lastPauseReason ?? run?.error,
        });
      if (needsYou && !["needs-you", "blocked"].includes(state.status))
        state = {
          status: "needs-you",
          reason: "decision",
          detail: "Waiting for your decision",
        };
      if (
        task.error &&
        ["failed", "blocked", "interrupted"].includes(task.status)
      )
        state = { ...state, detail: transcriptError(task.error).title };
      return {
        task,
        run,
        needsYou,
        pr,
        state,
        session,
        rank: rank === 3 ? 3 : needsYou ? 0 : rank,
        links: [
          { id: task.reportArtifactId, label: "Report" },
          {
            id: task.reviewArtifactId ?? task.reviewVerdict?.artifactId,
            label: "Review",
          },
          { id: task.prSummaryArtifactId, label: "PR summary" },
        ],
      };
    })
    .sort((a, b) => a.rank - b.rank);
  const current = tasks.filter(({ rank }) => rank !== 3);
  const history = tasks.filter(({ rank }) => rank === 3);
  const filtered =
    filter === "current" ? current : filter === "history" ? history : tasks;
  const pageCount = Math.max(1, Math.ceil(filtered.length / 5));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleTasks = filtered.slice(visiblePage * 5, visiblePage * 5 + 5);
  const attention = tasks.filter(({ rank }) => rank === 0).length;
  const manager = findMono(member.reportsTo ?? ""),
    look = manager && monoLook(manager);
  const button =
    "rounded-md px-2.5 py-1.5 hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40";
  const renderTask = ({
    task,
    needsYou,
    pr,
    run,
    state,
    session,
    links,
  }: (typeof tasks)[number]) => {
    const [label] = managerTaskLifecycle(task, pr, needsYou);
    const dispatch = run?.dispatches?.find(
      (dispatch) =>
        dispatch.id === (task.activeDispatchId ?? task.lastDispatchId),
    );
    const at = dispatch?.updatedAt ?? dispatch?.startedAt ?? task.prReadyAt;
    const metrics =
      session?.taskMetrics?.[task.id] ??
      selectTaskMetrics(task, run?.dispatches ?? [], []);
    const prNumber = task.prUrl?.match(/\/pull\/(\d+)/)?.[1];
    const verdict =
      task.status === "completed" &&
      task.reviewVerdict?.dispatchId ===
        (task.activeDispatchId ?? task.lastDispatchId)
        ? task.reviewVerdict
        : undefined;
    return (
      <article
        key={JSON.stringify([run?.leadId, task.id])}
        data-member-task={task.id}
        data-state={state.status}
        className="agent-state-surface min-w-0 overflow-hidden rounded-lg border border-stroke bg-content/2 font-sans text-xs"
      >
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3 text-left focus-visible:outline-accent">
          <span className="flex min-w-0 flex-1 basis-52 items-center gap-2">
            <strong
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={presentationText(task.title)}
            >
              {presentationText(task.title)}
            </strong>
            <span
              data-task-status
              className="shrink-0 rounded bg-content/5 px-1.5 py-0.5 text-content/70"
            >
              {label}
            </span>
          </span>
          <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-content/60">
              {look && (
                <PixelMascot
                  name={look.mascot}
                  color={look.color}
                  still
                  className="size-4 shrink-0"
                />
              )}
              <span
                className="max-w-28 truncate"
                title={
                  task.origin === "user"
                    ? "From user"
                    : `From ${look?.name ?? "Manager"}`
                }
              >
                From{" "}
                {task.origin === "user" ? "user" : (look?.name ?? "Manager")}
              </span>
            </span>
            {verdict && (
              <span
                title={verdict.notes}
                className={`shrink-0 rounded-md px-1.5 py-0.5 ${verdict.decision === "approve" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-orange-500/10 text-orange-700 dark:text-orange-400"}`}
              >
                {verdict.decision === "approve" ? "Approved" : "Changes"}
              </span>
            )}
            {task.prUrl && (
              <span
                title={task.prUrl}
                className="shrink-0 rounded-md bg-content/5 px-1.5 py-0.5 text-content/60"
              >
                PR {prNumber ? `#${prNumber}` : "↗"}
              </span>
            )}
            {at !== undefined && (
              <time
                dateTime={new Date(at).toISOString()}
                className="shrink-0 text-content/50"
              >
                {formatRelativeTime(new Date(at).toISOString())}
              </time>
            )}
          </span>
          <AgentDetailTooltip
            detail={openedTask ? undefined : taskMetricsDetail(metrics, state)}
          >
            <button
              type="button"
              aria-haspopup="dialog"
              className={`${button} shrink-0 bg-content/8 font-medium`}
              onClick={() =>
                setOpenedTask({ id: task.id, leadId: run?.leadId })
              }
            >
              Open
            </button>
          </AgentDetailTooltip>
        </div>
        <div className="px-3 pb-2">
          {dispatch &&
          ["queued", "workspace_prepared", "session_prepared"].includes(
            dispatch.stage,
          ) &&
          dispatch.turnStartedAt === undefined ? (
            <p data-task-metrics className="text-[10px] text-content/65">
              Conversation not started · Tokens unavailable
            </p>
          ) : (
            <TaskMetricsLine
              metrics={metrics}
              state={state}
              startedAt={dispatch?.turnStartedAt ?? dispatch?.startedAt}
              endedAt={
                dispatch?.finishedAt ??
                (!["running", "queued", "cancelling"].includes(task.status)
                  ? dispatch?.updatedAt
                  : undefined)
              }
            />
          )}
          {task.error &&
          ["failed", "blocked", "interrupted"].includes(task.status) ? (
            <TranscriptError
              error={task.error}
              title={`Couldn't complete ${presentationText(task.title)}`}
            />
          ) : (
            state.detail && (
              <p data-task-reason className="mt-1 break-words text-content/75">
                {presentationText(state.detail)}
              </p>
            )
          )}
          <OrgArtifactLinks monoId={member.id} links={links} />
          {task.status === "queued" && (
            <div className="mt-2 flex flex-wrap gap-1">
              <button
                type="button"
                className={button}
                onClick={() =>
                  actions
                    ? actions.open(task.sessionId)
                    : openCardSession(task.sessionId)
                }
              >
                Open worker session
              </button>
              <button
                type="button"
                className={button}
                disabled={pendingTask !== undefined || !run?.leadId}
                onClick={async () => {
                  if (!run?.leadId || pendingTask) return;
                  setPendingTask(task.id);
                  setActionError(undefined);
                  try {
                    await orchestrator.cancelTask(run.leadId, task.id);
                    taskToggleRef.current?.focus();
                  } catch (error) {
                    setActionError({
                      memberId: member.id,
                      message: `${task.title}: ${error instanceof Error ? error.message : String(error)}`,
                    });
                  } finally {
                    setPendingTask(undefined);
                  }
                }}
              >
                {pendingTask === task.id ? "Cancelling…" : "Cancel task"}
              </button>
            </div>
          )}
        </div>
      </article>
    );
  };
  const selected = tasks.find(
    ({ task, run }) =>
      task.id === openedTask?.id && run?.leadId === openedTask?.leadId,
  );
  const renderDetails = ({ task, links }: (typeof tasks)[number]) => {
    const cwd = task.workspace?.checkoutCwd;
    return (
      <Modal
        title={presentationText(task.title)}
        fitViewport
        onClose={() => {
          setOpenedTask(undefined);
          if (!visibleTasks.some((item) => item.task === task))
            taskToggleRef.current?.focus();
        }}
      >
        <div
          id={`member-task-${task.id}`}
          className="space-y-3 p-4 text-xs"
          onClickCapture={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("[data-org-artifact]")
            )
              setOpenedTask(undefined);
          }}
        >
          <OrgArtifactLinks monoId={member.id} links={links} />
          {cwd && (
            <p title={cwd} className="truncate font-mono text-content/60">
              {task.workspace?.branch || projectName(cwd)}
            </p>
          )}
          {!!task.checkoutBaseline?.inheritedChangedPaths?.length && (
            <p className="text-content/60">
              Started with {task.checkoutBaseline.inheritedChangedPaths.length}{" "}
              inherited changes
            </p>
          )}
          {task.readOnly && (
            <p className="text-content/60">
              Read-only task
              {task.readOnlyFallback ? ` · ${task.readOnlyFallback}` : ""}
            </p>
          )}
          {task.error &&
            ["failed", "blocked", "interrupted"].includes(task.status) && (
              <TranscriptError
                error={task.error}
                title={`Couldn't complete ${presentationText(task.title)}`}
              />
            )}
          <div>
            <h3 className="font-medium text-content/60">Assignment</h3>
            <p className="mt-2 whitespace-pre-wrap break-words">
              {presentationText(task.prompt)}
            </p>
          </div>
          {task.result && !task.reportArtifactId && (
            <div>
              <div className="mb-2 text-content/60">Report</div>
              <AgentMarkdown
                className="agent-chat-bubble-md mono-run-report"
                text={presentationText(task.result)}
                streaming={false}
                cwd={cwd}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-1 border-t border-content/10 pt-2">
            <button
              type="button"
              className={button}
              onClick={() => {
                setOpenedTask(undefined);
                openCardSession(task.sessionId);
              }}
            >
              Open worker session
            </button>
            {cwd && (!task.readOnly || task.readOnlyFallback) && (
              <button
                type="button"
                className={button}
                disabled={!actions?.openWorker}
                onClick={() => {
                  setOpenedTask(undefined);
                  actions?.openWorker?.(task.sessionId);
                }}
              >
                Open worktree
              </button>
            )}
            {task.prUrl && (
              <button
                type="button"
                className={button}
                onClick={() => void openUrl(task.prUrl!)}
              >
                Open PR
              </button>
            )}
          </div>
        </div>
      </Modal>
    );
  };
  if (activity) {
    const events = memberActivityEvents(
      runs,
      member.id,
      activity.trail.blocks,
    ).filter(
      (event) => activity.filter === "all" || event.kind === activity.filter,
    );
    return (
      <div className="min-w-0">
        {events.length > activityLimit && (
          <button
            type="button"
            className={`${button} mb-3 text-xs text-content/60`}
            onClick={() => setActivityLimit((value) => value + 80)}
          >
            Show earlier events
          </button>
        )}
        <ol
          aria-label="Member activity in chronological order"
          className="flex min-w-0 flex-col gap-3"
        >
          {events.slice(-activityLimit).map((event) => (
            <li
              key={event.id}
              data-member-activity={event.kind}
              className="relative min-w-0 border-l border-content/12 pl-4"
            >
              <span
                aria-hidden
                className="absolute -left-[3px] top-2 size-1.5 rounded-full bg-content/30"
              />
              {event.block ? (
                <MonoActivityTrail {...activity.trail} blocks={[event.block]} />
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      className="min-w-0 truncate text-left text-xs font-medium hover:text-accent focus-visible:outline-accent"
                      onClick={() =>
                        setOpenedTask({
                          id: event.task.id,
                          leadId: taskRuns.get(event.task)?.leadId,
                        })
                      }
                    >
                      {event.label}
                    </button>
                    {event.at !== undefined && (
                      <time
                        className="shrink-0 text-[11px] text-content/70"
                        dateTime={new Date(event.at).toISOString()}
                      >
                        {formatRelativeTime(new Date(event.at).toISOString())}
                      </time>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-content/70">
                    {presentationText(event.task.title)}
                  </p>
                  {event.error ? (
                    <div className="mt-2">
                      <TranscriptError
                        error={event.error}
                        title={`Couldn't complete ${presentationText(event.task.title)}`}
                      />
                      <button
                        type="button"
                        className={`${button} mt-1 text-xs text-content/75`}
                        onClick={() =>
                          actions
                            ? actions.open(event.task.sessionId)
                            : openCardSession(event.task.sessionId)
                        }
                      >
                        Open worker session
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ol>
        {!events.length && (
          <p className="px-1 py-3 text-xs text-content/60">
            No {activity.filter === "all" ? "activity" : activity.filter} yet.
          </p>
        )}
        {selected && renderDetails(selected)}
      </div>
    );
  }
  return (
    <section aria-label="Member work log" className="cc7u-assignments min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <h2 className="text-[13px] font-medium">Assignments</h2>
        <span className="ml-auto text-content/60">
          {current.length} current · {history.length} past
        </span>
        {attention > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            Needs attention ({attention})
          </span>
        )}
      </div>
      <div
        role="tablist"
        aria-label="Assignment filter"
        className="cc7u-segments"
      >
        {(["current", "history", "all"] as const).map(
          (value, index, values) => (
            <button
              key={value}
              ref={filter === value ? taskToggleRef : undefined}
              type="button"
              id={`${panelId}-${value}`}
              role="tab"
              aria-selected={filter === value}
              aria-controls={`${panelId}-tasks`}
              tabIndex={filter === value ? 0 : -1}
              onClick={() => {
                setFilter(value);
                setPage(0);
              }}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "current"
                    : event.key === "End"
                      ? "all"
                      : values[
                          (index + (event.key === "ArrowRight" ? 1 : 2)) % 3
                        ];
                setFilter(next);
                setPage(0);
                document.getElementById(`${panelId}-${next}`)?.focus();
              }}
            >
              {value === "current"
                ? "Current"
                : value === "history"
                  ? "History"
                  : "All"}
            </button>
          ),
        )}
      </div>
      {actionError?.memberId === member.id && (
        <p
          role="alert"
          className="px-2.5 py-1 text-xs text-red-700 dark:text-red-400"
        >
          {presentationText(actionError.message)}
        </p>
      )}
      <div
        id={`${panelId}-tasks`}
        role="tabpanel"
        aria-labelledby={`${panelId}-${filter}`}
      >
        <div
          ref={scrollerRef}
          role="region"
          aria-label="Assignments and work history"
          tabIndex={0}
          className="cc7u-task-list space-y-2 rounded-md focus-visible:outline-accent"
        >
          {visibleTasks.map(renderTask)}
          {!filtered.length && (
            <div className="cc7u-empty-work">
              <h3>
                {!tasks.length
                  ? "No assignments yet"
                  : filter === "history"
                    ? "No past assignments"
                    : "No current assignment"}
              </h3>
              <p>
                {!tasks.length
                  ? `${look?.name ?? "Your Manager"} assigns work here.`
                  : filter === "current"
                    ? "Past work is available in History."
                    : "Finished work will appear here."}
              </p>
            </div>
          )}
        </div>
        {pageCount > 1 && (
          <nav aria-label="Assignment pages" className="cc7u-paging">
            <button
              type="button"
              disabled={visiblePage === 0}
              onClick={() => setPage(visiblePage - 1)}
              aria-label="Previous assignments"
            >
              Previous
            </button>
            <span aria-live="polite">
              {visiblePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={visiblePage === pageCount - 1}
              onClick={() => setPage(visiblePage + 1)}
              aria-label="Next assignments"
            >
              Next
            </button>
          </nav>
        )}
      </div>
      {selected && renderDetails(selected)}
    </section>
  );
}
