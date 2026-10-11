import { describe, expect, it } from "vitest";
import type { OrchestrationRun } from "./orchestrationState";
import { acknowledgeManagerWake, addManagerWakeEvent, managerWakePlan, prepareManagerWake } from "./managerWake";

const fresh = (): OrchestrationRun => ({
  version: 2, leadId: "manager", ownerSessionId: "manager-chat", ownerMonoId: "manager-mono",
  cwd: "C:/synthetic/manager-wake-budget", status: "active", allowedHarnesses: ["codex"], maxWorkers: 4,
  projectManager: true, projectName: "Synthetic project", cli: "fixture-cli",
  tasks: [], dispatches: [], continuations: 0, requests: {},
});

describe("Manager digest budget", () => {
  it("summarizes 20 long updates and a question within 4000 characters without discarding evidence", () => {
    let run = fresh();
    for (let i = 0; i < 20; i++) run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: `large-info:${i}`, kind: "info", at: 10_000, requestId: `request:${i}`,
      text: `Update ${i}: ${"I".repeat(6000)}`,
    }) };
    run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: "large-question", kind: "question", at: 10_000, requestId: "request:question",
      text: `Question action: ${"Q".repeat(6000)}`,
    }) };
    const originals = structuredClone(run.wakeState!.events);
    const prepared = prepareManagerWake(run, 10_250);
    const receipt = prepared.receipt!;
    expect(receipt.eventIds).toEqual(["large-question", ...originals.slice(0, 20).map(event => event.id)]);
    expect(receipt.body).toContain("untrusted evidence");
    expect(receipt.body).toContain("Question action:");
    for (let i = 0; i < 20; i++) expect(receipt.body).toContain(`Update ${i}:`);
    expect(prepared.events).toEqual(originals);
    expect(receipt.body.length).toBeLessThanOrEqual(4000);
    expect(receipt.body).toContain(`for ${run.projectName} (Manager ${run.leadId})`);
    expect(receipt.body).toContain("control list {} -> run.wakeState.events");
    const acknowledged = acknowledgeManagerWake(prepared, receipt.id, 10_251);
    expect(acknowledged.events).toHaveLength(21);
    expect(acknowledged.events.map(({ acknowledgedAt: _at, ...event }) => event)).toEqual(originals);
    expect(acknowledged.events.every(event => event.acknowledgedAt === 10_251)).toBe(true);
  });

  it.each(["/", "\\"])("delivers and pages evidence for a valid long Windows path using %s separators", separator => {
    const components = Array.from({ length: 19 }, (_, i) => `p${i}-${"a".repeat(198)}`);
    let run: OrchestrationRun = { ...fresh(), projectName: undefined,
      leadId: `mono-engine-${"1".repeat(64)}`, cwd: ["C:", "synthetic", ...components].join(separator) };
    expect(run.cwd.length).toBeGreaterThan(3700);
    expect(components.every(component => component.length <= 255)).toBe(true);
    for (let i = 0; i < 150; i++) run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: `update:${i}`, kind: "info", at: 10_000, text: `Update ${i}: ${"Detail".repeat(1200)}`,
    }) };
    const requestId = "r".repeat(128);
    const questionId = `11111111-1111-1111-1111-111111111111:${requestId}`;
    run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: questionId, requestId, kind: "question", at: 10_000, text: `Question action: ${"Q".repeat(6000)}`,
    }) };
    const originals = structuredClone(run.wakeState!.events);
    const seen = new Set<string>();
    expect(managerWakePlan(run, 10_249).ready).toBe(false);
    let pages = 0;
    while (managerWakePlan(run, 10_250).ready) {
      const prepared = prepareManagerWake(run, 10_250);
      const receipt = prepared.receipt!;
      expect(receipt.body).toContain(`for ${components.at(-1)!.slice(0, 100)} (Manager ${run.leadId})`);
      expect(receipt.body).toContain("control list {} -> run.wakeState.events");
      expect(receipt.body).not.toContain(run.cwd);
      expect(receipt.body.length).toBeLessThanOrEqual(4000);
      expect(receipt.eventIds.length).toBeGreaterThan(0);
      if (!pages) {
        expect(receipt.eventIds[0]).toBe(questionId);
        expect(receipt.body).toContain(`request ${requestId}: Question action:`);
      }
      for (const id of receipt.eventIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(receipt.body).toContain(`[${id}]`);
      }
      run = { ...run, wakeState: acknowledgeManagerWake(prepared, receipt.id, 10_251) };
      expect(run.wakeState!.events.filter(event => event.acknowledgedAt != null).map(event => event.id))
        .toEqual(originals.filter(event => seen.has(event.id)).map(event => event.id));
      expect(++pages).toBeLessThanOrEqual(originals.length);
    }
    expect(pages).toBeGreaterThan(1);
    expect([...seen]).toEqual([questionId, ...originals.slice(0, 150).map(event => event.id)]);
    expect(run.wakeState!.events.map(({ acknowledgedAt: _at, ...event }) => event)).toEqual(originals);
  });

  it("pages 150 action items within the budget and only acknowledges represented events", () => {
    let run = fresh();
    for (let i = 0; i < 150; i++) run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: `action:${i}`, kind: "decision", at: 10_000, requestId: `request:${i}`,
      text: `Action ${i}: ${"Detail".repeat(1200)}`,
    }) };
    const originals = structuredClone(run.wakeState!.events);
    const seen = new Set<string>();
    const receiptIds = new Set<string>();
    while (managerWakePlan(run, 10_250).ready) {
      const prepared = prepareManagerWake(run, 10_250);
      const receipt = prepared.receipt!;
      expect(receiptIds.has(receipt.id)).toBe(false);
      receiptIds.add(receipt.id);
      expect(receipt.body.length).toBeLessThanOrEqual(4000);
      expect(receipt.eventIds.length).toBeGreaterThan(0);
      for (const id of receipt.eventIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(receipt.body).toContain(`Action ${id.split(":")[1]}:`);
      }
      expect(prepared.events).toHaveLength(150);
      run = { ...run, wakeState: acknowledgeManagerWake(prepared, receipt.id, 10_251) };
      expect(run.wakeState!.events.filter(event => event.acknowledgedAt != null).map(event => event.id)).toEqual([...seen]);
      expect(receiptIds.size).toBeLessThanOrEqual(150);
    }
    expect(receiptIds.size).toBeGreaterThan(1);
    expect([...seen]).toEqual(originals.map(event => event.id));
    expect(run.wakeState!.events.map(({ acknowledgedAt: _at, ...event }) => event)).toEqual(originals);
  });

  it("continues the remaining information pages after the action item has been acknowledged", () => {
    let run = fresh();
    for (let i = 0; i < 150; i++) run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: `update:${i}`, kind: "info", at: 10_000, text: `Update ${i}: ${"Detail".repeat(1200)}`,
    }) };
    run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, {
      id: "first-action", kind: "decision", at: 10_000, text: "First action: respond before reading updates",
    }) };
    const first = prepareManagerWake(run, 10_250);
    expect(first.receipt?.eventIds[0]).toBe("first-action");
    expect(first.receipt!.eventIds.length).toBeLessThan(151);
    run = { ...run, wakeState: acknowledgeManagerWake(first, first.receipt!.id, 10_251) };
    expect(run.wakeState!.events.filter(event => event.acknowledgedAt == null).every(event => event.kind === "info")).toBe(true);
    expect(managerWakePlan(run, 10_251).ready).toBe(true);
    let pages = 1;
    while (managerWakePlan(run, 10_251).ready) {
      const prepared = prepareManagerWake(run, 10_251);
      const receipt = prepared.receipt!;
      expect(receipt.body.length).toBeLessThanOrEqual(4000);
      expect(receipt.eventIds.length).toBeGreaterThan(0);
      for (const id of receipt.eventIds) expect(receipt.body).toContain(`Update ${id.split(":")[1]}:`);
      run = { ...run, wakeState: acknowledgeManagerWake(prepared, receipt.id, 10_252) };
      pages++;
      expect(pages).toBeLessThanOrEqual(151);
    }
    expect(pages).toBeGreaterThan(1);
    expect(run.wakeState!.events).toHaveLength(151);
    expect(run.wakeState!.events.every(event => event.acknowledgedAt != null)).toBe(true);
  });
});
