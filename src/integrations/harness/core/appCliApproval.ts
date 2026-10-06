/** Fail closed on shell syntax. Only a direct invocation of the running app qualifies. */
export function isDirectAppCliCommand(
  command: string | string[] | undefined,
  executable: string,
): boolean {
  if (!command || !executable) return false;
  const windows = /^[A-Za-z]:[/\\]/.test(executable);
  const normalize = (path: string) =>
    windows ? path.replace(/\\/g, "/").toLowerCase() : path;
  if (Array.isArray(command)) {
    return (
      command.length > 0 &&
      command.every(
        (part) =>
          typeof part === "string" && !/[\x00-\x1f\x7f&|<>;`$%!^]/.test(part),
      ) &&
      normalize(command[0]) === normalize(executable)
    );
  }
  // Deliberately exclude expansion/escaping syntax even inside arguments: the
  // permission protocol doesn't identify the shell (cmd, PowerShell or POSIX).
  if (/[\x00-\x1f\x7f&|<>;`$%!^()*?\[\]#]/.test(command)) return false;
  const tokens: string[] = [];
  let token = "",
    quote = "",
    started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "\\" && /["'\s]/.test(command[i + 1] ?? "")) return false;
    if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) return false;
  if (started) tokens.push(token);
  return normalize(tokens[0] ?? "") === normalize(executable);
}
