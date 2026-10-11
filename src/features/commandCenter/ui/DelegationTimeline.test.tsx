// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DelegationTimeline } from "./DelegationTimeline";
import { selectGoalTimeline } from "../model/timeline";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";

vi.mock("../../monos/model/mono", () => ({ listMonos: () => roster, monosSnapshot: () => 0, subscribeMonos: () => () => {} }));
let storedGoals = goals;
let storeVersion = 0;
const listeners = new Set<() => void>();
vi.mock("../../monos/model/monoManagerGoals", () => ({ monoManagerGoals: { goals: () => storedGoals, snapshot: () => storeVersion,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const timeline = () => selectGoalTimeline({ goalId: goals[0].id, goals, roster, runs, sessions, now })!;
beforeEach(() => {
  storedGoals = goals; storeVersion = 0; listeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Delegation timeline and local route", () => {
  it("gives every span an accessible ledger row and explains unknown phase coverage", async () => {
    const data = timeline();
    await act(async () => root.render(<DelegationTimeline timeline={data} onBack={() => {}} onOpenTarget={() => {}} />));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(data.lanes.reduce((count, lane) => count + lane.spans.length, 0));
    for (const span of host.querySelectorAll<HTMLAnchorElement>(".dt-span")) {
      expect(document.getElementById(span.hash.slice(1))).not.toBeNull();
      expect(span.getAttribute("aria-label")).toBeTruthy();
    }
    expect(host.textContent).toContain("Exact model / tool phases are unavailable");
    expect(host.textContent).toContain("Start time unavailable");
    expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(6);
    expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(data.lanes.reduce((count, lane) => count + lane.spans.length, 0));
    expect(document.activeElement?.id).toBe("delegation-timeline-title");
  });

  it("opens an attempt's saved session and shows navigation failures", async () => {
    const open = vi.fn(async () => { throw Error("Session unavailable"); });
    await act(async () => root.render(<DelegationTimeline timeline={timeline()} onBack={() => {}} onOpenTarget={open} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open Reviewer attempt dispatch-synthetic-review"]')!.click());
    expect(open).toHaveBeenCalledWith({ sessionId: "synthetic-reviewer-chat" });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Session unavailable");
  });

  it("uses a recorded-window label for finished goals", async () => {
    const input = structuredClone({ goals, roster, runs, sessions, now }); input.goals[0].state = "done";
    const data = selectGoalTimeline({ ...input, goalId: goals[0].id })!;
    await act(async () => root.render(<DelegationTimeline timeline={data} onBack={() => {}} onOpenTarget={() => {}} />));
    expect(host.textContent).toContain("goal completion time unknown");
    expect(host.textContent).not.toContain("Window to current snapshot");
  });

  it("claims Escape in capture and returns to Mission control", async () => {
    const back = vi.fn(); const stop = vi.fn();
    window.addEventListener("keydown", stop);
    await act(async () => root.render(<DelegationTimeline timeline={timeline()} onBack={back} onOpenTarget={() => {}} />));
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true); expect(back).toHaveBeenCalledOnce(); expect(stop).not.toHaveBeenCalled();
    window.removeEventListener("keydown", stop);
  });

});
