import type { Session } from "../../sessions/model/session";
import type { TeamChange } from "./monoTeam";

/** One Manager turn is one visible team action; durable receipts stay per member. */
export function appendTeamChangeCard(session: Session, managerId: string, changeId: string, changes: readonly TeamChange[]): Session {
  if (session.blocks.some(block => block.monoTeamChange?.managerId === managerId && (block.monoTeamChange.changeIds ?? [block.monoTeamChange.changeId]).includes(changeId))) return session;
  const hiring = changes.find(change => change.id === changeId)?.action === "team.hire";
  const turn = session.blocks.reduce((last, block, index) => block.role === "user" ? index : last, -1);
  const group = session.blocks.reduce((last, block, index) => index > turn && block.monoTeamChange?.managerId === managerId && (changes.find(change => change.id === block.monoTeamChange?.changeId)?.action === "team.hire") === hiring ? index : last, -1);
  if (group >= 0) return { ...session, blocks: session.blocks.map((block, index) => index === group ? { ...block, monoTeamChange: { ...block.monoTeamChange!, changeIds: [...(block.monoTeamChange!.changeIds ?? [block.monoTeamChange!.changeId]), changeId] } } : block) };
  return { ...session, blocks: [...session.blocks, { id: `mono-team-${changeId}`, role: "assistant", text: "", monoTeamChange: { managerId, changeId } }] };
}
