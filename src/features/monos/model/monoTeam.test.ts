// @vitest-environment happy-dom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addTeamMemory, assertTeamManager, assertTeamMember, defaultReviewerProfile, forgetTeamMemory, handleMonoTeam, lockMonoField, setTeamSizeCap, teamMemoryFacts, undoMonoTeamChange, undoMonoTeamChanges, unlockMonoField, validateTeamSoul, type TeamHost } from "./monoTeam";
import { addTeamMember, listMonos, updateMono, type Mono } from "./mono";
import { resetHarnessModelOverlays, resolveModel, setHarnessModels, type AgentModel } from "../../sessions/model/models";
import { resolveMonoRoleEffort, switchMonoRoleEffort } from "./monoRoleEffort";

const disk = vi.hoisted(() => new Map<string, string>());
const hooks = vi.hoisted(() => ({ write: undefined as undefined | (() => void), fail: false }));
vi.mock("./monoFiles", () => ({
  MonoFileConflict: class extends Error {},
  MEMORY_MAX_BYTES: 24 * 1024,
  MEMORY_MAX_LINES: 200,
  readAgentFile: vi.fn(async (id: string, path: string) => ({ text: disk.get(`${id}/${path}`) ?? null, hash: disk.get(`${id}/${path}`) ?? "" })),
  writeAgentFile: vi.fn(async (id: string, path: string, text: string, expectedHash: string) => {
    if (hooks.fail) { hooks.fail = false; throw Error("interrupted"); }
    hooks.write?.();
    if ((disk.get(`${id}/${path}`) ?? "") !== expectedHash) throw Error("conflict");
    disk.set(`${id}/${path}`, text);
    return text;
  }),
}));

const node = (id: string, role: Mono["role"], project = "/app", reportsTo?: string): Mono => ({ id, role, reportsTo, projects: [project], mascot: "cat", color: "#abcdef", specialty: role === "member" ? "Reviewer" : undefined, name: id, workerProfile: { harness: "codex", model: "installed" } });
const host = (): TeamHost => ({ availableProfiles: [{ harness: "codex", models: ["installed", "second", "codex:gpt-6.1-sol"] }], cancelMemberTasks: vi.fn(async () => {}), postChange: vi.fn(async () => {}) });
const hire = { name: "Database specialist", specialty: "Backend", soul: "Use the repository tests; report evidence.", harness: "codex", model: "installed", memory: ["Build with npm run build", "token=super-secret-value", "Build with npm run build"] };
const codexEffortModel: AgentModel = { harness: "codex", id: "codex:synthetic", name: "Synthetic Codex", settings: [{ id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high", options: ["low", "medium", "high", "xhigh"].map(value => ({ value, label: value })) }] };
const liveEffortModel: AgentModel = { harness: "grok", id: "grok:live", name: "Live Grok", settings: [{ id: "reasoning", label: "Reasoning", kind: "select", value: "low", options: ["low", "high", "xhigh"].map(value => ({ value, label: value })) }] };

it("defaults reviewers to Codex 6.1 Sol and honors user locks", () => {
  const builder = { harness: "codex" as const, model: "codex:gpt-6.1-sol", modelSettings: { effort: "high" } };
  const available: TeamHost["availableProfiles"] = [{ harness: "codex", models: [builder.model, "codex:deepseek-r1"] }, { harness: "claude", models: ["claude:claude-opus-4"] }];
  expect(defaultReviewerProfile(builder, [builder], available)).toEqual(builder);
  const explicit = { harness: "claude" as const, model: "claude:claude-opus-4" };
  expect(defaultReviewerProfile(explicit, [builder], available)).toEqual({ harness: "codex", model: "codex:gpt-6.1-sol" });
  for (const lock of ["harness", "model", "modelSettings"]) expect(defaultReviewerProfile(explicit, [builder], available, [lock])).toBe(explicit);
});

beforeEach(() => {
  localStorage.clear();
  resetHarnessModelOverlays();
  disk.clear();
  hooks.write = undefined;
  hooks.fail = false;
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  localStorage.setItem("monocode:mono-roster", JSON.stringify([node("manager", "manager"), node("reviewer", "member", "/app", "manager"), node("other", "manager", "/other"), node("other-member", "member", "/other", "other"), node("leader", "orchestrator")]));
});
afterEach(() => resetHarnessModelOverlays());

it("preserves a locked user xhigh through a Team provider switch and Undo", async () => {
  setHarnessModels("codex", [codexEffortModel]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "user", userLockedFields: ["modelSettings"], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const previous = listMonos().find(mono => mono.id === "reviewer")!;
  const target = resolveModel("grok", "grok:grok-4.6");
  expect(switchMonoRoleEffort(previous, codexEffortModel, target, previous.workerProfile!.modelSettings!).modelSettings.effort).toBe("xhigh");
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [target.id] }];
  const result = await handleMonoTeam("manager", "provider-switch", "team.update", { memberId: "reviewer", harness: "grok", model: target.id }, bridge) as { changeId: string };
  const changed = listMonos().find(mono => mono.id === "reviewer")!;
  expect(changed).toMatchObject({ effortSource: "user", userLockedFields: ["modelSettings"], workerProfile: { harness: "grok", model: target.id, modelSettings: { effort: "xhigh" } } });
  expect(changed.workerProfile!.modelSettings).not.toHaveProperty("reasoningEffort");
  expect(resolveMonoRoleEffort(changed, target, changed.workerProfile!.modelSettings).modelSettings.effort).toBe("xhigh");
  await undoMonoTeamChange("manager", result.changeId, bridge);
  expect(listMonos().find(mono => mono.id === "reviewer")).toEqual(previous);
});

it.each(["user", undefined, "role"] as const)("uses both live advertised effort IDs while retaining %s ownership", async effortSource => {
  setHarnessModels("codex", [codexEffortModel]);
  setHarnessModels("grok", [liveEffortModel]);
  updateMono("reviewer", mono => ({ ...mono, effortSource, userLockedFields: effortSource === "role" ? [] : ["modelSettings"], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [liveEffortModel.id] }];
  await handleMonoTeam("manager", "live-switch", "team.update", { memberId: "reviewer", harness: "grok", model: liveEffortModel.id }, bridge);
  const changed = listMonos().find(mono => mono.id === "reviewer")!;
  expect(changed.effortSource).toBe(effortSource);
  expect(changed.userLockedFields).toEqual(effortSource === "role" ? [] : ["modelSettings"]);
  expect(changed.workerProfile!.modelSettings).toEqual({ reasoning: effortSource === "role" ? "high" : "xhigh" });
});

it("translates effort on a model-only Team switch within the same harness", async () => {
  const target: AgentModel = { ...liveEffortModel, harness: "codex", id: "codex:live" };
  setHarnessModels("codex", [codexEffortModel, target]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "user", userLockedFields: ["modelSettings"], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id, target.id] }];
  await handleMonoTeam("manager", "model-only-switch", "team.update", { memberId: "reviewer", model: target.id }, bridge);
  expect(listMonos().find(mono => mono.id === "reviewer")).toMatchObject({ effortSource: "user", userLockedFields: ["modelSettings"], workerProfile: { harness: "codex", model: target.id, modelSettings: { reasoning: "xhigh" } } });
});

it("keeps explicit Team settings authoritative and rejects an explicit write to locked settings", async () => {
  setHarnessModels("codex", [codexEffortModel]);
  setHarnessModels("grok", [liveEffortModel]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "role", workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "high" } } }));
  lockMonoField("reviewer", "modelSettings");
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [liveEffortModel.id] }];
  const input = { memberId: "reviewer", harness: "grok", model: liveEffortModel.id, modelSettings: { reasoning: "low" } };
  await expect(handleMonoTeam("manager", "locked-explicit-switch", "team.update", input, bridge)).rejects.toThrow("modelSettings is set by the user and locked");
  unlockMonoField("reviewer", "modelSettings");
  await handleMonoTeam("manager", "explicit-switch", "team.update", input, bridge);
  const changed = listMonos().find(mono => mono.id === "reviewer")!;
  expect(changed.effortSource).toBeUndefined();
  expect(changed.workerProfile!.modelSettings).toEqual({ reasoning: "low" });
});

it.each(["new settings lock", "settings edit"])("retains a concurrent %s while a Team provider switch saves", async edit => {
  setHarnessModels("codex", [codexEffortModel]);
  setHarnessModels("grok", [liveEffortModel]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "user", userLockedFields: edit === "settings edit" ? ["modelSettings"] : [], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [liveEffortModel.id] }];
  hooks.write = () => edit === "new settings lock" ? lockMonoField("reviewer", "modelSettings") : updateMono("reviewer", mono => ({ ...mono, workerProfile: { ...mono.workerProfile!, modelSettings: { reasoningEffort: "low" } } }));
  await expect(handleMonoTeam("manager", "concurrent-switch", "team.update", { memberId: "reviewer", harness: "grok", model: liveEffortModel.id, soul: "New duties" }, bridge)).rejects.toThrow(edit === "new settings lock" ? "locked" : "member changed");
  expect(listMonos().find(mono => mono.id === "reviewer")).toMatchObject({ userLockedFields: ["modelSettings"], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: edit === "settings edit" ? "low" : "xhigh" } } });
});

it("rejects Undo when settings were newly locked after a Team provider switch", async () => {
  setHarnessModels("codex", [codexEffortModel]);
  setHarnessModels("grok", [liveEffortModel]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "user", workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [liveEffortModel.id] }];
  const result = await handleMonoTeam("manager", "switch-before-lock", "team.update", { memberId: "reviewer", harness: "grok", model: liveEffortModel.id }, bridge) as { changeId: string };
  lockMonoField("reviewer", "modelSettings");
  await expect(undoMonoTeamChange("manager", result.changeId, bridge)).rejects.toThrow("user-locked");
  expect(listMonos().find(mono => mono.id === "reviewer")).toMatchObject({ userLockedFields: ["modelSettings"], workerProfile: { harness: "grok", model: liveEffortModel.id, modelSettings: { reasoning: "xhigh" } } });
});

it.each(["new settings lock", "new model lock", "settings edit"])("retains a concurrent %s while a Team provider switch Undo saves", async edit => {
  setHarnessModels("codex", [codexEffortModel]);
  setHarnessModels("grok", [liveEffortModel]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "user", userLockedFields: edit === "new settings lock" ? [] : ["modelSettings"], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [liveEffortModel.id] }];
  const result = await handleMonoTeam("manager", "switch-before-undo", "team.update", { memberId: "reviewer", harness: "grok", model: liveEffortModel.id, soul: "New duties" }, bridge) as { changeId: string };
  hooks.write = () => edit === "settings edit" ? updateMono("reviewer", mono => ({ ...mono, workerProfile: { ...mono.workerProfile!, modelSettings: { reasoning: "low" } } })) : lockMonoField("reviewer", edit === "new model lock" ? "model" : "modelSettings");
  await expect(undoMonoTeamChange("manager", result.changeId, bridge)).rejects.toThrow(edit === "settings edit" ? "newer edit" : "user-locked");
  expect(listMonos().find(mono => mono.id === "reviewer")).toMatchObject({ userLockedFields: edit === "new model lock" ? ["modelSettings", "model"] : ["modelSettings"], workerProfile: { harness: "grok", model: liveEffortModel.id, modelSettings: { reasoning: edit === "settings edit" ? "low" : "xhigh" } } });
});

it("restores a locked choice when grouped Undo returns to the same model after an unsupported effort fallback", async () => {
  setHarnessModels("codex", [codexEffortModel]);
  setHarnessModels("grok", [{ ...liveEffortModel, settings: liveEffortModel.settings!.map(setting => ({ ...setting, value: "high", options: setting.options.filter(option => option.value !== "xhigh") })) }]);
  updateMono("reviewer", mono => ({ ...mono, effortSource: "user", userLockedFields: ["modelSettings"], workerProfile: { harness: "codex", model: codexEffortModel.id, modelSettings: { reasoningEffort: "xhigh" } } }));
  const previous = listMonos().find(mono => mono.id === "reviewer")!;
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: [codexEffortModel.id] }, { harness: "grok", models: [liveEffortModel.id] }];
  const first = await handleMonoTeam("manager", "away-switch", "team.update", { memberId: "reviewer", harness: "grok", model: liveEffortModel.id }, bridge) as { changeId: string };
  const second = await handleMonoTeam("manager", "back-switch", "team.update", { memberId: "reviewer", harness: "codex", model: codexEffortModel.id }, bridge) as { changeId: string };
  expect(listMonos().find(mono => mono.id === "reviewer")!.workerProfile!.modelSettings).toEqual({ reasoningEffort: "high" });
  await undoMonoTeamChanges("manager", [first.changeId, second.changeId], bridge);
  expect(listMonos().find(mono => mono.id === "reviewer")).toEqual(previous);
});

it("marks a new member's inherited coordinator profile as a role choice", () => {
  updateMono("manager", mono => ({ ...mono, effortSource: "user", workerProfile: { harness: "codex", model: "installed", modelSettings: { reasoningEffort: "medium", serviceTier: "fast" } } }));
  const member = addTeamMember("manager", "Builder", "Backend");
  expect(member.effortSource).toBe("role");
  expect(listMonos().find(mono => mono.id === member.id)?.effortSource).toBe("role");
  expect(member.workerProfile?.modelSettings?.serviceTier).toBe("fast");
  expect(listMonos().find(mono => mono.id === "manager")?.effortSource).toBe("user");
});

it("marks inferred hires as role effort while retaining an explicitly supplied effort", async () => {
  updateMono("manager", mono => ({ ...mono, workerProfile: { harness: "codex", model: "installed", modelSettings: { reasoningEffort: "medium" } } }));
  const inferred = await handleMonoTeam("manager", "inferred-effort", "team.hire", hire, host()) as { member: Mono };
  expect(inferred.member.effortSource).toBe("role");
  expect(listMonos().find(mono => mono.id === inferred.member.id)?.effortSource).toBe("role");
  const explicit = await handleMonoTeam("manager", "explicit-effort", "team.hire", { ...hire, modelSettings: { reasoningEffort: "low" } }, host()) as { member: Mono };
  expect(explicit.member.effortSource).toBeUndefined();
  expect(listMonos().find(mono => mono.id === explicit.member.id)?.workerProfile?.modelSettings).toEqual({ reasoningEffort: "low" });
});

it("allows coordinator model-settings locks without extending other member-only locks", () => {
  for (const id of ["manager", "leader"]) {
    lockMonoField(id, "modelSettings");
    lockMonoField(id, "model");
    lockMonoField(id, "name");
    expect(listMonos().find(mono => mono.id === id)?.userLockedFields).toEqual(["modelSettings"]);
    unlockMonoField(id, "modelSettings");
    expect(listMonos().find(mono => mono.id === id)?.userLockedFields).toEqual([]);
  }
});

it("retains an explicit team effort update and restores its role ownership on Undo", async () => {
  updateMono("reviewer", mono => ({ ...mono, effortSource: "role", workerProfile: { harness: "codex", model: "installed", modelSettings: { reasoningEffort: "high" } } }));
  const bridge = host();
  const result = await handleMonoTeam("manager", "update-effort", "team.update", { memberId: "reviewer", modelSettings: { reasoningEffort: "low" } }, bridge) as { changeId: string };
  const changed = listMonos().find(mono => mono.id === "reviewer")!;
  expect(changed.effortSource).not.toBe("role");
  expect(changed.workerProfile?.modelSettings).toEqual({ reasoningEffort: "low" });
  await undoMonoTeamChange("manager", result.changeId, bridge);
  expect(listMonos().find(mono => mono.id === "reviewer")).toMatchObject({ effortSource: "role", workerProfile: { modelSettings: { reasoningEffort: "high" } } });
});

it("enforces manager identity and own-project member scope", async () => {
  for (const id of ["leader", "reviewer", "missing"])
    expect(() => assertTeamManager(listMonos(true), id)).toThrow("Only a Manager");
  expect(() => assertTeamMember(listMonos(true), "manager", "other-member")).toThrow("direct report");
  await expect(handleMonoTeam("other", "request", "team.update", { memberId: "reviewer", name: "stolen" }, host())).rejects.toThrow("direct report");
});

it("hires a tailored Mono with durable idempotent receipt, seeded redacted memory and reversible history", async () => {
  const bridge = host();
  const result = await handleMonoTeam("manager", "hire-one", "team.hire", hire, bridge) as { member: Mono; changeId: string };
  const member = listMonos().find((mono) => mono.id === result.member.id)!;
  expect(member).toMatchObject({ role: "member", reportsTo: "manager", projects: ["/app"], origin: "manager" });
  expect(disk.get(`${member.id}/SOUL.md`)).toBe(hire.soul);
  const facts = teamMemoryFacts(disk.get(`${member.id}/MEMORY.md`)!);
  expect(facts).toHaveLength(2);
  expect(JSON.stringify(facts)).not.toContain("super-secret-value");
  const repeat = await handleMonoTeam("manager", "hire-one", "team.hire", hire, bridge) as { member: Mono; repeated: boolean };
  expect(repeat.member.id).toBe(member.id);
  expect(repeat.repeated).toBe(true);
  expect(listMonos().filter((mono) => mono.reportsTo === "manager")).toHaveLength(2);
  await expect(handleMonoTeam("manager", "hire-one", "team.hire", { ...hire, name: "different" }, bridge)).rejects.toThrow("different team action");
  await undoMonoTeamChange("manager", result.changeId, bridge);
  expect(listMonos().some((mono) => mono.id === member.id)).toBe(false);
  expect(listMonos(true).find((mono) => mono.id === member.id)?.archivedAt).toBeTypeOf("number");
  expect(disk.get(`${member.id}/SOUL.md`)).toBe(hire.soul);
  expect(bridge.cancelMemberTasks).toHaveBeenCalledWith(member.id);
});

it("uses Codex 6.1 Sol defaults for Reviewer hires and accepts an explicit matching model with a card warning", async () => {
  const bridge = host();
  bridge.availableProfiles = [{ harness: "codex", models: ["installed", "codex:gpt-6.1-sol"] }, { harness: "claude", models: ["claude:claude-opus-4"] }];
  await handleMonoTeam("manager", "builder", "team.hire", hire, bridge);
  const reviewerInput = { name: "Review expert", specialty: "Reviewer", soul: "Verify independently" };
  const result = await handleMonoTeam("manager", "independent", "team.hire", reviewerInput, bridge) as { member: Mono };
  expect(result.member.workerProfile).toMatchObject({ harness: "codex", model: "codex:gpt-6.1-sol" });
  await handleMonoTeam("manager", "matching", "team.hire", { ...reviewerInput, harness: "codex", model: "installed" }, bridge);
  expect(listMonos().find((mono) => mono.id === "manager")!.teamChanges!.at(-1)!.warning).toBe("Reviewer uses the same model as implementers");
  bridge.availableProfiles = [{ harness: "codex", models: ["installed", "codex:gpt-6.1-sol"] }];
  const fallback = await handleMonoTeam("manager", "fallback", "team.hire", reviewerInput, bridge) as { member: Mono };
  expect(fallback.member.workerProfile).toMatchObject({ harness: "codex", model: "codex:gpt-6.1-sol" });
  expect(listMonos().find((mono) => mono.id === "manager")!.teamChanges!.at(-1)!.warning).toBeUndefined();
});

it("undoes the whole hiring action into an empty team, permits a partial last-reviewer undo and cancels every hired member", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([node("manager", "manager")]));
  const bridge = host();
  const builder = await handleMonoTeam("manager", "builder", "team.hire", hire, bridge) as { member: Mono; changeId: string };
  const reviewer = await handleMonoTeam("manager", "reviewer", "team.hire", { ...hire, specialty: "Reviewer" }, bridge) as { member: Mono; changeId: string };
  await undoMonoTeamChange("manager", reviewer.changeId, bridge);
  await undoMonoTeamChanges("manager", [builder.changeId, reviewer.changeId], bridge);
  expect(listMonos().filter((mono) => mono.reportsTo === "manager")).toHaveLength(0);
  expect(bridge.cancelMemberTasks).toHaveBeenCalledWith(builder.member.id);
  expect(bridge.cancelMemberTasks).toHaveBeenCalledWith(reviewer.member.id);
  expect(listMonos(true).find((mono) => mono.id === "manager")!.teamChanges!.every((change) => change.undoneAt != null)).toBe(true);
});

it("validates every grouped Undo before reverting any member or file", async () => {
  const bridge = host();
  const first = await handleMonoTeam("manager", "one", "team.update", { memberId: "reviewer", name: "Renamed" }, bridge) as { changeId: string };
  const second = await handleMonoTeam("manager", "two", "team.memory.add", { memberId: "reviewer", facts: ["Important fact"] }, bridge) as { changeId: string };
  lockMonoField("reviewer", "name");
  const text = disk.get("reviewer/MEMORY.md");
  await expect(undoMonoTeamChanges("manager", [first.changeId, second.changeId], bridge)).rejects.toThrow("user-locked");
  expect(disk.get("reviewer/MEMORY.md")).toBe(text);
  expect(listMonos().find((mono) => mono.id === "reviewer")!.name).toBe("Renamed");
});

it("allows Undo of a Reviewer-only initial hire back to the original empty team", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([node("manager", "manager")]));
  const bridge = host();
  const reviewer = await handleMonoTeam("manager", "only-reviewer", "team.hire", { ...hire, specialty: "Reviewer" }, bridge) as { changeId: string };
  await undoMonoTeamChange("manager", reviewer.changeId, bridge);
  expect(listMonos().filter((mono) => mono.reportsTo === "manager")).toHaveLength(0);
});

it("rejects malformed profiles but permits last-reviewer removal and rename", async () => {
  const bridge = host();
  setTeamSizeCap("manager", 1);
  await expect(handleMonoTeam("manager", "cap", "team.hire", hire, bridge)).rejects.toThrow("size cap");
  setTeamSizeCap("manager", 6);
  await expect(handleMonoTeam("manager", "bad-model", "team.hire", { ...hire, model: "missing" }, bridge)).rejects.toThrow("available model");
  expect(() => validateTeamSoul("猫".repeat(3000))).toThrow("8 KB");
  await expect(handleMonoTeam("manager", "rename", "team.update", { memberId: "reviewer", specialty: "Builder" }, bridge)).resolves.toBeDefined();
  await expect(handleMonoTeam("manager", "retire", "team.retire", { memberId: "reviewer", reason: "done" }, bridge)).resolves.toBeDefined();
});

it("preserves user locks across storage reads and rejects manager changes and Undo", async () => {
  const bridge = host();
  const result = await handleMonoTeam("manager", "rename", "team.update", { memberId: "reviewer", name: "Review expert" }, bridge) as { changeId: string };
  lockMonoField("reviewer", "name");
  expect(listMonos().find((mono) => mono.id === "reviewer")?.userLockedFields).toEqual(["name"]);
  await expect(handleMonoTeam("manager", "rename-locked", "team.update", { memberId: "reviewer", name: "Other" }, bridge)).rejects.toThrow("locked");
  await expect(undoMonoTeamChange("manager", result.changeId, bridge)).rejects.toThrow("user-locked");
  unlockMonoField("reviewer", "name");
  await undoMonoTeamChange("manager", result.changeId, bridge);
  expect(listMonos().find((mono) => mono.id === "reviewer")?.name).toBe("reviewer");
});

it("adds and forgets memory by stable line IDs without deleting replacement facts", async () => {
  const bridge = host();
  const initial = "- A handwritten project fact\n";
  disk.set("reviewer/MEMORY.md", initial);
  const result = await handleMonoTeam("manager", "add", "team.memory.add", { memberId: "reviewer", facts: ["API uses strict validation"] }, bridge) as { changeId: string };
  const text = disk.get("reviewer/MEMORY.md")!;
  const id = teamMemoryFacts(text).at(-1)!.id;
  expect(forgetTeamMemory(text, [id])).toBe(initial);
  expect(() => forgetTeamMemory(text.replace("strict validation", "new validation"), [id])).toThrow("changed");
  await undoMonoTeamChange("manager", result.changeId, bridge);
  expect(disk.get("reviewer/MEMORY.md")).toBe(initial);
  expect(() => addTeamMemory("", ["x".repeat(1001)])).toThrow("1000");
  expect(() => addTeamMemory("# full\n".repeat(200), ["new"])).toThrow("full");
});

it("recovers an interrupted hire from the same durable request and does not duplicate members", async () => {
  const bridge = host();
  hooks.fail = true;
  await expect(handleMonoTeam("manager", "resume", "team.hire", hire, bridge)).rejects.toThrow("interrupted");
  expect(listMonos().find((mono) => mono.id === "manager")?.teamChanges?.[0].state).toBe("pending");
  await expect(handleMonoTeam("manager", "later", "team.hire", hire, bridge)).rejects.toThrow("interrupted");
  const result = await handleMonoTeam("manager", "resume", "team.hire", hire, bridge) as { member: Mono };
  expect(listMonos().filter((mono) => mono.id === result.member.id)).toHaveLength(1);
  expect(listMonos().find((mono) => mono.id === "manager")?.teamChanges?.[0].state).toBe("applied");
});

it("replays the same card receipt after a post failure without repeating the mutation", async () => {
  const bridge = host();
  bridge.postChange = vi.fn().mockRejectedValueOnce(Error("card interrupted")).mockResolvedValue(undefined);
  await expect(handleMonoTeam("manager", "card", "team.hire", hire, bridge)).rejects.toThrow("card interrupted");
  const change = listMonos().find((mono) => mono.id === "manager")!.teamChanges![0];
  await handleMonoTeam("manager", "card", "team.hire", hire, bridge);
  expect(bridge.postChange).toHaveBeenNthCalledWith(2, change);
  expect(listMonos().filter((mono) => mono.reportsTo === "manager")).toHaveLength(2);
});

it("does not overwrite user edits made while member files save", async () => {
  const bridge = host();
  hooks.write = () => { updateMono("reviewer", (mono) => ({ ...mono, name: "User name", userLockedFields: ["name"] })); };
  await expect(handleMonoTeam("manager", "concurrent", "team.update", { memberId: "reviewer", name: "Manager name", soul: "Updated reviewer duties" }, bridge)).rejects.toThrow("locked");
  expect(listMonos().find((mono) => mono.id === "reviewer")?.name).toBe("User name");
  expect(listMonos().find((mono) => mono.id === "manager")?.teamChanges?.[0].state).toBe("failed");
  await expect(handleMonoTeam("manager", "concurrent", "team.update", { memberId: "reviewer", name: "Manager name", soul: "Updated reviewer duties" }, bridge)).rejects.toThrow("action failed");
  hooks.write = undefined;
  await expect(handleMonoTeam("manager", "after-conflict", "team.memory.add", { memberId: "reviewer", facts: ["New project fact"] }, bridge)).resolves.toBeDefined();
});

it("retains starter origins and persists custom reviewer flags", async () => {
  expect(listMonos().find((mono) => mono.id === "reviewer")?.origin).toBe("starter");
  const bridge = host();
  const added = await handleMonoTeam("manager", "custom-reviewer", "team.hire", { ...hire, specialty: "Audit", reviewer: true }, bridge) as { member: Mono };
  expect(listMonos().find((mono) => mono.id === added.member.id)?.reviewer).toBe(true);
  await handleMonoTeam("manager", "retire-original", "team.retire", { memberId: "reviewer", reason: "Replacement hired" }, bridge);
  await undoMonoTeamChange("manager", listMonos().find((mono) => mono.id === "manager")!.teamChanges![0].id, bridge);
});

it("allows last Reviewer changes through user roster edits", () => {
  expect(() => updateMono("reviewer", (mono) => ({ ...mono, specialty: "Builder" }))).not.toThrow();
  expect(() => updateMono("reviewer", (mono) => ({ ...mono, archivedAt: Date.now() }))).not.toThrow();
  expect(listMonos().find((mono) => mono.id === "reviewer")?.specialty).toBeUndefined();
});

it("preserves concurrent user fields and attached sessions during a memory Undo", async () => {
  const bridge = host();
  const result = await handleMonoTeam("manager", "memory-change", "team.memory.add", { memberId: "reviewer", facts: ["Known project fact"] }, bridge) as { changeId: string };
  hooks.write = () => updateMono("reviewer", (mono) => ({ ...mono, name: "User changed name", sessionId: "new-session", userLockedFields: ["name"] }));
  await undoMonoTeamChange("manager", result.changeId, bridge);
  expect(listMonos().find((mono) => mono.id === "reviewer")).toMatchObject({ name: "User changed name", sessionId: "new-session", userLockedFields: ["name"] });
  expect(disk.get("reviewer/MEMORY.md")).toBe("");
});

it("rejects a soul Undo if the user locks it while Undo saves", async () => {
  const bridge = host();
  const result = await handleMonoTeam("manager", "soul-change", "team.update", { memberId: "reviewer", soul: "New review duties" }, bridge) as { changeId: string };
  hooks.write = () => lockMonoField("reviewer", "soul");
  await expect(undoMonoTeamChange("manager", result.changeId, bridge)).rejects.toThrow("user-locked soul");
  expect(listMonos().find((mono) => mono.id === "reviewer")?.userLockedFields).toContain("soul");
});
