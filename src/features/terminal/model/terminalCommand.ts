/** A click may supply one command to one fresh terminal; nothing is persisted. */
const commands = new Map<string, { cwd: string; command: string; isCurrent: () => boolean }>();
export function prepareTerminalCommand(id: string, cwd: string, command: string, isCurrent: () => boolean) {
  commands.set(id, { cwd, command, isCurrent });
}
export function takeTerminalCommand(id: string, cwd: string): string | undefined {
  const entry = commands.get(id);
  commands.delete(id);
  return entry?.cwd === cwd && entry.isCurrent() ? entry.command : undefined;
}
export function forgetTerminalCommand(id: string) { commands.delete(id); }
