import {
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import { listMonos, monoLook, monoState } from "../model/mono";
import { ArtifactText } from "../../artifacts/ui/ArtifactReference";
import {
  activityTaskEvent,
  activityTaskTitle,
  orgDescendants,
  teamActivityTasks,
  teamDecisions,
  TEAM_ACTIVITY_SECTIONS,
  type TeamActivityTask,
  type TeamDecision,
} from "../model/monoTeamActivity";
import { monoManagerGoals } from "../model/monoManagerGoals";
import type { Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { GitPr } from "../../../platform/tauri/fs";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import { openCardSession } from "../model/monoCards";
import { orchestrator } from "../../orchestration/model/orchestration";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { pathKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
} from "../../workspace/model/tabGroups";
import {
  crewMessagesSnapshot,
  subscribeCrewMessages,
} from "../model/monoCrewEvents";
import { MonoOrgActivity, orgCrewFeed } from "./MonoOrgActivity";
import {
  managerTaskLifecycle,
  taskPrStatus,
} from "../../orchestration/model/projectManager";

type Props = {
  monoId: string;
  sessions: readonly Session[];
  runs: readonly OrchestrationRun[];
  statuses: ReadonlyMap<string, GitPr | null>;
  onApproval(id: string, requestId: number, decision: "allow" | "deny"): void;
  onQuestion(id: string, requestId: number, reply: UserQuestionReply): void;
  onQuestionInteraction(id: string, requestId: number): void;
};

export function MonoTeamActivity({
  monoId,
  sessions,
  runs,
  statuses,
  onApproval,
  onQuestion,
  onQuestionInteraction,
}: Props) {
  useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  useSyncExternalStore(subscribeCrewMessages, crewMessagesSnapshot);
  const tabId = useId();
  const [selected, setActive] = useState<string>();
  const actions = useContext(OrchestrationActions);
  const roster = listMonos(),
    ids = orgDescendants(roster, monoId);
  const decisions = teamDecisions(roster, sessions, runs, monoId);
  const teams = runs.filter(
    (run) =>
      (run.ownerMonoId && ids.has(run.ownerMonoId)) ||
      run.tasks.some((task) => task.memberId === monoId),
  );
  const tasks = teamActivityTasks(teams, statuses, decisions).filter(
    (entry) =>
      roster.find((m) => m.id === monoId)?.role !== "member" ||
      entry.task.memberId === monoId,
  );
  const goals = monoManagerGoals.goals();
  const [now, setNow] = useState(Date.now);
  const [continuing, setContinuing] = useState<string>();
  const [continueError, setContinueError] = useState<string>();
  const running = tasks.some(({ task }) => task.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const decision = (item: TeamDecision) => (
    <div
      key={item.key}
      className="mt-2 border-l-2 border-amber-500/40 pl-3 text-xs"
    >
      {item.resume ? (
        <>
          <p className="mb-2 break-words">{item.resume.reason}</p>
          <button
            disabled={!!continuing}
            onClick={() => {
              setContinuing(item.key);
              setContinueError(undefined);
              void orchestrator
                .continueManager(item.resume!.leadId)
                .catch((error) => setContinueError(String(error)))
                .finally(() => setContinuing(undefined));
            }}
          >
            {continuing === item.key ? "Continuing..." : "Continue"}
          </button>
        </>
      ) : item.approval ? (
        <>
          <p className="mb-2 break-words">
            {item.approval.tool?.title || item.approval.text}
          </p>
          <p className="mb-2 text-content/60">
            {item.approval.approval?.autoApprovalReason ??
              "This operation requires your permission."}
          </p>
          <div className="flex gap-3">
            {(["allow", "deny"] as const).map((choice) => (
              <button
                key={choice}
                onClick={() =>
                  onApproval(
                    item.session.id,
                    item.approval!.approval!.requestId,
                    choice,
                  )
                }
              >
                {choice === "allow" ? "Allow" : "Deny"}
              </button>
            ))}
          </div>
        </>
      ) : (
        item.session.pendingQuestion && (
          <QuestionForm
            prompt={item.session.pendingQuestion}
            onReply={(id, reply) => onQuestion(item.session.id, id, reply)}
            onInteraction={(id) => onQuestionInteraction(item.session.id, id)}
          />
        )
      )}
    </div>
  );

  const row = (entry: TeamActivityTask) => {
    const { run, task, section } = entry;
    const member = roster.find((m) => m.id === task.memberId);
    const look = member
      ? monoLook(member)
      : {
          name: task.memberName ?? "Worker",
          mascot: task.memberMascot ?? "cat",
          color: task.memberColor ?? "#888",
        };
    const session = sessions.find((s) => s.id === task.sessionId);
    const dispatch = run.dispatches?.find(
      (d) => d.id === (task.activeDispatchId ?? task.lastDispatchId),
    );
    const turn = session?.blocks.find(
      (block) => block.role === "user" && block.startedAt !== undefined,
    );
    const startedAt = dispatch?.startedAt ?? turn?.startedAt;
    const ready = section === "Ready to merge";
    const title = activityTaskTitle(
      task,
      goals.find((g) => g.id === task.monoGoalId)?.title,
    );
    const [label, tone] = managerTaskLifecycle(
      task,
      taskPrStatus(task, statuses),
      !!session && monoState(session).status === "needs-you",
    );
    const statusClass = {
      running: "bg-accent/10 text-accent",
      review: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
      changes: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
      ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      merged: "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
      failed: "bg-red-500/10 text-red-700 dark:text-red-400",
      muted: "bg-content/5 text-content/60",
    }[tone];

    const open = () =>
      ready && actions?.openManagerCard
        ? actions.openManagerCard(
            run.ownerSessionId ??
              roster.find((mono) => mono.id === run.ownerMonoId)?.sessionId ??
              run.leadId,
            task.id,
          )
        : openCardSession(task.sessionId);
    return (
      <article
        key={task.id}
        data-team-task={task.id}
        className="min-w-0 py-2 text-xs"
      >
        <div className="flex min-w-0 items-center gap-2">
          <PixelMascot
            name={look.mascot}
            color={look.color}
            still
            className="size-4 shrink-0"
          />
          <span
            title={label}
            className={`max-w-36 shrink-0 truncate rounded-md px-1.5 py-0.5 ${statusClass}`}
          >
            {label}
          </span>
          <span
            data-task-title
            title={title}
            className="min-w-0 flex-1 truncate font-medium"
          >
            {title}
          </span>
          <button
            type="button"
            onClick={open}
            aria-label={`Open ${title}`}
            className="shrink-0 rounded-md px-2 py-1 text-content/70 hover:bg-content/6 focus-visible:outline-accent"
          >
            Open
          </button>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-content/60">
          <span title={look.name} className="max-w-24 truncate">
            {look.name}
          </span>
          {task.reviewedBy && (
            <span className="shrink-0 text-emerald-700 dark:text-emerald-400">
              Reviewed
            </span>
          )}
          <p
            data-task-event
            title={activityTaskEvent(task, session)}
            className="min-w-0 flex-1 truncate"
          >
            <ArtifactText
              text={activityTaskEvent(task, session)}
              monoId={task.memberId ?? run.ownerMonoId}
            />
          </p>
          {startedAt !== undefined && (
            <span className="shrink-0">
              {formatLiveElapsed(
                startedAt,
                task.status === "running"
                  ? now
                  : (dispatch?.updatedAt ??
                      startedAt + (turn?.durationMs ?? 0)),
              )}
            </span>
          )}
        </div>
        {entry.decisions.map(decision)}
      </article>
    );
  };

  const attachedDecisions = new Set(
    tasks.flatMap((task) => task.decisions.map((item) => item.key)),
  );
  const standalone = decisions.filter(
    (item) => !attachedDecisions.has(item.key),
  );
  const projects = new Map<string, { cwd: string; name: string }>();
  const labels = loadTabGroupLabels();
  const displayName = (cwd: string) =>
    resolveTabGroupLabel(pathKey(cwd), labels, projectName(cwd));
  for (const run of teams)
    projects.set(pathKey(run.cwd), {
      cwd: run.cwd,
      name: displayName(run.cwd),
    });
  for (const item of standalone)
    if (!projects.has(pathKey(item.project)))
      projects.set(pathKey(item.project), {
        cwd: item.project,
        name: displayName(item.project),
      });

  const waitingCount = goals.filter(
    (goal) =>
      teams.some((run) => goal.managerId === run.leadId) &&
      !goal.archived &&
      !["done", "cancelled", "ready"].includes(goal.state) &&
      !tasks.some(({ task }) => task.monoGoalId === goal.id),
  ).length;
  const tabs = [
    {
      key: "Needs you",
      label: "Needs you",
      count:
        tasks.filter((entry) => entry.section === "Needs you").length +
        standalone.length,
    },
    {
      key: "Work in progress",
      label: "Working",
      count:
        tasks.filter((entry) => entry.section === "Work in progress").length +
        waitingCount,
    },
    {
      key: "Ready to merge",
      label: "Ready",
      count: tasks.filter((entry) => entry.section === "Ready to merge").length,
    },
    {
      key: "Recently finished",
      label: "Finished",
      count: tasks.filter((entry) => entry.section === "Recently finished")
        .length,
    },
    {
      key: "Feed",
      label: "Feed",
      count: orgCrewFeed(monoId, roster, teams, statuses, sessions).length,
    },
  ];
  const active =
    selected ?? tabs.find((tab) => tab.count > 0)?.key ?? "Needs you";
  return (
    <div data-team-activity className="space-y-4 p-3">
      <MonoOrgActivity
        rootId={monoId}
        roster={roster}
        runs={teams}
        sessions={sessions}
        now={now}
        view="team"
        onApproval={onApproval}
      />
      <div
        role="tablist"
        aria-label="Team activity"
        className="flex flex-wrap gap-1 rounded-lg bg-content/4 p-1"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${tabId}-tab-${index}`}
            aria-selected={active === tab.key}
            aria-controls={`${tabId}-panel`}
            tabIndex={active === tab.key ? 0 : -1}
            className={`rounded-md px-2 py-1 text-xs focus-visible:outline-accent ${active === tab.key ? "bg-background-base font-medium text-content" : "text-content/60 hover:text-content"}`}
            onClick={() => setActive(tab.key)}
            onKeyDown={(event) => {
              if (
                !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              setActive(tabs[next].key);
              document.getElementById(`${tabId}-tab-${next}`)?.focus();
            }}
          >
            {tab.label} <span>{tab.count}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-tab-${tabs.findIndex((tab) => tab.key === active)}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-accent"
      >
        <p hidden={active !== "Needs you"} className="text-xs text-content/60">
          {decisions.length} decisions{" "}
          <span className="sr-only" data-team-needs-count>
            {decisions.length}
          </span>
        </p>
        {!decisions.length && active === "Needs you" && (
          <p className="text-xs text-content/60">
            Nothing needs your decision.
          </p>
        )}
        {continueError && (
          <p role="alert" className="text-xs text-amber-600">
            {continueError}
          </p>
        )}
        {[...projects].map(([projectKey, project]) => {
          const projectTasks = tasks.filter(
            (entry) => pathKey(entry.run.cwd) === projectKey,
          );
          const projectRuns = teams.filter(
            (run) => pathKey(run.cwd) === projectKey,
          );
          const waiting = goals.filter(
            (goal) =>
              projectRuns.some((run) => goal.managerId === run.leadId) &&
              !goal.archived &&
              !["done", "cancelled", "ready"].includes(goal.state) &&
              !projectTasks.some(({ task }) => task.monoGoalId === goal.id),
          );
          const pending = standalone.filter(
            (item) => pathKey(item.project) === projectKey,
          );
          if (!projectTasks.length && !waiting.length && !pending.length)
            return null;
          return (
            <section
              key={projectKey}
              data-team-project={projectKey}
              aria-label={project.cwd}
              hidden={
                active === "Feed" ||
                (!projectTasks.some((entry) => entry.section === active) &&
                  !(active === "Work in progress" && waiting.length) &&
                  !(active === "Needs you" && pending.length))
              }
              className="space-y-3"
            >
              <h3 title={project.cwd} className="truncate text-xs font-medium">
                {project.name}
              </h3>
              {pending.length > 0 && (
                <section
                  hidden={active !== "Needs you"}
                  data-team-section="Needs you"
                  aria-label="Needs you"
                >
                  <h4 className="text-xs font-medium text-content/60">
                    Needs you · {pending.length}
                  </h4>
                  {pending.map((item) => (
                    <div key={item.key} className="py-2">
                      <button
                        className="rounded text-xs font-medium focus-visible:outline-accent"
                        onClick={() => openCardSession(item.session.id)}
                      >
                        {monoLook(item.owner).name}
                      </button>
                      {decision(item)}
                    </div>
                  ))}
                </section>
              )}
              {TEAM_ACTIVITY_SECTIONS.map((section) => {
                const entries = projectTasks.filter(
                  (entry) => entry.section === section,
                );
                const unassigned =
                  section === "Work in progress" ? waiting : [];
                if (!entries.length && !unassigned.length) return null;
                const label =
                  section === "Work in progress"
                    ? "Working"
                    : section === "Ready to merge"
                      ? "Ready"
                      : section === "Recently finished"
                        ? "Finished"
                        : section;
                return (
                  <section
                    hidden={active !== section}
                    key={section}
                    data-team-section={section}
                    aria-label={section}
                  >
                    <h4 className="text-xs font-medium text-content/60">
                      {label} · {entries.length + unassigned.length}
                    </h4>
                    <div className="divide-y divide-stroke">
                      {entries.map(row)}
                      {unassigned.map((goal) => {
                        const manager = roster.find(
                          (mono) =>
                            mono.id ===
                            projectRuns.find(
                              (run) => run.leadId === goal.managerId,
                            )?.ownerMonoId,
                        );
                        return (
                          <div
                            key={goal.id}
                            data-team-goal={goal.id}
                            className="py-2 text-xs"
                          >
                            <p
                              title={goal.title}
                              className="truncate font-medium"
                            >
                              {goal.title.split(/\r?\n/)[0]}
                            </p>
                            <button
                              type="button"
                              className="mt-1 rounded text-content/60 hover:underline focus-visible:outline-accent"
                              disabled={!manager}
                              onClick={() =>
                                manager &&
                                window.dispatchEvent(
                                  new CustomEvent("monocode:open-team", {
                                    detail: { monoId: manager.id },
                                  }),
                                )
                              }
                            >
                              {manager ? monoLook(manager).name : "Manager"} ·
                              Awaiting worker assignment
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </section>
          );
        })}
        <div hidden={active !== "Feed"}>
          <MonoOrgActivity
            rootId={monoId}
            roster={roster}
            runs={teams}
            sessions={sessions}
            now={now}
            view="feed"
          />
        </div>
        {active !== "Needs you" &&
          tabs.find((tab) => tab.key === active)?.count === 0 && (
            <p className="text-xs text-content/60">
              No{" "}
              {active === "Feed" ? "team events yet" : "tasks in this section"}.
            </p>
          )}
      </div>
    </div>
  );
}
