import { readFileSync } from "node:fs";
import ts from "typescript";
import { defineConfig } from "vite";
import projectConfig from "../../vite.config";

export default defineConfig(async environment => {
  const config = await projectConfig(environment);
  return { ...config, optimizeDeps: { entries: ["tests/browser/ccux1-panel.html"] }, plugins: [...config.plugins!, {
    name: "ccux1-panel-app-routes",
    resolveId: (id: string) => id === "virtual:ccux1-panel" ? "\0ccux1-panel" : undefined,
    load(id: string) {
      if (id !== "\0ccux1-panel") return;
      const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const names = ["onToggleRightPanel", "onToggleSessionSidebarShortcut", "onOpenMono", "onOpenProjectSettings", "onOpenProjectManager", "onOpenMember", "onOpenRailMono", "onSelectProjectWorktree", "onOpenTeamMap", "onOpenInbox", "onOpenNotes", "onOpenAutomations", "onOpenSearch", "openSettings", "onOpenSettings"];
      const code: Record<string, string> = {};
      const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node)) {
          const name = node.name.getText(ast);
          if (names.includes(name)) code[name] = (node.initializer as ts.CallExpression).arguments[0].getText(ast);
          if (["workspaceTitleBar", "monoDetailsPanel"].includes(name)) code[name] = `() => (${node.initializer!.getText(ast)})`;
          if (name === "openPage") code.openPageValue = `() => (${node.initializer!.getText(ast)})`;
        }
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "div" && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "ref" && prop.initializer?.getText(ast) === "{setRightPanelRef}")) code.panel = `() => (${node.getText(ast)})`;
        if (ts.isIfStatement(node) && node.expression.getText(ast) === "shortcut" && node.thenStatement.getText(ast).includes('run("toggle_session_sidebar"')) code.keydown = `(e) => { const shortcut = resolveAppShortcut(e); ${node.getText(ast)} }`;
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "WorktreeChats") {
          const attr = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "onSelect") as ts.JsxAttribute;
          code.selectRow = (attr.initializer as ts.JsxExpression).expression!.getText(ast);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const key of [...names, "workspaceTitleBar", "monoDetailsPanel", "panel", "keydown", "selectRow"]) if (!code[key]) throw Error(`Missing production seam: ${key}`);
      const output = ts.transpileModule(Object.entries(code).map(([key, value]) => `host.${key} = ${value};`).join("\n"), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
      return `export function bindPanelApp(host) { Function("host", ${JSON.stringify(`with(host){${output}}`)})(host); return host; }`;
    },
  }] };
});
