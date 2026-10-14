// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCodexRateLimits, parseClaudeOAuthUsage, idleRateLimits } from "./rateLimits";
const readers = vi.hoisted(() => ({ codex: vi.fn(), claude: vi.fn(), opencode: vi.fn(), invoke: vi.fn() }));
vi.mock("./rateLimitsFetch", () => ({ fetchCodexRateLimits: readers.codex, fetchClaudeRateLimits: readers.claude, fetchOpencodeGoRateLimits: readers.opencode }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: readers.invoke }));
import { useUsageDashboard } from "./useUsageDashboard";
import { clearCachedRateLimits } from "./rateLimitsCache";
import { saveProviderAccount } from "./providerAccounts";
import { UsageDashboard } from "../ui/UsageDashboard";
import { UsageVital } from "../ui/UsageVital";
import { USAGE_HISTORY_KEY } from "./usageHistory";
import { newSession } from "../../sessions/model/session";
const now = Date.UTC(2026, 9, 14, 12);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let state: ReturnType<typeof useUsageDashboard>;
const piSession = { ...newSession("pi", "/synthetic"), id: "pi-home", model: "pi:anthropic/claude-sonnet-4" };
const input = { roster: [{ id: "pi-mono", name: "Pi worker", mascot: "fox", color: "blue", projects: [], sessionId: piSession.id }], runs: [], sessions: [piSession] };
function Surface() {
  state = useUsageDashboard(input);
  return <><UsageVital snapshot={state.snapshot} onOpen={() => {}} /><UsageDashboard snapshot={state.snapshot} history={state.history} onRefresh={state.refresh} /><span role="status">{state.historyWarning}</span></>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", new Window({ url: "http://synthetic.local" }).localStorage);
  localStorage.clear(); clearCachedRateLimits();
  readers.codex.mockImplementation(async () => parseCodexRateLimits({ primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: (now + 3_600_000) / 1000 } }));
  readers.claude.mockImplementation(async () => parseClaudeOAuthUsage(JSON.stringify({ five_hour: { utilization: 20, resets_at: new Date(now + 3_600_000).toISOString() } })));
  readers.opencode.mockResolvedValue(idleRateLimits("opencode"));
  readers.invoke.mockResolvedValue({ status: "ok", windows: { session: { usedPercent: 35, windowMinutes: 300, resetsAt: now + 3_600_000 }, weekly: null } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("Connected shared usage surface", () => {
  it("uses real cached reader normalization for every account and both dashboard/vital without invented trends", async () => {
    saveProviderAccount({ provider: "codex", id: "reserve", label: "Synthetic reserve" });
    await act(async () => { root.render(<Surface />); });
    expect(readers.codex.mock.calls.map(call => call[0])).toEqual(["default", "reserve"]);
    expect(readers.claude).toHaveBeenCalledWith("default");
    expect(readers.invoke).toHaveBeenCalledWith("fetch_pi_usage", { provider: "anthropic" });
    expect(host.textContent).toContain("Synthetic reserve");
    expect(host.querySelector(".usage-vital")?.textContent).toContain("18%session left");
    expect(host.querySelector('[aria-label="Default account Session remaining"]')?.getAttribute("aria-valuenow")).toBe("18");
    expect(host.textContent).toContain("Pi worker · idle / configured · home");
    expect(host.querySelectorAll(".usage-trend svg")).toHaveLength(0);
    expect(host.textContent).toContain("Trend unavailable");
    const history = JSON.parse(localStorage.getItem(USAGE_HISTORY_KEY)!);
    expect(Object.keys(history)).toContain(JSON.stringify(["pi", "anthropic", "session"]));
    expect(JSON.stringify(history)).not.toContain("Synthetic reserve");
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60_000); });
    expect(state.snapshot.now).toBe(now + 31 * 60_000);
  });
  it("preserves malformed history bytes and reports unavailable local persistence", async () => {
    localStorage.setItem(USAGE_HISTORY_KEY, "{opaque");
    await act(async () => { root.render(<Surface />); });
    expect(localStorage.getItem(USAGE_HISTORY_KEY)).toBe("{opaque");
    expect(host.textContent).toContain("stored data was preserved");
    expect(host.querySelectorAll(".usage-trend svg")).toHaveLength(0);
  });
});
