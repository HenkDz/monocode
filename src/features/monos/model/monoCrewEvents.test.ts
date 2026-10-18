// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { crewMessages, deliverCrewMessage, recordCrewMessage, subscribeCrewMessages, teamMessageRequiresReply } from "./monoCrewEvents";
beforeEach(() => localStorage.clear());
it("stores teammate events once and notifies the feed", () => {
  let changed = 0;
  const unsubscribe = subscribeCrewMessages(() => changed++);
  const event = { id: "turn:request", managerId: "manager", senderId: "ui", recipientId: "backend", topic: "api", text: "Which endpoint?", at: 1 };
  recordCrewMessage(event);
  recordCrewMessage(event);
  expect(crewMessages()).toEqual([event]);
  expect(changed).toBe(1);
  unsubscribe();
});
it("shows acknowledgement messages in the feed without delivering a recipient turn", async () => {
  const recipientTurn = vi.fn(async () => {});
  const event = { id: "closure", managerId: "manager", senderId: "manager", recipientId: "orchestrator", topic: "closed", text: "Closure complete; no reply needed", at: 2, requiresReply: false };
  await deliverCrewMessage(event, recipientTurn);
  expect(recipientTurn).not.toHaveBeenCalled();
  expect(crewMessages()).toEqual([event]);
});
it.each([undefined, true])("delivers real questions with requiresReply=%s before storing the feed receipt", async requiresReply => {
  const event = { id: "question", managerId: "manager", senderId: "manager", recipientId: "orchestrator", topic: "decision", text: "Which scope should we use?", at: 3, requiresReply };
  const recipientTurn = vi.fn(async () => { expect(crewMessages()).toEqual([]); });
  await deliverCrewMessage(event, recipientTurn);
  expect(recipientTurn).toHaveBeenCalledOnce();
  expect(crewMessages()[0].id).toBe("question");
});
it("does not save a feed receipt when recipient delivery fails", async () => {
  await expect(deliverCrewMessage({ id: "question", managerId: "manager", senderId: "ui", recipientId: "backend", topic: "api", text: "Which endpoint?", at: 1 }, async () => { throw Error("Unavailable"); })).rejects.toThrow("Unavailable");
  expect(crewMessages()).toEqual([]);
});
it.each([null, "false", 0, {}])("rejects nonboolean requiresReply=%s", value => {
  expect(() => teamMessageRequiresReply(value)).toThrow("must be a boolean");
});
