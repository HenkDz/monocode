import { readFileSync } from "node:fs";
import ts from "typescript";

/** Real App callbacks; only native/provider/storage boundaries are supplied by the fixture. */
export function workbenchAppDeclarations(
  source = readFileSync(
    new URL("../../src/app/App.tsx", import.meta.url),
    "utf8",
  ),
) {
  const ast = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [
    "onSelectHistorySession",
    "onOpenMono",
    "onVisitBack",
    "onVisitForward",
    "onRailBack",
    "onRailForward",
  ];
  const callbacks = new Map<string, string>();
  let visitEffect = "";
  let followUp = "";
  let enqueue = "";
  let deliver = "";
  let scheduler = "";
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      names.includes(node.name.getText(ast)) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      callbacks.set(
        node.name.getText(ast),
        node.initializer.arguments[0].getText(ast),
      );
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("const activeVisit =")
    )
      visitEffect = node.arguments[0].getText(ast);
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "followUpBehavior"
    )
      followUp = node.initializer!.getText(ast);
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(ast).includes("!options?.queuedMessageId") &&
      node.thenStatement.getText(ast).includes("enqueueMonoMessage(")
    )
      enqueue = node.getText(ast);
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(ast) ===
        "mono && current.busy && options?.queuedMessageId"
    )
      deliver = node.getText(ast);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]
        ?.getText(ast)
        .includes("queueDispatchingRef.current.add")
    )
      scheduler = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (
    callbacks.size !== names.length ||
    !visitEffect ||
    !followUp ||
    !enqueue ||
    !deliver ||
    !scheduler
  )
    throw Error("CC-WB1 App callback boundaries missing");
  const declaration =
    [...callbacks].map(([name, text]) => `host.${name} = ${text};`).join("\n") +
    `host.recordVisit = ${visitEffect};
          host.enqueue = function() { ${enqueue} };
          host.deliver = async function() { ${deliver} };
          host.dispatchQueue = ${scheduler};`;
  const compiled = ts.transpileModule(declaration, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return { compiled, followUp };
}

export function ccwb1AppPaths() {
  return {
    name: "ccwb1-app-paths",
    resolveId: (id: string) =>
      id === "virtual:ccwb1-app" ? "\0ccwb1-app" : undefined,
    load(id: string) {
      if (id !== "\0ccwb1-app") return;
      const { compiled, followUp } = workbenchAppDeclarations();
      // Function's non-strict scope resolves the App's closure variables from synthetic host boundaries.
      return `export function bindWorkbenchApp(host) { Function("host", ${JSON.stringify(`with (host) { ${compiled} }`)})(host); return host; }
      export function followUpBehavior(current, mono, options, steerable, intent, operatorCommand) { const loadFollowUpBehavior = () => "steer"; return ${followUp}; }`;
    },
  };
}
