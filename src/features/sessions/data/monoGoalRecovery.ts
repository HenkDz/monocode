import type { Block, Session } from "../model/session";
import { getMonoTranscriptPage } from "./sessionStore";

/** Recovery checks the durable history without changing the viewer's loaded page. */
export async function getMonoGoalRecoveryBlocks(sessionId: string): Promise<Block[]> {
  // shortcut: scan saved pages per recovery pass; add a pending index if long histories slow polling.
  const pages: Block[][] = [];
  let before: number | undefined;
  do {
    const page = await getMonoTranscriptPage(sessionId, { before });
    pages.push(page.blocks);
    if (page.before == null) break;
    if (before != null && page.before >= before)
      throw Error("Mono transcript history cursor did not advance");
    before = page.before;
  } while (true);
  return pages.reverse().flat();
}

/** The current writable tail wins over reads that finished while chat changed. */
export function mergeMonoGoalRecoverySession(live: Session, history: readonly Block[]): Session {
  const firstId = live.monoTranscript?.firstBlockId ?? live.blocks[0]?.id;
  let start = firstId ? history.findIndex(block => block.id === firstId) : history.length;
  if (start < 0 && live.monoTranscript?.firstBlockId == null) start = history.length;
  if (start < 0) throw Error("The originating transcript changed during recovery");
  const liveIds = new Set(live.blocks.map(block => block.id));
  // A committed goal may be absent from the live tail after its save acknowledgement failed.
  const retainedOrigins = history.slice(start).filter(block =>
    block.role === "user" && block.monoGoalSubmission && !liveIds.has(block.id));
  const blocks = [...history.slice(0, start), ...live.blocks, ...retainedOrigins];
  if (new Set(blocks.map(block => block.id)).size !== blocks.length)
    throw Error("Goal recovery would duplicate a historical message identity");
  return { ...live, blocks,
    monoTranscript: { before: null, firstBlockId: blocks[0]?.id ?? null } };
}

export function monoGoalRecoveryLiveSession(live: Session, next: Session, previousHistory: readonly Block[]): Session {
  const historicalIds = new Set(previousHistory.map(block => block.id));
  const liveIds = new Set(live.blocks.map(block => block.id));
  const firstId = live.monoTranscript?.firstBlockId ?? live.blocks[0]?.id;
  const start = firstId ? previousHistory.findIndex(block => block.id === firstId) : previousHistory.length;
  const retainedOriginIds = new Set(previousHistory.slice(Math.max(0, start)).filter(block =>
    block.role === "user" && block.monoGoalSubmission).map(block => block.id));
  return { ...next, monoTranscript: live.monoTranscript,
    blocks: next.blocks.filter(block => liveIds.has(block.id) || !historicalIds.has(block.id) || retainedOriginIds.has(block.id)) };
}
