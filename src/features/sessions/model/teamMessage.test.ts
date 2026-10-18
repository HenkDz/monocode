import { expect, it } from "vitest";
import { appendSteerUser, appendUser } from "../../../integrations/harness/core/apply";
import { teamMessageEnvelope } from "../../monos/model/monoOrg";
import type { Mono } from "../../monos/model/mono";
import { newSession } from "./session";
import { lastUserTurnBlock } from "./editLastTurn";
import { sanitizeSessionForPersist } from "../data/sessionStore";
import { isUserMessage, parseTeamMessage } from "./teamMessage";

it.each([["manager", "orchestrator"], ["member", "manager"], ["member", "member"]])("retains sender identity for %s to %s delivery and worker steering", (senderRole, recipientRole) => {
  const sender = { id: "sender", name: "Backend", mascot: "fox", color: "#abc", role: senderRole } as Mono;
  const recipient = { id: "recipient", name: "Manager", role: recipientRole } as Mono;
  const text = teamMessageEnvelope(sender, recipient, "api", "Which endpoint?");
  for (const append of [appendUser, appendSteerUser]) {
    const session = append(appendUser(newSession("codex", "/tmp"), "User instruction"), text);
    expect(session.blocks[1].monoTeamMessage).toEqual({ id: "sender", name: "Backend", mascot: "fox", color: "#abc", topic: "api", text: "Which endpoint?" });
    expect(isUserMessage(session.blocks[1])).toBe(false);
    expect(lastUserTurnBlock(session.blocks)).toBeUndefined();
    const saved = sanitizeSessionForPersist(session);
    expect(saved.blocks[1].monoTeamMessage).toEqual(session.blocks[1].monoTeamMessage);
  }
});

it("recognizes legacy team envelopes without reclassifying ordinary user text", () => {
  expect(parseTeamMessage("Team message from Backend to Manager (api):\nQuestion\n\nReply directly with app team.message {}.")).toMatchObject({ name: "Backend", text: "Question" });
  expect(parseTeamMessage("Team message from someone: please investigate")).toBeUndefined();
  expect(isUserMessage({ id: "user", role: "user", text: "Team message from someone: please investigate" })).toBe(true);
});
