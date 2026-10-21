import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import type { Session } from "../../sessions/model/session";
import { leafIds, type WorkspaceTab } from "../../workspace/model/layout";
import { isManagerTab, workspaceTabCwd, workspaceTabWorktree } from "../../workspace/model/workspaceTabGroups";
import type { Worktree } from "./worktrees";

/** Checkout ownership is a projection; it never retargets a conversation. */
export function chatWorktreePath(project: string, path: string, trees?: readonly Worktree[], removed = false): string {
  if (!trees) return removed ? project : path;
  const live = trees.filter(tree => !tree.missing && !tree.prunable);
  const match = !removed && live.filter(tree => isEqualOrInside(path, tree.path))
    .sort((a, b) => pathKey(b.path).length - pathKey(a.path).length)[0];
  return match ? match.path : (live.find(tree => tree.isMain)?.path ?? project);
}

export function chatTabWorktree(tab: WorkspaceTab, sessions: readonly Session[], trees?: readonly Worktree[]): string | null {
  const project = workspaceTabCwd(tab, sessions);
  const work = workspaceTabWorktree(tab, sessions);
  if (!project || !work || isManagerTab(tab)) return work;
  const session = sessions.find(session => leafIds(tab.layout).includes(session.id));
  return chatWorktreePath(project, work, trees, session?.worktreeRemoved);
}

/** Close only older tab surfaces; live sessions and saved chat history stay intact. */
export function boundWorktreeTabs(tabs: WorkspaceTab[], sessions: readonly Session[], activeId: string, worktreeOf: (tab: WorkspaceTab) => string | null): WorkspaceTab[] {
  const counts = new Map<string, number>();
  const kept = new Set<string>();
  const active = tabs.find(tab => tab.id === activeId);
  for (const tab of [...(active ? [active] : []), ...tabs.slice().reverse().filter(tab => tab !== active)]) {
    if (isManagerTab(tab) || !leafIds(tab.layout).some(id => sessions.some(session => session.id === id))) { kept.add(tab.id); continue; }
    const key = `${pathKey(workspaceTabCwd(tab, sessions) ?? "")}\0${pathKey(worktreeOf(tab) ?? "")}`;
    const count = counts.get(key) ?? 0;
    if (count < 12) { kept.add(tab.id); counts.set(key, count + 1); }
  }
  return kept.size === tabs.length ? tabs : tabs.filter(tab => kept.has(tab.id));
}
