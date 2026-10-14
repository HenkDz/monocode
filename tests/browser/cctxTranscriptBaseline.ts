import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The pre-CC-TX renderer uses the same synthetic blocks and shared dependencies. */
export function cctxTranscriptBaseline() {
  const virtualId = "virtual:cctx-baseline-transcript";
  const resolvedId = "\0cctx-baseline-transcript";
  return {
    name: "cctx-transcript-baseline",
    resolveId: (id: string) => (id === virtualId ? resolvedId : undefined),
    load(id: string) {
      if (id !== resolvedId) return;
      const source = execFileSync(
        "git",
        [
          "show",
          "126cbbe4703519e9169a79703b7e2969858c9c18:src/features/sessions/ui/AgentTranscript.tsx",
        ],
        {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        },
      ).replace(
        /from\s+(["'])(\.{1,2}\/[^"']+)\1/g,
        (_, quote: string, path: string) =>
          `from ${quote}${posix.normalize(posix.join("/src/features/sessions/ui", path))}${quote}`,
      );
      return ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText;
    },
  };
}
