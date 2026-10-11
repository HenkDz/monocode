import { findMono, listMonos, monoForSession } from "../../features/monos/model/mono";
import { habitRunMono } from "../../features/monos/model/monoHabits";
import { monoSkillsRole, resolveMonoSkillsPolicy, type MonoSkillsContext } from "../../features/monos/model/monoSkills";
import { orchestrator } from "../../features/orchestration/model/orchestration";

export function monoSkillsForSession(sessionId: string): MonoSkillsContext & { codexStore?: "mono" } {
  const run = orchestrator.forSession(sessionId);
  const task = run?.tasks.find(task => task.sessionId === sessionId);
  const mono = monoForSession(sessionId) ?? findMono(habitRunMono(sessionId) ?? "") ?? findMono(task?.memberId ?? "");
  if (!mono && (!task || !run?.ownerMonoId)) return {};
  const roster = listMonos();
  const skillsPolicy = mono ? resolveMonoSkillsPolicy(mono, roster)
    : roster.find(owner => owner.id === run?.ownerMonoId)?.teamSkillsPolicy ?? { mode: "role" as const };
  return { codexStore: "mono", skillsRole: monoSkillsRole(mono, !!task?.reviewOf), skillsPolicy };
}
