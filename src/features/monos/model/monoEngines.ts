import type { Mono } from "./mono";
import { projectKey } from "../../../shared/lib/paths";

/** An engine belongs to a Mono and a folder, never to its display name or selected tab. */
export async function monoEngineId(mono: Mono, project: string): Promise<string> {
  if (mono.managerProject && projectKey(mono.managerProject) === projectKey(project) && mono.sessionId) return mono.sessionId;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([mono.id, projectKey(project)])));
  return `mono-engine-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
