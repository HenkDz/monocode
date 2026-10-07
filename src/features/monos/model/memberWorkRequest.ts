import { assertDirectReport } from "./monoOrg";
import { monoLook, type Mono } from "./mono";
import type { GoalOrigin } from "./monoManagerGoals";

export async function requestMemberWork(roster: readonly Mono[], memberId: string, origin: GoalOrigin | undefined, requestId: string, input: Record<string, unknown>, host: {
  delegate(manager: Mono, requestId: string, input: Record<string, unknown>): Promise<unknown>;
  notify(manager: Mono, member: Mono, receipt: unknown, requestId: string): Promise<void>;
}) {
  const member = roster.find(m => m.id === memberId);
  const manager = roster.find(m => m.id === member?.reportsTo);
  if (!member || !manager || origin?.kind !== "user") throw Error("Only a direct user request in a member chat can request work");
  assertDirectReport(roster, manager.id, member.id, "worker");
  if (Object.keys(input).some(key => !["title", "prompt", "files"].includes(key)) ||
      typeof input.title !== "string" || !input.title.trim() || input.title.length > 160 ||
      typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 16000 ||
      !Array.isArray(input.files) || !input.files.length || input.files.some(path => typeof path !== "string" || !path.trim())) throw Error("Expected title, prompt and at least one file/directory scope in files");
  if (!member.workerProfile) throw Error("Choose the member's installed model before requesting work");
  const look = monoLook(member);
  const receipt = await host.delegate(manager, `member-${member.id}-${requestId}`, {
    ...input, ...member.workerProfile, member: member.id,
    memberName: look.name, memberMascot: look.mascot, memberColor: look.color, origin: "user",
  });
  await host.notify(manager, member, receipt, requestId);
  return receipt;
}
