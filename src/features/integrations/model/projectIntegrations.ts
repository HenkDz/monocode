import { isEqualOrInside, pathKey, projectName } from "../../../shared/lib/paths";
import { IS_WIN } from "../../../platform/tauri/platform";
import { listSkills } from "../../../platform/tauri/fs";
import { githubStatus } from "../../inbox/model/githubTasks";
import { loadSkills } from "../../skills/model/skills";
import { monoCodexSkillsCatalog } from "../../../integrations/harness/core/child";
import { enabledMonoSkills } from "../../monos/model/monoSkills";
import { monoSkillsForSession } from "../../../app/model/monoSkillsForSession";
import { sessionWorkCwd, type Session } from "../../sessions/model/session";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { OwnedDecision } from "../../commandCenter/model/decisionView";
import { installCapabilityRequest } from "./integrationCapabilities";
import type { IntegrationRequestView } from "../ui/IntegrationRequestCard";
import type { ConnectedIntegration } from "../ui/Integrations";

export const INTEGRATIONS_SCOPE = "command-center:integrations";

/** Only authenticated Ask fields supply the actor/project/session; context supplies inspectable evidence. */
export function projectSkillRequest({ managerId, decision }: OwnedDecision, roster: readonly Mono[], sessions: readonly Session[],
  runs: readonly OrchestrationRun[], goals: readonly MonoManagerGoal[]): IntegrationRequestView | undefined {
  const request = installCapabilityRequest(decision);
  const manager = roster.find(mono => mono.id === managerId && mono.role === "manager" && mono.archivedAt == null);
  const requester = roster.find(mono => mono.id === decision.requestingMonoId && mono.archivedAt == null);
  const session = sessions.find(session => session.id === decision.requesterSessionId);
  if (!request || decision.readOnly || decision.noLongerNeededAt != null || !manager || !requester?.role || !session ||
      !/^[A-Za-z]:[/\\]/.test(decision.projectId) || !manager.projects.some(project => pathKey(project) === pathKey(decision.projectId)) ||
      (requester.role !== "orchestrator" && !decision.escalationChain.some(entry => entry.id === manager.id)) || !decision.options.some(option => option.id === "later")) return;
  if (requester.role === "member" ? requester.reportsTo !== manager.id : requester.role === "manager" ? requester.id !== manager.id : manager.reportsTo !== requester.id) return;
  const run = runs.find(run => run.tasks.some(task => task.sessionId === session.id && task.memberId === requester.id));
  if (run?.ownerMonoId && run.ownerMonoId !== manager.id) return;
  if (requester.sessionId !== session.id && !run) return;
  const actualProject = run?.workspace?.projectCwd ?? run?.cwd ?? (requester.role === "orchestrator" ? session.cwd : requester.projects[0]);
  if (!actualProject) return;
  if (pathKey(actualProject) !== pathKey(decision.projectId)) return;
  if (decision.taskId && !run?.tasks.some(task => task.id === decision.taskId && task.sessionId === session.id && task.status !== "cancelled")) return;
  const goal = decision.goalId ? goals.find(goal => goal.id === decision.goalId && goal.monoId === managerId && pathKey(goal.projectId) === pathKey(decision.projectId)) : undefined;
  if (decision.goalId && (!goal || goal.state === "cancelled" || goal.state === "done")) return;
  return { id: decision.id, request, name: request.name, requester: requester.name ?? requester.specialty ?? requester.id,
    project: projectName(decision.projectId), projectPath: decision.projectId, mono: requester.name ?? requester.id, goal: goal?.title ?? "",
    provider: "skill", available: IS_WIN, answerable: decision.status === "waiting", status: decision.status === "answered" && decision.answer === decision.options.find(option => option.id === "later")?.label ? "declined" : "pending" };
}

/** Uses the existing catalog and consumer selection; no preferences are changed. */
export async function loadProjectIntegrations(project: string, requests: readonly IntegrationRequestView[], sessions: readonly Session[],
  decisions: readonly OwnedDecision[]): Promise<ConnectedIntegration[]> {
  const [discovered, github] = await Promise.all([listSkills(project), githubStatus().catch(() => undefined)]);
  const rows: ConnectedIntegration[] = discovered.filter(skill => skill.scope === "project" && isEqualOrInside(skill.path, project)).map(skill => ({
    id: skill.path, name: skill.name, provider: "skill", scope: projectName(project), projectPath: project, skillPath: skill.path, monos: [], available: true,
  }));
  for (const request of requests) {
    const ask = decisions.find(item => item.decision.id === request.id)?.decision;
    const session = sessions.find(session => session.id === ask?.requesterSessionId);
    if (!session || session.harness !== "codex") continue;
    const context = monoSkillsForSession(session.id);
    if (!context.skillsPolicy || !context.skillsRole) continue;
    try {
      const cwd = sessionWorkCwd(session);
      const [catalog, commands] = await Promise.all([monoCodexSkillsCatalog(session.providerAccountId, cwd), loadSkills({ harness: session.harness, cwd, sessionId: session.id }, { refresh: true })]);
      const selected = new Set(enabledMonoSkills(catalog, context.skillsRole, context.skillsPolicy));
      for (const row of rows) {
        const exact = catalog.skills.find(skill => pathKey(skill.path) === pathKey(row.skillPath!) && selected.has(skill.id));
        if (exact && commands.some(command => command.kind === "file" ? pathKey(command.path) === pathKey(exact.path)
          : command.kind === "native" && !!command.origin && pathKey(command.origin) === pathKey(exact.path))) {
          if (!row.monos.includes(request.mono)) row.monos.push(request.mono);
          row.skillDelivery = "discovered";
        }
      }
    } catch { /* Without exact consumer proof the row stays simply Installed. */ }
  }
  if (github?.installed && github.authenticated) rows.push({ id: "github-cli", name: "GitHub", provider: "gh CLI", scope: projectName(project), monos: [], available: true });
  return rows;
}
