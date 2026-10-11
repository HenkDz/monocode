const updates = new Map<string, Promise<unknown>>();

/** Build the next origin snapshot only after the previous save and ref update. */
export function serializeMonoGoalUpdate<T>(sessionId: string, update: () => Promise<T>): Promise<T> {
  const previous = updates.get(sessionId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(update);
  const tail = run.then(() => undefined, () => undefined);
  updates.set(sessionId, tail);
  void tail.then(() => {
    if (updates.get(sessionId) === tail) updates.delete(sessionId);
  });
  return run;
}
