import { readFileSync } from "node:fs";
import ts from "typescript";
import { defineConfig } from "vite";
import projectConfig from "../../vite.config";

// Execute the production callers, supplying only synthetic state and callbacks.
export default defineConfig(async environment => ({
  ...await projectConfig(environment),
  optimizeDeps: { entries: ["tests/browser/ccfb5.html"] },
  plugins: [...(await projectConfig(environment)).plugins!, {
    name: "ccfb5-callers",
    resolveId: id => id === "virtual:ccfb5-callers" ? "\0ccfb5-callers" : undefined,
    load(id) {
      if (id !== "\0ccfb5-callers") return;
      const parse = (path: string) => ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const sidebar = parse("src/app/shell/Sidebar.tsx");
      const app = parse("src/app/App.tsx");
      let navFunction = "", navCall = "", header = "";
      const visitSidebar = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === "SidebarNavList") navFunction = node.getText(sidebar);
        if (ts.isVariableDeclaration(node) && node.name.getText(sidebar) === "navList") navCall = node.initializer!.getText(sidebar);
        ts.forEachChild(node, visitSidebar);
      };
      const visitApp = (node: ts.Node) => {
        if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(app) === "data-mono-view")) {
          const index = node.children.findIndex(child => ts.isJsxSelfClosingElement(child) && child.tagName.getText(app) === "SessionPane");
          if (index < 0) throw Error("Mono caller SessionPane boundary missing");
          header = node.children.slice(0, index).map(child => child.getText(app)).join("\n");
        }
        ts.forEachChild(node, visitApp);
      };
      visitSidebar(sidebar); visitApp(app);
      if (!navFunction || !navCall || !header.includes("TeamMapHeaderAction")) throw Error("C5 production callers missing");
      const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
      return `export const SidebarCaller = host => Function("host", ${JSON.stringify(`with(host) { ${compile(`${navFunction}\nreturn ${navCall};`)} }`)})(host);
        export const HeaderCaller = host => Function("host", ${JSON.stringify(`with(host) { ${compile(`return <>${header}</>;`)} }`)})(host);`;
    },
  }],
}));
