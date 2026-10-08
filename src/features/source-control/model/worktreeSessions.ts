import type { SessionSummary } from "../../sessions/data/sessionStore";
import { compareSessionSummaries } from "../../sessions/data/sessionHistory";
import { sameProjectPath } from "../../projects/model/recents";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import type { Worktree } from "./worktrees";
import { isProjectManager } from "../../orchestration/model/projectManager";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

/** Live rows override saved checkout bindings, including unsaved blank tabs. */
export function worktreeSessionGroups(
  project: string,
  trees: readonly Worktree[],
  history: readonly SessionSummary[],
  openSessions: readonly SessionSummary[],
  teamRuns: readonly OrchestrationRun[] = [],
) {
  const teamWorkers = new Set(teamRuns.filter(run => run.ownerMonoId).flatMap(run => [...run.tasks.map(task => task.sessionId), ...(run.dispatches ?? []).map(dispatch => dispatch.sessionId)]));
  const rows = new Map(history.map((session) => [session.id, session]));
  for (const session of openSessions) {
    const saved = rows.get(session.id);
    rows.set(session.id, {
      ...saved,
      ...session,
      createdAt: saved?.createdAt ?? session.createdAt,
      updatedAt: saved?.updatedAt ?? session.updatedAt,
    });
  }
  const groups = new Map<string, SessionSummary[]>(
    trees.map((tree) => [pathKey(tree.path), []]),
  );
  // Prefer the most specific checkout when worktree folders are nested.
  const ordered = [...trees].sort((a, b) => b.path.length - a.path.length);
  for (const session of rows.values()) {
    if (
      !sameProjectPath(session.cwd, project) ||
      session.archived ||
      teamWorkers.has(session.id) ||
      isProjectManager(session.id) ||
      (session.orchestrationLeadId && !isProjectManager(session.orchestrationLeadId)) ||
      session.worktreeRemoved
    )
      continue;
    const tree = ordered.find((tree) =>
      isEqualOrInside(session.worktreeCwd || session.cwd, tree.path),
    );
    if (tree) groups.get(pathKey(tree.path))!.push(session);
  }
  for (const sessions of groups.values())
    sessions.sort(compareSessionSummaries);
  return groups;
}

export function worktreeProgress(
  sessions: readonly SessionSummary[],
  busy: ReadonlySet<string>,
  needsInput: ReadonlySet<string>,
  done: ReadonlySet<string>,
) {
  let working = 0;
  let waiting = 0;
  let finished = 0;
  for (const session of sessions) {
    if (needsInput.has(session.id)) waiting++;
    else if (busy.has(session.id)) working++;
    else if (done.has(session.id)) finished++;
  }
  return (
    [
      waiting ? `${waiting} needs input` : "",
      working ? `${working} working` : "",
      finished ? `${finished} done` : "",
    ]
      .filter(Boolean)
      .join(" · ") ||
    `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
  );
}
