import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pathKey } from "../../../shared/lib/paths";
import { invalidateSkills } from "../../skills/model/skills";
import { invalidateProjectFiles } from "../../files/model/fileIndex";
import { isIntegrationUserEvent } from "./localToolBroker";
import type { ProjectSkillInspection } from "./localToolAdapters";

export type SkillOperationLog = (line: string) => Promise<void>;
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
const keyFor = (project: string, name: string) => `${pathKey(project)}\0${name}`;
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useProjectSkillBusy(project: string, name: string): boolean {
  return useSyncExternalStore(subscribe, () => inFlight.has(keyFor(project, name)));
}

/** Only the user's own button click crosses this boundary; ask answers never enter it. */
export async function executeInspectedProjectSkill(event: Event, buttonId: string, inspection: ProjectSkillInspection,
  operation: "install" | "archive", log?: SkillOperationLog): Promise<void> {
  if (!isIntegrationUserEvent(event, buttonId)) throw Error("Use the Install or Remove button yourself.");
  if (event instanceof MouseEvent && event.detail > 1) throw Error("Click Install or Remove once after inspecting.");
  const captured = structuredClone(inspection);
  const key = keyFor(captured.project, captured.name);
  if (inFlight.has(key)) throw Error("This skill already has an operation in progress.");
  inFlight.add(key); notify();
  try {
    await invoke(operation === "install" ? "install_project_skill" : "archive_project_skill", {
      project: captured.project, name: captured.name,
      ...(operation === "install" ? { source: captured.source } : {}),
      expectedProjectIdentity: captured.projectIdentity, expectedFingerprint: captured.fingerprint,
    });
    invalidateSkills({ cwd: captured.project });
    invalidateProjectFiles(captured.project);
    try { await log?.(`${operation === "install" ? "Installed" : "Removed"} ${captured.name} in ${captured.project} · by you · ${new Date().toLocaleString()}`); }
    catch { /* Logging must never turn a successful native operation into a failure. */ }
  } finally { inFlight.delete(key); notify(); }
}
