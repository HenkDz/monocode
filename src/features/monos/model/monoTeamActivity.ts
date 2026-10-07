import type { Mono } from "./mono";
import type { Session, Block } from "../../sessions/model/session";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import {
  managerPrReady,
  managerTaskFinished,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
import type { GitPr } from "../../../platform/tauri/fs";

export const TEAM_ACTIVITY_SECTIONS = [
  "Needs you",
  "Work in progress",
  "Ready to merge",
  "Recently finished",
] as const;
export type TeamActivitySection = (typeof TEAM_ACTIVITY_SECTIONS)[number];
export type TeamActivityTask = {
  run: OrchestrationRun;
  task: OrchestrationTask;
  section: TeamActivitySection;
  decisions: TeamDecision[];
};

const oneLine = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim() ?? "";
const sameText = (left: string, right: string) =>
  left.replace(/\s+/g, " ").trim() === right.replace(/\s+/g, " ").trim();

/** Older assignments sometimes copied the entire prompt into title. */
export function activityTaskTitle(
  task: OrchestrationTask,
  goalTitle?: string,
): string {
  const title = task.title.trim();
  return title &&
    !/[\r\n]/.test(title) &&
    title.length <= 160 &&
    !sameText(title, task.prompt ?? "")
    ? title
    : oneLine(goalTitle ?? "").slice(0, 120) || "Untitled task";
}

export function activityTaskEvent(
  task: OrchestrationTask,
  session?: Session,
): string {
  for (const block of [...(session?.blocks ?? [])].reverse()) {
    if (block.internal) continue;
    const text =
      block.tool?.title ||
      (block.role === "assistant" || block.notice ? block.text : "");
    if (text.trim() && !sameText(text, task.prompt ?? "")) return oneLine(text);
  }
  const result = task.error || task.result || "";
  return result.trim() && !sameText(result, task.prompt ?? "")
    ? oneLine(result)
    : "Waiting for the next step";
}

/** Classify once, then render that single task identity in its section. */
export function teamActivityTasks(
  runs: readonly OrchestrationRun[],
  statuses: ReadonlyMap<string, GitPr | null>,
  decisions: readonly TeamDecision[],
): TeamActivityTask[] {
  const tasks = new Map<string, TeamActivityTask>();
  for (const run of runs)
    for (const task of run.tasks) {
      const pr = taskPrStatus(task, statuses);
      const pending = decisions.filter(
        (decision) =>
          !decision.resume && decision.session.id === task.sessionId,
      );
      const section: TeamActivitySection =
        task.status === "cancelled" || managerTaskFinished(task, pr)
          ? "Recently finished"
          : pending.length
            ? "Needs you"
            : managerPrReady(task, pr)
              ? "Ready to merge"
              : "Work in progress";
      const existing = tasks.get(task.id);
      const updatedAt = (entry: {
        run: OrchestrationRun;
        task: OrchestrationTask;
      }) =>
        entry.run.dispatches?.find(
          (dispatch) =>
            dispatch.id ===
            (entry.task.activeDispatchId ?? entry.task.lastDispatchId),
        )?.updatedAt ?? 0;
      if (existing && updatedAt(existing) > updatedAt({ run, task })) continue;
      tasks.set(task.id, {
        run,
        task,
        section,
        decisions: section === "Needs you" ? pending : [],
      });
    }
  return [...tasks.values()];
}

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
