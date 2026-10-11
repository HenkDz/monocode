import type { Block } from "../../sessions/model/session";
import {
  isHiddenTool,
  isToolBlock,
  toolCallState,
} from "../../sessions/model/transcriptActivity";
import { presentationText } from "../../sessions/model/transcriptPresentation";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";

export const ACTIVITY_FILTERS = [
  "all",
  "assignments",
  "tools",
  "messages",
  "results",
  "errors",
] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
export type ActivityKind = Exclude<ActivityFilter, "all">;
export type MemberActivityEvent = {
  id: string;
  kind: ActivityKind;
  at?: number;
  orderAt?: number;
} & (
  | { block: Block; task?: never; label?: never; error?: never }
  | {
      task: OrchestrationTask;
      label: string;
      error?: string;
      block?: never;
    }
);

export function activityKind(block: Block): ActivityKind | undefined {
  if (block.internal || block.draft) return;
  if (isToolBlock(block)) {
    if (isHiddenTool(block)) return;
    return toolCallState(block) === "rejected" ? "errors" : "tools";
  }
  if (
    !presentationText(block.monoTeamMessage?.text ?? block.text).trim() &&
    !block.image &&
    !block.plan &&
    !block.taskList
  )
    return;
  if (block.role === "user") return "messages";
  if (block.notice === "error") return "errors";
  if (["assistant", "image", "plan", "tasks"].includes(block.role))
    return "results";
  if (block.notice === "interrupt" || block.interjection) return "messages";
}

/** Turn clocks locate unclocked steps; only each event's own recorded clock is displayed. */
export function memberActivityEvents(
  runs: OrchestrationRun[],
  memberId: string | undefined,
  blocks: Block[],
): MemberActivityEvent[] {
  const events: MemberActivityEvent[] = [];
  let turnAt: number | undefined;
  for (const block of blocks) {
    if (block.role === "user") turnAt = block.startedAt ?? block.sentAt;
    const kind = activityKind(block);
    if (kind)
      events.push({
        id: `block:${block.id}`,
        kind,
        block,
        at: block.sentAt ?? block.startedAt,
        orderAt: block.sentAt ?? block.startedAt ?? turnAt,
      });
  }
  for (const run of runs) {
    for (const task of run.tasks) {
      if (!memberId || task.memberId !== memberId) continue;
      const dispatches = (run.dispatches ?? []).filter(
        (dispatch) => dispatch.taskId === task.id,
      );
      const first = dispatches.reduce<number | undefined>(
        (at, dispatch) =>
          Math.min(at ?? Infinity, dispatch.dispatchedAt ?? dispatch.startedAt),
        undefined,
      );
      events.push({
        id: `task:${run.leadId}:${task.id}:assignment`,
        kind: "assignments",
        task,
        label: `Assigned ${presentationText(task.title)}`,
        at: first,
        orderAt: first,
      });
      for (const dispatch of dispatches) {
        if (
          ![
            "completed",
            "failed",
            "blocked",
            "interrupted",
            "cancelled",
          ].includes(dispatch.state)
        )
          continue;
        const error = dispatch.error || dispatch.cleanupError;
        const kind =
          error || ["failed", "blocked", "interrupted"].includes(dispatch.state)
            ? "errors"
            : "results";
        events.push({
          id: `dispatch:${run.leadId}:${dispatch.id}:outcome`,
          kind,
          task,
          label: `${dispatch.state === "cancelled" ? "Cancelled" : kind === "errors" ? "Stopped" : "Finished"} ${presentationText(task.title)}`,
          error:
            error ||
            (kind === "errors"
              ? "The assignment stopped before completion."
              : undefined),
          at: dispatch.finishedAt,
          orderAt: dispatch.finishedAt,
        });
      }
      if (
        !dispatches.some(
          (dispatch) =>
            [
              "completed",
              "failed",
              "blocked",
              "interrupted",
              "cancelled",
            ].includes(dispatch.state) &&
            (!(task.activeDispatchId ?? task.lastDispatchId) ||
              dispatch.id === (task.activeDispatchId ?? task.lastDispatchId)),
        ) &&
        ["completed", "failed", "blocked", "interrupted", "cancelled"].includes(
          task.status,
        )
      ) {
        const kind = ["failed", "blocked", "interrupted"].includes(task.status)
          ? "errors"
          : "results";
        events.push({
          id: `task:${run.leadId}:${task.id}:outcome`,
          kind,
          task,
          label: `${task.status === "cancelled" ? "Cancelled" : kind === "errors" ? "Stopped" : "Finished"} ${presentationText(task.title)}`,
          error:
            task.error ||
            (kind === "errors"
              ? "The assignment stopped before completion."
              : undefined),
        });
      }
    }
  }
  return events.sort(
    (a, b) => (a.orderAt ?? Infinity) - (b.orderAt ?? Infinity),
  );
}
