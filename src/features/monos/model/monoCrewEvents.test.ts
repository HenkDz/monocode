// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { crewMessages, recordCrewMessage, subscribeCrewMessages } from "./monoCrewEvents";
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
