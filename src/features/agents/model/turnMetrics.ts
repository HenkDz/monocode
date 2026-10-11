import type { HarnessEvent } from "../../../integrations/harness/core/types";
import type { Session, TurnMetrics } from "../../sessions/model/session";

export function isFirstTokenEvent(event: HarnessEvent): boolean {
  return (
    (event.type === "message.delta" ||
      event.type === "reasoning.delta" ||
      event.type === "plan") &&
    event.text.length > 0
  );
}

/** Steers and saved outbox bubbles join an existing turn rather than owning it. */
export function currentTurnIndex(
  session: Pick<Session, "blocks" | "queuedMessages">,
): number {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (
      block.role === "user" &&
      !block.draft &&
      block.startedAt != null &&
      !session.queuedMessages?.some((message) => message.blockId === block.id)
    )
      return index;
  }
  return -1;
}

export function captureTurnEvent(
  session: Session,
  event: HarnessEvent,
  at = Date.now(),
): Session {
  const firstToken = isFirstTokenEvent(event);
  if (
    !firstToken &&
    event.type !== "turn.metrics" &&
    event.type !== "turn.compaction"
  )
    return session;
  const index = currentTurnIndex(session);
  if (
    index < 0 ||
    (event.type === "turn.compaction" &&
      session.blocks[index].durationMs != null)
  ) {
    return event.type === "turn.compaction"
      ? { ...session, compacting: event.phase === "started" && !!session.busy }
      : session;
  }
  const block = session.blocks[index];
  const current = block.turnMetrics ?? {};
  let metrics: TurnMetrics = current;
  if (firstToken) {
    if (
      !session.busy ||
      block.durationMs != null ||
      current.firstTokenAt != null
    )
      return session;
    metrics = { ...current, firstTokenAt: at };
  } else if (event.type === "turn.metrics") {
    if (
      event.providerTurnId &&
      block.providerTurnId &&
      event.providerTurnId !== block.providerTurnId
    )
      return session;
    if (event.modelCallId && current.modelCallIds?.includes(event.modelCallId))
      return session;
    metrics = { ...current };
    for (const key of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ] as const) {
      const value = event[key];
      if (value == null || !Number.isFinite(value) || value < 0) continue;
      metrics[key] = event.modelCallId ? (current[key] ?? 0) + value : value;
    }
    if (
      event.cacheHitPercent != null &&
      Number.isFinite(event.cacheHitPercent) &&
      event.cacheHitPercent >= 0
    )
      metrics.cacheHitPercent = event.cacheHitPercent;
    if (
      event.modelCalls != null &&
      Number.isSafeInteger(event.modelCalls) &&
      event.modelCalls >= 0
    )
      metrics.modelCalls = event.modelCalls;
    if (event.modelCallId) {
      metrics.modelCallIds = [
        ...(current.modelCallIds ?? []),
        event.modelCallId,
      ];
      metrics.modelCalls = metrics.modelCallIds.length;
      if (metrics.inputTokens && metrics.cacheReadTokens != null) {
        const input =
          metrics.inputTokens +
          (session.harness === "codex" ? 0 : metrics.cacheReadTokens) +
          (metrics.cacheWriteTokens ?? 0);
        metrics.cacheHitPercent = (metrics.cacheReadTokens / input) * 100;
      }
    }
  } else if (event.type === "turn.compaction") {
    if (!session.busy || block.durationMs != null) return session;
    const compactions = [...(current.compactions ?? [])];
    // The deprecated Codex boundary repeats the identified lifecycle's completion.
    const latest = compactions[compactions.length - 1];
    if (event.legacy && latest?.id && latest.endedAt != null) return session;
    let existing = event.id
      ? compactions.findIndex((row) => row.id === event.id)
      : -1;
    if (!event.id) {
      for (let at = compactions.length - 1; at >= 0; at--) {
        if (compactions[at].endedAt == null) {
          existing = at;
          break;
        }
      }
    }
    if (event.phase === "started") {
      if (existing >= 0) return session;
      compactions.push({
        ...(event.id ? { id: event.id } : {}),
        startedAt: at,
      });
    } else if (existing >= 0) {
      if (compactions[existing].endedAt != null) return session;
      compactions[existing] = { ...compactions[existing], endedAt: at };
    } else {
      compactions.push({ ...(event.id ? { id: event.id } : {}), endedAt: at });
    }
    metrics = { ...current, compactions };
    session = {
      ...session,
      compacting: compactions.some((row) => row.endedAt == null),
    };
  }
  const blocks = session.blocks.slice();
  blocks[index] = { ...block, turnMetrics: metrics };
  return { ...session, blocks };
}
