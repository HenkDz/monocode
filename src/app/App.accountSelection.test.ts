// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { newSession, type Session } from "../features/sessions/model/session";
import { SessionStateStore } from "../features/sessions/model/sessionStateStore";
import { updateSessionState } from "./model/sessionState";

const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function accountCallback(scope: Record<string, unknown>) {
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === "onSelectProviderAccount") declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(app);
  if (!declaration) throw Error("Production account-selection seam missing");
  const callback = (declaration.initializer as ts.CallExpression).arguments[0];
  return new Function(...Object.keys(scope), ts.transpile(`return ${callback.getText(app)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}

it.each([false, true])("inherits current same-session settings when switching accounts (role=%s)", role => {
  const captured: Session = { ...newSession("codex", "/synthetic", "codex:gpt-5.4"), providerAccountId: "account-a", providerSessionId: "old-account-thread",
    runtimeMode: "supervised", runtimeModeSource: "default", windowsSandbox: "default", modelSettings: { effort: "low" },
    blocks: [{ id: "answer", role: "assistant", text: "Existing conversation" }] };
  const sibling = { ...newSession("claude", "/sibling"), title: "Pending sibling edit" };
  const store = new SessionStateStore([captured, sibling]);
  const appendTab = vi.fn();
  const select = accountCallback({ active: captured, sessionsRef: store.ref, setSessions: store.setState,
    newSession, updateSessionState, DEFAULT_PROVIDER_ACCOUNT_ID: "default", monoForSession: () => role ? { role: "manager" } : undefined,
    newTab: (id: string) => ({ id: `tab-${id}` }), appendTab, setActiveTabId: vi.fn(), setComposerFocused: vi.fn(),
    usageLimitAccountChangeRef: { current: vi.fn() } });
  const latest: Session = { ...captured, runtimeMode: "full-access", runtimeModeSource: "user", windowsSandbox: "unelevated",
    modelSettings: { effort: "high", custom: "keep" }, effortSource: role ? undefined : "user" };
  store.setState([latest, sibling]);
  select("codex", "account-b");
  const created = store.snapshot()[2];
  expect(created).toMatchObject({ providerAccountId: "account-b", runtimeMode: "full-access", runtimeModeSource: "user", windowsSandbox: "unelevated",
    modelSettings: latest.modelSettings, effortSource: latest.effortSource });
  expect(created.providerSessionId).toBeUndefined();
  expect(store.snapshot().slice(0, 2)).toEqual([latest, sibling]);
  expect(store.snapshot()[0].providerSessionId).toBe("old-account-thread");
  expect(appendTab).toHaveBeenCalledWith({ id: `tab-${created.id}` }, latest.cwd);
});
