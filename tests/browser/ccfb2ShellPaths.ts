import { readFileSync } from "node:fs";
import ts from "typescript";
import type { Plugin } from "vite";

/** Exercise App's actual title-bar placement without booting providers or a profile. */
export function ccfb2ShellExpressions() {
  const ast = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, string>();
  const placements: string[] = [];
  let hideControls = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ["compactTitleNavigation", "compactTitleBar", "topTitleBar"].includes(node.name.getText(ast))) {
      declarations.set(node.name.getText(ast), node.initializer!.getText(ast));
    }
    if (ts.isJsxExpression(node) && node.expression && /^(compactTitleBar|topTitleBar) \? (workspaceTitleBar \: null|null \: workspaceTitleBar)$/.test(node.expression.getText(ast))) {
      placements.push(node.expression.getText(ast));
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "hideWindowControls" && node.initializer && ts.isJsxExpression(node.initializer)) {
      hideControls = node.initializer.expression!.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (placements.length !== 2 || !hideControls || !declarations.has("compactTitleBar")) throw Error("CC-FB2 App chrome seams missing");
  return {
    declarations: [...declarations].map(([name, expression]) => `const ${name} = ${expression};`).join("\n"),
    top: placements[0], inner: placements[1], hideControls,
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
