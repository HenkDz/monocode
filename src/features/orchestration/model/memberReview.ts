import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";

/** Evidence belongs to both exact dispatches, not a reusable task or member label. */
export function approvedMemberReview(
  run: OrchestrationRun,
  task: OrchestrationTask,
  reviewerId: string,
): OrchestrationTask | undefined {
  return run.tasks.find(
    (review) =>
      task.memberId !== reviewerId &&
      review.memberId === reviewerId &&
      review.reviewOf?.taskId === task.id &&
      review.reviewOf.dispatchId === task.lastDispatchId &&
      review.status === "completed" &&
      !!review.lastDispatchId &&
      review.reviewVerdict?.dispatchId === review.lastDispatchId &&
      (!task.delivery?.head || review.reviewVerdict.headOid === task.delivery.head) &&
      review.reviewVerdict.decision === "approve",
  );
}
