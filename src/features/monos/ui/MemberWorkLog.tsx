import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
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
import { ChevronDown } from "../../../shared/ui/icons";
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
  const [expanded, setExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [activityLimit, setActivityLimit] = useState(80);
  useEffect(() => setActivityLimit(80), [member.id, activity?.filter]);
  const panelId = useId();
  const taskToggleRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const history = historyRef.current;
    if (!scroller || !expanded) return;
    scroller.scrollTop =
      showHistory && history
        ? history.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
        : 0;
  }, [expanded, showHistory]);
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
  const current = tasks.filter(
    ({ task, rank }) =>
      rank !== 3 && !["queued", "completed"].includes(task.status),
  );
  const queue = tasks.filter(({ task }) => task.status === "queued");
  const workLog = tasks.filter(
    ({ task, rank }) => task.status === "completed" && rank !== 3,
  );
  const history = tasks.filter(({ rank }) => rank === 3);
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
  const renderDetails = ({ task, links, rank }: (typeof tasks)[number]) => {
    const cwd = task.workspace?.checkoutCwd;
    return (
      <Modal
        title={presentationText(task.title)}
        fitViewport
        onClose={() => {
          setOpenedTask(undefined);
          if (!expanded || (rank === 3 && !showHistory))
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
                    <span className="shrink-0 text-[11px] text-content/70">
                      {event.at === undefined ? (
                        "Time not recorded"
                      ) : (
                        <time dateTime={new Date(event.at).toISOString()}>
                          {formatRelativeTime(new Date(event.at).toISOString())}
                        </time>
                      )}
                    </span>
                  </div>
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
    <section
      aria-label="Member work log"
      className="mx-auto w-full max-w-4xl shrink-0 px-4 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          ref={taskToggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          disabled={!tasks.length}
          className={`${button} flex items-center gap-1.5 font-medium`}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown className={`size-3.5 ${expanded ? "" : "-rotate-90"}`} />
          Tasks ({tasks.length})
        </button>
        {current.length > 0 && (
          <span className="text-content/60">{current.length} current</span>
        )}
        {attention > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            Needs attention ({attention})
          </span>
        )}
        {history.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded && showHistory}
            aria-controls={`${panelId}-history`}
            className={`${button} ml-auto flex items-center gap-1.5 text-content/60`}
            onClick={() => {
              setShowHistory(!expanded || !showHistory);
              setExpanded(true);
            }}
          >
            <ChevronDown
              className={`size-3.5 ${expanded && showHistory ? "" : "-rotate-90"}`}
            />
            History ({history.length})
          </button>
        )}
      </div>
      {!tasks.length && (
        <p className="px-2.5 py-1 text-xs text-content/70">
          No assignments yet. {look?.name ?? "Your Manager"} assigns work here.
        </p>
      )}
      {actionError?.memberId === member.id && (
        <p
          role="alert"
          className="px-2.5 py-1 text-xs text-red-700 dark:text-red-400"
        >
          {presentationText(actionError.message)}
        </p>
      )}
      <div id={panelId} hidden={!expanded}>
        <div
          ref={scrollerRef}
          role="region"
          aria-label="Assignments and work history"
          tabIndex={0}
          className="max-h-[min(30dvh,16rem)] space-y-2 overflow-y-auto overscroll-contain rounded-md border-b border-stroke pb-2 [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline-accent"
        >
          {expanded &&
            (current.length > 0 || queue.length > 0 || workLog.length > 0) && (
              <div className="space-y-2" data-member-section="current">
                <h3 className="px-2.5 text-xs font-medium text-content/60">
                  Current assignment
                </h3>
                {current.length ? (
                  current.map(renderTask)
                ) : (
                  <p className="px-2.5 text-xs text-content/70">
                    No current assignment.
                  </p>
                )}
              </div>
            )}
          {expanded && queue.length > 0 && (
            <div className="space-y-2" data-member-section="queue">
              <h3 className="px-2.5 text-xs font-medium text-content/60">
                Queue ({queue.length})
              </h3>
              {queue.map(renderTask)}
            </div>
          )}
          {expanded && workLog.length > 0 && (
            <div className="space-y-2" data-member-section="log">
              <h3 className="px-2.5 text-xs font-medium text-content/60">
                Work log ({workLog.length})
              </h3>
              {workLog.map(renderTask)}
            </div>
          )}
          <div
            ref={historyRef}
            id={`${panelId}-history`}
            hidden={!expanded || !showHistory}
          >
            {expanded && showHistory && (
              <div className="space-y-2 pt-2">
                <h3 className="px-2.5 text-xs font-medium text-content/50">
                  Completed and cancelled
                </h3>
                {history.map(renderTask)}
              </div>
            )}
          </div>
        </div>
      </div>
      {selected && renderDetails(selected)}
    </section>
  );
}
