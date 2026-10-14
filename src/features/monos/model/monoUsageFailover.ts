import {
  appendReadyHandoff,
  buildDeterministicHandoff,
  pendingHandoff,
} from "../../sessions/model/handoff";
import type { Session } from "../../sessions/model/session";
import {
  selectUsageFailoverAccount,
  type UsageFailoverCandidate,
  type UsageFailoverPolicy,
} from "../../providers/model/usageFailover";
import { switchMonoUsageLimitAccount } from "./monoUsageLimit";

const RECOVERY_PREFIX = "usage-failover-";
const MAX_ATTEMPTS = 256;

export type MonoUsageFailoverHost = {
  session(): Session | undefined;
  generation(): number;
  /** Includes explicit Stop, cancelled goal/task and original request authority. */
  held(): boolean;
  policy(): UsageFailoverPolicy;
  candidates(): readonly UsageFailoverCandidate[];
  now(): number;
  /**
   * Serialize with session writes. Validate before save and after its await;
   * persist without exposing `next` to dispatch, then CAS-publish only if valid.
   * Return false on rejection/save failure. Never publish on a failed save.
   */
  commit(expected: Session, next: Session, validate: () => boolean): Promise<boolean>;
};

export type MonoUsageFailoverResult =
  | { kind: "manual" }
  | { kind: "pause-and-ask"; reason: "held" | "home-binding" | "no-eligible-account" | "already-attempted" | "save-rejected" }
  | { kind: "switched"; accountId: string };

export function usageFailoverBoundarySafe(session: Session): boolean {
  const origin = requestId(session);
  const turnStart = session.blocks.findIndex(block => block.id === origin);
  const finished = ["completed", "failed", "cancelled"];
  return !!session.usageLimit && !session.busy &&
    (!session.queuedMessages?.length || session.queueStatus === "paused") &&
    !session.compacting && !session.backgroundTasks?.length && !session.pendingSwitch &&
    !pendingHandoff(session) && !session.pendingQuestion &&
    !session.editingQueuedMessageId && !session.sendingQueuedMessageId && !session.pendingMonoEvents?.length &&
    !session.worktreePreparing && !session.worktreeRemoved &&
    !session.codexStorageError && !session.codexStoragePreparing &&
    !session.codexStorageHeld && !session.codexStorageReturnChoice && !session.codexHomeThreadsUnresolved && !session.rotationWarning &&
    !session.blocks.some((block, index) => block.streaming || block.approval && !block.approval.decided ||
      block.tool && (["running", "pending", "in_progress", "in-progress"].includes(block.tool.status ?? "") ||
        (block.tool.background || index > turnStart) && !finished.includes(block.tool.status ?? "")));
}

function requestId(session: Session): string | undefined {
  const queued = new Set(session.queuedMessages?.map(message => message.blockId ?? message.id));
  return session.blocks.filter(block => block.role === "user" && !block.draft &&
    !queued.has(block.id) && !block.id.startsWith(RECOVERY_PREFIX) &&
    !block.appRequestId?.startsWith(RECOVERY_PREFIX)).slice(-1)[0]?.id;
}

/** One automatic recovery per original turn; a second exhaustion asks the user. */
export function createMonoUsageFailoverController() {
  const attempts = new Set<string>();
  const inflight = new Set<string>();
  return async (host: MonoUsageFailoverHost): Promise<MonoUsageFailoverResult> => {
    const original = host.session();
    if (!host.policy().enabled || !original?.usageLimit) return { kind: "manual" };
    const generation = host.generation();
    const origin = requestId(original);
    if (!origin || !/^[A-Za-z0-9_-]{1,450}$/.test(origin) || host.held() || !usageFailoverBoundarySafe(original))
      return { kind: "pause-and-ask", reason: "held" };
    // Account-owned home/thread maps need an explicit reviewed source transition.
    if (original.harness === "codex" && (original.codexStorageHome || original.providerSessionIdByHome))
      return { kind: "pause-and-ask", reason: "home-binding" };
    const receiptId = `${RECOVERY_PREFIX}${origin}`;
    const key = JSON.stringify([original.id, origin]);
    if (inflight.has(original.id) || attempts.has(key) || original.blocks.some(block => block.id === receiptId))
      return { kind: "pause-and-ask", reason: "already-attempted" };
    const select = () => selectUsageFailoverAccount(original.harness, original.providerAccountId,
      host.policy(), host.candidates(), host.now());
    const target = select();
    if (!target) return { kind: "pause-and-ask", reason: "no-eligible-account" };
    const validate = () => host.session() === original && host.generation() === generation &&
      !host.held() && usageFailoverBoundarySafe(original) && select()?.id === target.id;
    if (!validate()) return { kind: "pause-and-ask", reason: "held" };
    inflight.add(original.id);
    attempts.add(key);
    if (attempts.size > MAX_ATTEMPTS) attempts.delete(attempts.values().next().value!);
    try {
      const switched = switchMonoUsageLimitAccount(original, target.id);
      // A ready transcript handoff survives reload; pendingSwitch is memory-only.
      const handoff = appendReadyHandoff({ ...switched, pendingSwitch: undefined }, original.harness,
        original.harness, buildDeterministicHandoff(original));
      const added = new Set(switched.queuedMessages?.filter(message =>
        !original.queuedMessages?.some(previous => previous.id === message.id)).map(message => message.id));
      const continuationId = `${receiptId}-continue`;
      const next: Session = {
        ...handoff,
        blocks: [
          ...handoff.blocks.map(block => added.has(block.id)
            ? { ...block, id: continuationId, appRequestId: continuationId } : block),
          { id: receiptId, role: "system", text: `Automatic usage recovery: continuing with ${target.label} on ${original.harness}. The previous account reached its usage limit. A fresh provider thread uses the conversation handoff; the original task and queued requests are retained.` },
        ],
        queuedMessages: handoff.queuedMessages?.map(message => added.has(message.id)
          ? { ...message, id: continuationId, blockId: continuationId, appRequestId: continuationId } : message),
      };
      return await host.commit(original, next, validate)
        ? { kind: "switched", accountId: target.id }
        : { kind: "pause-and-ask", reason: "save-rejected" };
    } catch {
      return { kind: "pause-and-ask", reason: "save-rejected" };
    } finally {
      inflight.delete(original.id);
    }
  };
}
