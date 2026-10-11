import type { Mono } from "./mono";

export type MonoSkillsRole = "grand_orchestrator" | "manager" | "worker" | "reviewer";
export type MonoSkillsPolicy = { mode: "role" | "custom" | "all"; enabled?: string[]; plugins?: string[] };
export type MonoSkillsContext = { skillsRole?: MonoSkillsRole; skillsPolicy?: MonoSkillsPolicy };
export type MonoSkill = { id: string; name: string; description: string; path: string; source: string; plugin?: string };
export type MonoSkillsCatalog = { skills: MonoSkill[]; roleDefaults: Record<MonoSkillsRole, string[]>; plugins: string[] };

/** Stored choices are identifiers from the catalog, never paths to mutate. */
export function parseMonoSkillsPolicy(value: unknown): MonoSkillsPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const policy = value as Record<string, unknown>;
  if (policy.mode !== "role" && policy.mode !== "custom" && policy.mode !== "all") return undefined;
  const identifiers = (items: unknown) => Array.isArray(items)
    ? [...new Set(items.filter((item): item is string => typeof item === "string" && !!item && item.length <= 4096))].slice(0, 1000)
    : [];
  return { mode: policy.mode, enabled: identifiers(policy.enabled), plugins: identifiers(policy.plugins) };
}

export function monoSkillsRole(mono?: Pick<Mono, "role" | "reviewer" | "specialty">, review = false): MonoSkillsRole {
  if (review || mono?.reviewer || mono?.specialty?.trim().toLowerCase() === "reviewer") return "reviewer";
  return mono?.role === "orchestrator" ? "grand_orchestrator" : mono?.role === "manager" ? "manager" : "worker";
}

export function resolveMonoSkillsPolicy(mono: Mono | undefined, roster: readonly Mono[]): MonoSkillsPolicy {
  return mono?.skillsPolicy ?? roster.find(owner => owner.id === mono?.reportsTo)?.teamSkillsPolicy ?? { mode: "role" };
}

export function enabledMonoSkills(catalog: MonoSkillsCatalog, role: MonoSkillsRole, policy: MonoSkillsPolicy): string[] {
  const desired = policy.mode === "all" ? catalog.skills.map(skill => skill.id)
    : policy.mode === "custom" ? policy.enabled ?? [] : catalog.roleDefaults[role] ?? [];
  const available = new Set(catalog.skills.map(skill => skill.id));
  return [...new Set(desired)].filter(id => available.has(id));
}
