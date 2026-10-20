// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveAppShortcut } from "../features/settings/model/appShortcuts";
import { keybindingShortcutLabel, saveKeybindingOverride } from "../features/settings/model/settings";
import { MOD, SHIFT } from "../platform/tauri/platform";

const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
visit(ast);
function bind(name: string, scope: Record<string, unknown>) {
  const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useCallback") as ts.VariableDeclaration;
  const body = (declaration.initializer as ts.CallExpression).arguments[0].getText(ast);
  return Function(...Object.keys(scope), ts.transpile(`return (${body})`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});

const menuAst = ts.createSourceFile("MenuBar.tsx", readFileSync("src/app/shell/MenuBar.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const menuNodes: ts.Node[] = [];
const visitMenu = (node: ts.Node) => { menuNodes.push(node); ts.forEachChild(node, visitMenu); };
visitMenu(menuAst);
function menuFunction(name: string, scope: Record<string, unknown>) {
  const declaration = menuNodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(menuAst) === name) as ts.VariableDeclaration;
  const value = declaration.initializer!;
  const body = ts.isCallExpression(value) ? value.arguments[0] : value;
  return Function(...Object.keys(scope), ts.transpile(`return (${body.getText(menuAst)})`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
const nativeSource = readFileSync("src-tauri/src/menu.rs", "utf8");

// Native accelerator strings are source-extracted; dispatch below is synthetic, not a macOS menu run.
it.each([false, true])("routes Mod%s+B to exactly one surface through menu/keymap and duplicate dispatch", shiftKey => {
  const id = shiftKey ? "toggle_sidebar" : "toggle_session_sidebar";
  const command = shiftKey ? "App: Toggle Sidebar" : "App: Toggle Session Sidebar";
  const native = [...nativeSource.matchAll(/let (toggle_(?:session_)?sidebar) = menu_item\(\s*app,\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)",\s*"([^"]+)"/g)];
  const mapping = native.find(match => match[3] === `CmdOrCtrl+${shiftKey ? "Shift+" : ""}B`)!;
  expect(mapping?.[2]).toBe(id);
  expect(mapping?.[4]).toBe(command);
  const event = { key: "b", code: "KeyB", ctrlKey: true, metaKey: false, shiftKey, altKey: false, isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  expect(resolveAppShortcut(event)).toBe(command);
  for (const path of ["keymap", "native-menu", "custom-menu", "menu-then-keymap", "keymap-then-menu"]) {
    const panel = { rightPanelOpenRef: { current: false }, setRightPanelOpenState: vi.fn(), setRightPanelClosing: vi.fn() };
    const left = { setSessionSidebarOpen: vi.fn(), saveSessionSidebarOpen: vi.fn() };
    const onToggleSidebar = bind("onToggleSidebar", { insetLayout: true, onToggleSessionSidebar: bind("onToggleSessionSidebar", left) });
    const actions = { current: { onToggleSidebar, onToggleSessionSidebar: bind("onToggleSessionSidebarShortcut", { rightPanelToggleRef: { current: bind("onToggleRightPanel", panel) } }) } };
    const clock = { now: vi.fn(() => 1000) };
    const run = bind("run", { debounce: { current: { name: "", at: 0 } }, performance: clock });
    const dispatch = nodes.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === "shortcut" && node.thenStatement.getText(ast).includes('run("toggle_session_sidebar"'))!;
    const keydown = Function("resolveAppShortcut", "actions", "run", `return (e) => { const shortcut = resolveAppShortcut(e); ${dispatch.getText(ast)} }`)(resolveAppShortcut, actions, run);
    const listener = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "listen" && node.arguments[0]?.getText(ast) === `"${id}"`) as ts.CallExpression;
    const menu = Function("actions", "run", `return ${listener.arguments[1].getText(ast)}`)(actions, run);
    const pick = menuFunction("handlePick", { ...actions.current, closeMenu: vi.fn(), setOpen: vi.fn() });
    const items = menuFunction("getMenuItems", { shortcut: menuFunction("shortcut", { keybindingShortcutLabel }), MOD, SHIFT, onOpenNotes: undefined })("view");
    const item = items.find((item: { id?: string }) => item.id === id);
    expect(item.shortcut).toBe(`${MOD}${shiftKey ? SHIFT : ""}B`);
    expect(item.label).toBe(shiftKey ? "Toggle Sidebar" : "Toggle Panel");
    if (path === "keymap" || path === "keymap-then-menu") keydown(event);
    if (path === "native-menu" || path === "menu-then-keymap" || path === "keymap-then-menu") menu();
    if (path === "menu-then-keymap") keydown(event);
    if (path === "custom-menu") pick(item.id);
    expect(left.setSessionSidebarOpen).toHaveBeenCalledTimes(shiftKey ? 1 : 0);
    expect(panel.setRightPanelOpenState).toHaveBeenCalledTimes(shiftKey ? 0 : 1);
    if (!shiftKey) expect(panel.setRightPanelOpenState).toHaveBeenLastCalledWith(true);
    if (path === "menu-then-keymap" || path === "keymap-then-menu") {
      clock.now.mockReturnValue(1081);
      keydown(event);
      expect(left.setSessionSidebarOpen).toHaveBeenCalledTimes(shiftKey ? 2 : 0);
      expect(panel.setRightPanelOpenState).toHaveBeenCalledTimes(shiftKey ? 0 : 2);
    }
  }
});

it("keeps menu labels connected to custom and disabled bindings", () => {
  const items = () => menuFunction("getMenuItems", { shortcut: menuFunction("shortcut", { keybindingShortcutLabel }), MOD, SHIFT, onOpenNotes: undefined })("view");
  for (const [id, command] of [["toggle_sidebar", "App: Toggle Sidebar"], ["toggle_session_sidebar", "App: Toggle Session Sidebar"]]) {
    saveKeybindingOverride(command, { shortcut: "Control+KeyM" });
    expect(items().find((item: { id?: string }) => item.id === id).shortcut).toBe(keybindingShortcutLabel(command, "unused"));
    saveKeybindingOverride(command, { disabled: true });
    expect(items().find((item: { id?: string }) => item.id === id).shortcut).toBeUndefined();
  }
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
