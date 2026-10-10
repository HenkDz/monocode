import { newSession, hasPendingApproval, type Session } from "../../sessions/model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { habitRunMono } from "./monoHabits";
import {
  closeLeaf,
  leafIds,
  newTab,
  type WorkspaceTab,
} from "../../workspace/model/layout";
import { workspaceTabCwd } from "../../workspace/model/workspaceTabGroups";
import { sameProjectPath } from "../../projects/model/recents";
import {
  findMono,
  isMonoSession,
  monoForSession,
  monoRuntimeMode,
  monoDefaultRuntimeMode,
  legacyMonoRuntimeMode,
  finishMonoPermissionsMigration,
  saveMonoSessionId,
} from "./mono";
import { forgetAgentContext } from "./monoFiles";
import { forgetMonoRotation } from "./monoRotation";

const openingMonos = new Map<string, Promise<Session | undefined>>();

/** A member's choice also applies to its active work, never another member's. */
export function monoPermissionSessionIds(monoId: string | undefined, sessionId: string, sessions: readonly Session[], runs: readonly Pick<OrchestrationRun, "tasks">[]): string[] {
  const owned = new Set([sessionId]);
  if (monoId) {
    for (const run of runs)
      for (const task of run.tasks)
        if (task.memberId === monoId && !task.readOnly) owned.add(task.sessionId);
    for (const session of sessions)
      if (habitRunMono(session.id) === monoId) owned.add(session.id);
  }
  return sessions.filter(session => owned.has(session.id) && !session.readOnly && (session.id === sessionId || session.busy || hasPendingApproval(session.blocks))).map(session => session.id);
}

/**
 * Load the Mono's conversation without opening or replacing a workspace tab.
 * A new one starts with Auto permissions in the home folder: no single
 * project is its own.
 */
export function ensureMonoSession(
  monoId: string,
  host: {
    home(): Promise<string>;
    load(id: string): Promise<Session | null | undefined>;
    create(cwd: string): Session;
    add(session: Session): void;
    /** Save legacy permissions before forgetting their migration input. */
    save?(session: Session): Promise<unknown>;
  },
): Promise<Session | undefined> {
  const pending = openingMonos.get(monoId);
  if (pending) return pending;
  const opening = loadMonoSession(monoId, host).finally(() => {
    if (openingMonos.get(monoId) === opening) openingMonos.delete(monoId);
  });
  openingMonos.set(monoId, opening);
  return opening;
}

async function loadMonoSession(
  monoId: string,
  host: Parameters<typeof ensureMonoSession>[1],
): Promise<Session | undefined> {
  const mono = findMono(monoId);
  if (!mono) return undefined;
  if (mono.sessionId) {
    const existing = await host.load(mono.sessionId);
    if (existing) {
      const current = findMono(monoId);
      if (!current) return undefined;
      const runtimeMode = monoRuntimeMode(current, existing.runtimeMode);
      const session = runtimeMode === existing.runtimeMode ? existing : { ...existing, runtimeMode };
      await migratePermissions(current.id, session, host);
      return session;
    }
  }
  const home = await host.home();
  // Removed while the home folder was looked up.
  const current = findMono(monoId);
  if (!current) return undefined;
  const defaults = host.create(home);
  const profile = current.workerProfile;
  // All first-open paths, including a goal arriving before the chat is opened,
  // must use the Mono's profile. Existing chats above keep the user's choice.
  const runtimeMode = monoDefaultRuntimeMode(current);
  const session = profile ? { ...newSession(profile.harness, home, profile.model, runtimeMode, profile.modelSettings), id: defaults.id } : { ...defaults, runtimeMode };
  await migratePermissions(current.id, session, host);
  saveMonoSessionId(monoId, session.id);
  host.add(session);
  return session;
}

async function migratePermissions(monoId: string, session: Session, host: Parameters<typeof ensureMonoSession>[1]): Promise<void> {
  if (!host.save || !legacyMonoRuntimeMode(monoId)) return;
  if (await host.save(session) === null) return;
  finishMonoPermissionsMigration(monoId);
}

/** Reset only the Mono's chat, keeping its identity, habits and memory. */
export async function resetMonoSession(
  current: Session,
  host: {
    stop(id: string): Promise<Session | undefined>;
    remove(session: Session): Promise<void>;
    replace(session: Session): void;
  },
): Promise<Session> {
  const monoId = monoForSession(current.id)?.id;
  const stopped = (await host.stop(current.id)) ?? current;
  const fresh = newSession(
    stopped.harness,
    stopped.cwd,
    stopped.model,
    stopped.runtimeMode,
    stopped.modelSettings,
  );
  // A failed deletion must leave the original conversation selected.
  await host.remove(stopped);
  forgetAgentContext(current.id);
  forgetMonoRotation(current.id);
  if (monoId) saveMonoSessionId(monoId, fresh.id);
  host.replace(fresh);
  return fresh;
}

/** Migrate the earlier agent tabs into a separate view, keeping ordinary panes. */
export function detachMonoTabs(
  tabs: WorkspaceTab[],
  sessions: Session[],
  activeTabId: string,
  fallbackCwd: string,
  createSession: (cwd: string) => Session,
) {
  let changed = false;
  const removedProjects = new Set<string>();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const agentViewId =
    activeTab && isMonoSession(activeTab.focusedId)
      ? activeTab.focusedId
      : undefined;
  const regularTabs: WorkspaceTab[] = [];
  for (const tab of tabs) {
    const agentIds = leafIds(tab.layout).filter(isMonoSession);
    if (agentIds.length === 0) {
      regularTabs.push(tab);
      continue;
    }
    changed = true;
    const cwd = workspaceTabCwd(tab, sessions) ?? fallbackCwd;
    let remaining: WorkspaceTab | null = tab;
    for (const id of agentIds) {
      if (remaining) remaining = closeLeaf(remaining, id);
    }
    if (remaining) regularTabs.push(remaining);
    else removedProjects.add(cwd);
  }
  if (!changed) return undefined;

  const addedSessions: Session[] = [];
  for (const cwd of removedProjects) {
    if (
      regularTabs.some((tab) => {
        const project = workspaceTabCwd(tab, sessions);
        return project && sameProjectPath(project, cwd);
      })
    )
      continue;
    const session = createSession(cwd);
    addedSessions.push(session);
    regularTabs.push(newTab(session.id));
  }
  const activeCwd = activeTab
    ? (workspaceTabCwd(activeTab, sessions) ?? fallbackCwd)
    : fallbackCwd;
  const allSessions = [...sessions, ...addedSessions];
  const nextActive =
    regularTabs.find((tab) => tab.id === activeTabId) ??
    regularTabs.find((tab) => {
      const cwd = workspaceTabCwd(tab, allSessions);
      return cwd && sameProjectPath(cwd, activeCwd);
    }) ??
    regularTabs[0];
  return {
    tabs: regularTabs,
    addedSessions,
    activeTabId: nextActive.id,
    agentViewId,
  };
}
