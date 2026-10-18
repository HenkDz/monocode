import { useEffect, useState } from "react";
import {
  getSession,
  listSessionsByProject,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import type { Session } from "../../sessions/model/session";
import { isLegacyManagerSession } from "../model/legacyManagerSessions";
import { MonoActivityContent } from "./MonoActivityPanel";
import { PageHeader } from "./monoPanelParts";

export function ArchivedManagerConversations({
  project,
  onOpen,
}: {
  project: string;
  onOpen: (id: string) => void;
}) {
  const [rows, setRows] = useState<SessionSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void listSessionsByProject(project)
      .then((sessions) => {
        if (live)
          setRows(
            sessions.filter(
              (session) => session.archived && isLegacyManagerSession(session),
            ),
          );
      })
      .catch((reason) => {
        if (live) setError(String(reason));
      });
    return () => {
      live = false;
    };
  }, [project]);
  if (!rows.length && !error) return null;
  return (
    <div className="border-t border-stroke px-4 py-3">
      <p className="mb-1 text-[11px] text-content/45">Archived conversations</p>
      {error ? (
        <p role="alert" className="text-xs text-content/60">
          {error}
        </p>
      ) : (
        rows.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onOpen(session.id)}
            className="block w-full truncate rounded-md px-1 py-1.5 text-left text-xs text-content/70 hover:bg-content/5 focus-visible:outline-accent"
          >
            {session.title || "Previous Manager conversation"}
          </button>
        ))
      )}
    </div>
  );
}

/** Archived history opens here without adoption, a composer, or adding a recent chat. */
export function ArchivedManagerConversation({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void getSession(id)
      .then((value) => {
        if (!live) return;
        if (value) setSession(value);
        else setError("This archived conversation is unavailable.");
      })
      .catch((reason) => {
        if (live) setError(String(reason));
      });
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-archived-manager-conversation
    >
      <PageHeader
        title={session?.title || "Archived conversation"}
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="p-4 text-xs text-content/60">
            {error}
          </p>
        ) : session ? (
          <MonoActivityContent
            blocks={session.blocks}
            live={false}
            cwd={session.cwd}
            readOutput
          />
        ) : (
          <p role="status" className="p-4 text-xs text-content/45">
            Loading conversation…
          </p>
        )}
      </div>
    </div>
  );
}
