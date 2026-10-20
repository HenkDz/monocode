// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionUiActions } from "../commandCenter/ui/Decisions";
import { commandMapDecisions } from "./commandMapDecisions";
import { ask, fixtureLedger, project, roster } from "./fixtures/lite/data";
import type { GoalNextStep } from "../commandCenter/model/goalNextAction";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const actions: DecisionUiActions = { answer: vi.fn(async () => ({ logFailed: false })), autonomy: vi.fn(async () => {}), openProject: vi.fn() };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("counts the supplied actionable goals and shares their renderer without crossing Managers", async () => {
  const ledger = await fixtureLedger([]);
  const step: GoalNextStep = { goalId: "goal", key: "engine:continue", projectId: project, managerMonoId: "manager", managerId: "engine", sessionId: "chat", action: "continue", label: "Manager paused — Continue", revision: "one" };
  const render = vi.fn((value: GoalNextStep) => <button key={value.revision}>{value.label}</button>);
  const map = commandMapDecisions(ledger, roster, actions, Date.now(), { steps: [step], render });
  expect(map.needYou).toBe(1);
  const scoped = map.project(project, "manager");
  expect(scoped.pending).toBe(1);
  expect(scoped.goalAction?.("foreign")).toBeUndefined();
  await act(async () => root.render(<>{scoped.goalAction?.("goal")}{scoped.cards}</>));
  expect([...host.querySelectorAll("button")].filter(button => button.textContent === step.label)).toHaveLength(2);
  expect(map.project(project, "foreign-manager").pending).toBe(0);
});

it("uses lite retained counts and isolates a drawer to its live Manager and project", async () => {
  const ledger = await fixtureLedger([ask, { ...ask, id: "team", answererId: "boss" }, { ...ask, id: "other-project", projectId: "C:/other" },
    { ...ask, id: "answered", status: "answered", answeredBy: "boss", answeredAt: Date.now(), answer: "Reuse" }], 2, 1);
  const peer = { ...roster[1], id: "peer" };
  await ledger.recordDecision(peer.id, { ...ask, id: "peer-ask" });
  const map = commandMapDecisions(ledger, [...roster, peer], actions, Date.now());
  expect([map.needYou, map.handledToday, map.incomplete]).toEqual([3, 1, true]);
  const scoped = map.project(project, "manager");
  expect([scoped.pending, scoped.teamPending, scoped.incomplete]).toEqual([1, 1, true]);
  await act(async () => root.render(<>{scoped.autonomy}{scoped.cards}</>));
  expect(host.querySelectorAll(".decision-card")).toHaveLength(1);
  expect(host.textContent).toContain("2 older entries pruned");
  expect(host.textContent).toContain("1 unreadable entries skipped");
  const unavailable = map.project(project, "missing");
  await act(async () => root.render(<>{unavailable.autonomy}{unavailable.cards}</>));
  expect(unavailable.incomplete).toBe(true);
  expect(host.querySelectorAll("button")).toHaveLength(0);
});

it("leaves legacy rows in lite history and exposes autonomy without a goal", async () => {
  const ledger = await fixtureLedger([{ ...ask, readOnly: true }]);
  const scoped = commandMapDecisions(ledger, roster, actions, Date.now()).project(project, "manager");
  expect(scoped.pending).toBe(0);
  await act(async () => root.render(<>{scoped.autonomy}{scoped.cards}</>));
  expect(host.querySelectorAll(".decision-autonomy button")).toHaveLength(3);
  expect(host.querySelectorAll(".decision-options")).toHaveLength(0);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Decision log")!.click());
  expect(host.querySelector(".decision-log")?.textContent).toContain(ask.question);
  expect(actions.answer).not.toHaveBeenCalled();
});

it("passes each original native event and exact IDs to the supplied lite actions", async () => {
  const ledger = await fixtureLedger();
  const scoped = commandMapDecisions(ledger, roster, actions, Date.now()).project(project, "manager");
  await act(async () => root.render(<>{scoped.autonomy}{scoped.cards}</>));
  const option = host.querySelector<HTMLButtonElement>(".decision-options button")!;
  const event = new MouseEvent("click", { bubbles: true });
  await act(async () => option.dispatchEvent(event));
  expect(actions.answer).toHaveBeenCalledWith(event, "manager", "ask", "reuse");
  expect(event.isTrusted).toBeFalsy(); // happy-dom leaves trust unset; Chromium checks the host's actual trust gate.
  const autonomy = [...host.querySelectorAll<HTMLButtonElement>(".decision-autonomy button")].find(button => button.textContent === "Everything")!;
  const gesture = new MouseEvent("click", { bubbles: true });
  await act(async () => autonomy.dispatchEvent(gesture));
  expect(actions.autonomy).toHaveBeenCalledWith(gesture, "manager", project, "everything");
  const protectedCard = [...host.querySelectorAll(".decision-card")].find(card => card.textContent?.includes("Send the project update?"))!;
  expect(protectedCard.textContent).not.toContain("Let the Boss decide");
});

it("retains the host's accepted lookup when a waiting card remounts after a log failure", async () => {
  const wasAccepted = vi.fn((manager: string, id: string) => manager === "manager" && id === "ask");
  const ledger = await fixtureLedger();
  await act(async () => root.render(commandMapDecisions(ledger, roster, { ...actions, wasAccepted }, Date.now()).project(project, "manager").cards));
  const card = host.querySelector(".decision-card")!;
  expect(wasAccepted).toHaveBeenCalledWith("manager", "ask");
  expect(card.querySelector<HTMLButtonElement>(".decision-options button")!.disabled).toBe(true);
  expect(card.textContent).toContain("Answer sent");
  expect(actions.answer).not.toHaveBeenCalled();
});
