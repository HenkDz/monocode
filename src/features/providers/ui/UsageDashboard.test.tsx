// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageDashboard } from "./UsageDashboard";
import { UsageVital } from "./UsageVital";
import { selectUsageDashboard } from "../model/usageDashboard";
import { collectUsageHistory, type UsageHistory } from "../model/usageHistory";
import { idleRateLimits, type ProviderRateLimits } from "../model/rateLimits";
import { roster, runs, sessions, now } from "../../commandCenter/fixtures/syntheticMission";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function fixture(at = now, consumed = 82) {
  const limits: ProviderRateLimits = { ...idleRateLimits("codex"), status: "ok", updatedAt: at,
    session: { usedPercent: consumed, windowMinutes: 300, resetsAt: now + 3_600_000 },
    weekly: { usedPercent: 58, windowMinutes: 10080, resetsAt: now + 86_400_000 }, resetCredits: { availableCount: 2, credits: null } };
  return selectUsageDashboard({ now: at, roster, runs, sessions,
    accounts: [{ id: "default", provider: "codex", label: "Studio" }, { id: "reserve", provider: "codex", label: "Reserve" }, { id: "default", provider: "claude", label: "Design" }],
    usage: { "codex:default": limits, "codex:reserve": { ...limits, resetCredits: null, session: { ...limits.session!, usedPercent: 16 } } } });
}
const provider = (name: string) => host.querySelector<HTMLElement>(`[aria-label="${name} account comparison, scroll horizontally"]`)!;

describe("Usage dashboard", () => {
  it("marks reset-due reader snapshots stale coherently in the dashboard and vital", async () => {
    const source = fixture();
    const limits = { ...source.groups[0].accounts[0].limits!, session: { usedPercent: 100, windowMinutes: 300, resetsAt: now } };
    const snapshot = selectUsageDashboard({ now, roster, runs, sessions,
      accounts: [{ provider: "codex", id: "default", label: "Studio" }], usage: { "codex:default": limits } });
    await act(async () => root.render(<><UsageVital snapshot={snapshot} onOpen={() => {}} /><UsageDashboard snapshot={snapshot} /></>));
    expect(provider("Codex").textContent).toContain("Stale usage");
    expect(provider("Codex").textContent).toContain("0%left · last known");
    expect(provider("Codex").textContent).toContain("Reset due · awaiting refresh");
    expect(host.querySelector(".usage-vital")?.textContent).toContain("Usage unavailable");
    expect(provider("Codex").textContent).not.toContain("Ready");
  });
  it("renders normalized real account/window columns and every provider, with remaining headlines and actual home/task Mono bindings", async () => {
    const snapshot = fixture();
    await act(async () => root.render(<UsageDashboard snapshot={snapshot} />));
    expect([...host.querySelectorAll("h2")].map(heading => heading.textContent)).toEqual(["Codex", "Claude", "Cursor", "OpenCode", "Pi", "Account association unknown"]);
    const codex = provider("Codex");
    expect(codex.querySelectorAll("thead th")).toHaveLength(3);
    expect([...codex.querySelectorAll("tbody th")].map(cell => cell.textContent)).toEqual(["Session", "Weekly"]);
    expect(codex.querySelector('[aria-label="Studio Session remaining"]')?.getAttribute("aria-valuenow")).toBe("18");
    expect(codex.querySelector('[aria-label="Reserve Session remaining"]')?.getAttribute("aria-valuenow")).toBe("84");
    expect(codex.textContent).toContain("2 reset credits");
    expect(codex.textContent).toContain("Grand Orch · idle / configured · home");
    expect(codex.textContent).toContain("Search worker · working now · task");
    expect(host.textContent).toContain("Atlas Manager · association unknown · engine");
    expect(provider("Claude").textContent).toContain("Credits not reported");
    expect(provider("Cursor").querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelectorAll("svg")).toHaveLength(0);
    expect(host.textContent).toContain("Trend unavailable");
    expect(host.textContent).not.toContain("82% left");
  });

  it("labels focusable horizontal comparisons, retains side by side columns and exposes refresh/settings actions", async () => {
    const refresh = vi.fn(), settings = vi.fn();
    await act(async () => root.render(<UsageDashboard snapshot={fixture()} onRefresh={refresh} onOpenSettings={settings} />));
    const comparison = provider("Codex");
    expect(comparison.tabIndex).toBe(0);
    comparison.focus(); expect(document.activeElement).toBe(comparison);
    expect(comparison.querySelector("table")?.style.minWidth).toBe("616px");
    expect(comparison.querySelectorAll('[scope="col"]')).toHaveLength(3);
    expect(comparison.querySelectorAll('[scope="row"]')).toHaveLength(2);
    await act(async () => { host.querySelectorAll<HTMLButtonElement>("button")[0].click(); host.querySelectorAll<HTMLButtonElement>("button")[1].click(); });
    expect(refresh).toHaveBeenCalledOnce(); expect(settings).toHaveBeenCalledOnce();
  });

  it.each(["stale", "error", "fetching"] as const)("shows %s last-known telemetry explicitly and suppresses its trend", async freshness => {
    const snapshot = fixture(); snapshot.groups[0].accounts[0].freshness = freshness;
    await act(async () => root.render(<UsageDashboard snapshot={snapshot} />));
    const account = provider("Codex").querySelectorAll("thead th")[1];
    expect(account.textContent).toContain(freshness === "stale" ? "Stale snapshot" : freshness === "error" ? "Fetch failed" : "Fetching");
    expect(provider("Codex").querySelector("tbody td")?.textContent).toContain("18%left · last known");
    expect(provider("Codex").querySelector("tbody td")?.getAttribute("data-tone")).toBe("unknown");
    if (freshness === "fetching") expect(host.querySelector<HTMLButtonElement>("button")).toBeNull();
  });

  it("preserves missing windows, optional monthly data and reset-due readings without inventing fresh allowance", async () => {
    const snapshot = fixture();
    const limits = snapshot.groups[0].accounts[0].limits!;
    limits.weekly = null;
    limits.session!.resetsAt = now - 1;
    limits.monthly = { usedPercent: 10, windowMinutes: 43200, resetsAt: now + 86_400_000 };
    await act(async () => root.render(<UsageDashboard snapshot={snapshot} />));
    const rows = provider("Codex").querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector("td")?.textContent).toContain("Reset due · awaiting refresh");
    expect(rows[0].querySelector("td")?.textContent).toContain("18%left");
    expect(rows[1].querySelector('[role="progressbar"]')).not.toBeNull();
    expect(rows[1].querySelector("td")?.querySelector('[role="progressbar"]')).toBeNull();
    expect(rows[1].querySelector("td")?.textContent).toContain("Unavailable · Trend unavailable");
    expect(rows[2].querySelector("td")?.textContent).toContain("90%left");
  });

  it("draws only collected valid account history and breaks the displayed trend when the reset identity changes", async () => {
    let history: UsageHistory = {};
    for (let i = 0; i < 3; i++) history = collectUsageHistory(history, fixture(now + i * 60_000, 80 + i));
    const snapshot = fixture(now + 120_000, 82);
    await act(async () => root.render(<UsageDashboard snapshot={snapshot} history={history} />));
    const sessionCell = provider("Codex").querySelector("tbody td")!;
    expect(sessionCell.querySelector('[aria-label="Local trend: -2 percentage points across 3 samples"]')).not.toBeNull();
    expect(sessionCell.querySelectorAll("svg")).toHaveLength(1);
    expect(provider("Claude").querySelectorAll("svg")).toHaveLength(0);
    snapshot.groups[0].accounts[0].limits!.session!.resetsAt = now + 7_200_000;
    await act(async () => root.render(<UsageDashboard snapshot={snapshot} history={history} />));
    expect(sessionCell.textContent).toContain("Trend unavailable");
    expect(sessionCell.querySelectorAll("svg")).toHaveLength(0);
  });

  it("never renders non-finite usage as 100% available", async () => {
    const snapshot = fixture(); snapshot.groups[0].accounts[0].limits!.session!.usedPercent = NaN;
    await act(async () => root.render(<UsageDashboard snapshot={snapshot} />));
    expect(provider("Codex").querySelector("tbody td")?.querySelector('[role="progressbar"]')).toBeNull();
    expect(provider("Codex").querySelector("tbody td")?.textContent).toContain("Unavailable");
  });
});
