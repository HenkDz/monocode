import { readFileSync } from "node:fs";
import ts from "typescript";
import { defineConfig } from "vite";
import projectConfig from "../../vite.config";

export default defineConfig(async environment => {
  const config = await projectConfig(environment);
  return {
    ...config,
    optimizeDeps: { entries: ["tests/browser/ccux1-ui.html"] },
    plugins: [...config.plugins!, {
      name: "ccux1-page-callers",
      resolveId: id => id === "virtual:ccux1-page-callers" ? "\0ccux1-page-callers" : undefined,
      load(id) {
        if (id !== "\0ccux1-page-callers") return;
        const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const expressions: Record<string, string> = {};
        const visit = (node: ts.Node) => {
          if (ts.isVariableDeclaration(node) && ["openPage", "nextTitleTabs"].includes(node.name.getText(app))) expressions[node.name.getText(app)] = node.initializer!.getText(app);
          if (ts.isSpreadElement(node)) {
            const expression = ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression;
            if (/^insetLayout\s*\?/.test(expression.getText(app))) expressions.appTabs = expression.getText(app);
          }
          if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === "TitleBar") {
            for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr) && ["tabs", "mono", "activeId", "standaloneTitle"].includes(attr.name.getText(app)) && attr.initializer && ts.isJsxExpression(attr.initializer)) expressions[attr.name.getText(app)] = attr.initializer.expression!.getText(app);
          }
          ts.forEachChild(node, visit);
        };
        visit(app);
        for (const key of ["openPage", "nextTitleTabs", "appTabs", "tabs", "mono", "activeId", "standaloneTitle"]) if (!expressions[key]) throw Error(`CCUX1 App caller missing: ${key}`);
        const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
        return `export const callers = ${JSON.stringify(Object.fromEntries(Object.entries(expressions).map(([key, value]) => [key, compile(`return (${value});`)])))};`;
      },
    }],
  };
});
