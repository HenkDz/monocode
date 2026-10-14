import { describe, expect, it } from "vitest";
import { selectUsageDashboard } from "./usageDashboard";
import { idleRateLimits } from "./rateLimits";
import { collectUsageHistory, HISTORY_MAX_SAMPLES, readUsageHistory, usageTrend, USAGE_HISTORY_KEY, type UsageHistory } from "./usageHistory";

const start = Date.UTC(2026, 9, 14, 12);
const resetAt = start + 3_600_000;
function snapshot(at = start, used = 10, patch = {}) {
  return selectUsageDashboard({ roster: [], runs: [], sessions: [], now: at, accounts: [{ id: "default", provider: "codex", label: "Synthetic" }], usage: { "codex:default": { ...idleRateLimits("codex"), status: "ok", updatedAt: at, session: { usedPercent: used, windowMinutes: 300, resetsAt: resetAt }, ...patch } } });
}
const account = (state: ReturnType<typeof snapshot>) => state.groups[0].accounts[0];
describe("Bounded normalized local usage history", () => {
  it("needs three distinct valid same-reset samples; repeated polls and identical numbers add no history", () => {
    let history = collectUsageHistory({}, snapshot());
    expect(usageTrend(history, account(snapshot()), "session", start)).toBeNull();
    expect(collectUsageHistory(history, snapshot())).toBe(history);
    expect(collectUsageHistory(history, snapshot(start + 60_000))).toBe(history);
    history = collectUsageHistory(history, snapshot(start + 60_000, 20));
    expect(usageTrend(history, account(snapshot(start + 60_000, 20)), "session", start + 60_000)).toBeNull();
    history = collectUsageHistory(history, snapshot(start + 120_000, 30));
    expect(usageTrend(history, account(snapshot(start + 120_000, 30)), "session", start + 120_000)?.delta).toBe(-20);
    const saved = JSON.stringify(history);
    const restored = readUsageHistory({ getItem: () => saved }, start + 120_000);
    expect(restored.writable).toBe(true);
    expect(usageTrend(restored.history, account(snapshot(start + 120_000, 30)), "session", start + 120_000)?.samples).toHaveLength(3);
  });
  it("breaks history at error, missing, reset change, increase or excessive gap; fetching is transient", () => {
    const history = collectUsageHistory({}, snapshot());
    for (const patch of [{ status: "error" }, { session: null }, { status: "unavailable" }]) {
      expect(collectUsageHistory(history, snapshot(start + 60_000, 20, patch))).toEqual({});
    }
    expect(collectUsageHistory(history, snapshot(start + 60_000, 20, { status: "fetching" }))).toBe(history);
    const reset = collectUsageHistory(history, snapshot(start + 60_000, 20, { session: { usedPercent: 20, windowMinutes: 300, resetsAt: resetAt + 1 } }));
    expect(Object.values(reset)[0]).toHaveLength(1);
    expect(Object.values(collectUsageHistory(history, snapshot(start + 60_000, 5)))[0]).toHaveLength(1);
    expect(Object.values(collectUsageHistory(history, snapshot(start + 31 * 60_000, 20)))[0]).toHaveLength(1);
  });
  it("isolates account and provider histories and ignores stale telemetry", () => {
    const history = collectUsageHistory({}, snapshot());
    const state = snapshot();
    const other = { ...account(state), accountId: "other" };
    expect(usageTrend(history, other, "session", start)).toBeNull();
    expect(collectUsageHistory(history, { ...state, now: start + 60_000, groups: state.groups.map(group => ({ ...group, accounts: group.accounts.map(account => ({ ...account, freshness: "stale" as const })) })) })).toEqual({});
  });
  it("preserves malformed storage and sanitizes secrets from valid normalized records", () => {
    for (const raw of ["{", "[]", JSON.stringify({ invalid: [] }), JSON.stringify({ [JSON.stringify(["codex", "default", "session"])]: [{ at: 0 }] })]) {
      expect(readUsageHistory({ getItem: () => raw }, start)).toEqual({ history: {}, writable: false });
    }
    const history = collectUsageHistory({}, snapshot());
    const key = Object.keys(history)[0];
    const parsed = JSON.parse(JSON.stringify(history)); parsed[key][0].credential = "never persist";
    expect(JSON.stringify(readUsageHistory({ getItem: () => JSON.stringify(parsed) }, start).history)).not.toContain("credential");
    expect(USAGE_HISTORY_KEY).toBe("monocode.usageHistory.v1");
  });
  it("caps each history even over many changing reports", () => {
    let history: UsageHistory = {};
    for (let index = 0; index < 120; index++) history = collectUsageHistory(history, snapshot(start + index * 60_000, index / 2, { session: { usedPercent: index / 2, windowMinutes: 10_080, resetsAt: start + 86_400_000 } }));
    expect(Object.values(history)[0]).toHaveLength(HISTORY_MAX_SAMPLES);
  });
});
