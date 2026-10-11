import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import {
  loadLastModelSettings,
  resetHarnessModelOverlays,
  saveLastModelSettings,
  setHarnessModels,
  type AgentModel,
} from "../../sessions/model/models";
import { monoRoleEffort, resetMonoRoleEffort, resolveMonoRoleEffort, snapshotMonoWorkerEffort, switchMonoRoleEffort } from "./monoRoleEffort";
import type { Mono } from "./mono";

const model: AgentModel = {
  harness: "codex", id: "codex:effort-test", name: "Test",
  settings: [{ id: "reasoningEffort", label: "Reasoning", kind: "select", value: "low",
    options: ["low", "medium", "high", "xhigh"].map(value => ({ value, label: value })) },
  { id: "fast", label: "Fast", kind: "toggle", value: "false", options: [{ value: "false", label: "Off" }, { value: "true", label: "On" }] }],
};
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  setHarnessModels("codex", [model]);
});
afterEach(() => { resetHarnessModelOverlays(); vi.unstubAllGlobals(); });

describe("role effort", () => {
  it.each(["orchestrator", "manager", "member"] as const)("replaces global xhigh after generic %s creation without remembering a new preference", role => {
    saveLastModelSettings({ reasoningEffort: "xhigh", fast: "true" });
    const generic = newSession("codex", "/synthetic", model.id);
    expect(generic.modelSettings.reasoningEffort).toBe("xhigh");
    const effective = resolveMonoRoleEffort({ role }, model);
    expect(effective).toEqual({ effortSource: "role", modelSettings: { reasoningEffort: role === "member" ? "high" : "medium", fast: "false" } });
    expect(loadLastModelSettings()).toEqual({ reasoningEffort: "xhigh", fast: "true" });
  });

  it("keeps plain Mono behavior outside the role policy", () => {
    expect(monoRoleEffort(undefined)).toBeUndefined();
    expect(resolveMonoRoleEffort({}, model, { reasoningEffort: "xhigh" }).modelSettings.reasoningEffort).toBe("xhigh");
  });

  it.each(["effort", "reasoning", "reasoningEffort", "thinking", "variant"])("uses the advertised %s setting ID", id => {
    const actual = { ...model, settings: [{ ...model.settings![0], id }] };
    expect(resolveMonoRoleEffort({ role: "manager" }, actual).modelSettings).toEqual({ [id]: "medium" });
  });

  it.each(["orchestrator", "member"] as const)("keeps an unsupported %s default at the provider value", role => {
    const unsupported = { ...model, settings: [{ ...model.settings![0], value: "low", options: [{ value: "low", label: "Low" }] }] };
    expect(resolveMonoRoleEffort({ role, effortSource: "role" }, unsupported, { reasoningEffort: "xhigh" })).toEqual({
      effortSource: "role", modelSettings: { reasoningEffort: "low" },
    });
    expect(resolveMonoRoleEffort({ role }, { ...model, settings: undefined })).toEqual({ effortSource: "role", modelSettings: {} });
  });

  it.each([
    { role: "manager" as const, effortSource: "user" as const },
    { role: "manager" as const, userLockedFields: ["modelSettings" as const] },
    { role: "manager" as const },
  ])("preserves locked, explicit unlocked and legacy choices: %j", mono => {
    const effective = resolveMonoRoleEffort(mono, model, { reasoningEffort: "high", fast: "true" });
    expect(effective.modelSettings).toEqual({ reasoningEffort: "high", fast: "true" });
    expect(effective.effortSource).toBe(mono.effortSource);
  });

  it("resets only effort and the settings lock, preserving other values and locks", () => {
    const reset = resetMonoRoleEffort({ role: "manager", effortSource: "user", userLockedFields: ["model", "modelSettings", "soul"] }, model, { reasoningEffort: "xhigh", fast: "true" });
    expect(reset).toEqual({ effortSource: "role", modelSettings: { reasoningEffort: "medium", fast: "true" }, userLockedFields: ["model", "soul"] });
  });

  it("honors a settings lock even when the prior effort originally came from the role", () => {
    expect(resolveMonoRoleEffort({ role: "manager", effortSource: "role", userLockedFields: ["modelSettings"] }, model, { reasoningEffort: "high", fast: "true" }).modelSettings).toEqual({ reasoningEffort: "high", fast: "true" });
  });

  it("uses target setting IDs after a user-selected provider/model switch", () => {
    const target: AgentModel = { ...model, harness: "grok", id: "grok:test", settings: [{ ...model.settings![0], id: "effort" }, model.settings![1]] };
    setHarnessModels("grok", [target]);
    for (const effortSource of [undefined, "user", "role"] as const) {
      const effective = switchMonoRoleEffort({ role: "manager", effortSource }, model, target, { reasoningEffort: "xhigh", fast: "true" });
      expect(effective.modelSettings).toEqual({ effort: effortSource === "role" ? "medium" : "xhigh", fast: "true" });
    }
    expect(target.id).toBe("grok:test");
  });

  it("does not invent an effort alias or select another model when the target omits the requested value", () => {
    const target: AgentModel = { ...model, id: "codex:limited", settings: [{ ...model.settings![0], value: "low", options: [{ value: "low", label: "Low" }] }] };
    const result = switchMonoRoleEffort({ role: "manager", effortSource: "user" }, model, target, { reasoningEffort: "xhigh" });
    expect(result.modelSettings).toEqual({ reasoningEffort: "low" });
    expect(result.effortSource).toBe("user");
  });
});

it("freezes prepared worker settings across retries and later member/provider edits", () => {
  const member: Mono = { id: "worker", role: "member", effortSource: "role", projects: [], mascot: "cat", color: "#abc" };
  const task = { harness: model.harness, model: model.id };
  const first = snapshotMonoWorkerEffort(task, member);
  expect(first).toEqual({ effortSource: "role", modelSettings: { reasoningEffort: "high", fast: "false" } });
  saveLastModelSettings({ reasoningEffort: "xhigh" });
  setHarnessModels("codex", [{ ...model, settings: [] }]);
  const retried = snapshotMonoWorkerEffort({ ...task, ...first }, { ...member, effortSource: "user", workerProfile: { ...task, modelSettings: { reasoningEffort: "low" } } });
  expect(retried).toEqual(first);
  expect(retried.modelSettings).not.toBe(first.modelSettings);
});

it("retains a legacy worker's populated effort instead of migrating it", () => {
  const member: Mono = { id: "worker", role: "member", effortSource: "role", projects: [], mascot: "cat", color: "#abc" };
  expect(snapshotMonoWorkerEffort({ harness: model.harness, model: model.id, modelSettings: { reasoningEffort: "xhigh" } }, member)).toEqual({ effortSource: "user", modelSettings: { reasoningEffort: "xhigh", fast: "false" } });
});
