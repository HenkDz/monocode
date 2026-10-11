import type { RuntimeMode, RuntimeModeSource, Session } from "../../sessions/model/session";
import { legacyMonoRuntimeMode, type Mono } from "./mono";

type PermissionOwner = Pick<Mono, "role" | "runtimeMode" | "runtimeModeSource" | "userLockedFields"> & { id?: string };
export type MonoPermissionResolution = { runtimeMode: RuntimeMode; runtimeModeSource?: RuntimeModeSource };

export function monoRoleRuntimeMode(role: Mono["role"]): RuntimeMode {
  return role === "manager" || role === "orchestrator" ? "full-access" : "auto";
}

/** Old implicit permissions remain unchanged until the user resets them. */
export function resolveMonoRolePermissions(mono: PermissionOwner, runtimeMode?: RuntimeMode): MonoPermissionResolution {
  const legacy = mono.id ? legacyMonoRuntimeMode(mono.id) : undefined;
  if (legacy) return { runtimeMode: legacy, runtimeModeSource: mono.runtimeModeSource };
  const chosen = runtimeMode ?? mono.runtimeMode;
  const oldDefault = mono.role === "manager" || mono.role === "member" ? "full-access" : "auto";
  const fallback = mono.runtimeModeSource || !mono.id ? monoRoleRuntimeMode(mono.role) : oldDefault;
  const locked = mono.userLockedFields?.includes("runtimeMode");
  if (locked || mono.runtimeModeSource === "user" || (chosen && mono.runtimeModeSource !== "role"))
    return { runtimeMode: chosen ?? fallback, runtimeModeSource: locked ? "user" : mono.runtimeModeSource };
  return mono.runtimeModeSource === "role" || !mono.id
    ? { runtimeMode: monoRoleRuntimeMode(mono.role), runtimeModeSource: "role" }
    : { runtimeMode: chosen ?? fallback, runtimeModeSource: undefined };
}

export function resetMonoRolePermissions(mono: PermissionOwner) {
  return {
    runtimeMode: monoRoleRuntimeMode(mono.role),
    runtimeModeSource: "role" as const,
    userLockedFields: (mono.userLockedFields ?? []).filter(field => field !== "runtimeMode"),
  };
}

/** Saved workers and task snapshots outlive changes to their team profile. */
export function snapshotMonoWorkerPermissions(
  task: { sessionId?: string; readOnly?: boolean; runtimeMode?: RuntimeMode; runtimeModeSource?: RuntimeModeSource; windowsSandbox?: Session["windowsSandbox"] },
  member?: Mono,
  session?: Pick<Session, "id" | "runtimeMode" | "runtimeModeSource" | "windowsSandbox">,
) {
  const savedWorker = session && (!task.sessionId || task.sessionId === session.id) ? session : undefined;
  const memberChoice = member && (session?.runtimeModeSource === "role" ||
    (member.runtimeMode && (member.runtimeModeSource === "user" || member.userLockedFields?.includes("runtimeMode")))) ? resolveMonoRolePermissions(member) : undefined;
  const chosen = savedWorker ?? (task.runtimeMode ? task : memberChoice ?? session);
  const permissions = chosen?.runtimeMode
    ? { runtimeMode: chosen.runtimeMode, runtimeModeSource: chosen.runtimeModeSource }
    : member ? resolveMonoRolePermissions(member) : { runtimeMode: "auto" as const, runtimeModeSource: "role" as const };
  const windowsSandbox = savedWorker ? savedWorker.windowsSandbox
    : task.runtimeMode ? task.windowsSandbox : session?.windowsSandbox ?? task.windowsSandbox ?? member?.windowsSandbox;
  return {
    ...permissions,
    ...(task.readOnly ? { runtimeMode: "supervised" as const } : {}),
    ...(windowsSandbox ? { windowsSandbox } : {}),
  };
}
