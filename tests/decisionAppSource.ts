import { readFileSync } from "node:fs";
import ts from "typescript";

/** Execute the actual App seams against synthetic boundaries; fail if production wiring disappears. */
export function decisionAppSource() {
  const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(predicate: (node: ts.Node) => boolean): ts.Node {
    let found: ts.Node | undefined;
    function visit(node: ts.Node) {
      if (!found && predicate(node)) found = node;
      if (!found) ts.forEachChild(node, visit);
    }
    visit(ast);
    if (!found) throw Error("Actual App decision seam missing");
    return found;
  }
  const host = find(node => ts.isBinaryExpression(node) && node.left.getText(ast) === "decisionRuntime.current");
  const team = find(node => ts.isIfStatement(node) && node.expression.getText(ast).startsWith('source && (payload.action === "team.message"'));
  const consumer = find(node => ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.statements[0]?.getText(ast) === "scheduled.delete(session.id);");
  const accept = find(node => ts.isPropertyAssignment(node) && node.name.getText(ast) === "acceptManagerDigest");
  const stop = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "onStop") as ts.VariableDeclaration;
  const send = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "onSubmit") as ts.VariableDeclaration;
  const resume = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "onResumeQueue") as ts.VariableDeclaration;
  const guard = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "validateManagerDelivery");
  const setup = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "afterDecisionSetup");
  const actions = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "decisionActions") as ts.VariableDeclaration;
  const notifications = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "decisionNotifications");
  const recovery = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[1]?.getText(ast) === "[decisionRevision, orchestrationRuns]") as ts.CallExpression;
  const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return {
    host: compile(`${host.getText(ast)};`), team: compile(team.getText(ast)),
    consumer: compile(`return ${consumer.getText(ast)};`),
    accept: compile(`return ${(accept as ts.PropertyAssignment).initializer.getText(ast)};`),
    stop: compile(`return ${(stop.initializer as ts.CallExpression).arguments[0].getText(ast)};`),
    send: compile(`return ${(send.initializer as ts.CallExpression).arguments[0].getText(ast)};`),
    resume: compile(`return ${(resume.initializer as ts.CallExpression).arguments[0].getText(ast)};`),
    guards: compile(`const ${guard.getText(ast)}; const ${setup.getText(ast)}; return { validateManagerDelivery, afterDecisionSetup };`),
    actions: compile(`return ${actions.initializer!.getText(ast)};`),
    notifications: compile(`const ${notifications.getText(ast)}; return decisionNotifications;`),
    recovery: compile(`return ${recovery.arguments[0].getText(ast)};`),
    source: ast.text,
  };
}

export function evaluateDecisionApp<T>(code: string, scope: Record<string, unknown>): T {
  return new Function(...Object.keys(scope), code)(...Object.values(scope)) as T;
}
