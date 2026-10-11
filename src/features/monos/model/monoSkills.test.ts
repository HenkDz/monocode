import { afterEach, expect, it, vi } from "vitest";
import { listMonos, type Mono } from "./mono";
import { enabledMonoSkills, monoSkillsRole, parseMonoSkillsPolicy, resolveMonoSkillsPolicy, type MonoSkillsCatalog } from "./monoSkills";

const owner: Mono = { id: "manager", role: "manager", projects: ["/repo"], mascot: "cat", color: "#abc", teamSkillsPolicy: { mode: "custom", enabled: ["review"], plugins: [] } };
const member: Mono = { id: "member", role: "member", reportsTo: owner.id, projects: ["/repo"], mascot: "cat", color: "#abc" };
const catalog: MonoSkillsCatalog = { skills: ["review", "testing", "video"].map(id => ({ id, name: id, path: `/synthetic/${id}`, description: id, source: "account" })), roleDefaults: { grand_orchestrator: [], manager: ["testing"], worker: ["testing"], reviewer: ["review"] }, plugins: ["ponytail@test"] };
afterEach(() => vi.unstubAllGlobals());

it("resolves roles including explicit review tasks and legacy Reviewer specialties", () => {
  expect(monoSkillsRole({ role: "orchestrator" })).toBe("grand_orchestrator");
  expect(monoSkillsRole(owner)).toBe("manager");
  expect(monoSkillsRole(member)).toBe("worker");
  expect(monoSkillsRole({ ...member, specialty: " Reviewer " })).toBe("reviewer");
  expect(monoSkillsRole(member, true)).toBe("reviewer");
});

it("inherits a team selection until the Mono overrides it or explicitly chooses role defaults", () => {
  expect(resolveMonoSkillsPolicy(member, [owner, member])).toEqual(owner.teamSkillsPolicy);
  const custom = { ...member, skillsPolicy: { mode: "custom" as const, enabled: ["testing"] } };
  expect(resolveMonoSkillsPolicy(custom, [owner, custom])).toEqual(custom.skillsPolicy);
  expect(resolveMonoSkillsPolicy({ ...member, skillsPolicy: { mode: "role" } }, [owner, member])).toEqual({ mode: "role" });
  expect(resolveMonoSkillsPolicy(member, [member])).toEqual({ mode: "role" });
});

it("uses current role and account inventory, drops missing selections and keeps all opt-in", () => {
  expect(enabledMonoSkills(catalog, "reviewer", { mode: "role" })).toEqual(["review"]);
  expect(enabledMonoSkills(catalog, "worker", { mode: "custom", enabled: ["renamed", "review", "review"] })).toEqual(["review"]);
  expect(enabledMonoSkills({ ...catalog, skills: catalog.skills.slice(1) }, "worker", { mode: "custom", enabled: ["review"] })).toEqual([]);
  expect(enabledMonoSkills(catalog, "worker", { mode: "all" })).toEqual(["review", "testing", "video"]);
});

it("validates and persists independent Mono and team choices without enabling plugins by default", () => {
  expect(parseMonoSkillsPolicy({ mode: "custom", enabled: ["review", 2, "", "review"], plugins: [null] })).toEqual({ mode: "custom", enabled: ["review"], plugins: [] });
  expect(parseMonoSkillsPolicy({ mode: "unrecognized" })).toBeUndefined();
  const saved = JSON.stringify([{ ...owner, skillsPolicy: { mode: "all" } }, member]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "monocode:mono-roster" ? saved : null, setItem: () => {} });
  expect(listMonos()[0]).toMatchObject({ skillsPolicy: { mode: "all", enabled: [], plugins: [] }, teamSkillsPolicy: owner.teamSkillsPolicy });
});
