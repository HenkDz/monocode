// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionControlNav, MissionControlView } from "./MissionControl";
import { selectGoalViews, type GoalTarget } from "../model/goalView";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const view = () => selectGoalViews({ goals, roster, runs, sessions, now });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];

describe("Mission control", () => {
  it("shows two live goals, honest state reasons, complete long titles and collapsed Finished history", async () => {
    await act(async () => root.render(<MissionControlView view={view()} onOpenTarget={() => {}} onClose={() => {}} />));
    const heading = [...host.querySelectorAll(".mc-goal-header h2")].map(node => node.textContent);
    expect(heading).toContain(goals[0].title);
    expect(heading).toContain(goals[1].title);
    expect(host.querySelector(".mc-list-heading h2")?.textContent).toBe("Live goals · 2");
    expect(host.querySelector<HTMLDetailsElement>(".mc-finished")?.open).toBe(false);
    expect(host.querySelector(".mc-finished summary")?.textContent).toBe("Finished · 2");
    expect(host.querySelector('[data-agent-state="blocked"]')?.textContent).toBe("Blocked · storage");
    expect(host.textContent).toContain(sessions[3].codexStorageError);
    expect(host.textContent).toContain("cost unavailable");
    expect(host.textContent).toContain("these totals overlap");
  });

  it("opens the blocked review's exact session and keeps the reviewed attempt visible", async () => {
    const open = vi.fn<(target: GoalTarget) => void>();
    await act(async () => root.render(<MissionControlView view={view()} onOpenTarget={open} onClose={() => {}} />));
    await act(async () => buttons().find(button => button.getAttribute("aria-label") === "Resolve Reviewer")!.click());
    expect(open).toHaveBeenCalledWith({ sessionId: "synthetic-reviewer-chat" });
    expect(host.querySelector(".mc-review")?.textContent).toContain("dispatch-synthetic-build");
  });

  it("discloses metric scopes per node and explains shared conversation overlap once per goal", async () => {
    await act(async () => root.render(<MissionControlView view={view()} onOpenTarget={() => {}} onClose={() => {}} />));
    const goal = host.querySelector(".mc-goal")!;
    expect(goal.querySelectorAll(".mc-goal-note")).toHaveLength(1);
    expect(goal.querySelectorAll(".mc-node .mc-note")).toHaveLength(0);
    const metrics = goal.querySelector<HTMLDetailsElement>(".mc-metrics")!;
    expect(metrics.open).toBe(false);
    expect(metrics.querySelector("summary")?.textContent).toMatch(/\d+m \d+s · [\d,]+ tokens/);
    expect(metrics.querySelector("dt")?.textContent).toBe("Observed turn time");
    metrics.open = true;
    expect(metrics.querySelector("dl")?.textContent).toContain("Goal contribution");
    expect(goal.querySelector('[data-role="manager"] [data-agent-state="waiting-on-member"]')?.textContent).toBe("Waiting · Reviewer blocked");
    expect(goal.querySelector('[data-role="manager"] .mc-reason')).toBeNull();
    expect(goal.querySelector('[data-role="worker"][data-state="blocked"] .mc-metrics summary')?.textContent).toBe("Elapsed unavailable · Tokens unavailable");
  });

  it("restores project filter, history disclosure and scroll after returning from a conversation", async () => {
    const data = view();
    const render = (open: boolean) => root.render(<MissionControlView view={data} open={open} onOpenTarget={() => {}} onClose={() => {}} />);
    await act(async () => render(true));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = goals[0].projectId; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const history = host.querySelector<HTMLDetailsElement>(".mc-finished")!;
    history.open = true;
    const scroll = host.querySelector<HTMLDivElement>(".mc-scroll")!; scroll.scrollTop = 240;
    await act(async () => render(false));
    expect(host.querySelector<HTMLElement>(".mission-control")?.hidden).toBe(true);
    await act(async () => render(true));
    expect(select.value).toBe(goals[0].projectId);
    expect(history.open).toBe(true);
    expect(scroll.scrollTop).toBe(240);
  });

  it("filters by project identity even when project names match", async () => {
    const duplicateNames = selectGoalViews({ goals: [
      { ...goals[0], projectId: "C:/alpha/repo", managerId: "absent-one" },
      { ...goals[1], projectId: "D:/beta/repo", managerId: "absent-two" },
    ], roster, runs: [], sessions, now });
    await act(async () => root.render(<MissionControlView view={duplicateNames} onOpenTarget={() => {}} onClose={() => {}} />));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(select.options).toHaveLength(3);
    await act(async () => { select.value = "D:/beta/repo"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".mc-goal")).toHaveLength(1);
    expect(host.querySelector(".mc-goal h2")?.textContent).toBe(goals[1].title);
  });

  it("shows conversation navigation failure without losing the goal view", async () => {
    await act(async () => root.render(<MissionControlView view={view()} onOpenTarget={async () => { throw Error("Session removed"); }} onClose={() => {}} />));
    await act(async () => buttons().find(button => button.getAttribute("aria-label") === "Resolve Reviewer")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Session removed");
    expect(host.querySelector(".mc-list-heading h2")?.textContent).toContain("2");
  });

  it("omits unsupported attention counts and provides a useful empty goal state", async () => {
    const empty = selectGoalViews({ goals: [], roster: [], runs: [], sessions: [], now });
    await act(async () => root.render(<MissionControlView view={empty} onOpenTarget={() => {}} onClose={() => {}} />));
    expect(host.querySelector('[aria-label="Attention"]')).toBeNull();
    expect(host.textContent).toContain("No live goals yet");
  });

  it("offers accessible navigation and claims Escape before background session stop handlers", async () => {
    const open = vi.fn(); const close = vi.fn();
    await act(async () => root.render(<><MissionControlNav compact onOpen={open} />
      <MissionControlView view={view()} onOpenTarget={() => {}} onClose={close} /></>));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mission control"]')!.click());
    expect(open).toHaveBeenCalledOnce();
    await act(async () => buttons().find(button => button.textContent === "Back to conversation")!.click());
    expect(close).toHaveBeenCalledOnce();
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<MissionControlView view={view()} open={false} onOpenTarget={() => {}} onClose={close} />));
    const hiddenEscape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(hiddenEscape));
    expect(hiddenEscape.defaultPrevented).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
