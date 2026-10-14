import { javascriptLanguage } from "@codemirror/lang-javascript";

/** Read literal shell arguments from code-mode input without running provider code. */
export function codeModeCommand(code: string): string | undefined {
  if (!code.includes("exec_command")) return undefined;
  // shortcut: unusually large scripts keep the generic title; revisit if those need labels.
  if (code.length > 128_000) return undefined;
  const tree = javascriptLanguage.parser.parse(code);
  let malformed = false;
  tree.iterate({ enter(node) { if (node.type.isError) malformed = true; } });
  if (malformed) return undefined;
  let command: string | undefined;
  tree.iterate({
    enter(ref) {
      if (command || ref.name !== "CallExpression") return;
      const call = ref.node;
      const callee = call.getChild("MemberExpression");
      if (!callee || !/^tools\s*\.\s*exec_command$/.test(code.slice(callee.from, callee.to))) return;
      const argument = call.getChild("ArgList")?.firstChild?.nextSibling;
      if (argument?.name !== "ObjectExpression") return;
      let literal: string | undefined;
      for (let property = argument.firstChild; property; property = property.nextSibling) {
        if (property.name !== "Property") continue;
        const key = property.firstChild;
        if (key && ["Spread", "[", "get", "set"].includes(key.name)) return;
        // Escaped keys and accessors may override an earlier literal command.
        if (key && code.slice(key.from, key.to).includes("\\")) return;
        if (!key || !/^(?:cmd|command|"cmd"|"command"|'cmd'|'command')$/.test(code.slice(key.from, key.to))) continue;
        const value = key.nextSibling?.nextSibling;
        if (literal != null || !value || !["String", "TemplateString"].includes(value.name)) return;
        if (value.getChild("Interpolation")) return;
        literal = decodeLiteral(code.slice(value.from, value.to));
        if (literal == null) return;
      }
      command = literal;
    },
  });
  return command;
}

function decodeLiteral(literal: string): string | undefined {
  try {
    if (/\\(?:[1-9]|0\d)/.test(literal)) return undefined;
    let valid = true;
    const text = literal.slice(1, -1).replace(/\\(\r?\n|u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (_, escape: string) => {
      if (/^\r?\n$/.test(escape)) return "";
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
      if (simple[escape] != null) return simple[escape];
      if (escape[0] === "u" || escape[0] === "x") {
        return String.fromCodePoint(parseInt(escape.replace(/^[ux]\{?|\}$/g, ""), 16));
      }
      if (/^[1-9]$/.test(escape)) valid = false;
      return escape;
    });
    return valid ? text : undefined;
  } catch {
    return undefined;
  }
}

/** A readable single line; the caller keeps the full command for hover and approval. */
export function commandSummary(command: string): string {
  const line = command.split(/\r?\n/).map((part) => part.trim()).find((part) => part && !/^(?:#|\/\/)/.test(part)) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
