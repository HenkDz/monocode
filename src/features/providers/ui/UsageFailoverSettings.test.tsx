// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageFailoverSettings } from "./UsageFailoverSettings";
import { loadUsageFailoverPolicy, saveUsageFailoverPolicy, USAGE_FAILOVER_SETTINGS_KEY } from "../model/usageFailoverSettings";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", new Storage());
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const accounts = [
  { id: "default", provider: "claude" as const, label: "Personal" },
  { id: "work", provider: "claude" as const, label: "Work" },
  { id: "other", provider: "codex" as const, label: "Other provider" },
];
async function render() { await act(async () => root.render(<UsageFailoverSettings provider="claude" accounts={accounts} />)); }
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label || button.textContent?.trim() === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
it("renders manual default and an explicit empty ranking, saving only a deliberate per-provider opt-in", async () => {
  await render();
  expect(container.querySelector("input")?.checked).toBe(false);
  expect(container.textContent).toContain("Manual pause and choose is the default");
  expect(container.textContent).toContain("No ranked accounts");
  expect(container.textContent).not.toContain("Other provider");
  await act(async () => container.querySelector("input")!.click());
  expect(loadUsageFailoverPolicy("claude").enabled).toBe(true);
  expect(loadUsageFailoverPolicy("codex").enabled).toBe(false);
});
it("provides labelled native controls for explicit rank/add/remove and retains them on remount", async () => {
  await render(); await click("Add Personal to order"); await click("Add Work to order");
  await click("Move Work earlier");
  expect(loadUsageFailoverPolicy("claude").rankedAccountIds).toEqual(["work", "default"]);
  expect(container.querySelector("ol")?.getAttribute("aria-label")).toBe("claude failover account order");
  const first = container.querySelector("ol button") as HTMLButtonElement;
  expect(first.disabled).toBe(true);
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(container.querySelector("li")?.textContent).toContain("1. Work");
  await click("Remove Work from failover");
  expect(loadUsageFailoverPolicy("claude").rankedAccountIds).toEqual(["default"]);
});
it("reflects settings from another window and exposes failed opt-in without falsely checking it", async () => {
  await render();
  await act(async () => {
    saveUsageFailoverPolicy("claude", { enabled: false, rankedAccountIds: ["work"] });
    window.dispatchEvent(new StorageEvent("storage", { key: USAGE_FAILOVER_SETTINGS_KEY }));
  });
  expect(container.querySelector("li")?.textContent).toContain("Work");
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("full"); });
  await act(async () => container.querySelector("input")!.click());
  expect(container.querySelector("input")?.checked).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  expect(loadUsageFailoverPolicy("claude").enabled).toBe(false);
});
