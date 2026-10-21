import { readFileSync } from "node:fs";
import ts from "typescript";
import { defineConfig } from "vite";
import projectConfig from "../../vite.config";
import { ccwb1AppPaths } from "./ccwb1AppPaths";

export default defineConfig(async environment => {
  const config = await projectConfig(environment);
  return { ...config, optimizeDeps: { entries: ["tests/browser/ccux2.html", "tests/browser/ccwb1-workbench.html"] }, plugins: [...config.plugins!, ccwb1AppPaths(), {
    name: "ccux2-production-app-seams",
    resolveId: id => id === "virtual:ccux2-app" ? "\0ccux2-app" : undefined,
    load(id) {
      if (id !== "\0ccux2-app") return;
      const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const nodes: ts.Node[] = [];
      const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
      const declaration = (name: string) => {
        const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration | undefined;
        if (!node?.initializer) throw Error(`Missing production App declaration ${name}`);
        return node.initializer;
      };
      const callbacks = ["onOpenMono", "onSelectHistorySession", "onSelectProjectWorktree", "onNewWorktreeSession", "onSelectTitleTab", "closeViewTab", "onRunProjectScript", "onOpenTeamMap", "onOpenSearch", "onOpenInbox", "onOpenNotes", "onOpenAutomations", "onToggleRightPanel"];
      const callback = (name: string) => {
        const node = declaration(name);
        if (!ts.isCallExpression(node)) throw Error(`Production callback changed: ${name}`);
        return node.arguments[0].getText(ast);
      };
      const helpers = ["conversationTitle", "isBlankWorkspaceTab", "toTitleTab"].map(name => {
        const node = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
        if (!node) throw Error(`Missing production App helper ${name}`);
        return node.getText(ast);
      });
      const expressions = ["openPage", "pageTab", "activeWorker", "orderedTitleTabs", "shownViewTabId", "placeholderTab", "nextTitleTabs", "chromeSurfaceOpen", "insetRightPanelShown", "showRightPanelToggle"];
      const titleBar = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "TitleBar") as ts.JsxSelfClosingElement;
      const props = ["tabs", "mono", "activeId", "standaloneTitle", "cwd", "onShowMonoDetails", "onToggleRightPanel", "rightPanelOpen"];
      const selectedProps = props.map(name => {
        const attribute = titleBar.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name) as ts.JsxAttribute;
        if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer)) throw Error(`Missing production title prop ${name}`);
        return `${name}: (${attribute.initializer.expression!.getText(ast)})`;
      });
      const code = `with(host) { ${helpers.join("\n")}
        ${callbacks.map(name => `host.${name} = ${callback(name)};`).join("\n")}
        host.readTitle = () => { const deckProjectTabs = (${callback("deckProjectTabs")})();
          ${expressions.map(name => `const ${name} = ${declaration(name).getText(ast)};`).join("\n")}
          const titleTabs = nextTitleTabs;
          return { title: { ${selectedProps.join(",")} }, contextVisible: insetRightPanelShown, global: chromeSurfaceOpen };
        }; }`;
      const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
      return `export function bindCCUX2(host) { Function("host", ${JSON.stringify(compiled)})(host); return host; }`;
    },
  }] };
});
