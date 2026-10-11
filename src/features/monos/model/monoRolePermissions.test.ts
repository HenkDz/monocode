// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { addTeamMember, createMono, findMono, legacyMonoRuntimeMode, listMonos, monoDefaultRuntimeMode, saveMonoRuntimeMode, setOrchestrator, type Mono } from "./mono";
import { monoRoleRuntimeMode, resetMonoRolePermissions, resolveMonoRolePermissions, snapshotMonoWorkerPermissions } from "./monoRolePermissions";
import { newSession } from "../../sessions/model/session";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const member: Mono = { id: "worker", role: "member", runtimeModeSource: "role", reportsTo: "manager", specialty: "Builder", projects: ["/project"], mascot: "cat", color: "#abc" };
const manager: Mono = { id: "manager", role: "manager", runtimeModeSource: "role", projects: ["/project"], mascot: "cat", color: "#abc" };

it.each(["orchestrator", "manager", "member", undefined] as const)("defaults the %s role without changing a provider or model", role => {
  const mode = role === "manager" || role === "orchestrator" ? "full-access" : "auto";
  expect(monoRoleRuntimeMode(role)).toBe(mode);
  expect(resolveMonoRolePermissions({ role, runtimeModeSource: "role" })).toEqual({ runtimeMode: mode, runtimeModeSource: "role" });
  expect(resolveMonoRolePermissions({ role })).toEqual({ runtimeMode: mode, runtimeModeSource: "role" });
});

it.each(["supervised", "auto-accept-edits", "auto", "full-access"] as const)("retains the saved legacy %s choice", runtimeMode => {
  expect(resolveMonoRolePermissions({ role: "manager" }, runtimeMode)).toEqual({ runtimeMode, runtimeModeSource: undefined });
});

it.each(["orchestrator", "manager", "member"] as const)("does not migrate the old implicit %s profile", role => {
  expect(resolveMonoRolePermissions({ id: "legacy", role })).toEqual({ runtimeMode: role === "orchestrator" ? "auto" : "full-access", runtimeModeSource: undefined });
});

it("preserves explicit and locked choices over role defaults", () => {
  expect(resolveMonoRolePermissions({ ...member, runtimeMode: "full-access", runtimeModeSource: "user" })).toEqual({ runtimeMode: "full-access", runtimeModeSource: "user" });
  expect(resolveMonoRolePermissions({ ...member, runtimeMode: "supervised", userLockedFields: ["runtimeMode"] })).toEqual({ runtimeMode: "supervised", runtimeModeSource: "user" });
  expect(resolveMonoRolePermissions({ ...member, userLockedFields: ["runtimeMode"] })).toEqual({ runtimeMode: "auto", runtimeModeSource: "user" });
  expect(resolveMonoRolePermissions({ ...member, runtimeModeSource: "user" })).toEqual({ runtimeMode: "auto", runtimeModeSource: "user" });
});

it("displays a conflicting role marker as a user choice when its mode is locked without mutating it", () => {
  const locked: Mono = { ...member, runtimeMode: "full-access", userLockedFields: ["runtimeMode"] };
  expect(resolveMonoRolePermissions(locked)).toEqual({ runtimeMode: "full-access", runtimeModeSource: "user" });
  expect(locked.runtimeModeSource).toBe("role");
});

it("resets only permissions and their lock", () => {
  expect(resetMonoRolePermissions({ ...member, runtimeMode: "full-access", runtimeModeSource: "user", userLockedFields: ["runtimeMode", "model", "soul"] })).toEqual({ runtimeMode: "auto", runtimeModeSource: "role", userLockedFields: ["model", "soul"] });
});

it("keeps legacy migration separate from new sourced profiles and validates explicit engines", () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { ...manager, runtimeMode: "auto", runtimeModeSource: undefined },
    { ...member, runtimeMode: "supervised", runtimeModeSource: "user", windowsSandbox: "elevated", userLockedFields: ["runtimeMode", "invalid"] },
  ]));
  const roster = listMonos();
  expect(roster[0]).not.toHaveProperty("runtimeMode");
  expect(legacyMonoRuntimeMode(manager.id)).toBe("auto");
  expect(resolveMonoRolePermissions(roster[0])).toEqual({ runtimeMode: "auto", runtimeModeSource: undefined });
  expect(roster[1]).toMatchObject({ runtimeMode: "supervised", runtimeModeSource: "user", windowsSandbox: "elevated", userLockedFields: ["runtimeMode"] });
  expect(legacyMonoRuntimeMode(member.id)).toBeUndefined();
  localStorage.setItem("monocode:mono-roster", JSON.stringify([{ ...manager, windowsSandbox: "invalid", runtimeModeSource: "invalid" }]));
  expect(findMono(manager.id)?.windowsSandbox).toBeUndefined();
  expect(findMono(manager.id)?.runtimeModeSource).toBeUndefined();
});

it("persists an explicit user choice and reversibly resets its lock", () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager, { ...member, userLockedFields: ["soul"] }]));
  saveMonoRuntimeMode(member.id, "full-access");
  expect(findMono(member.id)).toMatchObject({ runtimeMode: "full-access", runtimeModeSource: "user", userLockedFields: ["soul", "runtimeMode"] });
  expect(monoDefaultRuntimeMode(findMono(member.id)!)).toBe("full-access");
  saveMonoRuntimeMode(member.id, "auto", "role");
  expect(findMono(member.id)).toMatchObject({ runtimeMode: "auto", runtimeModeSource: "role", userLockedFields: ["soul"] });
});

it("marks newly created Grand Orch, assigned Managers and hires as role-owned", () => {
  const orchestrator = createMono(["/project"]);
  setOrchestrator(orchestrator.id, true);
  const assigned = listMonos().find(mono => mono.role === "manager")!;
  expect(findMono(orchestrator.id)?.runtimeModeSource).toBe("role");
  expect(monoDefaultRuntimeMode(findMono(orchestrator.id)!)).toBe("full-access");
  expect(assigned.runtimeModeSource).toBe("role");
  expect(monoDefaultRuntimeMode(assigned)).toBe("full-access");
  const hired = addTeamMember(assigned.id, "Builder", "Backend");
  expect(hired.runtimeModeSource).toBe("role");
  expect(monoDefaultRuntimeMode(hired)).toBe("auto");
});

it("defaults anonymous and named role workers to Auto", () => {
  expect(snapshotMonoWorkerPermissions({})).toEqual({ runtimeMode: "auto", runtimeModeSource: "role" });
  expect(snapshotMonoWorkerPermissions({}, member)).toEqual({ runtimeMode: "auto", runtimeModeSource: "role" });
});

it("honors a member's explicit permissions for a fresh task while preserving saved workers", () => {
  const explicit = { ...member, runtimeMode: "supervised" as const, runtimeModeSource: "user" as const };
  const resident = { ...newSession("codex", "/project", undefined, "full-access"), id: "resident" };
  expect(snapshotMonoWorkerPermissions({ sessionId: "fresh" }, explicit, resident)).toEqual({ runtimeMode: "supervised", runtimeModeSource: "user" });
  expect(snapshotMonoWorkerPermissions({ sessionId: "resident" }, explicit, resident)).toEqual({ runtimeMode: "full-access", runtimeModeSource: undefined });
});

it("keeps task snapshots ahead of later member sessions and profile edits", () => {
  const snapshot = { sessionId: "task", runtimeMode: "auto" as const, runtimeModeSource: "role" as const, windowsSandbox: "unelevated" as const };
  const resident = { ...newSession("codex", "/project", undefined, "full-access"), id: "resident", runtimeModeSource: "user" as const, windowsSandbox: "elevated" as const };
  expect(snapshotMonoWorkerPermissions(snapshot, { ...member, runtimeMode: "full-access", runtimeModeSource: "user" }, resident)).toEqual({ runtimeMode: "auto", runtimeModeSource: "role", windowsSandbox: "unelevated" });
  expect(snapshotMonoWorkerPermissions({ ...snapshot, windowsSandbox: undefined }, { ...member, windowsSandbox: "elevated" }, resident)).toEqual({ runtimeMode: "auto", runtimeModeSource: "role" });
});

it("keeps existing worker and named legacy resident choices without upgrading them", () => {
  const saved = { ...newSession("codex", "/project", undefined, "supervised"), id: "task", windowsSandbox: "elevated" as const };
  expect(snapshotMonoWorkerPermissions({ sessionId: "task", runtimeMode: "auto", runtimeModeSource: "role" }, member, saved)).toEqual({ runtimeMode: "supervised", runtimeModeSource: undefined, windowsSandbox: "elevated" });
  expect(snapshotMonoWorkerPermissions({ sessionId: "new-task" }, member, { ...saved, id: "resident", runtimeMode: "full-access" })).toEqual({ runtimeMode: "full-access", runtimeModeSource: undefined, windowsSandbox: "elevated" });
});

it("read-only workers remain supervised with explicit engines retained", () => {
  const saved = { ...newSession("codex", "/project", undefined, "full-access"), id: "task", runtimeModeSource: "user" as const, windowsSandbox: "elevated" as const };
  expect(snapshotMonoWorkerPermissions({ sessionId: "task", readOnly: true }, member, saved)).toEqual({ runtimeMode: "supervised", runtimeModeSource: "user", windowsSandbox: "elevated" });
  expect(snapshotMonoWorkerPermissions({ readOnly: true }, { ...member, windowsSandbox: "unelevated" })).toEqual({ runtimeMode: "supervised", runtimeModeSource: "role", windowsSandbox: "unelevated" });
});
