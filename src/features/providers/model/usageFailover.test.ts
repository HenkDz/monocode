import { describe, expect, it } from "vitest";
import { parseClaudeOAuthUsage, RATE_LIMIT_POLL_MS, type ProviderRateLimits } from "./rateLimits";
import { eligibleUsageFailoverAccount, MANUAL_USAGE_FAILOVER, selectUsageFailoverAccount, type UsageFailoverCandidate } from "./usageFailover";

const now = 1_800_000_000_000;
function candidate(id = "work", used = 10): UsageFailoverCandidate {
  return {
    account: { id, provider: "claude", label: id }, identity: { name: "Synthetic account" }, ready: true,
    limits: { ...parseClaudeOAuthUsage(JSON.stringify({
      five_hour: { utilization: used, resets_at: new Date(now + 3_600_000).toISOString() },
      seven_day: { utilization: used + 5, resets_at: new Date(now + 86_400_000).toISOString() },
    })), updatedAt: now },
  };
}
const automatic = { enabled: true, rankedAccountIds: ["work", "backup"] };

describe("ranked same-provider usage recovery", () => {
  it("keeps manual OFF by default and does not invent an order", () => {
    expect(selectUsageFailoverAccount("claude", "default", MANUAL_USAGE_FAILOVER, [candidate()], now)).toBeNull();
    expect(selectUsageFailoverAccount("claude", "default", { enabled: true, rankedAccountIds: [] }, [candidate()], now)).toBeNull();
  });
  it("uses explicit rank rather than highest headroom", () => {
    expect(selectUsageFailoverAccount("claude", "default", automatic, [candidate("backup", 1), candidate("work", 80)], now)?.id).toBe("work");
    expect(selectUsageFailoverAccount("claude", "work", automatic, [candidate(), candidate("backup")], now)?.id).toBe("backup");
  });
  it("never crosses providers and treats legacy default IDs as the same account", () => {
    expect(selectUsageFailoverAccount("codex", "default", automatic, [candidate()], now)).toBeNull();
    expect(selectUsageFailoverAccount("cursor", "default", automatic, [candidate()], now)).toBeNull();
    expect(selectUsageFailoverAccount("claude", undefined, { enabled: true, rankedAccountIds: ["default"] }, [candidate("default")], now)).toBeNull();
  });
  it.each([
    { status: "error" }, { status: "fetching" }, { status: "unavailable" }, { status: "idle" },
    { error: "Sign in" }, { updatedAt: now - RATE_LIMIT_POLL_MS - 1 }, { updatedAt: now + 1 },
    { session: null }, { weekly: null }, { provider: "codex" },
  ] as Partial<ProviderRateLimits>[])("rejects unhealthy or incomplete normalized telemetry %j", patch => {
    const entry = candidate(); entry.limits = { ...entry.limits!, ...patch };
    expect(eligibleUsageFailoverAccount("claude", entry, now)).toBe(false);
  });
  it.each([NaN, -1, 100, 101, Infinity])("rejects invalid/exhausted windows (%s)", usedPercent => {
    const entry = candidate(); entry.limits!.weekly!.usedPercent = usedPercent;
    expect(eligibleUsageFailoverAccount("claude", entry, now)).toBe(false);
  });
  it.each([null, now, now - 1, NaN])("does not infer availability when the reset is unknown or passed (%s)", reset => {
    const entry = candidate(); entry.limits!.session!.resetsAt = reset;
    expect(eligibleUsageFailoverAccount("claude", entry, now)).toBe(false);
  });
  it("checks monthly limits too and skips unknown identities/readiness", () => {
    const entry = candidate();
    entry.limits!.monthly = { usedPercent: 100, windowMinutes: 43200, resetsAt: now + 1000 };
    expect(eligibleUsageFailoverAccount("claude", entry, now)).toBe(false);
    expect(eligibleUsageFailoverAccount("claude", { ...candidate(), identity: null }, now)).toBe(false);
    expect(eligibleUsageFailoverAccount("claude", { ...candidate(), ready: false }, now)).toBe(false);
  });
  it("skips exhausted first rank and pauses when no rank qualifies", () => {
    expect(selectUsageFailoverAccount("claude", "default", automatic, [candidate("work", 100), candidate("backup")], now)?.id).toBe("backup");
    expect(selectUsageFailoverAccount("claude", "default", automatic, [candidate("work", 100)], now)).toBeNull();
  });
});
