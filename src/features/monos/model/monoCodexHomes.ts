import type { Session } from "../../sessions/model/session";

export function sanitizeCodexHomeThreads(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([home, id]) => !home || home.length > 4096 ||
    typeof id !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(id))) return undefined;
  return Object.fromEntries(entries);
}

/** Save the outgoing thread before selecting the current launch source's thread. */
export function selectCodexStorageHome(session: Session, prepared: { home: string; originalHome: string; threadId: string | null }): Session {
  if (session.codexHomeThreadsUnresolved) throw new Error("Codex storage needs repair: Preserve the unreadable per-home provider thread map before selecting a home.");
  const threads = { ...session.providerSessionIdByHome };
  const previous = session.codexStorageHome ?? prepared.originalHome;
  if (session.providerSessionId) threads[previous] = session.providerSessionId;
  else delete threads[previous];
  const threadId = prepared.threadId ?? undefined;
  if (threadId) threads[prepared.home] = threadId;
  else delete threads[prepared.home];
  if (!sanitizeCodexHomeThreads(threads)) throw new Error("Codex storage needs repair: Preserve the per-home provider threads before retrying.");
  return { ...session, codexStorageHome: prepared.home, providerSessionId: threadId, providerSessionIdByHome: threads };
}
