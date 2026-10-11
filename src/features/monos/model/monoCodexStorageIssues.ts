import type { Session } from "../../sessions/model/session";

export type MonoCodexStorageIssue = {
  accountId: string;
  detail: string;
  sessionIds: string[];
  blockedContext: string;
};

export function codexStorageAccountId(session: Session, selected?: string): string {
  return session.codexStorageAccountId ?? session.providerAccountId ?? selected ?? "default";
}

export function codexStorageBlockedContext(session: Session, name: string): string {
  const count = session.queuedMessages?.filter(message => !message.monoSessionCompletion && !message.monoSource).length ?? 0;
  if (count) return `${count} queued message${count === 1 ? "" : "s"} on ${name} ${count === 1 ? "is" : "are"} waiting`;
  if (session.blocks.some(block => block.draft)) return `An unsent message on ${name} is waiting`;
  return `${name} is waiting for storage repair`;
}

/** One account issue can hold submissions in several conversations. */
export function monoCodexStorageIssues(
  sessions: readonly Session[],
  selected: (session: Session) => string | undefined,
  name: (session: Session) => string,
): MonoCodexStorageIssue[] {
  const issues = new Map<string, MonoCodexStorageIssue>();
  for (const session of sessions) {
    if (session.harness !== "codex" || !session.codexStorageError) continue;
    const accountId = codexStorageAccountId(session, selected(session));
    const issue = issues.get(accountId);
    if (issue) {
      issue.sessionIds.push(session.id);
      issue.blockedContext += `; ${codexStorageBlockedContext(session, name(session))}`;
    } else {
      issues.set(accountId, {
        accountId,
        detail: session.codexStorageError,
        sessionIds: [session.id],
        blockedContext: codexStorageBlockedContext(session, name(session)),
      });
    }
  }
  return [...issues.values()];
}
