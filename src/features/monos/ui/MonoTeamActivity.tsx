import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import { listMonos, monoLook } from "../model/mono";
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
import { openUrl } from "@tauri-apps/plugin-opener";
import { orchestrator } from "../../orchestration/model/orchestration";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { pathKey } from "../../../shared/lib/paths";

type Props = {
  monoId: string;
  sessions: readonly Session[];
  runs: readonly OrchestrationRun[];
  statuses: ReadonlyMap<string, GitPr | null>;
  onApproval(id: string, requestId: number, decision: "allow" | "deny"): void;
  onQuestion(id: string, requestId: number, reply: UserQuestionReply): void;
  onQuestionInteraction(id: string, requestId: number): void;
};

function TaskPrompt({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  return prompt ? (
    <details className="mt-2 text-content/60">
      <summary className="w-fit cursor-pointer rounded focus-visible:outline-accent">
        Details
      </summary>
      <p
        data-task-prompt
        className={`mt-2 whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-4"}`}
      >
        {prompt}
      </p>
      <button
        type="button"
        className="mt-1 rounded text-content hover:underline focus-visible:outline-accent"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </details>
  ) : null;
}

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
  const actions = useContext(OrchestrationActions);
  const roster = listMonos(),
    ids = orgDescendants(roster, monoId);
  const decisions = teamDecisions(roster, sessions, runs, monoId);
  const teams = runs.filter(
    (run) => run.ownerMonoId && ids.has(run.ownerMonoId),
  );
  const tasks = teamActivityTasks(teams, statuses, decisions);
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
      className="mt-2 rounded-md border border-amber-500/25 p-2 text-xs"
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
        className="min-w-0 rounded-md border border-stroke p-2 text-xs"
      >
        <button
          type="button"
          className="block w-full truncate rounded text-left font-medium hover:underline focus-visible:outline-accent"
          onClick={open}
        >
          {activityTaskTitle(
            task,
            goals.find((g) => g.id === task.monoGoalId)?.title,
          )}
        </button>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-content/60">
            <PixelMascot
              name={look.mascot}
              color={look.color}
              still
              className="size-5 shrink-0"
            />
            <span className="truncate">{look.name}</span>
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${ready ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : section === "Needs you" || task.status === "blocked" ? "bg-amber-500/10 text-amber-600" : "bg-content/5 text-content/60"}`}
          >
            {ready
              ? "PR ready"
              : section === "Needs you"
                ? "Needs you"
                : task.status === "completed" && !task.accepted
                  ? "In review"
                  : task.status}
          </span>
          {task.reviewedBy && (
            <span className="text-emerald-600 dark:text-emerald-400">
              Reviewed
            </span>
          )}
          {startedAt !== undefined && (
            <span className="text-content/40">
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
        <p data-task-event className="mt-1 truncate text-content/50">
          {activityTaskEvent(task, session)}
        </p>
        <TaskPrompt prompt={task.prompt ?? ""} />
        {entry.decisions.map(decision)}
        {task.prUrl && (
          <div className="mt-2 flex gap-3">
            {ready && (
              <button
                type="button"
                className="rounded hover:underline focus-visible:outline-accent"
                onClick={open}
              >
                Review in chat
              </button>
            )}
            <button
              type="button"
              className="rounded hover:underline focus-visible:outline-accent"
              onClick={() => void openUrl(task.prUrl!)}
            >
              Open PR
            </button>
            <button
              type="button"
              className="rounded hover:underline focus-visible:outline-accent"
              onClick={() => openCardSession(task.sessionId)}
            >
              Go to worktree
            </button>
          </div>
        )}
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
  for (const run of teams)
    projects.set(pathKey(run.cwd), {
      cwd: run.cwd,
      name: run.projectName ?? run.cwd,
    });
  for (const item of standalone)
    if (!projects.has(pathKey(item.project)))
      projects.set(pathKey(item.project), {
        cwd: item.project,
        name: item.project,
      });

  return (
    <div data-team-activity className="space-y-4 p-3">
      <h3 className="text-xs font-medium">
        Needs you <span data-team-needs-count>{decisions.length}</span>
      </h3>
      {!decisions.length && (
        <p className="text-xs text-content/45">Nothing needs your decision.</p>
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
        const grouped = new Map<string, TeamActivityTask[]>();
        for (const entry of projectTasks) {
          const key = entry.task.monoGoalId ?? "";
          grouped.set(key, [...(grouped.get(key) ?? []), entry]);
        }
        for (const goal of waiting) grouped.set(goal.id, []);
        return (
          <section
            key={projectKey}
            data-team-project={projectKey}
            aria-label={project.cwd}
          >
            <h3 className="mb-2 truncate text-xs font-medium">
              {project.name}
            </h3>
            {pending.length > 0 && (
              <section data-team-section="Needs you" aria-label="Needs you">
                <h4 className="text-xs text-content/60">Needs you</h4>
                {pending.map((item) => (
                  <div key={item.key}>
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
            {[...grouped].map(([goalId, group]) => {
              const goal = goals.find((goal) => goal.id === goalId);
              const manager = roster.find(
                (mono) =>
                  mono.id ===
                  projectRuns.find((run) => run.leadId === goal?.managerId)
                    ?.ownerMonoId,
              );
              return (
                <div
                  key={goalId}
                  data-team-goal={goalId || undefined}
                  className="mt-3"
                >
                  {goalId && (
                    <h4 className="mb-2 line-clamp-2 text-xs font-medium text-content/70">
                      {goal?.title ?? "Goal"}
                    </h4>
                  )}
                  <div
                    className={`space-y-3 ${goalId ? "border-l border-stroke pl-3" : ""}`}
                  >
                    {group.length === 0 && goal && (
                      <section
                        className="text-xs"
                        data-team-section="Work in progress"
                        aria-label="Work in progress"
                      >
                        <h5 className="mb-2 text-content/60">
                          Work in progress
                        </h5>
                        <span className="rounded bg-content/5 px-1.5 py-0.5 text-content/60">
                          {goal.state}
                        </span>
                        <button
                          className="ml-2 rounded text-content/50 hover:underline focus-visible:outline-accent"
                          disabled={!manager?.sessionId}
                          onClick={() =>
                            manager?.sessionId &&
                            openCardSession(manager.sessionId)
                          }
                        >
                          {manager ? monoLook(manager).name : "Manager"} ·
                          Awaiting worker assignment
                        </button>
                      </section>
                    )}
                    {TEAM_ACTIVITY_SECTIONS.map((section) => {
                      const entries = group.filter(
                        (entry) => entry.section === section,
                      );
                      if (!entries.length) return null;
                      const content = (
                        <div className="mt-2 space-y-2">{entries.map(row)}</div>
                      );
                      return section === "Recently finished" ? (
                        <details key={section} data-team-section={section}>
                          <summary className="cursor-pointer rounded text-xs text-content/60 focus-visible:outline-accent">
                            {section} ({entries.length})
                          </summary>
                          {content}
                        </details>
                      ) : (
                        <section
                          key={section}
                          data-team-section={section}
                          aria-label={section}
                        >
                          <h5 className="text-xs text-content/60">{section}</h5>
                          {content}
                        </section>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
