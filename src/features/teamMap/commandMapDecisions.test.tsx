// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionUiActions } from "../commandCenter/ui/Decisions";
import { commandMapDecisions } from "./commandMapDecisions";
import { ask, fixtureLedger, project, roster } from "./fixtures/lite/data";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const actions: DecisionUiActions = { answer: vi.fn(async () => ({ logFailed: false })), autonomy: vi.fn(async () => {}), openProject: vi.fn() };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

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
