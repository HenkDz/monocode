import type { Block } from "../../sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";

export function managerReviewTurn(
  run: OrchestrationRun,
  task: OrchestrationTask,
  blocks: readonly Block[],
): string | undefined {
  if (task.prReadyTurnId) return task.prReadyTurnId;
  const turns = blocks.filter((block) => block.role === "user");
  const at =
    task.prReadyAt ??
    run.dispatches?.find((dispatch) => dispatch.id === task.acceptedDispatchId)
      ?.updatedAt;
  // Old snapshots have only dispatch timing. Keep their card in that historical turn.
  return (
    turns
      .filter(
        (block) =>
          at != null && block.startedAt != null && block.startedAt <= at,
      )
      .slice(-1)[0]?.id ?? turns[0]?.id
  );
}

export function managerReviewTimeline(
  runs: readonly OrchestrationRun[],
  blocks: readonly Block[],
): Map<string, OrchestrationRun[]> {
  const timeline = new Map<string, OrchestrationRun[]>();
  const seen = new Set<string>();
  for (const run of runs) {
    const grouped = new Map<string, OrchestrationTask[]>();
    for (const task of run.tasks) {
      if (!task.prUrl || seen.has(task.id)) continue;
      const turnId = managerReviewTurn(run, task, blocks);
      if (!turnId) continue;
      seen.add(task.id);
      grouped.set(turnId, [...(grouped.get(turnId) ?? []), task]);
    }
    for (const [turnId, tasks] of grouped)
      timeline.set(turnId, [
        ...(timeline.get(turnId) ?? []),
        { ...run, tasks },
      ]);
  }
  return timeline;
}

export function focusManagerReview(taskId: string): void {
  const card = document.getElementById(`manager-review-${taskId}`);
  card?.scrollIntoView({ block: "center" });
  card?.focus({ preventScroll: true });
}

export function jumpToManagerReview(taskId: string): void {
  window.dispatchEvent(
    new CustomEvent("monocode:manager-review", { detail: { taskId } }),
  );
  focusManagerReview(taskId);
}
