import { readFileSync } from "node:fs";
import ts from "typescript";
import type { Plugin } from "vite";

/** Production App seams with synthetic storage/provider boundaries, as in CC-FB2/WB1. */
export function ccvisionAppPaths(): Plugin {
  const id = "virtual:ccvision-app";
  return {
    name: "ccvision-app-paths",
    resolveId(source) { if (source === id) return `\0${id}`; },
    load(source) {
      if (source !== `\0${id}`) return;
      const ast = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const names = ["onOpenMono", "onOpenSearch", "onToggleRightPanel", "onToggleSessionSidebarShortcut"];
      const callbacks = new Map<string, string>();
      const expressions = new Map<string, string>();
      const title = new Map<string, string>();
      const props = ["mono", "inset", "rightPanelOpen", "onToggleRightPanel", "rightPanelUnavailable", "hideWindowControls"];
      let gate = "", shortcut = "", keyDispatch = "", action = "";
      const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node)) {
          const name = node.name.getText(ast);
          if (names.includes(name) && node.initializer && ts.isCallExpression(node.initializer)) callbacks.set(name, node.initializer.arguments[0].getText(ast));
          if (["showRightPanelToggle", "insetRightPanelShown"].includes(name)) expressions.set(name, node.initializer!.getText(ast));
          if (name === "shortcut" && node.initializer?.getText(ast) === "resolveAppShortcut(e)") shortcut = node.getText(ast);
        }
        if (ts.isBinaryExpression(node) && node.left.getText(ast) === "rightPanelToggleRef.current") gate = node.getText(ast);
        if (ts.isIfStatement(node) && node.expression.getText(ast) === "shortcut" && node.thenStatement.getText(ast).includes('run("toggle_session_sidebar"')) keyDispatch = node.getText(ast);
        if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "onToggleSessionSidebar" && node.initializer.getText(ast) === "onToggleSessionSidebarShortcut") action = node.initializer.getText(ast);
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "TitleBar") {
          for (const prop of node.attributes.properties) {
            if (ts.isJsxAttribute(prop) && props.includes(prop.name.getText(ast)) && prop.initializer && ts.isJsxExpression(prop.initializer)) title.set(prop.name.getText(ast), prop.initializer.expression!.getText(ast));
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
      if (callbacks.size !== names.length || expressions.size !== 2 || title.size !== props.length || !gate || !shortcut || !keyDispatch || !action) throw Error("CC-VISION App seams missing");
      const declarations = [...expressions].map(([name, value]) => `const ${name} = ${value};`).join("\n");
      const code = [...callbacks].map(([name, value]) => `host.${name} = ${value};`).join("\n") + `
        host.actions.current.onToggleSessionSidebar = ${action};
        host.actions.current.onOpenSearch = onOpenSearch;
        host.keydown = (e: KeyboardEvent) => { const ${shortcut}; ${keyDispatch} };
        host.contextState = () => { ${declarations} ${gate}; return { shown: insetRightPanelShown, title: { ${[...title].map(([name, value]) => `${name}: (${value})`).join(",")} } }; };`;
      const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
      return `export function bindVisionApp(host) { Function("host", ${JSON.stringify(`with (host) { ${compiled} }`)})(host); return host; }`;
    },
  };
}
