export function isCodexStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Codex storage needs repair:") ||
    message.includes("Unexpected link in Mono Codex storage:");
}

/** Hold the exact submission until repair succeeds, before a Manager turn exists. */
export class MonoCodexStorageRecovery {
  private pending = new Map<string, () => unknown>();
  private preparing = new Set<string>();
  private repairing = new Set<string>();

  isPreparing(sessionId: string): boolean {
    return this.preparing.has(sessionId);
  }

  async prepare(sessionId: string, preparation: () => Promise<unknown>, submit: () => boolean | Promise<boolean>, failed: (error: unknown) => void): Promise<boolean> {
    if (this.preparing.has(sessionId)) return false;
    this.preparing.add(sessionId);
    try {
      try { await preparation(); } catch (error) {
        failed(error);
        return true;
      }
      return await submit();
    } finally {
      this.preparing.delete(sessionId);
    }
  }

  hold(sessionId: string, retry: () => unknown): void {
    if (!this.pending.has(sessionId)) this.pending.set(sessionId, retry);
  }

  async repair(sessionId: string, relink: () => Promise<unknown>): Promise<void> {
    if (this.repairing.has(sessionId)) return;
    this.repairing.add(sessionId);
    try {
      await relink();
      const retry = this.pending.get(sessionId);
      this.pending.delete(sessionId);
      try {
        if (await retry?.() === false)
          throw new Error("The turn could not restart. Its prompt was retained; try Repair again when the conversation is available.");
      } catch (error) {
        if (retry) this.hold(sessionId, retry);
        throw error;
      }
    } finally {
      this.repairing.delete(sessionId);
    }
  }
}
