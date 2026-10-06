import { projectKey, projectName } from "../../../shared/lib/paths";
import { validateMonoOrg, withDefaultTeam } from "./monoOrg";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupMascot,
  TAB_GROUP_COLORS,
} from "../../workspace/model/tabGroups";
import {
  hasPendingApproval,
  type Block,
  type Session,
} from "../../sessions/model/session";
import {
  PROJECT_MASCOTS,
  projectMascot,
} from "../../projects/model/projectMascots";
import { removeMonoBackground } from "./monoBackground";

/** The project palette's colors, plus indigo for a Mono's ninth preset. */
export const MONO_COLORS = [
  ...TAB_GROUP_COLORS.slice(1),
  "hsl(245 75% 65%)",
] as const;

/**
 * A Mono is a long-lived agent of its own: a name, a mascot and a color, one
 * conversation, and the projects it works on. It is not tied to any one of
 * them; it lives on the rail beside the projects and can be given more.
 */
export type Mono = {
  id: string;
  role?: "orchestrator" | "manager" | "member";
  reportsTo?: string;
  specialty?: string;
  teamInitialized?: boolean;
  workerProfile?: {
    harness: HarnessId;
    model: string;
    modelSettings?: Record<string, string>;
  };
  lastUsedAt?: number;
  /** Original Manager folder; its existing engine key is retained after migration. */
  managerProject?: string;
  /** Retained engine folders, including folders removed from active assignments. */
  workerProjects?: string[];
  /** Its conversation; absent until it is first opened. */
  sessionId?: string;
  /** Replaces the mascot's own name. */
  name?: string;
  mascot: string;
  color: string;
  /** Project folders it works on, in the order they were added. */
  projects: string[];
  /** Superseded by SOUL.md; only read once, to seed it. */
  instructions?: string;
  /**
   * From when each project had its own Mono: the project whose agent folder
   * it inherits. The folder moves under its id the first time it is read.
   */
  legacyProject?: string;
};

const ROSTER_KEY = "monocode:mono-roster";
const MONOS_CHANGED = "monocode:monos-changed";
export const HANDED_KEY = "monocode:mono-handed";

/** Storage from when each project had one Mono, keyed by project. */
const LEGACY_AGENTS_KEY = "monocode:monos";
const LEGACY_PROFILES_KEY = "monocode:mono-profiles";
/** And from before Monos had their name. */
const LEGACY_KEYS: [string, string][] = [
  ["monocode:project-agents", LEGACY_AGENTS_KEY],
  ["monocode:project-agent-profiles", LEGACY_PROFILES_KEY],
  ["monocode:project-agent-handed", HANDED_KEY],
];

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

let migrated = false;

/**
 * Turns each project's Mono into one of its own that works on that project,
 * keeping its conversation, name and look. One never claimed is dropped.
 */
export function migrateLegacyMonoStorage(): void {
  if (migrated) return;
  migrated = true;
  try {
    for (const [legacy, key] of LEGACY_KEYS) {
      const value = localStorage.getItem(legacy);
      if (value == null) continue;
      if (localStorage.getItem(key) == null) localStorage.setItem(key, value);
      localStorage.removeItem?.(legacy);
    }
    if (localStorage.getItem(ROSTER_KEY) != null) return;
    const agents = record(readJson(LEGACY_AGENTS_KEY));
    const profiles = record(readJson(LEGACY_PROFILES_KEY));
    const mascots = loadTabGroupMascots();
    const colors = loadTabGroupColors();
    const customColors = loadTabGroupCustomColors();
    const roster: Mono[] = [];
    for (const project of new Set([
      ...Object.keys(agents),
      ...Object.keys(profiles),
    ])) {
      const sessionId = agents[project];
      const profile = record(profiles[project]);
      if (typeof sessionId !== "string" && profile.claim !== "claimed")
        continue;
      const seed = projectName(project);
      roster.push({
        id: newMonoId(),
        ...(typeof sessionId === "string" ? { sessionId } : {}),
        ...(typeof profile.name === "string" && profile.name.trim()
          ? { name: profile.name }
          : {}),
        mascot: projectMascot(seed, resolveTabGroupMascot(project, mascots))
          .name,
        color: resolveTabGroupColor(project, colors, customColors, seed),
        projects: [project],
        ...(typeof profile.instructions === "string" &&
        profile.instructions.trim()
          ? { instructions: profile.instructions }
          : {}),
        legacyProject: project,
      });
    }
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
    localStorage.removeItem?.(LEGACY_AGENTS_KEY);
    localStorage.removeItem?.(LEGACY_PROFILES_KEY);
  } catch {
    // Storage unavailable: there is nothing to move either.
  }
}

function newMonoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseMono(value: unknown): Mono | undefined {
  const entry = record(value);
  if (typeof entry.id !== "string" || !/^[A-Za-z0-9-]+$/.test(entry.id))
    return undefined;
  const text = (key: string) =>
    typeof entry[key] === "string" ? (entry[key] as string) : undefined;
  const sessionId = text("sessionId");
  const name = text("name");
  const instructions = text("instructions");
  const legacyProject = text("legacyProject");
  const profile = record(entry.workerProfile);
  const settings = record(profile.modelSettings);
  const workerProfile =
    HARNESSES.includes(profile.harness as HarnessId) &&
    typeof profile.model === "string" &&
    profile.model.length > 0 &&
    profile.model.length <= 256
      ? {
          harness: profile.harness as HarnessId,
          model: profile.model,
          modelSettings: Object.fromEntries(
            Object.entries(settings).filter(
              ([key, value]) =>
                key.length <= 100 &&
                typeof value === "string" &&
                value.length <= 1000,
            ),
          ) as Record<string, string>,
        }
      : undefined;
  return {
    id: entry.id,
    ...(["orchestrator", "manager", "member"].includes(String(entry.role))
      ? { role: entry.role as Mono["role"] }
      : {}),
    ...(text("reportsTo") ? { reportsTo: text("reportsTo") } : {}),
    ...(text("specialty") ? { specialty: text("specialty") } : {}),
    ...(entry.teamInitialized === true ? { teamInitialized: true } : {}),
    ...(workerProfile ? { workerProfile } : {}),
    ...(typeof entry.lastUsedAt === "number" &&
    Number.isFinite(entry.lastUsedAt)
      ? { lastUsedAt: entry.lastUsedAt }
      : {}),
    ...(text("managerProject")
      ? { managerProject: text("managerProject") }
      : {}),
    ...(Array.isArray(entry.workerProjects)
      ? {
          workerProjects: entry.workerProjects.filter(
            (path): path is string => typeof path === "string",
          ),
        }
      : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(name ? { name } : {}),
    mascot: text("mascot") ?? PROJECT_MASCOTS[0].name,
    color: text("color") ?? TAB_GROUP_COLORS[1],
    projects: Array.isArray(entry.projects)
      ? entry.projects.filter(
          (path): path is string => typeof path === "string" && !!path,
        )
      : [],
    ...(instructions ? { instructions } : {}),
    ...(legacyProject ? { legacyProject } : {}),
  };
}

/** Every Mono, in the order the rail shows them. */
export function listMonos(): Mono[] {
  migrateLegacyMonoStorage();
  const parsed = readJson(ROSTER_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => parseMono(entry) ?? []);
}

function saveRoster(roster: readonly Mono[]): void {
  validateMonoOrg(roster);
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(MONOS_CHANGED));
}

export function findMono(id: string): Mono | undefined {
  return listMonos().find((mono) => mono.id === id);
}

/** The Mono whose conversation this is. */
export function monoForSession(sessionId: string): Mono | undefined {
  return listMonos().find((mono) => mono.sessionId === sessionId);
}

export function isMonoSession(sessionId: string): boolean {
  return !!monoForSession(sessionId);
}

/** Only the dedicated Manager owns a project's sidebar slot. */
export function dedicatedMono(
  project: string,
  roster = listMonos(),
): Mono | undefined {
  return roster
    .filter(
      (mono) =>
        mono.role === "manager" &&
        mono.projects.length === 1 &&
        projectKey(mono.projects[0]) === projectKey(project),
    )
    .sort(
      (a, b) =>
        (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.id.localeCompare(b.id),
    )[0];
}

export function railMonos(roster = listMonos()): Mono[] {
  return roster.filter((mono) => !mono.role || mono.role === "orchestrator");
}

/** Conversion keeps the conversation ID and all existing engine/worker references. */
export function adoptManagerMono(
  sessionId: string,
  project: string,
  at = Date.now(),
  profile?: Mono["workerProfile"],
): Mono {
  const existing = monoForSession(sessionId);
  if (existing?.role === "manager" && existing.teamInitialized) return existing;
  const occupied = dedicatedMono(project);
  if (occupied && occupied.sessionId !== sessionId)
    throw Error("Another Manager already owns this project's conversation");
  const key = projectKey(project);
  const seed = projectName(project);
  const mono: Mono = {
    ...existing,
    id: existing?.id ?? sessionId,
    sessionId,
    managerProject: project,
    projects: [project],
    lastUsedAt: at,
    role: "manager",
    reportsTo: listMonos().find((mono) => mono.role === "orchestrator")?.id,
    workerProfile: existing?.workerProfile ?? profile,
    name:
      existing?.name ??
      `${resolveTabGroupLabel(key, loadTabGroupLabels(), seed)} Manager`,
    mascot:
      existing?.mascot ??
      projectMascot(seed, resolveTabGroupMascot(key, loadTabGroupMascots()))
        .name,
    color:
      existing?.color ??
      resolveTabGroupColor(
        key,
        loadTabGroupColors(),
        loadTabGroupCustomColors(),
        seed,
      ),
  };
  // Migration must fail closed if storage is unavailable, not claim conversion succeeded.
  const roster = withDefaultTeam(
    [...listMonos().filter((entry) => entry.id !== mono.id), mono],
    mono.id,
  );
  validateMonoOrg(roster);
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  window.dispatchEvent(new CustomEvent(MONOS_CHANGED));
  return roster.find((entry) => entry.id === mono.id)!;
}

export function setOrchestrator(id: string, enabled: boolean): void {
  const roster = listMonos();
  const target = roster.find((mono) => mono.id === id);
  if (!target || target.role === "manager" || target.role === "member")
    throw Error("Choose a plain Mono as Orchestrator");
  if (!enabled && target.role !== "orchestrator") return;
  const next = roster.map((mono) =>
    mono.id === id
      ? {
          ...mono,
          role: enabled ? ("orchestrator" as const) : undefined,
          reportsTo: undefined,
        }
      : mono.role === "manager"
        ? { ...mono, reportsTo: enabled ? id : undefined }
        : mono,
  );
  validateMonoOrg(next);
  saveRoster(next);
}

export function addTeamMember(
  managerId: string,
  name: string,
  specialty: string,
): Mono {
  const manager = findMono(managerId);
  if (manager?.role !== "manager") throw Error("Only a Manager owns a team");
  if (
    !name.trim() ||
    name.length > 80 ||
    !specialty.trim() ||
    specialty.length > 80
  )
    throw Error("Use a name and specialty under 80 characters");
  const member: Mono = {
    id: newMonoId(),
    role: "member",
    reportsTo: managerId,
    name: name.trim(),
    specialty: specialty.trim(),
    projects: [...manager.projects],
    ...nextMonoLook(),
    color: manager.color,
    workerProfile: manager.workerProfile,
    instructions: `You are the ${specialty.trim()} specialist. Work only on assignments from your Manager, verify the result, and report facts, tests and blockers to your Manager. Never message teammates directly.`,
  };
  saveRoster([...listMonos(), member]);
  return member;
}

/**
 * The mascot and color the next Mono gets: ones the others are not using yet,
 * where any are left.
 */
export function nextMonoLook(
  roster: readonly Pick<Mono, "mascot" | "color">[] = listMonos(),
): { mascot: string; color: string } {
  const mascots = new Set(roster.map((mono) => mono.mascot));
  const colors = new Set(roster.map((mono) => mono.color));
  const palette = MONO_COLORS;
  return {
    mascot: (
      PROJECT_MASCOTS.find((mascot) => !mascots.has(mascot.name)) ??
      PROJECT_MASCOTS[roster.length % PROJECT_MASCOTS.length]
    ).name,
    color:
      palette.find((color) => !colors.has(color)) ??
      palette[roster.length % palette.length],
  };
}

/** A new Mono with the next look, starting with the projects given, if any. */
export function createMono(projects: readonly string[] = []): Mono {
  const roster = listMonos();
  const mono: Mono = {
    id: newMonoId(),
    ...nextMonoLook(roster),
    projects: uniqueProjects(projects),
  };
  saveRoster([...roster, mono]);
  return mono;
}

const INTRO_DISMISSED_KEY = "monocode:mono-intro-dismissed";

/** Whether the user passed on the intro that meets them before any Mono. */
export function monoIntroDismissed(): boolean {
  try {
    return localStorage.getItem(INTRO_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissMonoIntro(): void {
  try {
    localStorage.setItem(INTRO_DISMISSED_KEY, "1");
  } catch {
    // It shows again next launch; harmless.
  }
  window.dispatchEvent(new CustomEvent(MONOS_CHANGED));
}

function uniqueProjects(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = projectKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function updateMono(
  id: string,
  change: (mono: Mono) => Mono,
): Mono | undefined {
  const roster = listMonos();
  const index = roster.findIndex((mono) => mono.id === id);
  if (index < 0) return undefined;
  const next = change(roster[index]);
  if (!next.name?.trim()) delete next.name;
  if (!next.instructions?.trim()) delete next.instructions;
  next.projects = uniqueProjects(next.projects);
  roster[index] = next;
  saveRoster(roster);
  return next;
}

/** Forgets the Mono and its background. Its folder of files stays on disk. */
export function removeMono(id: string): void {
  const next = listMonos().filter((mono) => mono.id !== id);
  validateMonoOrg(next);
  removeMonoBackground(id);
  saveRoster(next);
}

export function reorderMonos(ids: readonly string[]): void {
  const roster = listMonos();
  const order = new Map(ids.map((id, index) => [id, index]));
  saveRoster(
    [...roster].sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

export function saveMonoSessionId(monoId: string, sessionId: string): void {
  updateMono(monoId, (mono) => ({ ...mono, sessionId }));
}

export function saveMonoName(monoId: string, name: string): void {
  updateMono(monoId, (mono) => ({ ...mono, name }));
}

export function saveMonoMascot(monoId: string, mascot: string): void {
  updateMono(monoId, (mono) => ({ ...mono, mascot }));
}

export function addMonoProject(monoId: string, path: string): void {
  updateMono(monoId, (mono) => ({
    ...mono,
    projects: [...mono.projects, path],
  }));
}

export function removeMonoProject(monoId: string, path: string): void {
  const key = projectKey(path);
  updateMono(monoId, (mono) => ({
    ...mono,
    projects: mono.projects.filter((project) => projectKey(project) !== key),
  }));
}

/** Whether the Mono has been given this project. */
export function monoWorksOn(mono: Pick<Mono, "projects">, path: string) {
  const key = projectKey(path);
  return mono.projects.some((project) => projectKey(project) === key);
}

export function subscribeMonos(onChange: () => void): () => void {
  window.addEventListener(MONOS_CHANGED, onChange);
  return () => window.removeEventListener(MONOS_CHANGED, onChange);
}

/**
 * Snapshot for `useSyncExternalStore`; stable while storage is unchanged.
 * Project labels are part of it, since a Mono's look names its projects.
 */
export function monosSnapshot(): string {
  migrateLegacyMonoStorage();
  try {
    return `${localStorage.getItem(ROSTER_KEY) ?? ""}|${JSON.stringify(
      loadTabGroupLabels(),
    )}|${monoIntroDismissed()}`;
  } catch {
    return "";
  }
}

/** Mascots whose Mono name is shorter than the mascot's. */
const MONO_NAME: Record<string, string> = { mushroom: "Shroom" };

/** The name a Mono goes by until the user names it: "MonoCrab", "MonoShroom". */
export function defaultMonoName(mascot: string): string {
  return `Mono${MONO_NAME[mascot] ?? mascot.charAt(0).toUpperCase() + mascot.slice(1)}`;
}

/** One project a Mono works on, as the rail labels it. */
export type MonoProject = { path: string; name: string };

export type MonoLook = {
  /** The user's name for it, or its default: "MonoInvader", "MonoGhost". */
  name: string;
  mascot: string;
  color: string;
  projects: MonoProject[];
};

/** How a Mono looks, and the projects it works on by their rail labels. */
export function monoLook(mono: Mono): MonoLook {
  const labels = loadTabGroupLabels();
  return {
    name: mono.name?.trim() || defaultMonoName(mono.mascot),
    mascot: mono.mascot,
    color: mono.color,
    projects: mono.projects.map((path) => ({
      path,
      name: resolveTabGroupLabel(projectKey(path), labels, projectName(path)),
    })),
  };
}

/** Its projects as a phrase: "app", "app and site", "app, site and api". */
export function monoProjectsPhrase(projects: readonly MonoProject[]): string {
  const names = projects.map((project) => project.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plain one-line take on a step's title, for the Mono's status. */
function plainLine(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>)\s*/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/^\s*[-\d.]+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the agent is doing right now, as the Monos roster shows it. */
export type MonoStatus = "working" | "needs-you" | "idle";

export type MonoState = {
  status: MonoStatus;
  /** Short present-tense note while working or waiting. */
  activity?: string;
};

export const MONO_STATUS_LABEL: Record<MonoStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
};

/** The agent's state, with the step it is on or the call it is waiting for. */
export function monoState(
  session: Pick<
    Session,
    "blocks" | "busy" | "pendingQuestion" | "worktreeRemoved" | "usageLimit"
  >,
): MonoState {
  const { blocks, pendingQuestion: question } = session;
  if (!session.worktreeRemoved && question) {
    return {
      status: "needs-you",
      activity: question.title?.trim() || question.questions[0]?.prompt.trim(),
    };
  }
  if (!session.worktreeRemoved && hasPendingApproval(blocks)) {
    const approval = latest(
      blocks,
      (block) => !!block.approval && !block.approval.decided,
    );
    return {
      status: "needs-you",
      activity: approval?.tool?.title
        ? `Approve ${plainLine(approval.tool.title)}`
        : "Waiting for approval",
    };
  }
  if (!session.worktreeRemoved && session.usageLimit) {
    return { status: "needs-you", activity: "Usage limit reached" };
  }
  if (!session.busy) return { status: "idle" };
  const last = blocks[blocks.length - 1];
  if (last?.role === "assistant" && !last.tool && last.streaming) {
    return { status: "working", activity: "Writing a reply" };
  }
  // Only a step from the current turn says what it is doing now.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user") break;
    if (block.tool?.title) {
      return { status: "working", activity: plainLine(block.tool.title) };
    }
  }
  return { status: "working", activity: "Thinking" };
}

function latest(
  blocks: readonly Block[],
  match: (block: Block) => boolean,
): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (match(blocks[i])) return blocks[i];
  }
  return undefined;
}
