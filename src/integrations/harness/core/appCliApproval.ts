export type AppCliApprovalPolicy = { executable: string; tempDir: string; actions: string[]; trustedRtk?: string | null; trustedPowerShell?: string[] };

export const APP_CLI_TRANSPARENT_WRAPPERS = ["rtk", "rtk.exe"] as const;
/** One trusted RTK prefix, then optionally one constrained OS PowerShell. */
export function appCliInvocation(command: string | string[] | undefined, policy: Pick<AppCliApprovalPolicy, "trustedRtk" | "trustedPowerShell"> = {}): { tokens: string[]; powerShell?: string } | undefined {
  const stripRtk = (tokens: string[]) => policy.trustedRtk && tokens[0] === policy.trustedRtk &&
    APP_CLI_TRANSPARENT_WRAPPERS.some(name => tokens[0].replace(/\\/g, "/").split("/").pop()?.toLowerCase() === name)
    ? tokens.slice(tokens[1] === "proxy" ? 2 : 1) : tokens;
  const direct = appCliCommandTokens(command);
  if (direct) {
    const tokens = stripRtk(direct);
    if (tokens[1] === "app") return { tokens };
  }
  // Outer quoting preserves the script as ONE argument. Metacharacters are
  // checked on the inner command after removing its sole allowed call operator.
  const outer = splitCommandTokens(command, false);
  if (!outer) return;
  const args = stripRtk(outer);
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  if (!policy.trustedPowerShell?.some(path => normalize(path) === normalize(args[0] ?? ""))) return;
  let index = 1;
  if (args[index++]?.toLowerCase() !== "-noprofile") return;
  if (args[index]?.toLowerCase() === "-noninteractive") index++;
  if (args[index++]?.toLowerCase() !== "-command" || args.length !== index + 1) return;
  const tokens = powerShellAppTokens(args[index]);
  return tokens ? { tokens, powerShell: args[0] } : undefined;
}

/** Deliberately NOT the generic command tokenizer: Windows PowerShell has
 * different quoting and native-argv rules. Use session-private input instead of JSON. */
export function powerShellAppTokens(script: string): string[] | undefined {
  if (/[\x00-\x1f\x7f\u2018-\u201f\u2013-\u2015\u00ab\u00bb`$"|<>;%!^()*?\[\]#]/.test(script) || script.includes("''")) return;
  // Quoted executables need &, while a no-space absolute Windows path is
  // already a valid command name (Codex emits this form through pwsh).
  const inner = script.startsWith("& ") ? script.slice(2) : script;
  if (inner.includes("&")) return;
  const head = (script.startsWith("& ")
    ? /^'([^']+)' +app +([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)(?= |$)/
    : /^([A-Za-z]:[/\\][A-Za-z0-9._:/\\-]+) +app +([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)(?= |$)/).exec(inner);
  if (!head) return;
  const tokens = [head[1], "app", head[2]];
  let rest = inner.slice(head[0].length);
  while (rest.length) {
    const next = /^ +(?:'([^']+)'|([A-Za-z0-9._:/=-]+))(?= |$)/.exec(rest);
    if (!next) return;
    tokens.push(next[1] ?? next[2]);
    rest = rest.slice(next[0].length);
  }
  // PS 5.1 strips embedded native double quotes even inside single-quoted JSON.
  if (tokens.includes("--json")) return;
  return tokens;
}

export function appCliApprovalReason(command: string | string[] | undefined, trustedRtk?: string | null): string {
  if (command === undefined) return "Not an app CLI command; this tool request follows the Mono's permission mode.";
  const raw = splitCommandTokens(command, false);
  if (raw && /(?:^|[/\\])rtk(?:\.exe|\.cmd|\.bat)?$/i.test(raw[0] ?? "") && raw[0] !== trustedRtk)
    return "wrapped by untrusted rtk, call the app CLI directly";
  const tokens = appCliInvocation(command, { trustedRtk })?.tokens;
  if (!tokens) return "Not auto-approved: command is missing, uses an untrusted launcher, lacks required PowerShell -NoProfile, or contains shell syntax or ambiguous quoting.";
  if (tokens[1] !== "app") return "Not auto-approved: unsupported wrapper, shell launcher, or non-app subcommand. Invoke the app executable directly.";
  return "Not auto-approved: executable identity, action, or arguments did not pass the app CLI safety checks. This is not a permission-mode diagnosis.";
}

/** No shell wrappers, expansion, chaining, redirects or ambiguous escapes. */
export function appCliCommandTokens(command: string | string[] | undefined): string[] | undefined {
  return splitCommandTokens(command, true);
}

function splitCommandTokens(command: string | string[] | undefined, strict: boolean): string[] | undefined {
  if (!command) return;
  if (Array.isArray(command)) return command.every(part => typeof part === "string" &&
    !(strict ? /[\x00-\x1f\x7f&|<>;`$%!^]/ : /[\x00-\x1f\x7f]/).test(part)) ? command : undefined;
  if ((strict ? /[\x00-\x1f\x7f&|<>;`$%!^()*?\[\]#]/ : /[\x00-\x1f\x7f]/).test(command)) return;
  const tokens: string[] = [];
  let token = "", quote = "", started = false, closedQuote = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "\\" && /["'\s]/.test(command[i + 1] ?? "")) return;
    if (quote) {
      if (char === quote) { quote = ""; closedQuote = true; }
      else token += char;
    } else if (char === '"' || char === "'") {
      if (!strict && started) return;
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
      closedQuote = false;
    } else {
      if (!strict && closedQuote) return;
      token += char;
      started = true;
    }
  }
  if (quote) return;
  if (started) tokens.push(token);
  return tokens;
}

/** The native CLI supplies its action allowlist and session-private app-data input directory. */
export function isDirectAppCliCommand(
  command: string | string[] | undefined,
  executable: string,
  policy: Pick<AppCliApprovalPolicy, "tempDir" | "actions" | "trustedRtk" | "trustedPowerShell">,
): boolean {
  const tokens = appCliInvocation(command, policy)?.tokens;
  if (!tokens || !executable) return false;
  const windows = /^[A-Za-z]:[/\\]/.test(executable);
  // Identity comparison only. Keep the original argv verbatim; Windows accepts
  // repeated separators, and native canonical checks still gate shells/input.
  const normalize = (path: string) => windows ? path.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase() : path;
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
