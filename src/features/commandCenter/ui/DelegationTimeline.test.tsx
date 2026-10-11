// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DelegationTimeline, DelegationTimelineRoute } from "./DelegationTimeline";
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
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;

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

  it("Mission control's View timeline opens the exact goal and preserves filters, history, scroll and return focus", async () => {
    const close = vi.fn();
    await act(async () => root.render(<DelegationTimelineRoute runs={runs} sessions={sessions} open onClose={close} onOpenTarget={() => {}} />));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = goals[0].projectId; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const history = host.querySelector<HTMLDetailsElement>(".mc-finished")!; history.open = true;
    const scroll = host.querySelector<HTMLElement>(".mc-scroll")!; scroll.scrollTop = 240;
    const link = host.querySelector<HTMLAnchorElement>(`[data-goal-timeline="${goals[0].id}"]`)!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => link.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(host.querySelector(".delegation-timeline h1")?.textContent).toBe(goals[0].title);
    expect(host.querySelector<HTMLElement>(".mission-control")?.hidden).toBe(true);
    await act(async () => button("Back to Mission control").click());
    expect(host.querySelector(".delegation-timeline")).toBeNull();
    expect(select.value).toBe(goals[0].projectId); expect(history.open).toBe(true); expect(scroll.scrollTop).toBe(240);
    expect(document.activeElement).toBe(link); expect(close).not.toHaveBeenCalled();
  });

  it("hidden routes release Escape and stop displaying timeline navigation", async () => {
    const close = vi.fn();
    const render = (open: boolean) => root.render(<DelegationTimelineRoute runs={runs} sessions={sessions} open={open} onClose={close} onOpenTarget={() => {}} />);
    await act(async () => render(true));
    await act(async () => host.querySelector<HTMLAnchorElement>("[data-goal-timeline]")!.click());
    await act(async () => render(false));
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false); expect(close).not.toHaveBeenCalled();
    expect(host.querySelector(".delegation-timeline")).toBeNull();
    expect(host.querySelector<HTMLElement>(".dt-route")?.hidden).toBe(true);
  });

  it("keeps Escape guarded and moves focus to Back when the selected goal disappears", async () => {
    const close = vi.fn(), hiddenStop = vi.fn();
    window.addEventListener("keydown", hiddenStop);
    await act(async () => root.render(<DelegationTimelineRoute runs={runs} sessions={sessions} open onClose={close} onOpenTarget={() => {}} />));
    await act(async () => host.querySelector<HTMLAnchorElement>("[data-goal-timeline]")!.click());
    await act(async () => { storedGoals = []; storeVersion++; listeners.forEach(listener => listener()); });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("no longer available");
    expect(document.activeElement).toBe(button("Back to Mission control"));
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true); expect(hiddenStop).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(host.querySelector(".dt-missing")).toBeNull();
    window.removeEventListener("keydown", hiddenStop);
  });
});
