import { projectName } from "../../../shared/lib/paths";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { selectAgentLiveState, type AgentLiveState } from "../../agents/model/agentLiveState";
import { selectAgentMetrics, selectDelegationEdges, selectGoalMetrics, selectTaskMetrics,
  type AgentMetrics, type DelegationEdge } from "../../agents/model/agentMetrics";
import { currentTurnIndex } from "../../agents/model/turnMetrics";

export type GoalTarget = { monoId?: string; sessionId?: string; requestSessionId?: string };
export function agentInitials(name: string, role?: string, project = ""): string {
  const words = name.trim().split(/\s+/);
  return (role === "manager" && project ? `${project[0]}M`
    : words.length > 1 ? words.slice(0, 2).map(word => word[0]).join("") : name.slice(0, 2)).toUpperCase();
}
export function openGoalTarget(target: GoalTarget, routes: {
  close: () => void;
  request: (id: string) => void;
  mono: (id: string) => void | Promise<void>;
  session: (id: string) => void | Promise<void>;
}) {
  if (target.requestSessionId) {
    routes.close();
    return routes.request(target.requestSessionId);
  }
  if (target.monoId) return routes.mono(target.monoId);
  if (target.sessionId) return routes.session(target.sessionId);
  throw Error("Conversation unavailable");
}
export type GoalAttempt = { edge: DelegationEdge; state: string; elapsedMs?: number };
export type GoalNode = {
  id: string;
  monoId?: string;
  role: "orchestrator" | "manager" | "worker";
  name: string;
  state?: AgentLiveState;
  activity?: string;
  target?: GoalTarget;
  metrics?: AgentMetrics;
  chatMetrics?: AgentMetrics;
  metricsLabel?: string;
  elapsedMs?: number;
  elapsedLabel: string;
  shared?: boolean;
  attempts?: GoalAttempt[];
  review?: { taskId: string; title: string; dispatchId: string; available: boolean };
};
export type GoalView = {
  goal: MonoManagerGoal;
  project: string;
  projectId: string;
  wallElapsedMs?: number;
  metrics: AgentMetrics;
  nodes: GoalNode[];
  rosterIssue?: string;
};
export type GoalViewModel = { live: GoalView[]; finished: GoalView[]; attention: GoalNode[] };
export type GoalViewInput = {
  goals: readonly MonoManagerGoal[];
  roster: readonly Mono[];
  runs: readonly OrchestrationRun[];
  sessions: readonly Session[];
  now?: number;
};

function withReviewGoals(run: OrchestrationRun): OrchestrationRun {
  const tasks = new Map(run.tasks.map(task => [task.id, task]));
  const goalId = (task: OrchestrationTask): string | undefined => {
    const seen = new Set<string>();
    let current: OrchestrationTask | undefined = task;
    while (current && !seen.has(current.id)) {
      if (current.monoGoalId) return current.monoGoalId;
      seen.add(current.id);
      current = current.reviewOf ? tasks.get(current.reviewOf.taskId) : undefined;
    }
  };
  return { ...run, tasks: run.tasks.map(task => task.monoGoalId ? task : { ...task, monoGoalId: goalId(task) }) };
}

function rosterIssue(nodes: readonly GoalNode[], roster: readonly Mono[]): string | undefined {
  const byId = new Map(roster.map(mono => [mono.id, mono]));
  for (const node of nodes) {
    if (!node.monoId) continue;
    const seen = new Set<string>();
    let id: string | undefined = node.monoId;
    while (id) {
      if (seen.has(id)) return "Cyclic roster link · chain uses saved goal and task identities.";
      seen.add(id);
      const mono = byId.get(id);
      if (!mono) return "Missing roster link · identity unavailable; chain uses saved goal and task identities.";
      id = mono.reportsTo;
    }
  }
  if (nodes.some(node => node.role !== "worker" && !node.monoId))
    return "Roster identity unavailable · chain uses saved goal and task identities.";
}

export function selectGoalViews(input: GoalViewInput): GoalViewModel {
  const now = input.now ?? Date.now();
  const runs = input.runs.map(withReviewGoals);
  const edges = selectDelegationEdges(input.goals, runs, input.sessions);
  const sessions = new Map(input.sessions.map(session => [session.id, session]));
  const roster = new Map(input.roster.map(mono => [mono.id, mono]));
  const views = input.goals.map(goal => {
    const finished = goal.archived || goal.state === "done" || goal.state === "cancelled";
    const members: { name: string; state: AgentLiveState }[] = [];
    const run = runs.find(run => run.leadId === goal.managerId);
    const tasks = runs.flatMap(candidate => candidate.tasks.filter(task => task.monoGoalId === goal.id));
    const manager = roster.get(run?.ownerMonoId ?? "") ?? input.roster.find(mono => mono.managerEngineId === goal.managerId);
    const origin = roster.get(goal.monoId);
    const originSessionId = origin?.sessionId ?? input.sessions.find(session => session.blocks.some(block => block.id === goal.userMessageId))?.id;
    const taskIds = new Set(tasks.map(task => task.id));
    const turnIds = new Set([goal.userMessageId, ...tasks.flatMap(task => task.managerTurnBlockId ? [task.managerTurnBlockId] : []),
      ...runs.flatMap(candidate => (candidate.dispatches ?? []).filter(dispatch => taskIds.has(dispatch.taskId))
        .flatMap(dispatch => dispatch.reportedTurnBlockId ? [dispatch.reportedTurnBlockId] : []))]);
    const actor = (role: "orchestrator" | "manager", mono: Mono | undefined, sessionId?: string): GoalNode => {
      const engineSession = sessions.get(sessionId ?? "");
      const ownSession = sessions.get(mono?.sessionId ?? "");
      const ownState = ownSession && selectAgentLiveState(ownSession);
      let session = ownSession && ownState?.status !== "idle" ? ownSession : engineSession ?? ownSession;
      if (!ownSession?.codexStorageError && engineSession?.codexStorageError) session = engineSession;
      else if (ownState?.status !== "blocked" && ownState?.status !== "needs-you" && engineSession?.usageLimit) session = engineSession;
      const scopedMetrics = (source?: Session) => {
        if (!source) return;
        const blocks = source.blocks.filter(block => turnIds.has(block.id) || block.monoSource?.goalId === goal.id);
        // Filtering a busy shared chat must not make an old goal turn active.
        const current = source.blocks[currentTurnIndex(source)];
        return selectAgentMetrics({ ...source, blocks, busy: !!source.busy && blocks.some(block => block.id === current?.id) }, now);
      };
      const metrics = scopedMetrics(engineSession ?? ownSession);
      const chatMetrics = ownSession && engineSession && ownSession.id !== engineSession.id ? scopedMetrics(ownSession) : undefined;
      const state = session || (role === "manager" && tasks.length) ? selectAgentLiveState(session,
        role === "manager" ? { tasks, members, runStatus: run?.status, pauseReason: run?.lastPauseReason } : {}) : undefined;
      const activeTasks = tasks.filter(task => ["queued", "running", "cancelling"].includes(task.status)).length;
      return { id: `${role}:${mono?.id ?? sessionId ?? goal.id}`, monoId: mono?.id ?? (role === "orchestrator" ? goal.monoId : undefined), role,
        name: mono?.name ?? mono?.specialty ?? (role === "orchestrator" ? "Grand Orch" : "Manager"),
        state, activity: state?.detail ?? (role === "orchestrator" && activeTasks ? `${activeTasks} active assignments below · delegated to Manager` : undefined),
        metrics, chatMetrics, metricsLabel: chatMetrics ? "Engine goal contribution" : "Goal contribution",
        elapsedMs: metrics?.turns ? metrics.elapsedMs : undefined,
        elapsedLabel: chatMetrics ? "Engine observed turn time" : "Observed turn time",
        target: mono && (!session || session.id === mono.sessionId) ? { monoId: mono.id }
          : session ? { sessionId: session.id } : sessionId ? { sessionId } : undefined,
        shared: input.goals.filter(other => role === "orchestrator" ? other.monoId === goal.monoId
          : other.managerId === goal.managerId || (!!sessionId && runs.some(candidate => candidate.leadId === other.managerId && (candidate.ownerSessionId ?? candidate.leadId) === sessionId))).length > 1 };
    };
    const workers: GoalNode[] = runs.flatMap(workerRun => workerRun.tasks.filter(task => task.monoGoalId === goal.id).map(task => {
      const dispatches = (workerRun.dispatches ?? []).filter(dispatch => dispatch.taskId === task.id);
      const attempts: GoalAttempt[] = dispatches.map(dispatch => {
        const edge = edges.find(edge => edge.id === dispatch.id && edge.managerId === workerRun.leadId)!;
        const active = ["starting", "running"].includes(dispatch.state);
        return { edge, state: dispatch.state, elapsedMs: edge.finishedAt != null || active
          ? Math.max(0, (edge.finishedAt ?? now) - edge.dispatchedAt) : undefined };
      }).sort((a, b) => a.edge.dispatchedAt - b.edge.dispatchedAt);
      const latest = dispatches.find(dispatch => dispatch.id === (task.activeDispatchId ?? task.lastDispatchId))
        ?? [...dispatches].sort((a, b) => b.startedAt - a.startedAt)[0];
      const sessionId = latest?.sessionId ?? task.sessionId;
      const session = sessions.get(sessionId);
      const member = roster.get(task.memberId ?? "");
      const state = selectAgentLiveState(["completed", "cancelled", "failed"].includes(task.status) ? undefined : session,
        { task, tasks: workerRun.tasks, runStatus: workerRun.status, pauseReason: workerRun.lastPauseReason });
      const name = task.memberName ?? member?.name ?? "Worker";
      if (!finished && !["finished", "stopped"].includes(workerRun.status) && !task.accepted && !["completed", "cancelled"].includes(task.status))
        members.push({ name, state });
      const reviewed = task.reviewOf && workerRun.tasks.find(candidate => candidate.id === task.reviewOf!.taskId);
      return { id: `${workerRun.leadId}:${task.id}`, monoId: task.memberId, role: "worker", name,
        state, activity: task.title, target: sessionId ? (state.status === "needs-you" ? { requestSessionId: sessionId } : { sessionId }) : member ? { monoId: member.id } : undefined,
        metrics: selectTaskMetrics(task, workerRun.dispatches ?? [], input.sessions, now),
        elapsedMs: attempts.find(attempt => attempt.edge.id === latest?.id)?.elapsedMs, elapsedLabel: "Attempt elapsed",
        attempts, review: task.reviewOf ? { ...task.reviewOf, title: reviewed?.title ?? "Unknown task",
          available: !!reviewed && dispatchesForReview(workerRun, task.reviewOf.taskId, task.reviewOf.dispatchId) } : undefined } satisfies GoalNode;
    }));
    const nodes = [actor("orchestrator", origin, originSessionId), actor("manager", manager, run?.ownerSessionId ?? run?.leadId ?? manager?.sessionId), ...workers];
    return { goal, projectId: goal.projectId, project: projectName(run?.workspace?.projectCwd ?? run?.cwd ?? goal.projectId), nodes,
      wallElapsedMs: !finished && Number.isFinite(goal.createdAt) ? Math.max(0, now - goal.createdAt) : undefined,
      metrics: selectGoalMetrics(goal, runs, input.sessions, now), rosterIssue: rosterIssue(nodes, input.roster) };
  });
  const live = views.filter(view => !view.goal.archived && view.goal.state !== "done" && view.goal.state !== "cancelled");
  const finished = views.filter(view => !live.includes(view));
  const attention = new Map<string, GoalNode>();
  for (const view of live) for (const node of view.nodes) {
    const state = node.state;
    const actionable = (state?.status === "needs-you" && node.role !== "worker") ||
      (state?.status === "blocked" && ["storage", "usage-limit"].includes(state.reason ?? ""));
    if (actionable && node.target) {
      const sessionId = node.target.sessionId ?? roster.get(node.target.monoId ?? "")?.sessionId;
      attention.set(`${sessionId ?? node.target.monoId}:${state!.reason ?? state!.status}`, node);
    }
  }
  return { live, finished, attention: [...attention.values()] };
}

function dispatchesForReview(run: OrchestrationRun, taskId: string, dispatchId: string): boolean {
  return !!run.dispatches?.some(dispatch => dispatch.id === dispatchId && dispatch.taskId === taskId);
}

export function goalTokenLabel(metrics?: AgentMetrics): string {
  if (!metrics || (metrics.inputTokens == null && metrics.outputTokens == null)) return "Tokens unavailable";
  const tokens = (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0);
  return `${tokens.toLocaleString()} tokens${metrics.partial || metrics.inputTokens == null || metrics.outputTokens == null ? " · partial" : ""}`;
}

export function goalElapsedLabel(elapsedMs?: number): string {
  if (elapsedMs == null) return "unavailable";
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m ${seconds % 60}s`;
}
