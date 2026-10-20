import { readFileSync } from "node:fs";
import ts from "typescript";

export function actualIntegrationAppSource() {
  const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
  const declaration = (name: string) => {
    const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
    if (!node) throw Error(`Missing actual App declaration ${name}`); return node as ts.VariableDeclaration;
  };
  const page = nodes.find(node => ts.isBinaryExpression(node) && node.getText(ast).startsWith("teamMap.open && teamMap.scope === INTEGRATIONS_SCOPE"));
  const sidebar = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "Sidebar") as ts.JsxSelfClosingElement;
  const decisions = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "Decisions") as ts.JsxSelfClosingElement;
  const expression = (element: ts.JsxSelfClosingElement, name: string) => {
    const attr = element.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name) as ts.JsxAttribute;
    if (!attr?.initializer || !ts.isJsxExpression(attr.initializer)) throw Error(`Missing actual App JSX ${name}`);
    return attr.initializer.expression!.getText(ast);
  };
  if (!page || !sidebar || !decisions) throw Error("Missing actual App integration mount/navigation");
  const bindings = ["React", "useState", "useRef", "useCallback", "useSyncExternalStore", "subscribeMonos", "monosSnapshot", "monoManagerGoals", "listMonos", "findMono", "teamMap", "sendDecisionFromClick", "ensureOpenSession", "ensureMonoSession", "homeDir", "saveMonoPermissions", "newDefaultSession", "sessionsRef", "setSessions", "submitSessionRef", "sameProjectPath", "remoteProjectFor", "orchestrator", "recordCrewMessage", "projectSkillRequest", "capabilityDecisionReason", "IntegrationRequestCard", "ProjectIntegrations", "pathKey", "sidebarCwd", "sessions", "orchestrationRuns", "workspaceNavigation", "setFilePickerOpen", "setSettingsOpen", "setSearchViewOpen", "setInboxViewOpen", "setNotesViewOpen", "setAutomationsViewOpen", "monosEnabled", "INTEGRATIONS_SCOPE", "DECISIONS_SCOPE", "Decisions", "selectDecisionView", "IntegrationsNav"];
  const states = ["decisionPending", "[integrationRefresh, setIntegrationRefresh]"].map(name => declaration(name).parent.parent.getText(ast));
  return ts.transpile(`function ActualIntegrationHost(ports) {
    const {${bindings.join(",")}} = ports;
    useSyncExternalStore(subscribeMonos, monosSnapshot);
    useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
    ${states.join("\n")}
    ${["onOpenTeamMap", "decisionActions", "integrationLog", "renderIntegrationRequest"].map(name => `const ${declaration(name).getText(ast)};`).join("\n")}
    return <><nav aria-label="Workspace"><IntegrationsNav onOpen={${expression(sidebar, "onOpenIntegrations")}} /><button type="button" onClick={${expression(sidebar, "onOpenAttentionQueue")}}>Decisions</button></nav>
      <main>{${page.getText(ast)}}{teamMap.open && teamMap.scope === DECISIONS_SCOPE && <Decisions view={${expression(decisions, "view")}} roster={${expression(decisions, "roster")}} actions={${expression(decisions, "actions")}} />}</main></>;
  }`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
}
