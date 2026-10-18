import { projectKey } from "../../../shared/lib/paths";
import { listMonos, setMonoArchive, type Mono } from "./mono";
import { monoEngineId } from "./monoEngines";
import type { Orchestrator } from "../../orchestration/model/orchestration";
import { stopStreaming } from "../../../integrations/harness/core/apply";
import type { Session } from "../../sessions/model/session";

/** Restoring identity must not restart saved messages or recovered goal receipts. */
export function archiveMonoConversation(session: Session): Session {
  return { ...stopStreaming(session), queueStatus: "paused" };
}

/** The dedicated Manager and its members, including an already archived team. */
export function projectMonoTeam(project: string): Mono[] {
  const roster = listMonos(true);
  const manager = roster.find(
    (mono) =>
      mono.role === "manager" &&
      mono.projects.length === 1 &&
      projectKey(mono.projects[0]) === projectKey(project),
  );
  return manager
    ? roster.filter(
        (mono) => mono.id === manager.id || mono.reportsTo === manager.id,
      )
    : [];
}

export async function archiveProjectMonos(
  project: string,
  engine: Pick<Orchestrator, "snapshot" | "stopRun">,
  stopConversation: (id: string) => Promise<void>,
): Promise<Mono[]> {
  const team = projectMonoTeam(project);
  if (!team.length) return team;
  const ids = new Set(team.map((mono) => mono.id));
  // Hide before awaiting stops so background Manager polling cannot schedule more work.
  setMonoArchive(ids, Date.now());
  const sessions = new Set(
    team.flatMap((mono) => (mono.sessionId ? [mono.sessionId] : [])),
  );
  const engines = new Set(
    engine
      .snapshot()
      .filter(
        (run) =>
          (run.ownerMonoId && ids.has(run.ownerMonoId)) ||
          sessions.has(run.ownerSessionId ?? run.leadId),
      )
      .map((run) => run.leadId),
  );
  for (const mono of team) {
    for (const folder of new Set([
      ...mono.projects,
      ...(mono.workerProjects ?? []),
      ...(mono.managerProject ? [mono.managerProject] : []),
    ]))
      engines.add(await monoEngineId(mono, folder));
  }
  const stopped = await Promise.allSettled([
    ...[...engines].map((id) => engine.stopRun(id, { retainWorktrees: true })),
    ...[...sessions].map(stopConversation),
  ]);
  const failed = stopped.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return team;
}

/** Reopening offers identity/history restoration, never automatically resumes runs. */
export function offerProjectMonoRestore(
  project: string,
  confirm: (message: string) => boolean = window.confirm.bind(window),
): boolean {
  const team = projectMonoTeam(project);
  if (!team.some((mono) => mono.archivedAt != null)) return false;
  if (
    !confirm(
      `Restore this project's archived Manager and ${team.length - 1} team members? Their history and worktrees were kept. Stopped runs will not resume automatically.`,
    )
  )
    return false;
  setMonoArchive(new Set(team.map((mono) => mono.id)));
  return true;
}
