import type { Block, Session } from "../../sessions/model/session";
import type { OrchestrationDispatch } from "../../orchestration/model/orchestrationState";
import { currentTurnIndex } from "../../agents/model/turnMetrics";
import { selectDelegationEdges } from "../../agents/model/agentMetrics";
import { selectGoalViews, type GoalTarget, type GoalViewInput } from "./goalView";

export type TimelineKind = "unknown" | "queued" | "waiting" | "compaction" | "blocked" | "milestone";
export type TimelineSpan = {
  id: string;
  kind: TimelineKind;
  label: string;
  start?: number;
  end?: number;
  ongoing?: boolean;
  detail: string;
};
export type TimelineLane = {
  id: string;
  name: string;
  role: string;
  assignment?: string;
  attempt?: string;
  state?: string;
  target?: GoalTarget;
  review?: { taskId: string; dispatchId: string; available: boolean };
  spans: TimelineSpan[];
};
export type GoalTimeline = {
  goalId: string;
  title: string;
  start: number;
  end: number;
  live: boolean;
  lanes: TimelineLane[];
};

const time = (value?: number) => value != null && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : undefined;
const active = (dispatch: OrchestrationDispatch) => dispatch.state === "running" || dispatch.state === "starting";

function dispatchReceipts(records: readonly OrchestrationDispatch[], conflicts: Set<string>) {
  const groups = new Map<string, OrchestrationDispatch[]>();
  for (const record of records) groups.set(record.id, [...(groups.get(record.id) ?? []), record]);
  return [...groups.values()].map(receipts => {
    // Mutable freshness selects snapshot metadata, never an interval boundary.
    const latest = [...receipts].sort((a, b) => b.updatedAt - a.updatedAt || JSON.stringify(a).localeCompare(JSON.stringify(b)))[0];
    const boundary = (values: (number | undefined)[]) => {
      const known = [...new Set(values.map(time).filter((value): value is number => value != null))];
      if (known.length > 1) conflicts.add(latest.id);
      return known.length === 1 ? known[0] : undefined;
    };
    const result = { ...latest };
    for (const key of ["dispatchedAt", "turnStartedAt", "firstTokenAt", "finishedAt", "reportedAt", "durationMs"] as const)
      result[key] = boundary(receipts.map(receipt => receipt[key]));
    result.startedAt = boundary(receipts.map(receipt => receipt.startedAt)) ?? NaN;
    if (receipts.some(receipt => receipt.turnMetrics)) result.turnMetrics = { ...latest.turnMetrics,
      firstTokenAt: boundary(receipts.map(receipt => receipt.turnMetrics?.firstTokenAt)),
      endedAt: boundary(receipts.map(receipt => receipt.turnMetrics?.endedAt)),
      compactions: receipts.flatMap(receipt => receipt.turnMetrics?.compactions ?? []),
    };
    return result;
  });
}

function addTurn(lane: TimelineLane, turn: Pick<Block, "id" | "startedAt" | "durationMs" | "turnMetrics">, ongoing: boolean) {
  const start = time(turn.startedAt);
  const recordedEnd = time(turn.turnMetrics?.endedAt) ?? (start != null && time(turn.durationMs) != null ? time(start + turn.durationMs!) : undefined);
  const end = recordedEnd != null && (start == null || recordedEnd >= start) ? recordedEnd : undefined;
  lane.spans.push({ id: `turn:${turn.id}`, kind: "unknown", label: "Turn · phases unknown", start, end,
    ongoing: start != null && end == null && ongoing,
    detail: "Recorded turn boundary; exact model, tool and waiting phases are unavailable." + (recordedEnd != null && end == null ? " Conflicting end precedes start." : "") });
  const first = time(turn.turnMetrics?.firstTokenAt);
  if (first != null) lane.spans.push({ id: `content:${turn.id}`, kind: "milestone", label: "Observed first content", start: first,
    detail: "First observed text/reasoning, not the start of a model call." });
  const compactions = new Map<string, { startedAt?: number; endedAt?: number; conflict?: boolean }>();
  for (const item of turn.turnMetrics?.compactions ?? []) {
    const key = item.id ?? `${item.startedAt}:${item.endedAt}`;
    const previous = compactions.get(key);
    const start = time(item.startedAt), end = time(item.endedAt);
    const conflict = previous?.conflict || (previous?.startedAt != null && start != null && previous.startedAt !== start) ||
      (previous?.endedAt != null && end != null && previous.endedAt !== end);
    compactions.set(key, { startedAt: previous?.startedAt ?? start, endedAt: previous?.endedAt ?? end, conflict });
  }
  for (const [id, item] of compactions) {
    const valid = !item.conflict && !(item.startedAt != null && item.endedAt != null && item.endedAt < item.startedAt);
    lane.spans.push({ id: `compaction:${turn.id}:${id}`, kind: valid ? "compaction" : "unknown", label: valid ? "Compaction" : "Compaction · conflicting timing",
      start: item.startedAt, end: valid ? item.endedAt : undefined,
      detail: valid ? "Recorded compaction receipt; missing boundaries stay unknown." : "Conflicting receipts; duration unavailable." });
  }
}

/** Display only CC4 receipts. Current state is a snapshot, never a historical start time. */
export function selectGoalTimeline(input: GoalViewInput & { goalId: string }): GoalTimeline | undefined {
  const now = time(input.now) ?? Date.now();
  const views = selectGoalViews({ ...input, now });
  const view = [...views.live, ...views.finished].find(view => view.goal.id === input.goalId);
  if (!view) return;
  const live = views.live.includes(view);
  const sessionById = new Map(input.sessions.map(session => [session.id, session]));
  const workerIds = new Set(view.nodes.filter(node => node.role === "worker").map(node => node.id));
  const conflicts = new Map<string, Set<string>>();
  const runs = input.runs.map(run => {
    const invalid = new Set<string>(); conflicts.set(run.leadId, invalid);
    return { ...run, dispatches: dispatchReceipts(run.dispatches ?? [], invalid),
      tasks: run.tasks.map(task => workerIds.has(`${run.leadId}:${task.id}`) ? { ...task, monoGoalId: view.goal.id } : task) };
  });
  const edges = selectDelegationEdges([view.goal], runs, input.sessions).filter(edge => edge.goalId === view.goal.id);
  const scopedTurnIds = new Set([view.goal.userMessageId]);
  for (const edge of edges) if (edge.managerTurnBlockId) scopedTurnIds.add(edge.managerTurnBlockId);
  for (const run of runs) for (const dispatch of run.dispatches ?? []) {
    if (workerIds.has(`${run.leadId}:${dispatch.taskId}`) && dispatch.reportedTurnBlockId) scopedTurnIds.add(dispatch.reportedTurnBlockId);
  }
  const lanes: TimelineLane[] = [];
  const addSessionTurns = (lane: TimelineLane, session: Session | undefined, predicate: (block: Block) => boolean, running = live) => {
    if (!session) return;
    const current = session.blocks[currentTurnIndex(session)];
    const turns = new Map(session.blocks.filter(block => block.role === "user" && !block.draft && predicate(block)).map(block => [block.id, block]));
    for (const turn of turns.values()) addTurn(lane, turn, running && !!session.busy && current?.id === turn.id);
  };
  for (const node of view.nodes.filter(node => node.role !== "worker")) {
    const lane: TimelineLane = { id: node.id, name: node.name, role: node.role, target: node.target, spans: [] };
    const actorSessions = new Set<string>();
    if (node.role === "orchestrator") {
      const origin = input.roster.find(mono => mono.id === view.goal.monoId);
      if (origin?.sessionId) actorSessions.add(origin.sessionId);
      for (const session of input.sessions) if (session.blocks.some(block => block.id === view.goal.userMessageId)) actorSessions.add(session.id);
      lane.spans.push({ id: "goal", kind: "milestone", label: "Goal created", start: time(view.goal.createdAt), detail: "Saved goal receipt; goal completion time is unavailable." });
    } else {
      for (const edge of edges) if (edge.managerSessionId) actorSessions.add(edge.managerSessionId);
      const manager = input.roster.find(mono => mono.id === node.monoId);
      if (manager?.sessionId) actorSessions.add(manager.sessionId);
    }
    for (const id of actorSessions) {
      const source: TimelineLane = { ...lane, spans: [] };
      addSessionTurns(source, sessionById.get(id), block => scopedTurnIds.has(block.id) || block.monoSource?.goalId === view.goal.id);
      lane.spans.push(...source.spans.map(span => ({ ...span, id: `${id}:${span.id}` })));
    }
    if (!lane.spans.length) lane.spans.push({ id: "legacy", kind: "unknown", label: "History unavailable", detail: "No attributed turn boundaries were recorded." });
    if (live && node.state && !["idle", "done"].includes(node.state.status)) lane.spans.push({ id: "snapshot", kind: node.state.status === "blocked" ? "blocked" : "unknown",
      label: `${node.state.status.replace(/-/g, " ")} now${node.state.reason ? ` · ${node.state.reason}` : ""}`, start: now,
      detail: `${node.state.detail ?? "Current availability snapshot"} Start time unavailable; no historical state duration claimed.` });
    lanes.push(lane);
  }
  for (const run of runs) for (const task of run.tasks) {
    if (!workerIds.has(`${run.leadId}:${task.id}`)) continue;
    const node = view.nodes.find(node => node.id === `${run.leadId}:${task.id}`)!;
    const dispatches = [...new Map((run.dispatches ?? []).filter(dispatch => dispatch.taskId === task.id).map(dispatch => [dispatch.id, dispatch])).values()]
      .sort((a, b) => (time(a.startedAt) ?? Infinity) - (time(b.startedAt) ?? Infinity) || a.id.localeCompare(b.id));
    if (!dispatches.length) lanes.push({ id: node.id, name: node.name, role: "worker", assignment: task.title, state: task.status, target: node.target, review: node.review,
      spans: [{ id: "legacy", kind: "unknown", label: "Assignment · timing unavailable", detail: "Legacy or undispatched assignment; no timestamp inferred from mutable task state." }] });
    for (const dispatch of dispatches) {
      const edge = edges.find(edge => edge.id === dispatch.id && edge.managerId === run.leadId)!;
      const lane: TimelineLane = { id: `${run.leadId}:${dispatch.id}`, name: node.name, role: "worker", assignment: task.title,
        attempt: dispatch.id, state: dispatch.state, target: { taskId: task.id, sessionId: dispatch.sessionId }, review: node.review, spans: [] };
      if (conflicts.get(run.leadId)?.has(dispatch.id)) lane.spans.push({ id: "conflict", kind: "unknown", label: "Conflicting dispatch receipts",
        detail: "Disagreeing immutable timestamps remain unknown; no duration inferred from conflicting boundaries." });
      const session = sessionById.get(dispatch.sessionId);
      const next = dispatches.find(candidate => candidate.sessionId === dispatch.sessionId && candidate.startedAt > dispatch.startedAt);
      const boundary = time(dispatch.finishedAt) ?? time(next?.startedAt);
      const start = time(edge.dispatchedAt);
      const blocks = session?.blocks.filter(block => block.role === "user" && !block.draft && (dispatch.turnBlockId
        ? block.id === dispatch.turnBlockId : block.startedAt != null && start != null && block.startedAt >= start && (boundary == null || block.startedAt < boundary))) ?? [];
      const turns = [...new Map(blocks.map(block => [block.id, block])).values()];
      const turnStart = time(dispatch.turnStartedAt) ?? (turns.length ? time(Math.min(...turns.flatMap(turn => time(turn.startedAt) == null ? [] : [turn.startedAt!]))) : undefined);
      const finish = time(dispatch.finishedAt);
      const reported = time(dispatch.reportedAt);
      const current = live && dispatch.id === (task.activeDispatchId ?? task.lastDispatchId ?? dispatches[dispatches.length - 1]?.id) && !["completed", "cancelled", "interrupted", "failed"].includes(task.status);
      const neverSubmitted = dispatch.stage === "accepted" || dispatch.stage === "session_prepared";
      lane.spans.push({ id: "dispatch", kind: "milestone", label: task.reviewOf ? "Review dispatched" : "Assignment dispatched", start, detail: `Saved dispatch ${dispatch.id}.` });
      if (start != null && turnStart != null && turnStart >= start) lane.spans.push({ id: "queue", kind: "queued", label: "Awaiting turn start", start, end: turnStart, detail: "Dispatch acceptance to recorded turn start; this is not first-token latency." });
      else if (neverSubmitted && current && start != null && ["starting", "blocked"].includes(dispatch.state)) lane.spans.push({ id: "queue", kind: "queued", label: "Awaiting turn start", start, ongoing: true, detail: "Current dispatch is awaiting a recorded turn start; blocker onset is unknown." });
      if (turns.length) {
        for (const turn of turns) addTurn(lane, { ...turn, turnMetrics: { ...dispatch.turnMetrics, ...turn.turnMetrics,
          firstTokenAt: turn.turnMetrics?.firstTokenAt ?? dispatch.firstTokenAt,
          endedAt: turn.turnMetrics?.endedAt ?? (turn.durationMs == null ? dispatch.turnMetrics?.endedAt ?? (turns.length === 1 ? finish : undefined) : undefined) } },
          current && active(dispatch) && !!session?.busy && session.blocks[currentTurnIndex(session)]?.id === turn.id);
      } else if (dispatch.turnMetrics || turnStart != null) addTurn(lane, {
        id: dispatch.turnBlockId ?? dispatch.id, startedAt: turnStart, durationMs: dispatch.durationMs,
        turnMetrics: { ...dispatch.turnMetrics, firstTokenAt: dispatch.firstTokenAt ?? dispatch.turnMetrics?.firstTokenAt,
          endedAt: dispatch.turnMetrics?.endedAt ?? (dispatch.durationMs == null ? finish : undefined) },
      }, current && active(dispatch));
      else lane.spans.push({ id: "unknown", kind: "unknown", label: neverSubmitted ? "No recorded execution" : "Execution · timing unknown", detail: "No recorded turn boundaries; no model or tool duration inferred." });
      if (finish != null) lane.spans.push({ id: "finish", kind: "milestone", label: `Attempt ${dispatch.state}`, start: finish, detail: "Observed attempt settlement, distinct from report delivery." });
      if (reported != null) lane.spans.push({ id: "report", kind: "milestone", label: "Reported to Manager", start: reported, detail: "Recorded delivery receipt." });
      if (finish != null && reported != null && reported >= finish) lane.spans.push({ id: "delivery", kind: "waiting", label: "Report delivery", start: finish, end: reported, detail: "Observed settlement to report delivery; not provider work." });
      if (task.reviewOf) {
        const manager = lanes.find(lane => lane.role === "manager");
        const end = reported ?? finish;
        if (manager && start != null) manager.spans.push({ id: `review:${dispatch.id}`, kind: "waiting", label: `Review outstanding · ${dispatch.id}`,
          start, end: end != null && end >= start ? end : undefined, ongoing: end == null && current,
          detail: `Assignment outstanding for ${task.reviewOf.taskId} / ${task.reviewOf.dispatchId}; may overlap Manager work.` });
      }
      if (current && node.state?.status === "blocked") lane.spans.push({ id: "blocker", kind: "blocked", label: `Blocked now · ${node.state.reason ?? "error"}`, start: now,
        detail: `${node.state.detail ?? "Current blocker"} Start time unavailable; no historical blocked duration claimed.` });
      lanes.push(lane);
    }
  }
  for (const lane of lanes) lane.spans.sort((a, b) => (a.start ?? a.end ?? Infinity) - (b.start ?? b.end ?? Infinity) || a.id.localeCompare(b.id));
  const times = lanes.flatMap(lane => lane.spans.flatMap(span => [span.start, span.end].filter((value): value is number => value != null)));
  const start = Math.min(time(view.goal.createdAt) ?? now, ...times);
  const end = Math.max(start, ...(live ? [now] : []), ...times);
  return { goalId: view.goal.id, title: view.goal.title, start, end, live, lanes };
}
