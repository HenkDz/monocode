// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { act, createElement, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) {
  const matches: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); };
  visit(app);
  expect(matches).toHaveLength(1);
  return matches[0];
}
function execute(text: string, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), ts.transpile(text, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}

it.each(["window Mono", "transferred window", "disabled", "saved Mono", "missing Mono"])("respects %s during the actual Mono reopen effect", mode => {
  const effect = find(node => ts.isCallExpression(node) && node.expression.getText(app) === "useEffect" && !!node.arguments[0]?.getText(app).includes("reopenedMono.current")) as ts.CallExpression;
  const onOpenMono = vi.fn(), saveOpenMono = vi.fn(), loadOpenMono = vi.fn(() => "saved");
  const run = execute(`return ${effect.arguments[0].getText(app)};`, {
    reopenedMono: { current: false }, windowTransfer: mode === "transferred window" ? {} : undefined,
    monoViewIdRef: { current: mode === "window Mono" ? "per-window" : undefined }, monosEnabled: mode !== "disabled",
    loadOpenMono, findMono: () => mode !== "missing Mono", onOpenMono, saveOpenMono,
  });
  run(); run();
  if (["window Mono", "transferred window", "disabled"].includes(mode)) {
    expect(loadOpenMono).not.toHaveBeenCalled();
    expect(onOpenMono).not.toHaveBeenCalled();
  } else if (mode === "saved Mono") expect(onOpenMono).toHaveBeenCalledExactlyOnceWith("saved");
  else expect(saveOpenMono).toHaveBeenCalledExactlyOnceWith(undefined);
});

it("uses the current layout when creating a Mono after a layout change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const declaration = find(node => ts.isVariableDeclaration(node) && node.name.getText(app) === "onCreateMono") as ts.VariableDeclaration;
  const onOpenMono = vi.fn(), setMonoSettingsFor = vi.fn(), setMonoPanelTab = vi.fn(), setMonoDetailsOpen = vi.fn();
  const setWorkspaceContextTab = vi.fn(), setRightPanelOpenState = vi.fn(), setRightPanelClosing = vi.fn();
  const host = document.createElement("div"), root = createRoot(host);
  let create!: () => void;
  function StateHost({ insetLayout }: { insetLayout: boolean }) {
    create = execute(`${declaration.getText(app)}; return onCreateMono;`.replace(/^onCreateMono/, "const onCreateMono"), {
      useCallback, insetLayout, onOpenMono, setMonoSettingsFor, setMonoPanelTab, setMonoDetailsOpen,
      setWorkspaceContextTab, setRightPanelOpenState, setRightPanelClosing,
      createMono: () => ({ id: "new-mono" }),
    });
    return null;
  }
  try {
    await act(async () => root.render(createElement(StateHost, { insetLayout: false })));
    create();
    expect(setMonoPanelTab).toHaveBeenCalledExactlyOnceWith("details");
    expect(setMonoDetailsOpen).toHaveBeenCalledExactlyOnceWith(true);
    expect(setWorkspaceContextTab).toHaveBeenCalledExactlyOnceWith("activity");
    expect(setRightPanelOpenState).toHaveBeenCalledExactlyOnceWith(true);
    expect(setRightPanelClosing).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => root.render(createElement(StateHost, { insetLayout: true })));
    create();
    expect(setMonoSettingsFor).toHaveBeenCalledExactlyOnceWith("new-mono");
    expect(setMonoPanelTab).toHaveBeenCalledTimes(1);
    expect(setMonoDetailsOpen).toHaveBeenCalledTimes(1);
    expect(setWorkspaceContextTab).toHaveBeenCalledTimes(1);
    expect(setRightPanelOpenState).toHaveBeenCalledTimes(1);
    expect(setRightPanelClosing).toHaveBeenCalledTimes(1);
    expect(onOpenMono).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
