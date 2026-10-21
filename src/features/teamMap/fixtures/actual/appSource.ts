import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the production App seams with explicit shell/native ports, without booting a profile.
export function appMapHostSource() {
  const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  const declaration = (name: string) => {
    const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration | undefined;
    if (!node) throw Error(`Missing App declaration: ${name}`);
    return node;
  };
  const states = ["[decisionError, setDecisionError]", "[decisionRefresh, setDecisionRefresh]", "[decisionLoaded, setDecisionLoaded]", "decisionLoadKey", "[, setDecisionNow]", "decisionPending"];
  const statements = [...new Set(states.map(name => declaration(name).parent.parent.getText(ast)))];
  const effects = nodes.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect" &&
    (node.getText(ast).includes("setDecisionLoaded(decisionLoadKey)") || node.getText(ast).includes("midnight.setHours")));
  if (effects.length !== 2) throw Error("App hydration/clock seams changed");
  const branch = nodes.find(node => ts.isBinaryExpression(node) && ts.isJsxElement(node.right) && node.getText(ast).startsWith("teamMap.open && teamMap.scope !== MISSION_CONTROL_SCOPE") && node.getText(ast).includes("<TeamMap key="));
  if (!branch) throw Error("Missing ordinary App map branch");
  const bindings = ["React", "useState", "useRef", "useEffect", "useCallback", "useSyncExternalStore", "subscribeMonos", "monosSnapshot", "monoManagerGoals", "listMonos", "findMono", "teamMap", "sendDecisionFromClick", "ensureOpenSession", "ensureMonoSession", "homeDir", "saveMonoPermissions", "newDefaultSession", "sessionsRef", "setSessions", "submitSessionRef", "submitSession", "submitMonoGoalRef", "sameProjectPath", "monoLook", "monoGoalRoutingContext", "remoteProjectFor", "recents", "projectKey", "workspaceNavigation", "setFilePickerOpen", "setSettingsOpen", "setSearchViewOpen", "setInboxViewOpen", "setNotesViewOpen", "setAutomationsViewOpen", "MISSION_CONTROL_SCOPE", "ATTENTION_QUEUE_SCOPE", "DECISIONS_SCOPE", "USAGE_DASHBOARD_SCOPE", "INTEGRATIONS_SCOPE", "capabilityDecisionReason", "renderIntegrationRequest", "TeamMap", "sessions", "orchestrationRuns", "managerPrStatuses", "onOpenMono", "commandMapDecisions", "goalNextSteps", "renderGoalNextAction"];
  bindings.push("attentionInput", "renderNeedsUserAttention", "selectedProviderAccountId");
  const body = `function AppMapHost(ports) {
    const {${bindings.join(",")}} = ports;
    const monosSnap = useSyncExternalStore(subscribeMonos, monosSnapshot);
    useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
    ${statements.join("\n")}
    ${effects.map(node => node.getText(ast)).join("\n")}
    ${["onOpenTeamMap", "decisionActions", "goalRoutingForMono", "submitBossGoal", "mapBoss", "mapBossContext", "submitMapManager"].map(name => `const ${declaration(name).getText(ast)};`).join("\n")}
    return ${branch.getText(ast)};
  }`;
  return ts.transpile(body, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
}
