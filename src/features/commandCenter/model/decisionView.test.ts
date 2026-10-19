import { expect, it, vi } from "vitest";
import { MonoManagerGoals } from "../../monos/model/monoManagerGoals";
import type { MonoDecision } from "../../monos/model/monoDecisions";
import type { Mono } from "../../monos/model/mono";
import { selectDecisionView, unreadableDecisionPreview } from "./decisionView";

const roster: Mono[] = [{ id: "manager", role: "manager", projects: ["C:/Project"], mascot: "m", color: "blue" }];

it("distinguishes a Manager whose history has not loaded from a real empty history", async () => {
  const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
  expect(selectDecisionView(ledger, roster, Date.now()).loading).toEqual(["manager"]);
  await ledger.hydrate("manager");
  expect(selectDecisionView(ledger, roster, Date.now())).toMatchObject({ loading: [], pending: [], log: [], handledToday: 0 });
});

it("derives current user badges and local-day team counts from retained readable history", () => {
  const ledger = new MonoManagerGoals();
  const now = new Date(2026, 9, 19, 12).getTime();
  const base = { projectId: "C:/Project", createdAt: now - 1000, deliveryState: "current" };
  vi.spyOn(ledger, "decisions").mockReturnValue([
    { ...base, id: "pending", status: "pending", deciderLevel: "user" },
    { ...base, id: "team", status: "delegated", deciderLevel: "boss" },
    { ...base, id: "today", status: "decided", deciderLevel: "manager", decidedAt: now - 500 },
    { ...base, id: "yesterday", status: "decided", deciderLevel: "boss", decidedAt: new Date(2026, 9, 18, 23).getTime() },
    { ...base, id: "stale", status: "decided", deciderLevel: "boss", decidedAt: now, deliveryState: "stale" },
  ] as MonoDecision[]);
  const view = selectDecisionView(ledger, roster, now, "c:\\project\\");
  expect(view.pending.map(item => item.decision.id)).toEqual(["pending"]);
  expect(view.teamPending).toBe(1);
  expect(view.handledToday).toBe(1);
  expect(view.log.map(item => item.decision.id)).toContain("stale");
  expect(selectDecisionView(ledger, roster, now, "C:/Other").pending).toEqual([]);
});

it("only previews bounded unreadable pending text without reconstructing active authority", () => {
  const raw = JSON.stringify({ decisions: [{ id: "old", status: "pending", question: "<script>untrusted</script>" }, { id: "done", status: "decided", question: "Resolved" }] });
  const entry = { at: 1, reason: "unreadable-decision-history" as const, raw };
  expect(unreadableDecisionPreview(entry)).toEqual([{ id: "old", question: "<script>untrusted</script>" }]);
  expect(unreadableDecisionPreview({ ...entry, raw: "invalid JSON" })).toEqual([]);
  expect(entry.raw).toBe(raw);
});
