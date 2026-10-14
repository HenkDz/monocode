import { describe, expect, it, vi } from "vitest";
import { selectUsageDashboard, USAGE_FRESH_MS } from "./usageDashboard";
import { idleRateLimits, parseCodexRateLimits, parseClaudeOAuthUsage } from "./rateLimits";
import { newSession } from "../../sessions/model/session";
import { roster, runs, sessions, now } from "../../commandCenter/fixtures/syntheticMission";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const accounts = [{ id: "default", provider: "codex" as const, label: "Studio" }, { id: "reserve", provider: "codex" as const, label: "Reserve" }, { id: "default", provider: "claude" as const, label: "Design" }];
const input = () => ({ roster: structuredClone(roster), runs: structuredClone(runs), sessions: structuredClone(sessions), now, accounts, usage: {} });
describe("Usage dashboard account bindings", () => {
  it("joins real home/engine/task sessions and keeps missing session identity unknown", () => {
    const state = input();
    state.sessions.push({ ...newSession("codex", "/synthetic"), id: "synthetic-engine", providerAccountId: "reserve", busy: true });
    const snapshot = selectUsageDashboard(state);
    const codex = snapshot.groups[0];
    expect(codex.accounts.map(account => account.label)).toEqual(["Studio", "Reserve"]);
    expect(codex.accounts[0].assignments.some(binding => binding.sessionId === "synthetic-manager-chat" && binding.kind === "home")).toBe(true);
    expect(codex.accounts[1].assignments).toContainEqual(expect.objectContaining({ monoId: "synthetic-manager", kind: "engine", state: "working" }));
    expect(codex.accounts[0].assignments).toContainEqual(expect.objectContaining({ monoId: "synthetic-searcher", kind: "task", state: "working" }));
    expect(snapshot.unknownAssignments).toEqual([]);
    state.sessions = state.sessions.filter(session => session.id !== "synthetic-manager-chat");
    expect(selectUsageDashboard(state).unknownAssignments).toContainEqual(expect.objectContaining({ monoId: "synthetic-manager", state: "unknown", kind: "home" }));
  });
  it("never aliases Pi OAuth usage into a managed Claude/Codex account", () => {
    const pi = { ...newSession("pi", "/synthetic"), id: "pi-home", model: "pi:anthropic/claude-sonnet-4" };
    const state = { ...input(), roster: [{ ...roster[0], sessionId: pi.id }], sessions: [pi], runs: [], usage: { "pi:anthropic": { ...idleRateLimits("claude"), status: "ok" as const, updatedAt: now } } };
    const snapshot = selectUsageDashboard(state);
    expect(snapshot.groups.find(group => group.provider === "claude")!.accounts[0].assignments).toHaveLength(0);
    expect(snapshot.groups.find(group => group.provider === "pi")!.accounts[0].assignments).toHaveLength(1);
    expect(snapshot.groups.find(group => group.provider === "cursor")!.accounts[0].limits).toBeUndefined();
  });
  it("uses normalized reader output without fabricated windows, credits or freshness", () => {
    const codex = { ...parseCodexRateLimits({ primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: (now + 60_000) / 1000 } }), updatedAt: now };
    const claude = { ...parseClaudeOAuthUsage(JSON.stringify({ five_hour: { utilization: 38, resets_at: new Date(now + 60_000).toISOString() } })), updatedAt: now };
    const snapshot = selectUsageDashboard({ ...input(), usage: { "codex:default": codex, "claude:default": claude, "codex:reserve": { ...codex, updatedAt: now - USAGE_FRESH_MS - 1 } } });
    expect(snapshot.groups[0].accounts[0].limits?.session?.usedPercent).toBe(82);
    expect(snapshot.groups[0].accounts[0].limits?.weekly).toBeNull();
    expect(snapshot.groups[1].accounts[0].limits?.resetCredits).toBeNull();
    expect(snapshot.groups[1].accounts[0].limits?.session?.usedPercent).toBe(38);
    expect(snapshot.groups[0].accounts[1].status.tone).toBe("unknown");
    expect(snapshot.groups[0].accounts[1].freshness).toBe("stale");
    const wrong = selectUsageDashboard({ ...input(), usage: { "codex:default": claude } });
    expect(wrong.groups[0].accounts[0].limits).toBeUndefined();
  });
});
