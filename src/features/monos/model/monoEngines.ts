import { findMono, updateMono, type Mono } from "./mono";
import { projectKey } from "../../../shared/lib/paths";

/** An engine belongs to a Mono and a folder, never to its display name or selected tab. */
export async function monoEngineId(mono: Mono, project: string): Promise<string> {
  const dedicated = mono.managerProject && projectKey(mono.managerProject) === projectKey(project);
  const saved = findMono(mono.id)?.managerEngineId ?? mono.managerEngineId;
  if (dedicated && saved) return saved;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([mono.id, projectKey(project)])));
  const id = dedicated && mono.sessionId ? mono.sessionId : `mono-engine-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (dedicated) {
    updateMono(mono.id, current => ({ ...current, managerEngineId: current.managerEngineId ?? id }));
    return findMono(mono.id)?.managerEngineId ?? id;
  }
  return id;
}
