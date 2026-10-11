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
function button(label: string) { return [...container.querySelectorAll("button")].find(button => button.textContent === label)!; }

it("shows the role count, supports individual removal and all opt-in while plugins stay off", async () => {
  await render();
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 1 enabled");
  expect(container.textContent).toContain("Changes apply on its next turn");
  const first = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(first.checked).toBe(true);
  act(() => first.click());
  expect(findMono("member")?.skillsPolicy).toMatchObject({ mode: "custom", enabled: [] });
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 0 enabled");
  act(() => (container.querySelector('[aria-label="Enable all skills"]') as HTMLElement).click());
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 3 enabled");
  expect(container.querySelector('[aria-label="ponytail@test"]')?.getAttribute("aria-checked")).toBe("false");
  act(() => (container.querySelector('[aria-label="ponytail@test"]') as HTMLElement).click());
  expect(findMono("member")?.skillsPolicy?.plugins).toEqual(["ponytail@test"]);
  act(() => button("Use role default").click());
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 1 enabled");
});

it("saves a team default and lets a member choose an independent role default", async () => {
  await render("manager");
  act(() => button("Use selection for team").click());
  expect(findMono("manager")?.teamSkillsPolicy).toMatchObject({ mode: "custom", enabled: ["review"] });
  act(() => (container.querySelector('[aria-label="Enable all skills"]') as HTMLElement).click());
  act(() => button("Use selection for team").click());
  await render("member");
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 3 enabled");
  expect(container.textContent).toContain("Team default");
  act(() => button("Use role default").click());
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 1 enabled");
  act(() => button("Use team default").click());
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 3 enabled");
});

it("reloads inventory on account switches without changing the saved selection", async () => {
  await render();
  act(() => (container.querySelector('[aria-label="Enable all skills"]') as HTMLElement).click());
  catalog.mockResolvedValueOnce({ ...inventory, skills: inventory.skills.slice(1) });
  await render("member", "other-account");
  expect(catalog).toHaveBeenLastCalledWith("other-account", "/synthetic");
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 2 enabled");
  expect(findMono("member")?.skillsPolicy?.mode).toBe("all");
});

it("searches the catalog without changing the enabled selection", async () => {
  await render();
  const input = container.querySelector('[aria-label="Search skills"]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "video");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const names = [...container.querySelectorAll('label')].map(label => label.textContent);
  expect(names).toEqual(["videoaccount"]);
  expect(container.querySelector("summary")?.textContent).toBe("Skills: 1 enabled");
  expect(findMono("member")?.skillsPolicy).toBeUndefined();
});
