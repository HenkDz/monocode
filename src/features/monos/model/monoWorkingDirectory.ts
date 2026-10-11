import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "../../../platform/tauri/fs";
import { looksLikeProject, sameProjectPath } from "../../projects/model/recents";
import type { Session } from "../../sessions/model/session";
import type { Mono } from "./mono";
import { forgetAgentContext, loadMonoFiles } from "./monoFiles";
import { rememberMonoWorkingDirectoryMigration } from "./monoWorkingDirectoryMigration";

type Host = {
  home(): Promise<string>;
  workspace(id: string): Promise<string>;
};

export async function ensureMonoWorkingDirectory(id: string): Promise<string> {
  // Adopt legacy identity files before the workspace creates the Mono folder.
  await loadMonoFiles(id);
  return invoke<string>("mono_workspace_ensure", { id });
}

const directoryHost: Host = { home: homeDir, workspace: ensureMonoWorkingDirectory };

export function isMonoHomeDirectory(cwd: string, home: string): boolean {
  return !cwd.trim() || cwd === "~" || sameProjectPath(cwd, home);
}

/** Grand Orch has many projects; its neutral workspace belongs to none of them. */
export async function defaultMonoWorkingDirectory(mono: Mono, host: Host = directoryHost): Promise<string> {
  const home = await host.home();
  const project = mono.role !== "orchestrator" && [mono.managerProject, ...mono.projects]
    .find(path => path && looksLikeProject(path) && !isMonoHomeDirectory(path, home));
  return project || host.workspace(mono.id);
}

/** Keep the saved provider conversation and transcript when only its folder moves. */
export async function changeMonoWorkingDirectory(
  session: Session,
  cwd: string,
  save: (session: Session) => Promise<unknown>,
): Promise<Session> {
  if (sameProjectPath(session.cwd, cwd) && !session.worktreeCwd) return session;
  const next = { ...session, cwd };
  rememberMonoWorkingDirectoryMigration(session.id, session.providerSessionId);
  if (await save(next) === null && session.providerSessionId)
    throw new Error("The conversation's working folder could not be saved. Retry before sending a turn.");
  forgetAgentContext(session.id);
  return next;
}

/** Only legacy home-folder chats migrate; project and assigned worktree choices stay. */
export async function migrateMonoWorkingDirectory(
  mono: Mono,
  session: Session,
  save: (session: Session) => Promise<unknown>,
  host: Host = directoryHost,
): Promise<Session> {
  const home = await host.home();
  if (!isMonoHomeDirectory(session.cwd, home)) return session;
  const cwd = await defaultMonoWorkingDirectory(mono, { ...host, home: async () => home });
  return changeMonoWorkingDirectory(session, cwd, save);
}
