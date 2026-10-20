// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GoalNextAction } from "./GoalNextAction";
import { Decisions, ProjectAutonomyControl } from "./Decisions";
import { ManagerUpdates } from "../../monos/ui/ManagerUpdates";
import type { GoalNextStep } from "../model/goalNextAction";

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const step: GoalNextStep = { goalId: "goal", key: "engine:continue", projectId: "/app", managerMonoId: "manager", managerId: "engine", sessionId: "chat", action: "continue", label: "Manager paused — Continue", revision: "one" };
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.unstubAllGlobals(); });
function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
}

it("shows a real goal action in empty Decisions and coalesces rapid clicks", async () => {
  mount();
  const action = vi.fn(async (_event: Event, _step: GoalNextStep) => {});
  await act(async () => root.render(<Decisions roster={[]} view={{ pending: [], log: [], teamPending: 0, handledToday: 0, pruned: 0, skipped: 0 }}
    actions={{ answer: async () => ({ logFailed: false }), autonomy: async () => {}, openProject: () => {} }}
    goalActionCount={1} goalActions={<GoalNextAction step={step} onAction={action} />} />));
  expect(host.textContent).toContain("1 need you");
  expect(host.textContent).not.toContain("Nothing needs your decision");
  const button = host.querySelector<HTMLButtonElement>(".goal-next-action button")!;
  await act(async () => { button.click(); button.click(); });
  expect(action).toHaveBeenCalledOnce(); expect(action.mock.calls[0][1]).toBe(step);
  expect(button.disabled).toBe(true); expect(button.textContent).toBe("Sent to Manager");
});

it("uses approved Ask me for copy and the existing policy values", async () => {
  mount(); const autonomy = vi.fn(async () => {});
  await act(async () => root.render(<ProjectAutonomyControl managerId="manager" projectId="/app" value="high-impact-only"
    actions={{ answer: async () => ({ logFailed: false }), autonomy, openProject: () => {} }} />));
  expect(host.textContent).toContain("You'll still approve merges, installs and deletes.");
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.map(button => button.textContent)).toEqual(["High-impact only", "Medium & up", "Everything"]);
  await act(async () => buttons[2].click());
  expect(autonomy).toHaveBeenCalledWith(expect.any(Event), "manager", "/app", "everything");
});

it("opens the actual retained update without sending or acknowledging it", async () => {
  mount(); const events = [{ id: "info", kind: "info" as const, at: 1, text: "Retained Manager update" }];
  await act(async () => root.render(<ManagerUpdates events={events} monoId="manager" />));
  expect(document.body.textContent).not.toContain("Retained Manager update");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Retained Manager update");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Evidence")!.click());
  expect(document.body.textContent).toContain("Retained Manager update");
  expect(events[0]).not.toHaveProperty("acknowledgedAt");
});
