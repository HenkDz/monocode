// @vitest-environment happy-dom
import React, { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MissionControlNav, MissionControlView, MISSION_CONTROL_SCOPE } from "../features/commandCenter/ui/MissionControl";
import { UsageDashboard, UsageDashboardNav, USAGE_DASHBOARD_SCOPE } from "../features/providers/ui/UsageDashboard";
import { useUsageDashboard } from "../features/providers/model/useUsageDashboard";
import { useTeamMap } from "../features/teamMap/navigation";
import { selectGoalViews } from "../features/commandCenter/model/goalView";
import { selectCockpit } from "../features/commandCenter/model/cockpit";
import { goals, roster, runs, sessions } from "../features/commandCenter/fixtures/syntheticMission";
import { clearCachedRateLimits } from "../features/providers/model/rateLimitsCache";
import { idleRateLimits } from "../features/providers/model/rateLimits";
import { UsageFooter } from "./shell/UsageFooter";

const readers = vi.hoisted(() => ({ invoke: vi.fn(), codex: vi.fn(), claude: vi.fn(), opencode: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: readers.invoke }));
vi.mock("../features/providers/model/rateLimitsFetch", () => ({ fetchCodexRateLimits: readers.codex, fetchClaudeRateLimits: readers.claude, fetchOpencodeGoRateLimits: readers.opencode }));
const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function source(predicate: (node: ts.Node) => boolean) {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (predicate(node)) found = node; else if (!found) ts.forEachChild(node, visit); };
  visit(ast);
  if (!found) throw Error("Actual App usage navigation seam missing");
  return found;
}
function execute(text: string, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), ts.transpile(`return ${text};`, { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
const open = source(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "onOpenTeamMap") as ts.VariableDeclaration;
const page = source(node => ts.isBinaryExpression(node) && node.left.getText(ast) === "teamMap.open && teamMap.scope === USAGE_DASHBOARD_SCOPE");
const focus = source(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("usageSurface.current?.querySelector")) as ts.CallExpression;
const footer = source(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "UsageFooter") as ts.JsxSelfClosingElement;
const footerOpen = (footer.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "onOpenUsage") as ts.JsxAttribute).initializer as ts.JsxExpression;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const settings = vi.fn();
function Surface() {
  const teamMap = useTeamMap();
  const usageSurface = useRef<HTMLDivElement>(null);
  const usage = useUsageDashboard({ roster, runs, sessions });
  const onOpenTeamMap = execute((open.initializer as ts.CallExpression).arguments[0].getText(ast), {
    teamMap, workspaceNavigation: { cancel: vi.fn() }, setFilePickerOpen: vi.fn(), setSettingsOpen: vi.fn(), setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(), setNotesViewOpen: vi.fn(), setAutomationsViewOpen: vi.fn(),
  });
  useEffect(execute(focus.arguments[0].getText(ast), { teamMap, usageSurface, USAGE_DASHBOARD_SCOPE }), [teamMap.open, teamMap.scope]);
  const input = { goals, roster, runs, sessions, now: usage.snapshot.now };
  return <>
    <MissionControlNav onOpen={() => onOpenTeamMap(MISSION_CONTROL_SCOPE)} />
    <UsageDashboardNav onOpen={() => onOpenTeamMap(USAGE_DASHBOARD_SCOPE)} />
    <UsageFooter providers={["codex"]} onOpenUsage={execute(footerOpen.expression!.getText(ast), { onOpenTeamMap, USAGE_DASHBOARD_SCOPE })} />
    <MissionControlView open={teamMap.open && teamMap.scope === MISSION_CONTROL_SCOPE} view={selectGoalViews(input)} cockpit={selectCockpit(input)}
      usageSnapshot={usage.snapshot} onOpenUsage={() => onOpenTeamMap(USAGE_DASHBOARD_SCOPE)} onClose={teamMap.close} onOpenTarget={() => {}} />
    {execute(page.getText(ast), { React, teamMap, usageSurface, usage, UsageDashboard, USAGE_DASHBOARD_SCOPE, openSettings: settings })}
  </>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", new Window({ url: "http://synthetic.local" }).localStorage);
  clearCachedRateLimits(); settings.mockClear();
  for (const provider of ["codex", "claude", "opencode"] as const) readers[provider].mockResolvedValue(idleRateLimits(provider));
  readers.invoke.mockResolvedValue(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

it("opens the focused dashboard through the actual App footer callback and closes the chip", async () => {
  await act(async () => root.render(<Surface />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Codex usage details"]')!;
  await act(async () => trigger.click());
  const action = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "See all usage →")!;
  const reads = readers.codex.mock.calls.length;
  await act(async () => action.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(host.querySelector('.usage-dashboard h1'));
  expect(readers.codex.mock.calls).toHaveLength(reads);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); clearCachedRateLimits(); vi.unstubAllGlobals(); });

it("connects the actual App navigation, one usage collector, six Mission vitals, heading focus, settings and back", async () => {
  await act(async () => root.render(<Surface />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mission control"]')!.click());
  expect(host.querySelector('.mc-vitals')!.children).toHaveLength(6);
  const reads = readers.codex.mock.calls.length;
  await act(async () => host.querySelector<HTMLButtonElement>('.usage-vital')!.click());
  const heading = host.querySelector<HTMLHeadingElement>('.usage-dashboard h1')!;
  expect(document.activeElement).toBe(heading);
  expect(host.querySelector('.mission-control')?.hasAttribute("hidden")).toBe(true);
  expect(host.textContent).toContain("Trend unavailable");
  expect(readers.codex.mock.calls).toHaveLength(reads);
  const settingsButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Account failover settings")!;
  await act(async () => settingsButton.click());
  expect(settings).toHaveBeenCalledWith("providers", "provider-accounts");
  await act(async () => heading.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(host.querySelector('.usage-dashboard')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Usage"]')!.click());
  expect(document.activeElement).toBe(host.querySelector('.usage-dashboard h1'));
  const back = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Back to conversation" && !button.closest('.mission-control'))!;
  await act(async () => back.click());
  expect(host.querySelector('.usage-dashboard')).toBeNull();
});
