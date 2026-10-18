import { invoke } from "@tauri-apps/api/core";
import {
  isLocalProject,
  loadArchivedProjects,
  normalizeProjectPath,
  sameProjectPath,
} from "./recents";
import { setWorktreeFocus } from "../../source-control/model/worktreeFocus";
import type { Session } from "../../sessions/model/session";

export type ProjectAddition = {
  path: string;
  project: string;
  branch: string | null;
};

export async function resolveProjectAddition(
  path: string,
  projects: string[],
): Promise<ProjectAddition> {
  const normalized = normalizeProjectPath(path);
  const fallback = { path: normalized, project: normalized, branch: null };
  if (!isLocalProject(normalized)) return fallback;
  return invoke<ProjectAddition>("resolve_project_add", {
    path: normalized,
    projects,
    separateProjects: loadArchivedProjects().map((project) => project.path),
  });
}

export function applyProjectAddition(
  addition: ProjectAddition,
  separate = false,
): string {
  const project = separate ? addition.path : addition.project;
  if (!sameProjectPath(project, addition.path)) {
    setWorktreeFocus(project, { path: addition.path, branch: addition.branch });
  }
  return project;
}

export function sessionForProjectAddition(
  session: Session,
  addition: ProjectAddition,
): Session {
  return sameProjectPath(addition.path, addition.project)
    ? session
    : {
        ...session,
        cwd: addition.project,
        worktreeCwd: session.worktreeCwd ?? addition.path,
        branch: session.branch ?? addition.branch ?? undefined,
      };
}
