import { pathKey, projectName } from "../../../shared/lib/paths";
import type { GitPr } from "../../../platform/tauri/fs";
import { selectAgentLiveState, type AgentLiveState } from "../../agents/model/agentLiveState";
import { selectAgentMetrics, selectDelegationEdges } from "../../agents/model/agentMetrics";
import { currentTurnIndex } from "../../agents/model/turnMetrics";
import { memberTasks } from "../../monos/model/monoNavigation";
import { activityTaskTitle } from "../../monos/model/monoTeamActivity";
import { taskPrStatus } from "../../orchestration/model/projectManager";
import { agentInitials, type GoalTarget, type GoalViewInput } from "./goalView";

export type CockpitAgent = {
  id: string; name: string; initials: string; role: string; projectId?: string; project: string;
  state: AgentLiveState; activity: string; target: GoalTarget; elapsedMs?: number;
};
export type CockpitActivity = { id: string; title: string; detail: string; at?: number; target: GoalTarget; kind: "merge" | "review" | "completion" };
export type CockpitModel = {
  agents: CockpitAgent[]; activity: CockpitActivity[];
  active: number; idle: number; handoffMs?: number; handoffSamples: number;
  tokensToday?: number; tokensPartial: boolean;
};

/** Presentation joins only; CC4 owns state, counters and boundaries. */
export function selectCockpit(input: GoalViewInput, statuses: ReadonlyMap<string, GitPr | null> = new Map()): CockpitModel {
  const now = input.now ?? Date.now();
  const sessions = [...new Map(input.sessions.map(session => [session.id, session])).values()];
  const currentRuns = input.runs.filter(run => !["finished", "stopped"].includes(run.status));
  const agents = input.roster.filter(mono => mono.archivedAt == null).map(mono => {
    const tasks = memberTasks(currentRuns, mono.id);
    const unfinished = tasks.filter(task => !task.accepted && !["completed", "cancelled"].includes(task.status) &&
      !input.goals.some(goal => goal.id === task.monoGoalId && (goal.archived || ["done", "cancelled"].includes(goal.state))));
    const task = unfinished.find(task => ["queued", "running", "cancelling"].includes(task.status)) ?? unfinished[0];
    const own = sessions.find(session => session.id === mono.sessionId);
    const worker = sessions.find(session => session.id === task?.sessionId);
    const owned = currentRuns.find(run => run.ownerMonoId === mono.id || run.leadId === mono.managerEngineId);
    const engine = sessions.find(session => session.id === (owned?.ownerSessionId ?? owned?.leadId));
    const candidates = [own, worker, engine].filter(session => session != null);
    const source = candidates.find(session => ["blocked", "needs-you"].includes(selectAgentLiveState(session).status))
      ?? candidates.find(session => session.busy) ?? worker ?? own ?? engine;
    const assignments = (owned?.tasks ?? []).filter(task => !task.accepted && !["completed", "cancelled"].includes(task.status) &&
      !input.goals.some(goal => goal.id === task.monoGoalId && (goal.archived || ["done", "cancelled"].includes(goal.state))));
    const members = [...new Set(assignments.map(task => task.memberId ?? task.sessionId))].map(id => {
      const tasks = assignments.filter(task => (task.memberId ?? task.sessionId) === id);
      const task = tasks.find(task => ["queued", "running", "cancelling"].includes(task.status)) ?? tasks[0];
      return { name: task.memberName, state: selectAgentLiveState(task.status === "failed" ? undefined : sessions.find(session => session.id === task.sessionId), { task, tasks: owned?.tasks, runStatus: owned?.status }) };
    });
    const state = selectAgentLiveState(source, { task, tasks: owned?.tasks ?? tasks, members,
      runStatus: owned?.status, pauseReason: owned?.lastPauseReason, wakeStates: owned?.wakeState ? [owned.wakeState] : [] });
    const turn = source?.blocks[currentTurnIndex(source)];
    const metrics = turn && source ? selectAgentMetrics({ ...source, blocks: [turn] }, now) : undefined;
    const manager = input.roster.find(parent => parent.id === mono.reportsTo);
    const projectId = mono.role === "orchestrator" ? undefined : mono.managerProject ?? mono.projects[0] ?? manager?.managerProject ?? manager?.projects[0];
    const name = mono.name ?? mono.specialty ?? mono.mascot;
    return { id: mono.id, name, initials: agentInitials(name, mono.role, projectId ? projectName(projectId) : ""),
      role: mono.role === "orchestrator" ? "Organization lead" : mono.role === "manager" ? "Project lead" : mono.specialty ?? (mono.reviewer ? "Quality & safety" : "Engineering"),
      projectId: projectId ? pathKey(projectId) : undefined, project: projectId ? projectName(projectId) : "Organization", state,
      activity: task ? activityTaskTitle(task) : state.detail ?? (state.status === "idle" ? "Available for a new assignment" : "No current activity recorded"),
      target: source && source.id !== mono.sessionId ? state.status === "needs-you" ? { requestSessionId: source.id } : { sessionId: source.id }
        : task?.sessionId && !source ? { sessionId: task.sessionId } : { monoId: mono.id },
      elapsedMs: source?.busy && metrics?.startedAt != null && Number.isFinite(metrics.elapsedMs) ? metrics.elapsedMs : undefined } satisfies CockpitAgent;
  });
  const edges = selectDelegationEdges(input.goals, input.runs, sessions);
  const receipts = new Map<string, typeof edges>();
  for (const edge of edges) {
    const id = `${edge.managerId}:${edge.id}`;
    receipts.set(id, [...(receipts.get(id) ?? []), edge]);
  }
  const handoffs = [...receipts.values()].flatMap(group => {
    const edge = group[0];
    if (group.some(other => other.dispatchedAt !== edge.dispatchedAt || other.startedAt !== edge.startedAt)) return [];
    return Number.isFinite(edge.dispatchedAt) && edge.startedAt != null && Number.isFinite(edge.startedAt) && edge.startedAt >= edge.dispatchedAt
      ? [edge.startedAt - edge.dispatchedAt] : [];
  });
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const daily = sessions.map(session => selectAgentMetrics({ ...session,
    blocks: [...new Map(session.blocks.filter(block => block.startedAt != null && block.startedAt >= today.getTime() && block.startedAt <= now).map(block => [block.id, block])).values()] }, now));
  const observed = daily.filter(metrics => metrics.inputTokens != null || metrics.outputTokens != null);
  const activity: CockpitActivity[] = input.runs.flatMap(run => run.tasks.flatMap(task => {
    const pr = taskPrStatus(task, statuses);
    const related = run.tasks.find(candidate => candidate.id === task.reviewOf?.taskId) ?? task;
    const prUrl = task.prUrl ?? related.prUrl;
    const id = prUrl ? `pr:${prUrl}` : `task:${run.leadId}:${related.id}`;
    const target = { sessionId: task.sessionId };
    const title = activityTaskTitle(task);
    const closedAt = Date.parse(pr?.closedAt ?? "");
    const dispatches = (run.dispatches ?? []).filter(dispatch => dispatch.taskId === task.id && dispatch.state === "completed");
    return [
      ...(pr?.state === "merged" && pr.url === task.prUrl ? [{ id, title, detail: `Merged PR #${pr.number}`, at: Number.isFinite(closedAt) ? closedAt : undefined, target, kind: "merge" as const }] : []),
      ...dispatches.map(dispatch => ({ id, title, detail: `${task.memberName ?? "Worker"} · ${task.reviewOf ? "Review completed" : "Completed"}`,
        at: dispatch.finishedAt, target: { sessionId: dispatch.sessionId }, kind: task.reviewOf ? "review" as const : "completion" as const })),
    ];
  }));
  const outcomes = new Map<string, CockpitActivity[]>();
  for (const item of activity) outcomes.set(item.id, [...(outcomes.get(item.id) ?? []), item]);
  const priority = { merge: 0, review: 1, completion: 2 };
  const recent = [...outcomes.values()].map(group => {
    group.sort((a, b) => priority[a.kind] - priority[b.kind] || (b.at ?? -1) - (a.at ?? -1));
    return { ...group[0], detail: [...new Set(group.map(item => item.detail))].join(" · ") };
  });
  return { agents, active: agents.filter(agent => ["thinking", "running-tool", "compacting"].includes(agent.state.status)).length,
    idle: agents.filter(agent => agent.state.status === "idle").length,
    handoffMs: handoffs.length ? handoffs.reduce((sum, value) => sum + value, 0) / handoffs.length : undefined, handoffSamples: handoffs.length,
    tokensToday: observed.length ? observed.reduce((sum, metrics) => sum + (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0), 0) : undefined,
    tokensPartial: daily.some(metrics => metrics.partial),
    activity: recent.sort((a, b) => (b.at ?? -1) - (a.at ?? -1)).slice(0, 8) };
}
