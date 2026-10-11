// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoDetails } from "./MonoDetails";
import { MonoTeamPage } from "./MonoTeamPage";
import { findMono, type Mono } from "../model/mono";
import { resetHarnessModelOverlays, setHarnessModels, type AgentModel, type EffortSource } from "../../sessions/model/models";
import { LOCAL_MODEL_SOURCE, ModelSourceContext } from "../../sessions/ui/modelSource";

vi.mock("../model/monoFiles", async original => ({
  ...(await original<object>()),
  loadMonoFiles: vi.fn(async () => ({ soul: "Sample soul", memory: "", topics: [] })),
}));
vi.mock("./MonoHabits", async original => ({ ...(await original<object>()), useHabits: () => [] }));
vi.mock("./MonoCodexStorageSource", () => ({ MonoCodexStorageSource: () => null }));

let root: Root;
let container: HTMLDivElement;
const noop = () => {};
const agent = { name: "Captain", mascot: "cat", color: "#6ba", projects: [] };
const model: AgentModel = {
  id: "codex:role-test", harness: "codex", name: "Role test",
  settings: [
    { id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high", options: [
      { value: "low", label: "Low" }, { value: "medium", label: "Medium" },
      { value: "high", label: "High" }, { value: "xhigh", label: "Extra high" },
    ] },
    { id: "serviceTier", label: "Service Tier", kind: "select", value: "default", options: [
      { value: "default", label: "Standard" }, { value: "priority", label: "Priority" },
    ] },
    { id: "fast", label: "Fast", kind: "toggle", value: "false", options: [
      { value: "false", label: "Off" }, { value: "true", label: "On" },
    ] },
  ],
};

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  setHarnessModels("codex", [model]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

function store(monos: Mono[]) {
  localStorage.setItem("monocode:mono-roster", JSON.stringify(monos));
}

function coordinator(role: "manager" | "orchestrator", extra: Partial<Mono> = {}): Mono {
  return { id: "coordinator", role, mascot: "cat", color: "#6ba", projects: ["/repo"], ...extra };
}

async function renderDetails(mono: Mono, settings: Record<string, string> = {}, remoteModel?: AgentModel, conversation?: { id: string; effortSource?: EffortSource }) {
  store(mono.role === "member" ? [coordinator("manager", { id: mono.reportsTo ?? "manager" }), mono] : [mono]);
  const changed = vi.fn();
  function Panel() {
    const [values, setValues] = useState(settings);
    const [effortSource, setEffortSource] = useState(conversation?.effortSource);
    const details = <MonoDetails open monoId={mono.id} sessionId={conversation?.id} effortSource={effortSource} cwd="/repo" agent={agent} state={{ status: "idle" }}
      harness="codex" model={model.id} modelSettings={values} runtimeMode="auto"
      onModelChange={noop} onClose={noop} onRuntimeModeChange={noop}
      onModelSettingsChange={(next, source?: EffortSource) => { changed(next, source); setValues(next); setEffortSource(source); }} />;
    return remoteModel ? <ModelSourceContext.Provider value={{ ...LOCAL_MODEL_SOURCE, id: "remote", resolve: () => remoteModel }}>{details}</ModelSourceContext.Provider> : details;
  }
  await act(async () => root.render(<Panel />));
  return changed;
}

function summary() {
  return container.querySelector<HTMLElement>("[data-mono-role-effort]")!;
}

async function clickText(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

async function pick(label: string, option: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  const selected = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent === option)!;
  expect(selected).toBeDefined();
  await act(async () => selected.click());
}

it.each(["manager", "orchestrator"] as const)("retains legacy %s effort and resets only effort on request", async role => {
  const before = coordinator(role, { userLockedFields: ["model", "modelSettings"] });
  const changed = await renderDetails(before, { reasoningEffort: "xhigh", serviceTier: "priority", fast: "true" });
  expect(summary().textContent).toContain("Extra high");
  expect(summary().textContent).toContain("Set by you");
  expect(summary().textContent).toContain("coordinators route and review; high effort mostly adds latency");
  expect(changed).not.toHaveBeenCalled();
  expect(findMono(before.id)?.effortSource).toBeUndefined();
  await clickText("Use role default (medium)");
  expect(changed).toHaveBeenLastCalledWith({ reasoningEffort: "medium", serviceTier: "priority", fast: "true" }, "role");
  expect(findMono(before.id)?.userLockedFields).toEqual(["model"]);
  expect(findMono(before.id)?.workerProfile?.modelSettings).toEqual({ reasoningEffort: "medium", serviceTier: "priority", fast: "true" });
  expect(summary().textContent).toContain("Medium");
  expect(summary().textContent).toContain("Role default");
});

it("marks effort selections as user choices while keeping unrelated role settings", async () => {
  const changed = await renderDetails(coordinator("manager", { effortSource: "role" }), { serviceTier: "priority" });
  expect(summary().textContent).toContain("Medium");
  await pick("Service Tier: Priority", "Standard");
  expect(changed).toHaveBeenLastCalledWith({ reasoningEffort: "medium", serviceTier: "default", fast: "false" }, "role");
  expect(summary().textContent).toContain("Role default");
  await pick("Reasoning: Medium", "High");
  expect(changed).toHaveBeenLastCalledWith({ reasoningEffort: "high", serviceTier: "default", fast: "false" }, "user");
  expect(findMono("coordinator")?.effortSource).toBe("user");
  expect(findMono("coordinator")?.userLockedFields).toContain("modelSettings");
  expect(summary().textContent).toContain("Set by you");
});

it("retains an unlocked legacy coordinator choice until reset", async () => {
  const changed = await renderDetails(coordinator("manager"), { reasoningEffort: "high" });
  expect(summary().textContent).toContain("High");
  expect(summary().textContent).toContain("Set by you");
  expect(changed).not.toHaveBeenCalled();
  await clickText("Use role default (medium)");
  expect(findMono("coordinator")?.effortSource).toBe("role");
  expect(summary().textContent).toContain("Medium");
});

it("keeps the provider's effective default when the requested role effort is unsupported", async () => {
  const unsupported = { ...model, settings: model.settings!.map(setting => setting.id === "reasoningEffort" ? { ...setting, options: setting.options.filter(option => option.value !== "medium") } : setting) };
  setHarnessModels("codex", [unsupported]);
  const changed = await renderDetails(coordinator("manager", { effortSource: "user" }), { reasoningEffort: "low", serviceTier: "priority" });
  expect(summary().textContent).toContain("Low");
  expect(summary().textContent).toContain("does not support the medium role default");
  await clickText("Reset to role default");
  expect(changed).toHaveBeenLastCalledWith({ reasoningEffort: "high", serviceTier: "priority", fast: "false" }, "role");
  expect(summary().textContent).toContain("High");
  expect(summary().textContent).toContain("Role default");
  expect(summary().textContent).not.toContain("Use role default (medium)");
});

it("shows the provider default when no effort setting is advertised", async () => {
  setHarnessModels("codex", [{ ...model, settings: [] }]);
  await renderDetails(coordinator("manager"));
  expect(summary().textContent).toContain("Provider default");
  expect(summary().textContent).toContain("Role default");
  expect(summary().textContent).toContain("does not support the medium role default");
});

it("uses a remote catalog's actual effort setting", async () => {
  const remote = { ...model, settings: [{ id: "thinking", label: "Thinking", kind: "select" as const, value: "xhigh", options: [
    { value: "medium", label: "Remote medium" }, { value: "xhigh", label: "Remote extra high" },
  ] }] };
  const changed = await renderDetails(coordinator("manager"), { thinking: "xhigh" }, remote);
  expect(summary().textContent).toContain("Remote extra high");
  await clickText("Use role default (medium)");
  expect(changed).toHaveBeenLastCalledWith({ thinking: "medium" }, "role");
  expect(summary().textContent).toContain("Remote medium");
});

it("resolves a member's high default without inheriting Manager effort, then edits and resets it", async () => {
  store([coordinator("manager"), { id: "member", role: "member", reportsTo: "coordinator", name: "Builder", specialty: "Backend", mascot: "cat", color: "#6ba", projects: ["/repo"], userLockedFields: ["model"] }]);
  await act(async () => root.render(createElement(MonoTeamPage, {
    monoId: "coordinator", fallback: { harness: "codex", model: model.id, modelSettings: { reasoningEffort: "xhigh", serviceTier: "priority" } }, onBack: noop,
  })));
  const memberButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.startsWith("Builder"))!;
  await act(async () => memberButton.click());
  expect(summary().textContent).toContain("High");
  expect(summary().textContent).toContain("Role default");
  expect(findMono("member")?.workerProfile).toBeUndefined();
  await pick("Reasoning: High", "Low");
  expect(summary().textContent).toContain("Set by you");
  expect(findMono("member")?.effortSource).toBe("user");
  expect(findMono("member")?.workerProfile?.modelSettings).toEqual({ reasoningEffort: "low", serviceTier: "priority", fast: "false" });
  await clickText("Reset to role default");
  expect(findMono("member")?.workerProfile?.modelSettings).toEqual({ reasoningEffort: "high", serviceTier: "priority", fast: "false" });
  expect(findMono("member")?.userLockedFields).toEqual(["model"]);
  expect(summary().textContent).toContain("Role default");
});

it("displays a legacy member conversation's saved effort even without a worker profile", async () => {
  const changed = await renderDetails({ ...coordinator("manager"), role: "member", reportsTo: "manager", specialty: "Backend" }, { reasoningEffort: "xhigh", serviceTier: "priority" });
  expect(summary().textContent).toContain("Extra high");
  expect(summary().textContent).toContain("Set by you");
  expect(changed).not.toHaveBeenCalled();
  await clickText("Reset to role default");
  expect(changed).toHaveBeenLastCalledWith({ reasoningEffort: "high", serviceTier: "priority", fast: "false" }, "role");
  expect(summary().textContent).toContain("High");
  expect(summary().textContent).toContain("Role default");
});

it.each([
  ["manager", "low"], ["manager", "high"],
  ["orchestrator", "low"], ["orchestrator", "high"],
  ["member", "low"], ["member", "high"],
] as const)("keeps a resident %s conversation's legacy %s effort after its Team profile resets", async (role, effort) => {
  const desired = role === "member" ? "high" : "medium";
  const mono = { ...coordinator("manager"), role, effortSource: "role" as const,
    ...(role === "member" ? { reportsTo: "manager", specialty: "Backend" } : {}),
    workerProfile: { harness: "codex" as const, model: model.id, modelSettings: { reasoningEffort: desired } },
  };
  const changed = await renderDetails(mono, { reasoningEffort: effort, serviceTier: "priority" }, undefined, { id: "resident" });
  expect(summary().querySelector("[data-model-control]")?.textContent).toBe(effort === "low" ? "Low" : "High");
  expect(summary().textContent).toContain("Set by you");
  expect(changed).not.toHaveBeenCalled();
  expect(findMono(mono.id)?.workerProfile?.modelSettings).toEqual({ reasoningEffort: desired });
  await clickText(role !== "member" && effort === "high" ? "Use role default (medium)" : "Reset to role default");
  expect(changed).toHaveBeenLastCalledWith({ reasoningEffort: desired, serviceTier: "priority", fast: "false" }, "role");
  expect(summary().textContent).toContain("Role default");
});
