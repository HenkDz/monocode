import { expect, it } from "vitest";
import { appendTeamChangeCard } from "./monoTeamCards";
import { newSession, type Session } from "../../sessions/model/session";
import type { TeamChange } from "./monoTeam";

it("groups hires in one Manager turn, retries idempotently, and keeps later actions separate", () => {
  const changes = ["a", "b", "c"].map(id => ({ id, action: "team.hire" })) as TeamChange[];
  let session: Session = { ...newSession("codex", "/repo"), blocks: [{ id: "turn", role: "user", text: "Hire a team" }] };
  session = appendTeamChangeCard(session, "manager", "a", changes);
  session = appendTeamChangeCard(session, "manager", "b", changes);
  expect(session.blocks.filter(block => block.monoTeamChange)).toHaveLength(1);
  expect(session.blocks[1].monoTeamChange?.changeIds).toEqual(["a", "b"]);
  expect(appendTeamChangeCard(session, "manager", "b", changes)).toBe(session);
  session.blocks.push({ id: "later", role: "user", text: "Hire another" });
  expect(appendTeamChangeCard(session, "manager", "c", changes).blocks.filter(block => block.monoTeamChange)).toHaveLength(2);
  const updated = appendTeamChangeCard(session, "manager", "update", [{ id: "update", action: "team.update" } as TeamChange, ...changes]);
  expect(updated.blocks[updated.blocks.length - 1].monoTeamChange?.changeId).toBe("update");
});
