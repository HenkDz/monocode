// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { acceptMonoRotation, loadMonoRotation, saveMonoRotation } from "../../monos/model/monoRotation";
import { createEditedResendAttempt, prepareEditedResend } from "./editLastTurn";
import { newSession } from "./session";

beforeEach(() => localStorage.clear());

it("keeps pending text unchanged through abandoned edit preparation and reload, then permits editing after acceptance", () => {
  const session = { ...newSession("pi", "/synthetic"), id: "pending-edit", blocks: [
    { id: "original", role: "user" as const, text: "Keep the original scope." },
  ] };
  const carry = { at: 1, reason: "context" as const, earlier: [], pendingBrief: "Original assignment.", pendingInput: session.blocks[0].text };
  expect(saveMonoRotation(session.id, carry)).toBe(true);
  expect(prepareEditedResend(session)).toBeNull();
  expect(createEditedResendAttempt(session)).toBeNull();
  const saved = localStorage.getItem("monocode:mono-rotations")!;
  localStorage.clear();
  localStorage.setItem("monocode:mono-rotations", saved);
  expect(loadMonoRotation(session.id)).toEqual(carry);
  expect(createEditedResendAttempt(session)).toBeNull();
  acceptMonoRotation(session.id, carry.at);
  expect(createEditedResendAttempt(session)?.blocks).toEqual([]);
});
