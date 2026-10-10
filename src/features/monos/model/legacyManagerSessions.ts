import { projectKey } from "../../../shared/lib/paths";
import type { Mono } from "./mono";

type Conversation = { id: string; cwd: string; title?: string };
const archivedManagers = new Set<string>();
// Session hydration also imports this helper, so importing mono's runtime here creates a cycle.
function sessionOwners(): Mono[] {
  try {
    const roster: unknown = JSON.parse(
      localStorage.getItem("monocode:mono-roster") ?? "[]",
    );
    return Array.isArray(roster)
      ? roster.filter(
          (entry): entry is Mono =>
            !!entry &&
            typeof entry === "object" &&
            typeof entry.sessionId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** Retain old Manager transcripts as archives, never as competing active Managers. */
export function isLegacyManagerSession(
  session: Conversation,
  roster: readonly Mono[] = sessionOwners(),
  home?: string,
): boolean {
  if (archivedManagers.has(session.id)) return true;
  const owner = roster.find((mono) => mono.sessionId === session.id);
  const homeFolder =
    session.cwd === "~" ||
    (!!home && projectKey(session.cwd) === projectKey(home));
  if (
    homeFolder &&
    (owner?.role === "manager" ||
      session.title?.trim().toLocaleLowerCase() === "manager")
  )
    return true;
  return session.id.startsWith("project-manager-") && !owner;
}

export async function archiveLegacyManagerSessions<
  T extends Conversation & { archived?: boolean },
>(
  sessions: readonly T[],
  archive: (id: string) => Promise<void>,
  home?: string,
): Promise<(T & { archived?: boolean })[]> {
  return Promise.all(
    sessions.map(async (session) => {
      if (!isLegacyManagerSession(session, undefined, home)) return session;
      if (!session.archived) await archive(session.id);
      archivedManagers.add(session.id);
      return { ...session, archived: true };
    }),
  );
}
