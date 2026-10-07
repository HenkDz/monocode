// @vitest-environment happy-dom
import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { addTeamMemory, assertTeamManager, assertTeamMember, forgetTeamMemory, handleMonoTeam, lockMonoField, setTeamSizeCap, teamMemoryFacts, undoMonoTeamChange, unlockMonoField, validateTeamSoul, type TeamHost } from "./monoTeam";
import { listMonos, updateMono, type Mono } from "./mono";

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
const host = (): TeamHost => ({ availableProfiles: [{ harness: "codex", models: ["installed", "second"] }], cancelMemberTasks: vi.fn(async () => {}), postChange: vi.fn(async () => {}) });
const hire = { name: "Database specialist", specialty: "Backend", soul: "Use the repository tests; report evidence.", harness: "codex", model: "installed", memory: ["Build with npm run build", "token=super-secret-value", "Build with npm run build"] };
beforeEach(() => {
  localStorage.clear();
  disk.clear();
  hooks.write = undefined;
  hooks.fail = false;
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  localStorage.setItem("monocode:mono-roster", JSON.stringify([node("manager", "manager"), node("reviewer", "member", "/app", "manager"), node("other", "manager", "/other"), node("other-member", "member", "/other", "other"), node("leader", "orchestrator")]));
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

it("rejects size caps, unavailable models, oversized souls and last-reviewer removal/rename", async () => {
  const bridge = host();
  setTeamSizeCap("manager", 1);
  await expect(handleMonoTeam("manager", "cap", "team.hire", hire, bridge)).rejects.toThrow("size cap");
  setTeamSizeCap("manager", 6);
  await expect(handleMonoTeam("manager", "bad-model", "team.hire", { ...hire, model: "missing" }, bridge)).rejects.toThrow("available model");
  expect(() => validateTeamSoul("猫".repeat(3000))).toThrow("8 KB");
  await expect(handleMonoTeam("manager", "retire", "team.retire", { memberId: "reviewer", reason: "done" }, bridge)).rejects.toThrow("last Reviewer");
  await expect(handleMonoTeam("manager", "rename", "team.update", { memberId: "reviewer", specialty: "Builder" }, bridge)).rejects.toThrow("last Reviewer");
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
  await expect(undoMonoTeamChange("manager", listMonos().find((mono) => mono.id === "manager")!.teamChanges![0].id, bridge)).rejects.toThrow("last Reviewer");
});

it("enforces the last Reviewer invariant through user roster edits while permitting whole-project archival", () => {
  expect(() => updateMono("reviewer", (mono) => ({ ...mono, specialty: "Builder" }))).toThrow("last Reviewer");
  expect(() => updateMono("reviewer", (mono) => ({ ...mono, archivedAt: Date.now() }))).toThrow("last Reviewer");
  expect(listMonos().find((mono) => mono.id === "reviewer")?.specialty).toBe("Reviewer");
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
