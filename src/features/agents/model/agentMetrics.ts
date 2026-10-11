import type { Block, Session } from "../../sessions/model/session";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationDispatch, OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";

type MetricsSession = Pick<Session, "id" | "blocks" | "busy">;
type MetricTurn = Pick<Block, "id" | "startedAt" | "durationMs" | "turnMetrics"> & { active?: boolean };
const counters = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "modelCalls"] as const;

export type AgentMetrics = {
  turns: number;
  elapsedMs: number;
  startedAt?: number;
  firstTokenAt?: number;
  endedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  modelCalls?: number;
  compactions?: number;
  /** Counters cover only observed turns, not unavailable history. */
  partial: boolean;
};

function rollup(turns: readonly MetricTurn[], now: number, missing = false): AgentMetrics {
  const summary: AgentMetrics = { turns: turns.length, elapsedMs: 0, partial: missing };
  let unfinished = false;
  for (const turn of turns) {
    const metrics = turn.turnMetrics;
    const endedAt = metrics?.endedAt ?? (turn.startedAt != null && turn.durationMs != null ? turn.startedAt + turn.durationMs : undefined);
    unfinished ||= turn.startedAt != null && endedAt == null;
    if (turn.startedAt != null) {
      summary.startedAt = Math.min(summary.startedAt ?? turn.startedAt, turn.startedAt);
    }
    summary.elapsedMs += Math.max(0, turn.durationMs ?? (turn.startedAt != null && (endedAt != null || turn.active)
      ? (endedAt ?? now) - turn.startedAt : 0));
    if (turn.startedAt != null && endedAt == null && !turn.active) summary.partial = true;
    if (metrics?.firstTokenAt != null)
      summary.firstTokenAt = Math.min(summary.firstTokenAt ?? metrics.firstTokenAt, metrics.firstTokenAt);
    if (endedAt != null) summary.endedAt = Math.max(summary.endedAt ?? endedAt, endedAt);
    for (const counter of counters) {
      const value = metrics?.[counter];
      if (value != null) summary[counter] = (summary[counter] ?? 0) + value;
    }
    if (metrics?.compactions) summary.compactions = (summary.compactions ?? 0) + metrics.compactions.length;
    if (metrics?.inputTokens == null || metrics.outputTokens == null) summary.partial = true;
  }
  if (unfinished) delete summary.endedAt;
  return summary;
}

function userTurns(session: MetricsSession): (Block & { active: boolean })[] {
  const turns = [...new Map(session.blocks.filter(block => block.role === "user" && !block.draft && (block.startedAt != null || block.turnMetrics))
    .map(block => [block.id, block])).values()];
  return turns.map((turn, index) => ({ ...turn, active: !!session.busy && index === turns.length - 1 }));
}

export function selectAgentMetrics(session: MetricsSession, now = Date.now()): AgentMetrics {
  return rollup(userTurns(session), now);
}

function taskTurns(task: OrchestrationTask, dispatches: readonly OrchestrationDispatch[], sessions: readonly MetricsSession[]) {
  const attempts = dispatches.filter(dispatch => dispatch.taskId === task.id).sort((a, b) => a.startedAt - b.startedAt);
  const turns = new Map<string, MetricTurn>();
  let missing = false;
  for (const dispatch of attempts) {
    const session = sessions.find(session => session.id === dispatch.sessionId);
    const following = attempts.find(attempt => attempt.sessionId === dispatch.sessionId && attempt.startedAt > dispatch.startedAt);
    const end = dispatch.finishedAt ?? following?.startedAt;
    const blocks = session ? userTurns(session).filter(block => dispatch.turnBlockId
      ? block.id === dispatch.turnBlockId
      : block.startedAt != null && block.startedAt >= (dispatch.dispatchedAt ?? dispatch.startedAt) && (end == null || block.startedAt < end)) : [];
    if (blocks.length) {
      for (const block of blocks) turns.set(`${session!.id}:${block.id}`, block);
    } else if (dispatch.turnMetrics || dispatch.turnStartedAt != null) {
      turns.set(`${dispatch.sessionId}:${dispatch.turnBlockId ?? dispatch.id}`, { id: dispatch.turnBlockId ?? dispatch.id, startedAt: dispatch.turnStartedAt, durationMs: dispatch.durationMs,
        active: ["running", "starting", "cancelling"].includes(dispatch.state),
        turnMetrics: { ...dispatch.turnMetrics, firstTokenAt: dispatch.firstTokenAt ?? dispatch.turnMetrics?.firstTokenAt,
          endedAt: dispatch.finishedAt ?? dispatch.turnMetrics?.endedAt } });
    } else if (dispatch.stage !== "accepted" && dispatch.stage !== "session_prepared") missing = true;
  }
  if (!attempts.length) {
    const session = sessions.find(session => session.id === task.sessionId);
    if (session) for (const block of userTurns(session)) turns.set(`${session.id}:${block.id}`, block);
    else if (task.status !== "queued") missing = true;
  }
  return { turns, missing };
}

export function selectTaskMetrics(task: OrchestrationTask, dispatches: readonly OrchestrationDispatch[], sessions: readonly MetricsSession[], now = Date.now()): AgentMetrics {
  const { turns, missing } = taskTurns(task, dispatches, sessions);
  return rollup([...turns.values()], now, missing);
}

export function selectGoalMetrics(goal: MonoManagerGoal, runs: readonly OrchestrationRun[], sessions: readonly MetricsSession[], now = Date.now()): AgentMetrics {
  const turns = new Map<string, MetricTurn>();
  const managerBlocks = new Set<string>();
  const foundManagerBlocks = new Set<string>();
  let foundOrigin = false;
  let missing = false;
  for (const run of runs) {
    const linked = run.tasks.filter(task => task.monoGoalId === goal.id);
    for (const task of linked) {
      if (task.managerTurnBlockId) managerBlocks.add(task.managerTurnBlockId);
      for (const dispatch of run.dispatches ?? [])
        if (dispatch.taskId === task.id && dispatch.reportedTurnBlockId) managerBlocks.add(dispatch.reportedTurnBlockId);
      const selected = taskTurns(task, run.dispatches ?? [], sessions);
      for (const [key, turn] of selected.turns) turns.set(key, turn);
      missing ||= selected.missing;
    }
  }
  for (const session of sessions) {
    for (const block of userTurns(session)) {
      if (block.id === goal.userMessageId) foundOrigin = true;
      if (managerBlocks.has(block.id)) foundManagerBlocks.add(block.id);
      if (block.id === goal.userMessageId || block.monoSource?.goalId === goal.id || managerBlocks.has(block.id))
        turns.set(`${session.id}:${block.id}`, block);
    }
  }
  return rollup([...turns.values()], now, missing || !foundOrigin || foundManagerBlocks.size < managerBlocks.size);
}

export type DelegationEdge = {
  id: string;
  goalId?: string;
  /** Project engine identity, matching MonoManagerGoal.managerId. */
  managerId: string;
  managerMonoId?: string;
  managerSessionId?: string;
  managerTurnBlockId?: string;
  taskId?: string;
  sessionId?: string;
  dispatchedAt: number;
  startedAt?: number;
  firstTokenAt?: number;
  finishedAt?: number;
  reportedAt?: number;
};

export function selectDelegationEdges(goals: readonly MonoManagerGoal[], runs: readonly OrchestrationRun[], sessions: readonly MetricsSession[]): DelegationEdge[] {
  const edges: DelegationEdge[] = goals.map(goal => {
    const run = runs.find(run => run.leadId === goal.managerId);
    const turn = sessions.flatMap(session => userTurns(session)).find(block => block.monoSource?.goalId === goal.id);
    return { id: goal.id, goalId: goal.id, managerId: goal.managerId, managerMonoId: run?.ownerMonoId,
      managerSessionId: run?.ownerSessionId ?? run?.leadId, dispatchedAt: goal.createdAt,
      startedAt: turn?.startedAt, firstTokenAt: turn?.turnMetrics?.firstTokenAt, finishedAt: turn?.turnMetrics?.endedAt };
  });
  for (const run of runs) {
    for (const dispatch of run.dispatches ?? []) {
      const task = run.tasks.find(task => task.id === dispatch.taskId);
      edges.push({ id: dispatch.id, goalId: task?.monoGoalId, managerId: run.leadId, managerMonoId: run.ownerMonoId,
        managerSessionId: run.ownerSessionId ?? run.leadId, managerTurnBlockId: task?.managerTurnBlockId,
        taskId: dispatch.taskId, sessionId: dispatch.sessionId, dispatchedAt: dispatch.dispatchedAt ?? dispatch.startedAt,
        startedAt: dispatch.turnStartedAt, firstTokenAt: dispatch.firstTokenAt,
        finishedAt: dispatch.finishedAt, reportedAt: dispatch.reportedAt });
    }
  }
  return edges;
}

/** Snapshot the exact worker turn before its conversation leaves memory. */
export function dispatchTurnSnapshot(dispatch: OrchestrationDispatch, session?: MetricsSession): Partial<OrchestrationDispatch> {
  const turn = session && userTurns(session).find(block => dispatch.turnBlockId
    ? block.id === dispatch.turnBlockId
    : block.startedAt != null && block.startedAt >= (dispatch.dispatchedAt ?? dispatch.startedAt));
  return turn ? { turnBlockId: turn.id, turnStartedAt: turn.startedAt,
    firstTokenAt: turn.turnMetrics?.firstTokenAt ?? dispatch.firstTokenAt,
    turnMetrics: turn.turnMetrics, durationMs: turn.durationMs } : {};
}
