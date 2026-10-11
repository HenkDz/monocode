// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findMono } from "../model/mono";
import type { MonoSkillsCatalog } from "../model/monoSkills";

const catalog = vi.hoisted(() => vi.fn());
vi.mock("../../../integrations/harness/core/child", () => ({ hasHeadlessChildBackend: () => false, monoCodexSkillsCatalog: catalog }));
vi.mock("../../connections/model/remoteProjects", () => ({ remoteProjectFor: () => undefined }));
vi.mock("../../providers/model/providerAccounts", () => ({ selectedProviderAccountId: () => "synthetic-account" }));
const { MonoSkillsSettings } = await import("./MonoSkillsSettings");

const inventory: MonoSkillsCatalog = { skills: ["testing", "review", "video"].map(id => ({ id, name: id, description: id, source: "account", path: `/synthetic/${id}` })), roleDefaults: { grand_orchestrator: [], manager: ["review"], worker: ["testing"], reviewer: ["review"] }, plugins: ["ponytail@test"] };
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map([["monocode:mono-roster", JSON.stringify([
    { id: "manager", role: "manager", projects: ["/synthetic"], mascot: "cat", color: "#abc" },
    { id: "member", role: "member", specialty: "Builder", reportsTo: "manager", projects: ["/synthetic"], mascot: "cat", color: "#abc" },
  ])]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  catalog.mockReset().mockResolvedValue(inventory);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(monoId = "member", providerAccountId = "synthetic-account") {
  await act(async () => root.render(createElement(MonoSkillsSettings, { monoId, harness: "codex", providerAccountId, cwd: "/synthetic" })));
}
function button(label: string) { return [...document.querySelectorAll("button")].find(button => button.textContent === label)!; }
function summary() { return container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!; }
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]')!; }
function openPicker() { act(() => { summary().focus(); summary().click(); }); }

it("shows the role count, supports individual removal and all opt-in while plugins stay off", async () => {
  await render();
  expect(summary().getAttribute("aria-label")).toBe("Skills · 1 enabled");
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[aria-label="Search skills"]')).toBeNull();
  expect(document.querySelector("details, summary")).toBeNull();
  openPicker();
  expect(summary().getAttribute("aria-expanded")).toBe("true");
  expect(dialog().getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector("details, summary")).toBeNull();
  expect(dialog().textContent).toContain("Changes apply on this Mono's next turn");
  expect(dialog().querySelector('[aria-label="Search skills"]')?.closest('[hidden], [aria-hidden="true"]')).toBeNull();
  expect(button("Role default").getAttribute("aria-pressed")).toBe("true");
  const first = dialog().querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(first.checked).toBe(true);
  act(() => first.closest("label")!.click());
  expect(findMono("member")?.skillsPolicy).toMatchObject({ mode: "custom", enabled: [] });
  expect(summary().getAttribute("aria-label")).toBe("Skills · 0 enabled");
  expect(dialog().textContent).toContain("No skills enabled");
  act(() => button("All").click());
  expect(summary().getAttribute("aria-label")).toBe("Skills · 3 enabled");
  expect(dialog().querySelector('[aria-label="ponytail@test"]')?.getAttribute("aria-checked")).toBe("false");
  act(() => (dialog().querySelector('[aria-label="ponytail@test"]') as HTMLElement).click());
  expect(findMono("member")?.skillsPolicy?.plugins).toEqual(["ponytail@test"]);
  act(() => button("Role default").click());
  expect(summary().getAttribute("aria-label")).toBe("Skills · 1 enabled");
  expect(findMono("member")?.skillsPolicy?.plugins).toEqual(["ponytail@test"]);
});

it("saves a team default and lets a member choose an independent role default", async () => {
  await render("manager");
  openPicker();
  act(() => button("Use selection for team").click());
  expect(findMono("manager")?.teamSkillsPolicy).toMatchObject({ mode: "custom", enabled: ["review"] });
  act(() => button("All").click());
  act(() => button("Use selection for team").click());
  await render("member");
  expect(summary().getAttribute("aria-label")).toBe("Skills · 3 enabled");
  expect(container.textContent).toContain("Team default");
  act(() => button("Role default").click());
  expect(summary().getAttribute("aria-label")).toBe("Skills · 1 enabled");
  act(() => button("Use team default").click());
  expect(summary().getAttribute("aria-label")).toBe("Skills · 3 enabled");
  await render("manager");
  act(() => button("Reset team to role defaults").click());
  expect(findMono("manager")?.teamSkillsPolicy).toBeUndefined();
  await render("member");
  expect(summary().getAttribute("aria-label")).toBe("Skills · 1 enabled");
});

it("reloads inventory on account switches without changing the saved selection", async () => {
  await render();
  openPicker();
  act(() => button("All").click());
  catalog.mockResolvedValueOnce({ ...inventory, skills: inventory.skills.slice(1) });
  await render("member", "other-account");
  expect(catalog).toHaveBeenLastCalledWith("other-account", "/synthetic");
  expect(summary().getAttribute("aria-label")).toBe("Skills · 2 enabled");
  expect(findMono("member")?.skillsPolicy?.mode).toBe("all");
});

it("searches the catalog without changing the enabled selection", async () => {
  await render();
  openPicker();
  const input = dialog().querySelector('[aria-label="Search skills"]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "video");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const names = [...dialog().querySelectorAll('input[type="checkbox"]')].map(input => input.getAttribute("aria-label"));
  expect(names).toEqual(["video"]);
  expect(dialog().querySelector('[aria-label="Remove testing"]')).not.toBeNull();
  expect(summary().getAttribute("aria-label")).toBe("Skills · 1 enabled");
  expect(findMono("member")?.skillsPolicy).toBeUndefined();
});

it("takes an all-skills snapshot for Custom and removes enabled chips", async () => {
  await render();
  openPicker();
  act(() => button("All").click());
  act(() => button("Custom").click());
  expect(findMono("member")?.skillsPolicy).toMatchObject({ mode: "custom", enabled: ["testing", "review", "video"] });
  act(() => (dialog().querySelector('[aria-label="Remove video"]') as HTMLButtonElement).click());
  expect(findMono("member")?.skillsPolicy).toMatchObject({ mode: "custom", enabled: ["testing", "review"] });
  expect(dialog().querySelector('[aria-label="Remove video"]')).toBeNull();
  expect((dialog().querySelector('input[aria-label="video"]') as HTMLInputElement).checked).toBe(false);
  expect(button("Custom").getAttribute("aria-pressed")).toBe("true");
});

it("keeps focus in the real picker, closes with Escape and restores its opener", async () => {
  await render();
  const opener = summary();
  openPicker();
  const close = dialog().querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
  const last = button("Use team default");
  expect(document.activeElement).toBe(close);
  last.focus();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  act(() => last.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  act(() => close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(last);
  act(() => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(opener.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(opener);
});

it("closes with the installed modal's Close control without changing the policy", async () => {
  await render();
  openPicker();
  act(() => dialog().querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(findMono("member")?.skillsPolicy).toBeUndefined();
});

it("keeps an empty inventory usable without plugins or disclosures", async () => {
  catalog.mockResolvedValueOnce({ ...inventory, skills: [], plugins: [] });
  await render();
  openPicker();
  expect(summary().getAttribute("aria-label")).toBe("Skills · 0 enabled");
  expect(dialog().querySelector('[aria-label="Search skills"]')).not.toBeNull();
  expect(dialog().textContent).toContain("No matching skills");
  expect(dialog().querySelector('[aria-label="Plugins"]')).toBeNull();
  expect(document.querySelector("details, summary")).toBeNull();
  act(() => button("All").click());
  expect(findMono("member")?.skillsPolicy?.mode).toBe("all");
});
