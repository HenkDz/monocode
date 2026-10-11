import type { ContextUsage } from "../../sessions/model/contextUsage";
import type { Block, Session } from "../../sessions/model/session";
import { hasPendingApproval } from "../../sessions/model/session";

/** Project the next input from a context level, never from billed token totals. */
export function taskContextBudget(
  usage: ContextUsage | undefined,
  inputGrowth = 0,
): {
  threshold?: number;
  projected?: number;
  rotate: boolean;
} {
  const positive = (value: number | undefined): value is number =>
    value != null && Number.isFinite(value) && value > 0;
  const threshold = positive(usage?.effectiveCompactionThreshold)
    ? usage.effectiveCompactionThreshold * 0.75
    : positive(usage?.window)
      ? usage.window * 0.6
      : undefined;
  if (
    !usage ||
    !Number.isFinite(usage.used) ||
    usage.used < 0 ||
    !Number.isFinite(inputGrowth) ||
    inputGrowth < 0
  )
    return { threshold, rotate: false };
  const projected = usage.used + inputGrowth;
  return {
    threshold,
    projected,
    rotate: threshold != null && projected >= threshold,
  };
}

/** UTF-8 bytes bound text tokens; the last turn reserves room for similar tool work. */
export function rotationInputGrowth(
  blocks: readonly Block[],
  nextText: string,
): number {
  let start = blocks.length;
  while (
    start > 0 &&
    (blocks[start - 1].role !== "user" || blocks[start - 1].draft)
  )
    start--;
  if (start > 0) start--;
  const encoder = new TextEncoder();
  let growth = encoder.encode(nextText).length;
  for (const block of blocks.slice(start)) {
    if (block.draft) continue;
    growth += encoder.encode(block.text).length;
    growth += encoder.encode(block.tool?.detail ?? "").length;
    growth += encoder.encode(block.tool?.preview?.output ?? "").length;
  }
  return growth;
}

export function canRotateContext(
  session: Pick<Session, "blocks"> & Partial<Session>,
): boolean {
  return (
    !session.busy &&
    !session.pendingSwitch &&
    !session.pendingQuestion &&
    !session.worktreePreparing &&
    !session.codexStoragePreparing &&
    !session.worktreeRemoved &&
    !session.backgroundTasks?.length &&
    !hasPendingApproval(session.blocks) &&
    !session.blocks.some(
      (block) => block.streaming || block.tool?.status === "running",
    )
  );
}
