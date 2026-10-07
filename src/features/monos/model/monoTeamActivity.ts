import type { Mono } from "./mono";
import type { Session, Block } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

export function orgDescendants(roster: readonly Mono[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const mono of roster) if (mono.reportsTo && ids.has(mono.reportsTo) && !ids.has(mono.id)) {
      ids.add(mono.id); changed = true;
    }
  }
  return ids;
}

export type TeamDecision = { key: string; session: Session; owner: Mono; project: string; approval?: Block; resume?: { leadId: string; reason: string } };
/** Shared by Activity, badges and Inbox; request identity is scoped to its session. */
export function teamDecisions(roster: readonly Mono[], sessions: readonly Session[], runs: readonly OrchestrationRun[], rootId?: string): TeamDecision[] {
  const scope = rootId ? orgDescendants(roster, rootId) : new Set(roster.filter(m => m.role).map(m => m.id));
  const seen = new Set<string>();
  const decisions: TeamDecision[] = sessions.flatMap(session => {
    const run = runs.find(run => run.tasks.some(task => task.sessionId === session.id));
    const task = run?.tasks.find(task => task.sessionId === session.id);
    const owner = roster.find(m => m.sessionId === session.id || m.id === task?.memberId);
    if (!owner || !scope.has(owner.id) || session.worktreeRemoved) return [];
    const base = { session, owner, project: run?.cwd ?? owner.managerProject ?? owner.projects[0] ?? session.cwd };
    return [
      ...(session.pendingQuestion ? [{ ...base, key: `${session.id}:question:${session.pendingQuestion.requestId}` }] : []),
      ...session.blocks.filter(block => block.approval && !block.approval.decided).map(approval => ({ ...base, approval, key: `${session.id}:approval:${approval.approval!.requestId}` })),
    ];
  });
  for (const run of runs) {
    if (!run.projectManager || run.status !== "paused" || run.recovering) continue;
    const owner = roster.find(mono => mono.id === run.ownerMonoId);
    const session = sessions.find(entry => entry.id === (run.ownerSessionId ?? owner?.sessionId ?? run.leadId));
    if (!owner || !scope.has(owner.id) || !session || session.worktreeRemoved) continue;
    decisions.push({ key: `${run.leadId}:continue`, owner, session, project: run.cwd,
      resume: { leadId: run.leadId, reason: run.error || run.lastPauseReason || "Manager needs your decision to continue" } });
  }
  return decisions.filter(decision => {
    if (seen.has(decision.key)) return false;
    seen.add(decision.key);
    return true;
  });
}
