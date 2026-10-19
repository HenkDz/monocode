// @vitest-environment happy-dom
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Decisions, type DecisionUiActions } from "./Decisions";
import { selectDecisionView } from "../model/decisionView";
import { fixtureLedger, roster } from "../../teamMap/fixtures/lite/data";

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([0, 1])("retains accepted row %i in place with the same DOM identity until its existing fade ends", async index => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const ledger = await fixtureLedger();
  const accepted = new Set<string>();
  const actions: DecisionUiActions = {
    wasAccepted: (manager, id) => accepted.has(`${manager}:${id}`),
    answer: async (_event, manager, id) => {
      accepted.add(`${manager}:${id}`);
      await ledger.recordDecisionAnswer(manager, id, "user", "Reuse");
      return { logFailed: false };
    },
    autonomy: async () => {}, openProject: () => {},
  };
  function Host() {
    useSyncExternalStore(ledger.subscribe, ledger.snapshot);
    return <Decisions view={selectDecisionView(ledger, roster, Date.now())} roster={roster} actions={actions} />;
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Host />));
  const before = [...host.querySelectorAll(".decision-card")];
  await act(async () => before[index].querySelector<HTMLButtonElement>(".decision-options button")!.click());
  const after = [...host.querySelectorAll(".decision-card")];
  expect(after).toHaveLength(2);
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[index].querySelector<HTMLButtonElement>(".decision-options button")!.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(1300));
  expect([...host.querySelectorAll(".decision-card")]).toEqual([before[1 - index]]);
});
