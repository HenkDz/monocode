// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageAgentAccountLabels, UsageVital } from "./UsageVital";
import { selectUsageDashboard } from "../model/usageDashboard";
import { idleRateLimits } from "../model/rateLimits";
import { roster, runs, sessions, now } from "../../commandCenter/fixtures/syntheticMission";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const fixture = () => selectUsageDashboard({ now, roster, runs, sessions,
  accounts: [{ provider: "codex", id: "default", label: "Studio" }], usage: { "codex:default": {
    ...idleRateLimits("codex"), status: "ok", updatedAt: now,
    session: { usedPercent: 82, windowMinutes: 300, resetsAt: now + 3_600_000 }, weekly: { usedPercent: 58, windowMinutes: 10080, resetsAt: now + 86_400_000 },
  } } });

describe("Mission Usage vital and loaded account labels", () => {
  it("names one constrained account/window, counts low accounts once and opens the dashboard", async () => {
    const open = vi.fn();
    await act(async () => root.render(<UsageVital snapshot={fixture()} onOpen={open} />));
    expect(host.textContent).toContain("18%session left");
    expect(host.textContent).toContain("Codex · Studio");
    expect(host.textContent).toContain("1 account low · 4 providers unavailable");
    expect(host.textContent).toContain("Resets in 1h");
    await act(async () => host.querySelector("button")!.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it.each(["stale", "error", "fetching", "unavailable"] as const)("shows unavailable instead of a %s headline", async freshness => {
    const snapshot = fixture(); snapshot.groups[0].accounts[0].freshness = freshness;
    await act(async () => root.render(<UsageVital snapshot={snapshot} onOpen={() => {}} />));
    expect(host.textContent).toContain("Usage unavailable");
    expect(host.textContent).not.toContain("18%");
    expect(host.textContent).toContain("0 accounts low · 5 providers unavailable");
  });

  it("excludes reset-due and malformed windows and keeps other fresh windows available", async () => {
    const snapshot = fixture(); const limits = snapshot.groups[0].accounts[0].limits!;
    limits.session!.resetsAt = now - 1;
    await act(async () => root.render(<UsageVital snapshot={snapshot} onOpen={() => {}} />));
    expect(host.textContent).toContain("42%weekly left");
    limits.weekly!.usedPercent = Infinity;
    await act(async () => root.render(<UsageVital snapshot={snapshot} onOpen={() => {}} />));
    expect(host.textContent).toContain("Usage unavailable");
  });

  it("renders working task, idle home and unresolved engine labels from actual loaded association joins", async () => {
    const snapshot = fixture();
    await act(async () => root.render(<><UsageAgentAccountLabels snapshot={snapshot} monoId="synthetic-searcher" /><UsageAgentAccountLabels snapshot={snapshot} monoId="synthetic-manager" /></>));
    const labels = host.querySelectorAll('[aria-label="Loaded account associations"]');
    expect(labels[0].textContent).toBe("Working · Codex / Studio");
    expect(labels[0].querySelector("span")?.title).toBe("task: synthetic-search-chat");
    expect(labels[1].textContent).toContain("Idle / configured · Codex / Studio");
    expect(labels[1].textContent).toContain("Account association unknown");
    expect(labels[1].textContent).not.toContain("Working");
  });
});
