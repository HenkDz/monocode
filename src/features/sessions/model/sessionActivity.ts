import type { Session } from "./session";

/** Reading a conversation is not activity. Missing clocks retain the saved order. */
export function sessionActivityAt(session: Session, savedAt = 0): number {
  return session.blocks.reduce((latest, block) => Math.max(latest, block.sentAt ?? 0,
    block.startedAt ?? 0, block.turnMetrics?.endedAt ?? 0,
    block.startedAt != null && block.durationMs != null ? block.startedAt + block.durationMs : 0), savedAt);
}
