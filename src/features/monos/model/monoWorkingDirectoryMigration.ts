const KEY = "monocode:mono-working-directory-migration:";

/** Persist before the new cwd: a restart must still relocate the old native context. */
export function rememberMonoWorkingDirectoryMigration(sessionId: string, providerSessionId?: string): void {
  if (!providerSessionId) return;
  localStorage.setItem(KEY + sessionId, providerSessionId);
}

export function monoWorkingDirectoryNeedsResume(sessionId: string, providerSessionId?: string): boolean {
  try { return !!providerSessionId && localStorage.getItem(KEY + sessionId) === providerSessionId; }
  catch { return false; }
}

/** A binding save must retry even if an event has already published the new ID. */
export function monoWorkingDirectoryMigrationPending(sessionId: string): boolean {
  return !!localStorage.getItem(KEY + sessionId);
}

/** Only an accepted provider turn proves that the saved context reached its new folder. */
export function acceptMonoWorkingDirectoryMigration(sessionId: string): void {
  try { localStorage.removeItem(KEY + sessionId); }
  catch { /* A stale receipt only retries relocation of its original native ID. */ }
}
