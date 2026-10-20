import { readFileSync } from "node:fs";
import ts from "typescript";
import { defineConfig } from "vite";
import projectConfig from "../../vite.config";

// Exercise the production panel callers without loading App's real storage/provider bootstrap.
export default defineConfig(async (environment) => {
  const config = await projectConfig(environment);
  return { ...config, plugins: [...(config.plugins ?? []), {
    name: "ccux1-a8-app-callers",
    resolveId: (id: string) => id === "virtual:ccux1-a8-app" ? "\0ccux1-a8-app" : undefined,
    load(id: string) {
      if (id !== "\0ccux1-a8-app") return;
      const source = readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8");
      const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const panels = new Map<string, string>();
      let changes = "";
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) && ["WorkspaceWorktrees", "WorkspaceWorktree"].includes(node.tagName.getText(ast)))
          panels.set(node.tagName.getText(ast), node.getText(ast));
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "onOpenWorktreeChanges") changes = node.initializer!.getText(ast);
        ts.forEachChild(node, visit);
      };
      visit(ast);
      if (panels.size !== 2 || !changes) throw Error("A8 production App caller boundaries missing");
      const compiled = ts.transpileModule(`host.onOpenWorktreeChanges = ${changes}; host.list = () => (${panels.get("WorkspaceWorktrees")}); host.panel = () => (${panels.get("WorkspaceWorktree")});`, {
        compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      }).outputText;
      return `export function bindA8App(host) { Function("host", ${JSON.stringify(`with (host) { ${compiled} }`)})(host); return host; }`;
    },
  }], optimizeDeps: { entries: ["tests/browser/ccux1-a8.html"] } };
});
