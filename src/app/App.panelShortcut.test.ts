// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveAppShortcut } from "../features/settings/model/appShortcuts";
import { saveKeybindingOverride } from "../features/settings/model/settings";

const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
visit(ast);
function bind(name: string, scope: Record<string, unknown>) {
  const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration;
  const body = (declaration.initializer as ts.CallExpression).arguments[0].getText(ast);
  return Function(...Object.keys(scope), ts.transpile(`return (${body})`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
it("dispatches the actual default/custom Panel shortcut once, preserves the left sidebar and IME/disabled guards", () => {
  const ref = { current: false };
  const scope = { rightPanelOpenRef: ref, setRightPanelOpenState: vi.fn(), setRightPanelClosing: vi.fn() };
  const toggle = bind("onToggleRightPanel", scope);
  const action = bind("onToggleSessionSidebarShortcut", { rightPanelToggleRef: { current: toggle } });
  const left = vi.fn();
  const dispatch = nodes.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === "shortcut" && node.thenStatement.getText(ast).includes('run("toggle_session_sidebar"'))!;
  const keydown = Function("resolveAppShortcut", "actions", "run", `return (e) => { const shortcut = resolveAppShortcut(e); ${dispatch.getText(ast)} }`)(resolveAppShortcut, { current: { onToggleSessionSidebar: action, onToggleSidebar: left } }, (_name: string, run: () => void) => run());
  const key = (options: Partial<KeyboardEvent> = {}) => ({ key: "b", code: "KeyB", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...options });
  keydown(key());
  expect(scope.setRightPanelOpenState).toHaveBeenLastCalledWith(true);
  expect(left).not.toHaveBeenCalled();
  keydown(key({ isComposing: true }));
  expect(scope.setRightPanelOpenState).toHaveBeenCalledTimes(1);
  keydown(key({ shiftKey: true }));
  expect(left).toHaveBeenCalledOnce();
  saveKeybindingOverride("App: Toggle Session Sidebar", { shortcut: "Control+KeyM" });
  keydown(key());
  expect(scope.setRightPanelOpenState).toHaveBeenCalledTimes(1);
  keydown(key({ key: "m", code: "KeyM" }));
  expect(scope.setRightPanelOpenState).toHaveBeenLastCalledWith(false);
  saveKeybindingOverride("App: Toggle Session Sidebar", { disabled: true });
  keydown(key({ key: "m", code: "KeyM" }));
  expect(scope.setRightPanelOpenState).toHaveBeenCalledTimes(2);
});
