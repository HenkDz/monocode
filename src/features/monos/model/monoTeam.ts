import { HARNESSES, type HarnessId } from "../../sessions/model/session";
import { PROJECT_MASCOTS } from "../../projects/model/projectMascots";
import { listMonos, nextMonoLook, saveMonoTeamRoster, type Mono } from "./mono";
import { assertDirectReport, validateMonoOrg, isTeamReviewer } from "./monoOrg";
export { isTeamReviewer } from "./monoOrg";
import { readAgentFile, writeAgentFile, MonoFileConflict, MEMORY_MAX_BYTES, MEMORY_MAX_LINES, type AgentFilePath } from "./monoFiles";
import { addMemoryEntry, memoryDate, memoryEntry, memoryLines } from "./monoMemory";

export const TEAM_SOUL_MAX_BYTES = 8 * 1024;
export const TEAM_DEFAULT_CAP = 6;
export const TEAM_LOCKED_FIELDS = ["name", "specialty", "soul", "harness", "model", "modelSettings"] as const;
export type TeamLockedField = (typeof TEAM_LOCKED_FIELDS)[number];
export type TeamChange = {
  id: string;
  requestId: string;
  fingerprint: string;
  action: string;
  memberId: string;
  memberName: string;
  summary: string;
  at: number;
  state: "pending" | "applied" | "failed";
  error?: string;
  undoneAt?: number;
  before?: Mono;
  after: Mono;
  files?: { soul?: { before: string; after: string }; memory?: { before: string; after: string } };
};
export type TeamHost = {
  availableProfiles: readonly { harness: HarnessId; models: readonly string[] }[];
  cancelMemberTasks(memberId: string): Promise<void>;
  postChange(change: TeamChange): Promise<void> | void;
  currentTasks?(memberId: string): unknown[];
};

export function assertTeamManager(roster: readonly Mono[], managerId: string): Mono {
  validateMonoOrg(roster);
  const manager = roster.find((mono) => mono.id === managerId && mono.archivedAt == null);
  if (manager?.role !== "manager") throw Error("Only a Manager may manage its own team");
  return manager;
}

export function assertTeamMember(roster: readonly Mono[], managerId: string, memberId: unknown): Mono {
  assertTeamManager(roster, managerId);
  if (typeof memberId !== "string") throw Error("memberId must identify your own team member");
  const member = assertDirectReport(roster, managerId, memberId, "worker");
  if (member.archivedAt != null) throw Error("This team member is retired");
  return member;
}

export function assertTeamCapacity(roster: readonly Mono[], manager: Mono): void {
  if (roster.filter((mono) => mono.role === "member" && mono.reportsTo === manager.id && mono.archivedAt == null).length >= (manager.teamSizeCap ?? TEAM_DEFAULT_CAP))
    throw Error(`Team size cap (${manager.teamSizeCap ?? TEAM_DEFAULT_CAP}) reached`);
}

export function validateTeamSoul(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw Error("soul must be nonempty text");
  if (new TextEncoder().encode(value).length > TEAM_SOUL_MAX_BYTES) throw Error("soul must fit within 8 KB");
  return value;
}

export function validateTeamProfile(profile: Mono["workerProfile"], available: TeamHost["availableProfiles"]): NonNullable<Mono["workerProfile"]> {
  if (!profile || typeof profile.model !== "string" || !HARNESSES.includes(profile.harness) || !available.some((entry) => entry.harness === profile.harness && entry.models.includes(profile.model)))
    throw Error("Choose an installed harness and an available model from models.list");
  if (!profile.model.trim() || profile.model.length > 256) throw Error("model must be under 256 characters");
  if (profile.modelSettings && (Object.entries(profile.modelSettings).length > 16 || Object.entries(profile.modelSettings).some(([key, value]) => !key || key.length > 100 || typeof value !== "string" || value.length > 1000)))
    throw Error("modelSettings must contain at most 16 short string values");
  return profile;
}

export function assertTeamUpdateUnlocked(member: Mono, input: Record<string, unknown>): void {
  for (const field of TEAM_LOCKED_FIELDS)
    if (Object.prototype.hasOwnProperty.call(input, field) && member.userLockedFields?.includes(field))
      throw Error(`${field} is set by the user and locked; suggest the change in chat`);
}

function assertReviewerRetained(roster: readonly Mono[], before: Mono, after: Mono): void {
  if (isTeamReviewer(before) && (after.archivedAt != null || !isTeamReviewer(after)) && !roster.some((mono) => mono.id !== before.id && mono.role === "member" && mono.reportsTo === before.reportsTo && mono.archivedAt == null && isTeamReviewer(mono)))
    throw Error("The last Reviewer cannot be retired or lose its reviewer role");
}

export function assertTeamRetire(roster: readonly Mono[], managerId: string, memberId: string): Mono {
  const member = assertTeamMember(roster, managerId, memberId);
  assertReviewerRetained(roster, member, { ...member, archivedAt: Date.now() });
  return member;
}

function shortText(value: unknown, field: string, max = 80): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw Error(`${field} must be nonempty text under ${max} characters`);
  return value.trim();
}

function hashText(text: string): string {
  // Stable IDs identify complete memory lines, so stale list IDs cannot delete a replacement.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function teamMemoryFacts(text: string): { id: string; text: string; date?: string }[] {
  const raw = text.split("\n");
  return memoryLines(text).filter((line) => !line.struck).map((line) => ({ id: `${line.index}-${hashText(raw[line.index])}`, text: line.text, date: line.date }));
}

export function addTeamMemory(text: string, facts: unknown, date = memoryDate()): string {
  if (!Array.isArray(facts) || facts.length < 1 || facts.length > 50 || facts.some((fact) => typeof fact !== "string")) throw Error("facts must contain 1 to 50 strings");
  let next = text;
  for (const fact of facts) next = addMemoryEntry(next, memoryEntry(fact, date)).text;
  if (new TextEncoder().encode(next).length > MEMORY_MAX_BYTES || next.trimEnd().split("\n").length > MEMORY_MAX_LINES)
    throw Error("Member memory is full; forget outdated facts before adding more");
  return next;
}

export function forgetTeamMemory(text: string, factIds: unknown): string {
  if (!Array.isArray(factIds) || factIds.length < 1 || factIds.length > 50 || factIds.some((id) => typeof id !== "string")) throw Error("factIds must contain 1 to 50 IDs from team.list");
  const live = new Set(teamMemoryFacts(text).map((fact) => fact.id));
  if (factIds.some((id) => !live.has(id))) throw Error("Memory facts changed; read team.list again");
  const ids = new Set(factIds);
  return text.split("\n").filter((line, index) => !ids.has(`${index}-${hashText(line)}`)).join("\n");
}

function updateProfile(member: Mono, input: Record<string, unknown>, host: TeamHost): NonNullable<Mono["workerProfile"]> {
  const profile = {
    harness: (input.harness ?? member.workerProfile?.harness) as HarnessId,
    model: (input.model ?? member.workerProfile?.model) as string,
    modelSettings: input.modelSettings !== undefined ? input.modelSettings as Record<string, string> : member.workerProfile?.modelSettings,
  };
  if (input.modelSettings !== undefined && (!input.modelSettings || typeof input.modelSettings !== "object" || Array.isArray(input.modelSettings))) throw Error("modelSettings must be an object of strings");
  return validateTeamProfile(profile, host.availableProfiles);
}

function saveChange(managerId: string, change: TeamChange, member?: Mono): void {
  const roster = listMonos(true);
  assertTeamManager(roster, managerId);
  const next = roster.map((mono) => mono.id === managerId ? { ...mono, teamChanges: [...(mono.teamChanges ?? []).filter((entry) => entry.id !== change.id), change] } : member && mono.id === member.id ? member : mono);
  if (member && !next.some((mono) => mono.id === member.id)) next.push(member);
  saveMonoTeamRoster(next);
}

class TeamEditConflict extends Error {}

/** A concurrent user edit fails durably, releasing the queue without overwriting it. */
async function finishChange(managerId: string, change: TeamChange, host: TeamHost): Promise<TeamChange> {
  if (change.state === "failed") throw Error(change.error ?? "This team action failed; use a new requestId for a revised action");
  try {
    return await applyPendingChange(managerId, change, host);
  } catch (error) {
    if (error instanceof TeamEditConflict || error instanceof MonoFileConflict) {
      const message = `${error.message}. The action failed; use a new requestId for a revised action`;
      const failed: TeamChange = { ...change, state: "failed", error: message };
      saveChange(managerId, failed);
      await host.postChange(failed);
      throw Error(message);
    }
    throw error;
  }
}

/** Resume a durable receipt after interruption, accepting only its before/after file state. */
async function applyPendingChange(managerId: string, change: TeamChange, host: TeamHost): Promise<TeamChange> {
  if (change.state === "applied") {
    await host.postChange(change);
    return change;
  }
  const roster = listMonos(true);
  assertTeamManager(roster, managerId);
  if (change.before) reconcileMember(roster, managerId, change);
  if (change.action === "team.hire") assertTeamCapacity(roster, assertTeamManager(roster, managerId));
  if (change.action === "team.retire") await host.cancelMemberTasks(change.memberId);
  for (const key of ["soul", "memory"] as const) {
    const edit = change.files?.[key];
    if (!edit) continue;
    if (key === "soul" && listMonos(true).find((mono) => mono.id === change.memberId)?.userLockedFields?.includes("soul")) throw new TeamEditConflict("soul is set by the user and locked; suggest the change in chat");
    const path: AgentFilePath = key === "soul" ? "SOUL.md" : "MEMORY.md";
    const file = await readAgentFile(change.memberId, path);
    const text = file.text ?? "";
    if (text !== edit.after) {
      if (text !== edit.before) throw new TeamEditConflict("Member files changed during a team action; the user's edit is retained");
      await writeAgentFile(change.memberId, path, edit.after, file.hash);
    }
  }
  const applied: TeamChange = { ...change, state: "applied" };
  const currentRoster = listMonos(true);
  const member = change.before ? reconcileMember(currentRoster, managerId, change) : change.after;
  if (!change.before) assertTeamCapacity(currentRoster, assertTeamManager(currentRoster, managerId));
  saveChange(managerId, applied, member);
  await host.postChange(applied);
  return applied;
}

/** Apply only touched fields; concurrent session/user changes remain authoritative. */
function reconcileMember(roster: readonly Mono[], managerId: string, change: TeamChange): Mono {
  const current = assertTeamMember(roster, managerId, change.memberId);
  const before = change.before!;
  const after = { ...current };
  for (const key of ["name", "specialty", "workerProfile", "archivedAt"] as const) {
    if (JSON.stringify(before[key]) === JSON.stringify(change.after[key])) continue;
    const fields: TeamLockedField[] = key === "workerProfile" ? (["harness", "model", "modelSettings"] as const).filter((field) => JSON.stringify(before.workerProfile?.[field]) !== JSON.stringify(change.after.workerProfile?.[field])) : key === "archivedAt" ? [] : [key];
    if (fields.some((field) => current.userLockedFields?.includes(field))) throw new TeamEditConflict("The user locked a field while the team action was saving");
    if (JSON.stringify(current[key]) !== JSON.stringify(before[key]) && JSON.stringify(current[key]) !== JSON.stringify(change.after[key])) throw new TeamEditConflict("The member changed while the team action was saving");
    Object.assign(after, { [key]: change.after[key] });
  }
  assertReviewerRetained(roster, current, after);
  return after;
}

const queues = new Map<string, Promise<unknown>>();
function serialized<T>(managerId: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(managerId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  queues.set(managerId, next);
  void next.finally(() => { if (queues.get(managerId) === next) queues.delete(managerId); }).catch(() => {});
  return next;
}

export function handleMonoTeam(managerId: string, requestId: string, action: string, input: Record<string, unknown>, host: TeamHost): Promise<unknown> {
  return serialized(managerId, async () => {
    const roster = listMonos(true);
    const manager = assertTeamManager(roster, managerId);
    shortText(requestId, "requestId", 120);
    const fields: Record<string, readonly string[]> = {
      "team.list": [],
      "team.hire": ["name", "specialty", "soul", "harness", "model", "modelSettings", "mascot", "color", "memory", "reviewer"],
      "team.update": ["memberId", "name", "specialty", "soul", "harness", "model", "modelSettings"],
      "team.memory.add": ["memberId", "facts"],
      "team.memory.forget": ["memberId", "factIds"],
      "team.retire": ["memberId", "reason"],
    };
    if (!fields[action]) throw Error("Unknown team action");
    if (Object.keys(input).some((key) => !fields[action].includes(key))) throw Error("Unknown fields in team input");
    if (new TextEncoder().encode(JSON.stringify(input)).length > 64 * 1024) throw Error("Team input exceeds 64 KB");
    if (action === "team.list") {
      const members = await Promise.all(roster.filter((mono) => mono.role === "member" && mono.reportsTo === managerId && mono.archivedAt == null).map(async (mono) => {
        const [soul, memory] = await Promise.all([readAgentFile(mono.id, "SOUL.md"), readAgentFile(mono.id, "MEMORY.md")]);
        const facts = teamMemoryFacts(memory.text ?? "");
        return { id: mono.id, name: mono.name, specialty: mono.specialty, reviewer: isTeamReviewer(mono), origin: mono.origin, mascot: mono.mascot, color: mono.color, harness: mono.workerProfile?.harness, model: mono.workerProfile?.model, modelSettings: mono.workerProfile?.modelSettings, soulSummary: (soul.text ?? mono.instructions ?? "").replace(/\s+/g, " ").slice(0, 200), memoryCount: facts.length, facts, currentTasks: host.currentTasks?.(mono.id) ?? [], userLockedFields: mono.userLockedFields ?? [] };
      }));
      return { managerId, teamSizeCap: manager.teamSizeCap ?? TEAM_DEFAULT_CAP, members };
    }
    if (!["team.hire", "team.update", "team.memory.add", "team.memory.forget", "team.retire"].includes(action)) throw Error("Unknown team action");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ action, input })));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const existing = manager.teamChanges?.find((entry) => entry.requestId === requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error("requestId was already used for a different team action");
      const done = await finishChange(managerId, existing, host);
      return { member: done.after, changeId: done.id, repeated: true, undone: done.undoneAt != null };
    }
    if (manager.teamChanges?.some((entry) => entry.state === "pending")) throw Error("A previous team action was interrupted; retry its original requestId first");
    let before: Mono | undefined;
    let after: Mono;
    const files: NonNullable<TeamChange["files"]> = {};
    if (action === "team.hire") {
      assertTeamCapacity(roster, manager);
      const soul = validateTeamSoul(input.soul);
      if (typeof input.harness !== "string" || typeof input.model !== "string") throw Error("team.hire requires harness and model from models.list");
      const look = nextMonoLook(roster);
      const mascot = input.mascot ?? look.mascot;
      if (typeof mascot !== "string" || !PROJECT_MASCOTS.some((entry) => entry.name === mascot)) throw Error("Choose an existing mascot");
      const color = input.color ?? manager.color;
      if (typeof color !== "string" || color.length > 100 || !/^#[0-9a-fA-F]{3,8}$|^(?:hsl|rgb)a?\([\d\s.,%+-]+\)$/.test(color)) throw Error("Choose a project color");
      if (input.reviewer !== undefined && typeof input.reviewer !== "boolean") throw Error("reviewer must be a boolean");
      after = { id: crypto.randomUUID(), name: shortText(input.name, "name"), specialty: shortText(input.specialty, "specialty"), role: "member", reportsTo: managerId, projects: [...manager.projects], origin: "manager", reviewer: input.reviewer === true, mascot, color, workerProfile: updateProfile(manager, input, host) };
      files.soul = { before: "", after: soul };
      if (input.memory !== undefined && !(Array.isArray(input.memory) && input.memory.length === 0)) files.memory = { before: "", after: addTeamMemory("", input.memory) };
    } else {
      before = assertTeamMember(roster, managerId, input.memberId);
      after = { ...before };
      if (action === "team.update") {
        assertTeamUpdateUnlocked(before, input);
        if (input.name !== undefined) after.name = shortText(input.name, "name");
        if (input.specialty !== undefined) after.specialty = shortText(input.specialty, "specialty");
        if (["harness", "model", "modelSettings"].some((key) => Object.prototype.hasOwnProperty.call(input, key))) after.workerProfile = updateProfile(before, input, host);
        if (input.soul !== undefined) files.soul = { before: (await readAgentFile(before.id, "SOUL.md")).text ?? "", after: validateTeamSoul(input.soul) };
        assertReviewerRetained(roster, before, after);
      } else if (action.startsWith("team.memory.")) {
        const memory = (await readAgentFile(before.id, "MEMORY.md")).text ?? "";
        files.memory = { before: memory, after: action === "team.memory.add" ? addTeamMemory(memory, input.facts) : forgetTeamMemory(memory, input.factIds) };
      } else {
        shortText(input.reason, "reason", 500);
        assertTeamRetire(roster, managerId, before.id);
        after.archivedAt = Date.now();
      }
    }
    const change: TeamChange = { id: crypto.randomUUID(), requestId, fingerprint, action, memberId: after.id, memberName: after.name ?? after.specialty ?? after.id, summary: action === "team.hire" ? `Hired ${after.name} · ${after.specialty}` : action === "team.retire" ? `Retired ${after.name}: ${input.reason}` : `${action.replace("team.", "")} · ${after.name}`, at: Date.now(), state: "pending", before, after, ...(Object.keys(files).length ? { files } : {}) };
    saveChange(managerId, change);
    const applied = await finishChange(managerId, change, host);
    return { member: applied.after, changeId: applied.id };
  });
}

export function lockMonoField(id: string, field: TeamLockedField): void {
  if (!TEAM_LOCKED_FIELDS.includes(field)) throw Error("Unknown user-locked field");
  const roster = listMonos(true);
  saveMonoTeamRoster(roster.map((mono) => mono.id === id && mono.role === "member" ? { ...mono, userLockedFields: [...new Set([...(mono.userLockedFields ?? []), field])] } : mono));
}

export function unlockMonoField(id: string, field: TeamLockedField): void {
  saveMonoTeamRoster(listMonos(true).map((mono) => mono.id === id ? { ...mono, userLockedFields: mono.userLockedFields?.filter((entry) => entry !== field) } : mono));
}

export function setTeamSizeCap(managerId: string, size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > 24) throw Error("Team size cap must be from 1 to 24");
  const roster = listMonos(true);
  assertTeamManager(roster, managerId);
  if (roster.filter((mono) => mono.reportsTo === managerId && mono.archivedAt == null).length > size) throw Error("Retire members before reducing the team size cap");
  saveMonoTeamRoster(roster.map((mono) => mono.id === managerId ? { ...mono, teamSizeCap: size } : mono));
}

export function undoMonoTeamChange(managerId: string, changeId: string, host: TeamHost): Promise<void> {
  return serialized(managerId, async () => {
    const roster = listMonos(true);
    const manager = assertTeamManager(roster, managerId);
    const change = manager.teamChanges?.find((entry) => entry.id === changeId);
    if (!change || change.state !== "applied") throw Error("Choose an applied team change");
    if (change.undoneAt) return;
    const member = roster.find((mono) => mono.id === change.memberId && mono.role === "member" && mono.reportsTo === managerId);
    if (!member) throw Error("This team member is no longer available");
    let restored: Mono;
    if (!change.before) {
      assertTeamRetire(roster, managerId, member.id);
      await host.cancelMemberTasks(member.id);
      restored = { ...member, archivedAt: Date.now() };
    } else {
      restored = { ...member };
      for (const key of ["name", "specialty", "workerProfile", "archivedAt"] as const) {
        if (JSON.stringify(change.before[key]) === JSON.stringify(change.after[key])) continue;
        if (JSON.stringify(member[key]) !== JSON.stringify(change.after[key])) throw Error("This member changed since that action; Undo would overwrite a newer edit");
        if ((key === "name" || key === "specialty") && member.userLockedFields?.includes(key) || key === "workerProfile" && (["harness", "model", "modelSettings"] as const).some((field) => JSON.stringify(change.before?.workerProfile?.[field]) !== JSON.stringify(change.after.workerProfile?.[field]) && member.userLockedFields?.includes(field))) throw Error("Undo cannot overwrite a user-locked field");
        Object.assign(restored, { [key]: change.before[key] });
      }
      if (member.archivedAt != null && restored.archivedAt == null) assertTeamCapacity(roster, manager);
      assertReviewerRetained(roster, member, restored);
    }
    const pending: { path: AgentFilePath; text: string; hash: string }[] = [];
    for (const key of ["soul", "memory"] as const) {
      const edit = change.files?.[key];
      if (!edit || !change.before) continue; // Hired members retain their files/history when retired.
      if (key === "soul" && member.userLockedFields?.includes("soul")) throw Error("Undo cannot overwrite a user-locked soul");
      const path = key === "soul" ? "SOUL.md" : "MEMORY.md";
      const current = await readAgentFile(member.id, path);
      if ((current.text ?? "") !== edit.after && (current.text ?? "") !== edit.before) throw Error("Member files changed since that action; Undo would overwrite a newer edit");
      pending.push({ path, text: edit.before, hash: current.hash });
    }
    for (const edit of pending) await writeAgentFile(member.id, edit.path, edit.text, edit.hash);
    const latestRoster = listMonos(true);
    const latestMember = latestRoster.find((mono) => mono.id === member.id && mono.role === "member" && mono.reportsTo === managerId);
    if (!latestMember) throw Error("This team member is no longer available");
    if (change.files?.soul && latestMember.userLockedFields?.includes("soul")) throw Error("Undo cannot overwrite a user-locked soul");
    const latestRestored = { ...latestMember };
    for (const key of ["name", "specialty", "workerProfile", "archivedAt"] as const) {
      if (JSON.stringify(restored[key]) === JSON.stringify(member[key])) continue;
      if (JSON.stringify(latestMember[key]) !== JSON.stringify(member[key])) throw Error("This member changed during Undo; a newer edit is retained");
      if ((key === "name" || key === "specialty") && latestMember.userLockedFields?.includes(key) || key === "workerProfile" && (["harness", "model", "modelSettings"] as const).some((field) => JSON.stringify(restored.workerProfile?.[field]) !== JSON.stringify(member.workerProfile?.[field]) && latestMember.userLockedFields?.includes(field))) throw Error("Undo cannot overwrite a user-locked field");
      Object.assign(latestRestored, { [key]: restored[key] });
    }
    if (latestMember.archivedAt != null && latestRestored.archivedAt == null) assertTeamCapacity(latestRoster, assertTeamManager(latestRoster, managerId));
    assertReviewerRetained(latestRoster, latestMember, latestRestored);
    const undone = { ...change, undoneAt: Date.now() };
    saveChange(managerId, undone, latestRestored);
    await host.postChange(undone);
  });
}
