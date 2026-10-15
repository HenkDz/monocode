import { hasPendingApproval, type Session, type TurnIntent } from "../../sessions/model/session";

export type CodexStorageConflict = {
  entry: string;
  monoPath: string;
  sourcePath: string;
  monoBytes: number;
  sourceBytes: number;
  monoMtime: number | null;
  sourceMtime: number | null;
  identical: boolean;
  monoFingerprint: string;
  sourceFingerprint: string;
  canKeepMono: boolean;
};

export type CodexStorageResolution = "use_account_version" | "keep_mono_version" |
  "use_unelevated_sandbox" | "use_mono_full_access" | "preserve_recovery_metadata" | "bind_selected_source" | "separate_selected_source" | "reattach_original_source" | "keep_private_history" | "preserve_home_threads";

export type CodexSandboxBlocker = {
  sandbox: true;
  reason: string;
  setupCommand: string;
};

export type CodexStorageRecoveryConflict = {
  recovery: true;
  reason: string;
  paths: string[];
  io?: { operation: string; path: string; holder: string | null; osError: number | null; retryable: boolean };
  metadata?: { path: string; identity: string; fingerprint: string };
  homeThreads?: NonNullable<Session["codexHomeThreadsRecovery"]>;
  sourceBinding?: { resolvedSourceHome: string; boundSourceHome: string | null; canBind: boolean; canSeparate?: boolean; canReturn?: boolean; sourceIdentity?: string };
  migration?: { sourcePath: string; monoPath: string; sourceFingerprint: string; monoFingerprint: string; sourceIdentity: string; monoIdentity: string };
};

export type CodexStorageComparison = {
  monoContent?: string | null;
  sourceContent?: string | null;
  truncated?: boolean;
  unavailable?: string | null;
};

const STORAGE_ERROR_PREFIX = "Codex storage needs repair:";

export function parseCodexSandboxBlocker(error: unknown): CodexSandboxBlocker | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf(STORAGE_ERROR_PREFIX);
  if (start < 0) return undefined;
  try {
    const value = JSON.parse(message.slice(start + STORAGE_ERROR_PREFIX.length).trim());
    if (value?.sandbox !== true || typeof value.reason !== "string" || !value.reason.trim() ||
      typeof value.setupCommand !== "string" || !value.setupCommand.trim()) return undefined;
    return value as CodexSandboxBlocker;
  } catch {
    return undefined;
  }
}
export function codexSandboxRepairSettings(session: Session, isWindows: boolean, networkAccess: boolean) {
  const head = session.queuedMessages?.[0];
  const intent = session.codexStorageHeld ? session.codexStorageHeld.intent : head ? head.intent : [...session.blocks].reverse().find(block => block.role === "user")?.intent;
  return {
    sandboxRequired: session.readOnly === true || intent === "plan" || intent === "orchestrate" || session.runtimeMode !== "full-access",
    windowsSandbox: isWindows ? session.windowsSandbox ?? (session.readOnly || session.runtimeMode === "auto" || session.runtimeMode === "auto-accept-edits" ? "unelevated" as const : undefined) : undefined,
    sandboxNetworkAccess: networkAccess,
  };
}

export function codexFullAccessRepairAllowed(session: Session): boolean {
  return !codexSandboxRepairSettings({ ...session, runtimeMode: "full-access" }, false, false).sandboxRequired;
}

export function parseCodexStorageConflict(error: unknown): CodexStorageConflict | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf(STORAGE_ERROR_PREFIX);
  if (start < 0) return undefined;
  try {
    const value = JSON.parse(message.slice(start + STORAGE_ERROR_PREFIX.length).trim());
    if (!value || typeof value !== "object" || value.recovery === true ||
      !["entry", "monoPath", "sourcePath", "monoFingerprint", "sourceFingerprint"].every(key => typeof value[key] === "string" && value[key].length > 0) ||
      !["monoBytes", "sourceBytes"].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) ||
      !["monoMtime", "sourceMtime"].every(key => value[key] === null || (Number.isFinite(value[key]) && value[key] >= 0)) ||
      typeof value.identical !== "boolean" || typeof value.canKeepMono !== "boolean") return undefined;
    return value as CodexStorageConflict;
  } catch {
    return undefined;
  }
}

export function parseCodexStorageRecoveryConflict(error: unknown): CodexStorageRecoveryConflict | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const start = message.indexOf(STORAGE_ERROR_PREFIX);
  if (start < 0) return undefined;
  try {
    const value = JSON.parse(message.slice(start + STORAGE_ERROR_PREFIX.length).trim());
    if (!value || value.recovery !== true || typeof value.reason !== "string" || !value.reason.length ||
      !Array.isArray(value.paths) || !value.paths.length ||
      !value.paths.every((path: unknown) => typeof path === "string" && path.length > 0)) return undefined;
    if (value.metadata !== undefined && (!value.metadata ||
      !["path", "identity", "fingerprint"].every(key => typeof value.metadata[key] === "string" && value.metadata[key].length > 0))) return undefined;
    if (value.io !== undefined && (!value.io ||
      !["operation", "path"].every(key => typeof value.io[key] === "string" && value.io[key].length > 0) ||
      (value.io.holder !== null && typeof value.io.holder !== "string") ||
      (value.io.osError !== null && !Number.isSafeInteger(value.io.osError)) || typeof value.io.retryable !== "boolean")) return undefined;
    if (value.homeThreads !== undefined && (!value.homeThreads ||
      !["sessionId", "identity", "fingerprint", "cwd"].every(key => typeof value.homeThreads[key] === "string" && value.homeThreads[key].length > 0) ||
      !["providerAccountId", "home"].every(key => value.homeThreads[key] === null || typeof value.homeThreads[key] === "string"))) return undefined;
    if (value.sourceBinding !== undefined && (!value.sourceBinding ||
      typeof value.sourceBinding.resolvedSourceHome !== "string" || !value.sourceBinding.resolvedSourceHome ||
      (value.sourceBinding.boundSourceHome !== null && (typeof value.sourceBinding.boundSourceHome !== "string" || !value.sourceBinding.boundSourceHome)) ||
      typeof value.sourceBinding.canBind !== "boolean")) return undefined;
    if (value.sourceBinding?.canSeparate !== undefined && (typeof value.sourceBinding.canSeparate !== "boolean" ||
      (value.sourceBinding.canSeparate && typeof value.sourceBinding.sourceIdentity !== "string"))) return undefined;
    if (value.sourceBinding?.canReturn !== undefined && (typeof value.sourceBinding.canReturn !== "boolean" ||
      (value.sourceBinding.canReturn && (value.sourceBinding.boundSourceHome !== value.sourceBinding.resolvedSourceHome || typeof value.sourceBinding.sourceIdentity !== "string")))) return undefined;
    if (value.migration !== undefined && (!value.migration ||
      !["sourcePath", "monoPath", "sourceFingerprint", "monoFingerprint", "sourceIdentity", "monoIdentity"].every(key => typeof value.migration[key] === "string" && value.migration[key].length > 0))) return undefined;
    return value as CodexStorageRecoveryConflict;
  } catch {
    return undefined;
  }
}

export function codexStorageIssueTitle(conflict: CodexStorageConflict): string {
  const name = conflict.entry === "hooks.json" ? "hooks file" :
    conflict.entry === "AGENTS.md" ? "instructions file" :
      conflict.entry === "config.toml" ? "config file" : conflict.entry;
  return `Codex ${name} got out of sync`;
}

export function isCodexStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(STORAGE_ERROR_PREFIX) ||
    message.includes("Unexpected link in Mono Codex storage:");
}

export function canAutomaticallyRepairCodexStorage(session: Session): boolean {
  const recovery = parseCodexStorageRecoveryConflict(session.codexStorageError);
  return session.harness === "codex" && recovery?.io?.retryable === true && recovery.io.osError === 32 &&
    !recovery.metadata && !recovery.homeThreads && !recovery.sourceBinding && !recovery.migration &&
    !session.busy && !session.codexStoragePreparing && !session.codexHomeThreadsUnresolved &&
    session.queueStatus !== "paused" && !session.pendingQuestion && !hasPendingApproval(session.blocks) &&
    !session.editingQueuedMessageId && !session.sendingQueuedMessageId && !session.worktreeRemoved;
}

/** Hold the exact submission until repair succeeds, before a Manager turn exists. */
export class MonoCodexStorageRecovery {
  private pending = new Map<string, { retry: () => unknown; intent?: TurnIntent }>();
  private preparing = new Map<string, Promise<void>>();
  private repairing = new Set<string>();
  private accountRepairs = new Map<string, { promise: Promise<void>; sessionIds: Set<string> }>();

  isPreparing(sessionId: string): boolean {
    return this.preparing.has(sessionId);
  }

  async waitForPreparations(sessionIds: string[]): Promise<void> {
    await Promise.all(sessionIds.map(sessionId => this.preparing.get(sessionId)));
  }

  isRepairingAccount(accountId: string): boolean {
    return this.accountRepairs.has(accountId);
  }

  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  held(sessionId: string): Session["codexStorageHeld"] {
    const held = this.pending.get(sessionId);
    return held ? { intent: held.intent } : undefined;
  }

  async prepare(sessionId: string, preparation: () => Promise<unknown>, submit: () => boolean | Promise<boolean>, failed: (error: unknown) => void): Promise<boolean> {
    if (this.preparing.has(sessionId)) return false;
    let finish!: () => void;
    this.preparing.set(sessionId, new Promise<void>(resolve => { finish = resolve; }));
    try {
      try { await preparation(); } catch (error) {
        failed(error);
        return true;
      }
      return await submit();
    } finally {
      this.preparing.delete(sessionId);
      finish();
    }
  }

  hold(sessionId: string, retry: () => unknown, intent?: TurnIntent): void {
    if (!this.pending.has(sessionId)) this.pending.set(sessionId, { retry, intent });
  }

  repairAccount(accountId: string, sessionIds: string[], relink: () => Promise<unknown>, beforeResume?: (sessionId: string) => void): Promise<void> {
    const active = this.accountRepairs.get(accountId);
    if (active) {
      for (const sessionId of sessionIds) active.sessionIds.add(sessionId);
      return active.promise;
    }
    const affected = new Set(sessionIds);
    const repair = (async () => {
      await relink();
      const failures: unknown[] = [];
      for (const sessionId of affected) {
        try { await this.repair(sessionId, async () => beforeResume?.(sessionId)); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw failures[0];
    })().finally(() => this.accountRepairs.delete(accountId));
    this.accountRepairs.set(accountId, { promise: repair, sessionIds: affected });
    return repair;
  }

  async repair(sessionId: string, relink: () => Promise<unknown>): Promise<void> {
    if (this.repairing.has(sessionId)) return;
    this.repairing.add(sessionId);
    try {
      await relink();
      const held = this.pending.get(sessionId);
      const retry = held?.retry;
      this.pending.delete(sessionId);
      try {
        if (await retry?.() === false)
          throw new Error("The turn could not restart. Its prompt was retained; try Repair again when the conversation is available.");
      } catch (error) {
        if (held) this.pending.set(sessionId, held);
        throw error;
      }
    } finally {
      this.repairing.delete(sessionId);
    }
  }
}
