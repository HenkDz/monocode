import { readFileSync } from "node:fs";
import ts from "typescript";
import type { Plugin } from "vite";

/** Exercise App's actual title-bar placement without booting providers or a profile. */
export function ccfb2ShellExpressions() {
  const ast = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, string>();
  const placements: string[] = [];
  let hideControls = "";
  let workspaceClass = "", workspaceInert = "", chromeOpen = "", footerOpen = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ["compactTitleNavigation", "compactTitleBar", "topTitleBar", "titleBarSpansWindow", "titleBarInBody"].includes(node.name.getText(ast))) {
      declarations.set(node.name.getText(ast), node.initializer!.getText(ast));
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "chromeSurfaceOpen") chromeOpen = node.initializer!.getText(ast);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "UsageFooter") {
      const prop = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "onOpenUsage") as ts.JsxAttribute;
      footerOpen = (prop.initializer as ts.JsxExpression).expression!.getText(ast);
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "div") {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const cls = attrs.find(attr => attr.name.getText(ast) === "className")?.initializer;
      if (cls && ts.isJsxExpression(cls) && cls.expression && ts.isConditionalExpression(cls.expression) && cls.expression.whenTrue.getText(ast) === '"hidden"' && cls.expression.condition.getText(ast).includes("teamMap.open")) {
        workspaceClass = cls.expression.getText(ast);
        const inert = attrs.find(attr => attr.name.getText(ast) === "inert")!.initializer as ts.JsxExpression;
        workspaceInert = inert.expression!.getText(ast);
      }
    }
    if (ts.isJsxExpression(node) && node.expression && /^(compactTitleBar|topTitleBar|titleBarSpansWindow|titleBarInBody) \? (workspaceTitleBar \: null|null \: workspaceTitleBar)$/.test(node.expression.getText(ast))) {
      placements.push(node.expression.getText(ast));
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "hideWindowControls" && node.initializer && ts.isJsxExpression(node.initializer)) {
      hideControls = node.initializer.expression!.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (placements.length !== 2 || !hideControls || !workspaceClass || !workspaceInert || !chromeOpen || !footerOpen || !declarations.has("compactTitleBar")) throw Error("CC-FB2 App chrome seams missing");
  return {
    declarations: [...declarations].map(([name, expression]) => `const ${name} = ${expression};`).join("\n"),
    top: placements[0], inner: placements[1], hideControls, workspaceClass, workspaceInert, chromeOpen, footerOpen,
  };
}

export function ccfb2ShellPaths(): Plugin {
  const id = "virtual:ccfb2-shell";
  return {
    name: "ccfb2-shell-paths",
    resolveId(source) { if (source === id) return `\0${id}`; },
    load(source) {
      if (source === `\0${id}`) return `export default ${JSON.stringify(ccfb2ShellExpressions())};`;
    },
  };
}
