import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { ccfb2ShellExpressions } from "../../tests/browser/ccfb2ShellPaths";
import { WindowControls } from "./shell/WindowControls";

const source = ccfb2ShellExpressions();
it.each([
  ["Windows workspace", false, false, false, false, false, false],
  ["Windows page", false, true, false, false, true, false],
  ["Windows page over Mono panel", false, true, true, false, true, false],
  ["Windows Mono panel", false, false, true, false, false, true],
  ["Mac workspace", true, false, false, false, false, false],
  ["Mac compact workspace", true, false, false, true, true, false],
  ["Mac page", true, true, false, false, false, false],
  ["Mac compact page over Mono", true, true, true, true, false, false],
])("keeps the source-selected chrome ownership for %s", (_name, IS_MAC, open, monoCovers, compactRailActive, top, hide) => {
  const scope = { IS_MAC, monoCovers, compactRailActive, teamMap: { open }, monoSidebarOpen: true, monoDetailsPanel: {},
    searchViewOpen: false, settingsOpen: false, inboxViewOpen: false, notesViewOpen: false, automationsViewOpen: false };
  const evaluate = (expression: string, declarations = "") => new Function(...Object.keys(scope), "chromeSurfaceOpen", "workspaceTitleBar", `${declarations}\nreturn ${expression};`)(...Object.values(scope), open, "titlebar");
  expect(evaluate(source.top, source.declarations)).toBe(top ? "titlebar" : null);
  expect(evaluate(source.inner, source.declarations)).toBe(top ? null : "titlebar");
  expect(evaluate(source.hideControls)).toBe(hide);
  expect(evaluate(source.workspaceClass) === "hidden").toBe(open);
  expect(evaluate(source.workspaceInert)).toBe(open || undefined);
});

for (const file of ["search/ui/SearchView", "inbox/ui/InboxView", "pullRequests/ui/PullRequestsView", "notes/ui/NotesView", "automations/ui/AutomationsView", "settings/ui/SettingsView"]) {
  it.each([false, true])(`preserves one existing custom-control owner in ${file} (Mac: %s)`, IS_MAC => {
    const ast = ts.createSourceFile("page.tsx", readFileSync(new URL(`../features/${file}.tsx`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const controls: ts.JsxSelfClosingElement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "WindowControls") controls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(controls).toHaveLength(1);
    expect(ts.isConditionalExpression(controls[0].parent)).toBe(true);
    const expression = controls[0].parent.getText(ast);
    const element = new Function("React", "IS_MAC", "WindowControls", ts.transpile(`return ${expression};`, { jsx: ts.JsxEmit.React }))(React, IS_MAC, WindowControls);
    const markup = renderToStaticMarkup(element);
    expect((markup.match(/aria-label="Minimize window"/g) ?? []).length).toBe(IS_MAC ? 0 : 1);
    expect((markup.match(/aria-label="Close window"/g) ?? []).length).toBe(IS_MAC ? 0 : 1);
  });
}
