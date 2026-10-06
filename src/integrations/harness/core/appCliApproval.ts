export type AppCliApprovalPolicy = { executable: string; tempDir: string; actions: string[] };

/** No shell wrappers, expansion, chaining, redirects or ambiguous escapes. */
export function appCliCommandTokens(command: string | string[] | undefined): string[] | undefined {
  if (!command) return;
  if (Array.isArray(command)) return command.every(part => typeof part === "string" &&
    !/[\x00-\x1f\x7f&|<>;`$%!^]/.test(part)) ? command : undefined;
  if (/[\x00-\x1f\x7f&|<>;`$%!^()*?\[\]#]/.test(command)) return;
  const tokens: string[] = [];
  let token = "", quote = "", started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "\\" && /["'\s]/.test(command[i + 1] ?? "")) return;
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
  if (quote) return;
  if (started) tokens.push(token);
  return tokens;
}

/** The native CLI supplies its actual action allowlist and OS temp directory. */
export function isDirectAppCliCommand(
  command: string | string[] | undefined,
  executable: string,
  policy: Pick<AppCliApprovalPolicy, "tempDir" | "actions">,
): boolean {
  const tokens = appCliCommandTokens(command);
  if (!tokens || !executable) return false;
  const windows = /^[A-Za-z]:[/\\]/.test(executable);
  const normalize = (path: string) => windows ? path.replace(/\\/g, "/").toLowerCase() : path;
  if (normalize(tokens[0] ?? "") !== normalize(executable) || tokens[1] !== "app" ||
      !policy.actions.includes(tokens[2])) return false;
  let input = false, requestId = false;
  for (let i = 3; i < tokens.length; i += 2) {
    const flag = tokens[i], value = tokens[i + 1];
    if (value === undefined) return false;
    if (flag === "--request-id") {
      if (requestId || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return false;
      requestId = true;
    } else if (flag === "--json" || flag === "--input") {
      if (input) return false;
      input = true;
      if (flag === "--json") {
        try {
          const json: unknown = JSON.parse(value);
          if (!json || typeof json !== "object" || Array.isArray(json) || new TextEncoder().encode(value).length > 262_144) return false;
        } catch { return false; }
      } else {
        const path = normalize(value), root = normalize(policy.tempDir).replace(/\/+$/, "");
        // Reject traversal, ADS, device paths and sibling-prefix matches. The
        // registry additionally checks the real file natively for symlinks.
        const parts = path.split("/");
        if (!root || !path.startsWith(root + "/") || parts.slice(windows ? 0 : 1).some(part => !part || part === "." || part === "..") ||
            /:/.test(path.slice(windows ? 2 : 0)) || (windows && parts.some(part => /[. ]$/.test(part)))) return false;
      }
    } else return false;
  }
  return true;
}
