// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  acceptMonoRotation,
  assertMonoRotationCurrent,
  discardMonoRotationPendingInputs,
  forgetMonoRotation,
  loadMonoRotation,
  MONO_ROTATION_READ_ERROR,
  previewMonoRotationDiscard,
  saveMonoRotation,
  sessionRotationStatus,
  type MonoRotation,
} from "./monoRotation";

const KEY = "monocode:mono-rotations";
const sessionIds = new Set<string>();

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});

afterEach(() => {
  for (const id of sessionIds) forgetMonoRotation(id);
  sessionIds.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pending(id: string): MonoRotation {
  sessionIds.add(id);
  const rotation: MonoRotation = {
    at: 1,
    reason: "context",
    afterBlockId: "scope",
    earlier: [],
    pendingBrief: "Keep the scope. Original assignment: parser only.",
    pendingInput: "Verify only; do not publish.",
    userRequests: [{ id: "scope", text: "Keep the scope." }],
  };
  expect(saveMonoRotation(id, rotation)).toBe(true);
  return rotation;
}

function stored(id: string): MonoRotation | undefined {
  return JSON.parse(localStorage.getItem(KEY)!)[id];
}

it("distinguishes a readable absent carry from an unreadable store", () => {
  expect(loadMonoRotation("missing")).toBeUndefined();
  expect(sessionRotationStatus({ id: "missing", blocks: [] })).toEqual({});
});

it.each([
  null, [], {},
  { at: "1" }, { reason: "unknown" }, { earlier: [false] },
  { afterBlockId: 1 }, { references: [null] }, { discardedInputIds: "scope" },
  { userRequests: [{ id: "scope" }] }, { userRequests: false },
  { pendingBrief: undefined }, { pendingBrief: "" }, { pendingBrief: " \n " },
  { pendingBrief: null }, { pendingInput: false }, { pendingInputs: [null] },
  { futureAuthority: "Do not discard unknown restrictions." },
  { userRequests: [{ id: "scope", text: "Keep the scope.", futureAuthority: "Never publish." }] },
  { userRequests: [{ id: "scope", text: "Keep the scope.", futureAuthority: { restrictions: ["Never publish."] } }] },
])("rejects malformed entries without replacing their protected bytes: %j", change => {
  const id = "invalid-entry";
  const original = pending(id);
  const broken = change && !Array.isArray(change) && Object.keys(change).length
    ? { ...original, ...change } : change;
  localStorage.setItem(KEY, JSON.stringify({ [id]: broken }));
  const before = localStorage.getItem(KEY);
  expect(loadMonoRotation(id)).toBeNull();
  expect(sessionRotationStatus({ id, blocks: [] }, "Retry")).toEqual({ deferredReason: MONO_ROTATION_READ_ERROR });
  expect(() => assertMonoRotationCurrent(id, original)).toThrow(MONO_ROTATION_READ_ERROR);
  expect(saveMonoRotation(id, original)).toBe(false);
  forgetMonoRotation(id);
  expect(localStorage.getItem(KEY)).toBe(before);
  localStorage.setItem(KEY, JSON.stringify({ [id]: original }));
  expect(sessionRotationStatus({ id, blocks: [] }, "Retry").plan?.brief(id)).toContain(original.pendingInput);
});

it.each(["idle", "restart", "context"] as const)("keeps valid settled and legacy %s carries readable", reason => {
  const settled: MonoRotation = { at: 0, reason, earlier: ["Prior exchange."], userRequests: [{ id: "scope", text: "Keep the scope." }] };
  expect(saveMonoRotation("legacy", settled)).toBe(true);
  expect(loadMonoRotation("legacy")).toEqual(settled);
  const legacy = { ...settled, pendingBrief: "Retained scope and assignment." };
  expect(saveMonoRotation("legacy", legacy)).toBe(true);
  expect(loadMonoRotation("legacy")).toEqual(legacy);
  expect(sessionRotationStatus({ id: "legacy", blocks: [] }, "Retry").plan?.brief("legacy")).toContain(legacy.pendingBrief);
  expect(loadMonoRotation("toString")).toBeUndefined();
});

it.each([false, true])("compare-and-save preserves a carry changed after planning (existing: %s)", existing => {
  const id = "plan-race";
  if (existing) pending(id);
  const session = { id, blocks: [], providerSessionId: "old", context: { used: 700, window: 1000 } };
  const plan = sessionRotationStatus(session, "Retry").plan!;
  const newer = { ...plan.rotation, pendingInputs: ["Never publish; keep every result local."] };
  expect(saveMonoRotation(id, newer)).toBe(true);
  const before = localStorage.getItem(KEY);
  expect(saveMonoRotation(id, plan.rotation, plan.expected)).toBe(false);
  expect(() => assertMonoRotationCurrent(id, plan.expected)).toThrow("carry changed");
  expect(localStorage.getItem(KEY)).toBe(before);
  const retry = sessionRotationStatus(session, "Retry").plan!;
  expect(retry.brief(id)).toContain(newer.pendingInputs[0]);
  expect(saveMonoRotation(id, retry.rotation, retry.expected)).toBe(true);
});

it("compares accepted settled receipts while durable clearing is still retrying", () => {
  vi.useFakeTimers();
  const id = "settled-receipt";
  const receipt = pending(id);
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw Error("full"); });
  acceptMonoRotation(id, receipt.at, undefined, receipt);
  const settled = loadMonoRotation(id)!;
  expect(settled.pendingBrief).toBeUndefined();
  expect(() => assertMonoRotationCurrent(id, settled)).not.toThrow();
  const plan = sessionRotationStatus({ id, blocks: [], providerSessionId: "accepted", context: { used: 700, window: 1000 } }, "Continue").plan!;
  expect(plan.expected).toEqual(settled);
  expect(saveMonoRotation(id, plan.rotation, plan.expected)).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(stored(id)).toEqual(plan.rotation);
});

it.each(["throws", "{invalid", "null", "[]", "false", "42", '"text"'])(
  "blocks planning and mutation when saved context is unreadable: %s", mode => {
    const id = "read-recovery";
    const carry = pending(id);
    const before = localStorage.getItem(KEY);
    const session = { id, blocks: [{ id: "scope", role: "user" as const, text: "Keep the scope." }] };
    const preview = previewMonoRotationDiscard(session)!;
    const getItem = localStorage.getItem.bind(localStorage);
    const read = vi.spyOn(localStorage, "getItem").mockImplementation(key => {
      if (key !== KEY) return getItem(key);
      if (mode === "throws") throw Error("temporary read outage");
      return mode;
    });
    const writes = vi.spyOn(localStorage, "setItem");
    expect(loadMonoRotation(id)).toBeNull();
    for (const providerSessionId of [undefined, "old-provider"]) {
      const current = { ...session, providerSessionId, context: { used: 700, window: 1000 } };
      expect(sessionRotationStatus(current, "Retry")).toEqual({ deferredReason: MONO_ROTATION_READ_ERROR });
      expect(sessionRotationStatus(current, "Edited", "", session.blocks)).toEqual({ deferredReason: MONO_ROTATION_READ_ERROR });
    }
    expect(saveMonoRotation(id, carry)).toBe(false);
    expect(discardMonoRotationPendingInputs(session, preview)).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    read.mockRestore();
    expect(localStorage.getItem(KEY)).toBe(before);
    const retry = sessionRotationStatus(session, "Retry").plan!;
    expect(retry.brief(id)).toContain(carry.pendingBrief);
    expect(retry.brief(id)).toContain(carry.pendingInput);
  },
);

it("preserves provider acceptance, suppresses replay, and durably clears after backed-off storage recovery", async () => {
  vi.useFakeTimers();
  const receipt = pending("accept-recovery");
  const warning = vi.fn();
  const setItem = vi.spyOn(localStorage, "setItem")
    .mockImplementationOnce(() => { throw new Error("full"); })
    .mockImplementationOnce(() => { throw new Error("full"); });
  expect(() => acceptMonoRotation("accept-recovery", receipt.at, warning, receipt)).not.toThrow();
  expect(warning).toHaveBeenCalledTimes(1);
  expect(warning.mock.calls[0][0]).toContain("provider accepted");
  expect(stored("accept-recovery")?.pendingBrief).toBe(receipt.pendingBrief);
  expect(loadMonoRotation("accept-recovery")?.pendingBrief).toBeUndefined();
  expect(sessionRotationStatus({ id: "accept-recovery", providerSessionId: "accepted", context: { used: 1, window: 1000 }, blocks: [] })).toEqual({});
  await vi.advanceTimersByTimeAsync(249);
  expect(setItem).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(setItem).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(499);
  expect(setItem).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(setItem).toHaveBeenCalledTimes(3);
  expect(stored("accept-recovery")?.pendingBrief).toBeUndefined();
  expect(stored("accept-recovery")?.pendingInput).toBeUndefined();
  expect(stored("accept-recovery")?.userRequests).toEqual(receipt.userRequests);
  expect(warning).toHaveBeenLastCalledWith();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(setItem).toHaveBeenCalledTimes(3);
});

it("refuses stale acceptance receipts even when a newer carry has the same rotation timestamp", () => {
  const original = pending("stale-receipt");
  const newer = { ...original, pendingInputs: ["New restriction: account B only."] };
  saveMonoRotation("stale-receipt", newer);
  const warning = vi.fn();
  acceptMonoRotation("stale-receipt", original.at, warning, original);
  expect(loadMonoRotation("stale-receipt")).toEqual(newer);
  expect(warning).not.toHaveBeenCalled();
  acceptMonoRotation("stale-receipt", original.at + 1, warning, newer);
  expect(stored("stale-receipt")).toEqual(newer);
});

it("retains acceptance and unrelated carries through a temporary storage read outage", async () => {
  vi.useFakeTimers();
  const receipt = pending("accept-read-outage");
  const other = pending("unrelated-carry");
  const warning = vi.fn();
  const setItem = vi.spyOn(localStorage, "setItem");
  const getItem = vi.spyOn(localStorage, "getItem")
    .mockImplementation(() => { throw new Error("unavailable"); });
  acceptMonoRotation("accept-read-outage", receipt.at, warning, receipt);
  expect(loadMonoRotation("accept-read-outage")?.pendingBrief).toBeUndefined();
  expect(saveMonoRotation("new-carry", receipt)).toBe(false);
  expect(setItem).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledTimes(1);
  getItem.mockRestore();
  expect(stored("accept-read-outage")).toEqual(receipt);
  await vi.advanceTimersByTimeAsync(250);
  expect(stored("accept-read-outage")?.pendingBrief).toBeUndefined();
  expect(stored("unrelated-carry")).toEqual(other);
  expect(warning).toHaveBeenLastCalledWith();
});

it("allows an accepted input to be edited without retaining its superseded protected request", () => {
  const carry = pending("accepted-edit");
  const edited = { id: "accepted", role: "user" as const, text: "Inspect the parser only." };
  saveMonoRotation("accepted-edit", {
    ...carry,
    userRequests: [...carry.userRequests!, { id: edited.id, text: edited.text }],
  });
  acceptMonoRotation("accepted-edit", carry.at);
  const plan = sessionRotationStatus({
    id: "accepted-edit", providerSessionId: "accepted", context: { used: 700, window: 1000 },
    blocks: [{ id: "scope", role: "user", text: "Keep the scope." }],
  }, "Inspect the renderer only.", "", [edited]).plan!;
  expect(plan).toBeDefined();
  expect(plan.rotation.userRequests).toEqual(carry.userRequests);
  expect(plan.brief("accepted-edit")).not.toContain(edited.text);
});

it("cancels an old clear retry when storage contains a newer carry with the same timestamp", async () => {
  vi.useFakeTimers();
  const original = pending("retry-stale");
  const warning = vi.fn();
  const setItem = vi.spyOn(localStorage, "setItem")
    .mockImplementationOnce(() => { throw new Error("full"); });
  acceptMonoRotation("retry-stale", original.at, warning, original);
  const newer = { ...original, pendingInput: "New input must survive." };
  localStorage.setItem(KEY, JSON.stringify({ "retry-stale": newer }));
  await vi.advanceTimersByTimeAsync(250);
  expect(loadMonoRotation("retry-stale")).toEqual(newer);
  expect(warning).toHaveBeenLastCalledWith();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(setItem).toHaveBeenCalledTimes(2);
  expect(stored("retry-stale")).toEqual(newer);
});

it.each(["save", "forget"])("cancels a failed acceptance clear after a subsequent %s", async (action) => {
  vi.useFakeTimers();
  const original = pending(`cancel-${action}`);
  const warning = vi.fn();
  const setItem = vi.spyOn(localStorage, "setItem")
    .mockImplementationOnce(() => { throw new Error("full"); });
  acceptMonoRotation(`cancel-${action}`, original.at, warning, original);
  if (action === "save") saveMonoRotation(`cancel-${action}`, { ...original, at: 2 });
  else forgetMonoRotation(`cancel-${action}`);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(setItem).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenLastCalledWith();
  expect(stored(`cancel-${action}`)?.at).toBe(action === "save" ? 2 : undefined);
});

it("discards all previewed pending inputs by their failed block IDs, preserving earlier identical constraints", () => {
  const original = pending("discard-inputs");
  const text = "Do not publish.";
  const blocks: Block[] = [
    { id: "scope", role: "user", text },
    { id: "failed-a", role: "user", text },
    { id: "failed-b", role: "user", text: "x".repeat(8001) },
  ];
  const carry = {
    ...original,
    pendingBrief: `${text}\n${original.pendingBrief}`,
    pendingInput: blocks[2].text,
    pendingInputs: [text, blocks[2].text],
    userRequests: blocks.map(({ id, text }) => ({ id, text })),
    references: ['Goal: "goal-1"'],
  };
  saveMonoRotation("discard-inputs", carry);
  const session = { id: "discard-inputs", providerSessionId: "fresh", blocks };
  const preview = previewMonoRotationDiscard(session)!;
  expect(preview.inputs).toEqual([text, blocks[2].text]);
  expect(preview.blockIds).toEqual(["failed-a", "failed-b"]);
  expect(stored(session.id)).toEqual(carry);
  expect(discardMonoRotationPendingInputs(session, preview)).toBe(true);
  const retained = stored(session.id)!;
  expect(retained.pendingBrief).toBe(carry.pendingBrief);
  expect(retained.pendingInput).toBeUndefined();
  expect(retained.pendingInputs).toBeUndefined();
  expect(retained.userRequests).toEqual([{ id: "scope", text }]);
  expect(retained.references).toEqual(carry.references);
  const retry = sessionRotationStatus(session, "Retry").plan!;
  expect(retry.rotation.pendingInputs).toEqual(["Retry"]);
  expect(retry.rotation.userRequests).toEqual([{ id: "scope", text }]);
  expect(retry.brief(session.id)).toContain(text);
  expect(retry.brief(session.id)).not.toContain(blocks[2].text);
});

it("refuses stale discard confirmation, including a newly loaded matching failed block", () => {
  const original = pending("discard-stale");
  const session = { id: "discard-stale", blocks: [{ id: "scope", role: "user" as const, text: "Keep the scope." }] };
  const preview = previewMonoRotationDiscard(session)!;
  const newer = { ...original, pendingInputs: ["Preserve another failed input."] };
  saveMonoRotation(session.id, newer);
  expect(discardMonoRotationPendingInputs(session, preview)).toBe(false);
  expect(stored(session.id)).toEqual(newer);
  const current = previewMonoRotationDiscard(session)!;
  session.blocks.push({ id: "failed", role: "user", text: newer.pendingInput! });
  expect(discardMonoRotationPendingInputs(session, current)).toBe(false);
  expect(stored(session.id)).toEqual(newer);
});

it("keeps the exact carry when explicit discard cannot be saved or its boundary is unloaded", () => {
  const original = pending("discard-failure");
  const session = { id: "discard-failure", blocks: [{ id: "scope", role: "user" as const, text: "Keep the scope." }] };
  expect(previewMonoRotationDiscard({ ...session, blocks: [] })).toBeUndefined();
  const preview = previewMonoRotationDiscard(session)!;
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("full"); });
  expect(discardMonoRotationPendingInputs(session, preview)).toBe(false);
  expect(stored(session.id)).toEqual(original);
  saveMonoRotation(session.id, { ...original, afterBlockId: undefined });
  expect(previewMonoRotationDiscard(session)).toBeUndefined();
});
