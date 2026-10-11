// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionControlNav, MissionControlView } from "./MissionControl";
import { selectGoalViews, type GoalTarget } from "../model/goalView";
import { selectCockpit } from "../model/cockpit";
import { selectGoalTimeline } from "../model/timeline";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const fixture = () => structuredClone({ goals, roster, runs, sessions, now });
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(label))!;
const key = async (value: string) => { const event = new KeyboardEvent("keydown", { key: value, cancelable: true, bubbles: true }); await act(async () => document.activeElement!.dispatchEvent(event)); return event; };
function render(input = fixture(), openTarget: (target: GoalTarget) => void | Promise<void> = () => {}, close = vi.fn(), open = true) {
  const view = selectGoalViews(input);
  return root.render(<MissionControlView view={view} cockpit={selectCockpit(input)} attentionInput={input}
    timeline={id => selectGoalTimeline({ ...input, goalId: id })} onOpenTarget={openTarget} onClose={close} open={open} command={<input aria-label="Synthetic command" />} />);
}
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("CC7N Cockpit", () => {
  it("keeps command, roster, vitals and recent work useful with zero goals", async () => {
    const input = fixture(); input.goals = [];
    await act(async () => render(input));
    expect(host.querySelectorAll("[data-agent]")).toHaveLength(roster.length);
    expect(host.querySelector('[aria-label="Synthetic command"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Organization vitals"]')?.textContent).toContain("Goals in flight");
    expect(host.querySelector('[aria-label="In flight"]')?.textContent).toContain("No live goals. Ask a question");
    expect(host.querySelector('[aria-label="Recent activity"]')?.textContent).toContain("Completed");
    expect(host.querySelectorAll("details, summary")).toHaveLength(0);
  });
  it("opens a live goal in a compact drawer with blocked chain and exact session targets", async () => {
    const open = vi.fn<(target: GoalTarget) => void>();
    await act(async () => render(fixture(), open));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-goal]")!.click());
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer.textContent).toContain(goals[0].title);
    expect(drawer.textContent).toContain("wall elapsed");
    expect(drawer.querySelectorAll(".mc-chain-node")).toHaveLength(4);
    expect(drawer.querySelector('[data-agent-state="blocked"]')?.textContent).toBe("Blocked · storage");
    expect(drawer.querySelectorAll("details, summary")).toHaveLength(0);
    await act(async () => drawer.querySelector<HTMLButtonElement>('[aria-label="Open Reviewer"]')!.click());
    expect(open).toHaveBeenCalledWith({ sessionId: "synthetic-reviewer-chat" });
    expect(drawer.querySelector('[aria-label="Open Reviewer"]')?.getAttribute("title")).toContain("dispatch-synthetic-build");
  });
  it("switches Phases/Ledger and pages recorded evidence without asserting unknown phases", async () => {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-goal]")!.click());
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer.querySelectorAll(".mc-phases button")).toHaveLength(5);
    expect(drawer.textContent).toContain("exact phase boundaries are unavailable");
    expect(drawer.querySelector("table")).toBeNull();
    await act(async () => button("Ledger", drawer).click());
    expect(drawer.querySelectorAll("tbody tr")).toHaveLength(4);
    const first = drawer.querySelector("tbody")?.textContent;
    await act(async () => drawer.querySelector<HTMLButtonElement>('[aria-label="Next ledger page"]')!.click());
    expect(drawer.querySelector("tbody")?.textContent).not.toBe(first);
    await act(async () => drawer.querySelector<HTMLButtonElement>("tbody button")!.click());
    expect(drawer.querySelector('[role="status"]')?.textContent).toContain("Start");
    await act(async () => button("Phases", drawer).click());
    expect(drawer.querySelector("table")).toBeNull();
  });
  it("hosts attention inside Mission control and blocker action switches the same drawer", async () => {
    await act(async () => render());
    expect(host.querySelector(".mc-attention")?.textContent).toContain("Needs attention");
    await act(async () => button("View all", host).click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Codex storage needs repair");
    await key("Escape");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-goal]")!.click());
    await act(async () => button("Resolve blocker").click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Needs attention");
  });
  it("persists project/state/density choices and restores the scroll on conversation return", async () => {
    await act(async () => render());
    await act(async () => button("Atlas", host.querySelector('[aria-label="Project filter"]')!).click());
    await act(async () => button("Compact", host.querySelector('[aria-label="Density"]')!).click());
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "Needs attention"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".mc-agent-card")).toHaveLength(1);
    expect(host.querySelector('[data-agent="synthetic-reviewer"]')).not.toBeNull();
    const scroll = host.querySelector<HTMLElement>(".mc-scroll")!; scroll.scrollTop = 240;
    await act(async () => render(fixture(), undefined, undefined, false));
    await act(async () => render());
    expect(scroll.scrollTop).toBe(240); expect(select.value).toBe("Needs attention");
    expect(host.querySelector(".mission-control")?.getAttribute("data-density")).toBe("compact");
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => render());
    expect(host.querySelector(".mission-control")?.getAttribute("data-density")).toBe("compact");
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("Needs attention");
  });
  it("j/k navigate cards and goals; Escape closes only the drawer and returns focus", async () => {
    const close = vi.fn();
    await act(async () => render(fixture(), undefined, close));
    await key("j"); expect(document.activeElement).toBe(host.querySelector("[data-mc-roving]"));
    await key("k"); const goals = host.querySelectorAll("[data-goal]"); expect(document.activeElement).toBe(goals[goals.length - 1]);
    const trigger = document.activeElement as HTMLButtonElement;
    await act(async () => trigger.click());
    await key("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(close).not.toHaveBeenCalled();
    const event = await key("Escape"); expect(event.defaultPrevented).toBe(true); expect(close).toHaveBeenCalledOnce();
    await act(async () => render(fixture(), undefined, close, false));
    expect((await key("Escape")).defaultPrevented).toBe(false);
  });
  it("text editing retains ordinary j/k keys and navigation errors stay visible in the drawer", async () => {
    await act(async () => render(fixture(), async () => { throw Error("Session removed"); }));
    const field = host.querySelector<HTMLInputElement>("input")!; field.focus();
    expect((await key("j")).defaultPrevented).toBe(false); expect(document.activeElement).toBe(field);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-goal]")!.click());
    await act(async () => button("Message Manager").click());
    expect(document.querySelector('.mc-drawer [role="alert"]')?.textContent).toContain("Session removed");
  });
  it("missing goals keep a closable drawer and hidden routes release it", async () => {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("[data-goal]")!.click());
    const input = fixture(); input.goals = [];
    await act(async () => render(input));
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain("no longer available");
    await act(async () => render(input, undefined, undefined, false));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("goal history opens without disclosures and compact navigation remains accessible", async () => {
    const open = vi.fn();
    await act(async () => root.render(<MissionControlNav compact onOpen={open} />));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); expect(open).toHaveBeenCalledOnce();
    await act(async () => render());
    await act(async () => button("Goals", host.querySelector(".mc-toolbar")!).click());
    expect(document.querySelectorAll(".mc-goal-row")).toHaveLength(goals.length);
    expect(document.querySelectorAll("details")).toHaveLength(0);
  });
});
