import { readFileSync } from "node:fs";
import ts from "typescript";

/** Production navigation, focus, migration and page JSX; only external shell ports are supplied. */
export function workerAppDeclarations() {
  const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
  const declaration = (name: string) => {
    const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration | undefined;
    if (!node?.initializer) throw Error(`Missing production worker seam: ${name}`);
    return node;
  };
  const names = ["setWorkerPage", "onOpenMono", "openWorkerTask", "openWorkerSession", "closeMonoView", "onSelectHistorySession", "onOpenApprovalSession", "onFocusPane", "onOpenMonoLaunchedSession", "showMonoLaunchedSession", "openReminderSession", "onOpenRailMono", "onSelectTitleTab", "onVisitBack", "onVisitForward"];
  const callbacks = names.map(name => {
    const node = declaration(name);
    if (!ts.isCallExpression(node.initializer!)) throw Error(`Worker callback changed: ${name}`);
    return `host.${name} = ${node.initializer.arguments[0].getText(ast)};`;
  });
  const effects = nodes.filter(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") as ts.CallExpression[];
  const effect = (marker: string) => {
    const found = effects.filter(node => node.arguments[0]?.getText(ast).includes(marker));
    if (found.length !== 1) throw Error(`Worker effect changed: ${marker}`);
    return found[0].arguments[0].getText(ast);
  };
  const expression = nodes.find(node => ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith("sessions.filter(session => isMonoSession(session.id)).map(home =>")) as ts.JsxExpression | undefined;
  if (!expression?.expression) throw Error("Production worker page JSX missing");
  const publish = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "publishCardSessions") as ts.CallExpression | undefined;
  if (!publish) throw Error("Production card opener missing");
  const focus = ["workerPageOwner", "workerPageSelection", "workerSelectedView", "workerSelectedSession", "activeSessionId"]
    .map(name => `host.${name} = ${declaration(name).initializer!.getText(ast)};`).join("\n");
  const source = callbacks.join("\n") + `
    host.workerNavigationRef.current = host.openWorkerTask;
    host.recordVisit = ${effect("const activeVisit =")};
    host.migrate = ${effect("const migrated = migrateWorkerTaskTabs")};
    host.registerEscape = ${effect('window.addEventListener("keydown", onEscape)')};
    host.openCard = ${publish.arguments[1].getText(ast)};
    host.refreshFocus = function() { ${focus} workerSelectedSessionIdRef.current = workerSelectedSession?.id; };
    host.renderPages = function() { return ${expression.expression.getText(ast)}; };`;
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
}

export function bindWorkerApp(host: Record<string, unknown>) {
  Function("host", `with (host) { ${workerAppDeclarations()} }`)(host);
  return host;
}

export function workerAppPaths() {
  return { name: "ccmap2-worker-paths",
    resolveId: (id: string) => id === "virtual:ccmap2-worker" ? "\0ccmap2-worker" : undefined,
    load(id: string) { if (id === "\0ccmap2-worker") return `export function bindWorkerApp(host) { Function("host", ${JSON.stringify(`with (host) { ${workerAppDeclarations()} }`)})(host); return host; }`; },
  };
}
