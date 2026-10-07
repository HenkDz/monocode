import { discoverOrchestrationSettings } from "../../orchestration/model/orchestrationCatalog";
import { orchestrator } from "../../orchestration/model/orchestration";
import type { TeamHost } from "./monoTeam";

let postCard: ((managerId: string, changeId: string) => Promise<void>) | undefined;

export function registerTeamCards(post: NonNullable<typeof postCard>) {
  postCard = post;
  return () => { if (postCard === post) postCard = undefined; };
}

export async function monoTeamHost(managerId: string, needsProfile = false): Promise<TeamHost> {
  const choices = needsProfile ? (await discoverOrchestrationSettings()).choices : [];
  const profiles = choices.reduce<TeamHost["availableProfiles"][number][]>((all, choice) => {
    const profile = all.find(profile => profile.harness === choice.harness);
    if (profile) (profile.models as string[]).push(choice.model);
    else all.push({ harness: choice.harness, models: [choice.model] });
    return all;
  }, []);
  return {
    availableProfiles: profiles,
    currentTasks: memberId => orchestrator.snapshot().filter(run => run.ownerMonoId === managerId).flatMap(run => run.tasks.filter(task => task.memberId === memberId && ["queued", "running", "blocked", "interrupted"].includes(task.status)).map(task => ({ id: task.id, title: task.title, status: task.status }))),
    cancelMemberTasks: async memberId => {
      for (const run of orchestrator.snapshot()) {
        if (run.ownerMonoId !== managerId) continue;
        for (const task of run.tasks) {
          if (task.memberId === memberId && ["running", "queued", "blocked", "interrupted"].includes(task.status))
            await orchestrator.cancelTask(run.leadId, task.id);
        }
      }
    },
    postChange: async change => {
      if (!postCard) throw new Error("Manager chat is unavailable");
      await postCard(managerId, change.id);
    },
  };
}
