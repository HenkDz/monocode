// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoDetails } from "../features/monos/ui/MonoDetails";
import { findMono, updateMono } from "../features/monos/model/mono";
import { lockMonoField } from "../features/monos/model/monoTeam";
import { resolveMonoRoleEffort } from "../features/monos/model/monoRoleEffort";
import { BuildTargetButton } from "../features/sessions/ui/SecondOpinionButton";
import { dropContextWindow } from "../features/sessions/model/contextUsage";
import { planComposerSwitch } from "../features/sessions/model/handoff";
import { mergeModelSettings, modelEffortSetting, resetHarnessModelOverlays, resolveModel, setHarnessModels, type AgentModel } from "../features/sessions/model/models";
import { formatSessionTitle, HARNESS_LABEL, newSession, sessionDisplayTitle, type PlanBuildTarget, type Session } from "../features/sessions/model/session";

vi.mock("../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: (harness: string) => harness === "codex",
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => {},
}));
vi.mock("../integrations/harness/core/registry", () => ({ refreshHarnessCatalogs: () => Promise.resolve() }));
vi.mock("../features/monos/model/monoFiles", async original => ({
  ...(await original<object>()),
  loadMonoFiles: vi.fn(async () => ({ soul: "Synthetic", memory: "", topics: [] })),
}));
vi.mock("../features/monos/ui/MonoHabits", async original => ({ ...(await original<object>()), useHabits: () => [] }));
vi.mock("../features/monos/ui/MonoCodexStorageSource", () => ({ MonoCodexStorageSource: () => null }));

// Exercise App's actual private callbacks without mounting the native workspace.
const source = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw Error("App callback was not found");
  return found;
}
const helpers = ["withHarnessChoice", "withPlanBuildTarget"].map(name =>
  findNode(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source),
).join("\n");
const withPlanBuildTarget = new Function("resolveModel", "mergeModelSettings", "modelEffortSetting", "planComposerSwitch", "HARNESS_LABEL", "formatSessionTitle", "sessionDisplayTitle", "dropContextWindow",
  ts.transpile(helpers, { target: ts.ScriptTarget.ES2022 }) + "\nreturn withPlanBuildTarget;",
)(resolveModel, mergeModelSettings, modelEffortSetting, planComposerSwitch, HARNESS_LABEL, formatSessionTitle, sessionDisplayTitle, dropContextWindow) as (session: Session, target: PlanBuildTarget) => Session;
const commit = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(source) === "commitSubmittedTurn") as ts.VariableDeclaration;
const refreshed = findNode(node => ts.isCallExpression(node) && node.expression.getText(source) === "refreshHarnessCatalogs" && node.arguments[0]?.getText(source) === "harnesses");
const thenCall = refreshed.parent.parent as ts.CallExpression;
const refreshCallback = thenCall.arguments[0].getText(source);

const model: AgentModel = {
  id: "codex:build-fixture", harness: "codex", name: "Build fixture",
  settings: [{ id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high", options: [
    { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "xhigh", label: "Extra high" },
  ] }],
};
let container: HTMLDivElement;
let root: Root;
let session: Session;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  setHarnessModels("codex", [model]);
  session = { ...newSession("codex", "/synthetic"), id: "resident", model: model.id, modelSettings: { reasoningEffort: "medium" }, effortSource: "role" };
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "manager", role: "manager", sessionId: session.id, projects: ["/synthetic"], mascot: "cat", color: "#6ba", effortSource: "role" },
  ]));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
});

function commitTarget(target: PlanBuildTarget) {
  session = withPlanBuildTarget(session, target);
  const setSessions = vi.fn();
  new Function("monoForSession", "updateMono", "lockMonoField", "setSessions", "sessionId", "options", "current",
    ts.transpile(`const ${commit.getText(source)}; commitSubmittedTurn();`, { target: ts.ScriptTarget.ES2022 }),
  )(() => findMono("manager"), updateMono, lockMonoField, setSessions, session.id, { buildTarget: target }, session);
  expect(setSessions).toHaveBeenCalledOnce();
}

function refreshCatalog() {
  new Function("setSessions", "isLiveHarness", "resolveModel", "monoForSession", "resolveMonoRoleEffort", "mergeModelSettings", "sameSettings",
    ts.transpile(`const refresh = ${refreshCallback}; refresh();`, { target: ts.ScriptTarget.ES2022 }),
  )((update: (sessions: Session[]) => Session[]) => { [session] = update([session]); }, () => true, resolveModel, () => findMono("manager"), resolveMonoRoleEffort, mergeModelSettings,
    (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b));
}

async function renderDetails() {
  await act(async () => root.render(createElement(MonoDetails, {
    open: true, monoId: "manager", sessionId: session.id, cwd: session.cwd,
    agent: { name: "Manager", mascot: "cat", color: "#6ba", projects: [] }, state: { status: "idle" },
    harness: session.harness, model: session.model, modelSettings: session.modelSettings, effortSource: session.effortSource, runtimeMode: "auto",
    onModelChange: vi.fn(), onModelSettingsChange: vi.fn(), onRuntimeModeChange: vi.fn(), onClose: vi.fn(),
  })));
}

it("keeps explicit Plan Build effort user-owned in Details and after a catalog refresh", async () => {
  const picked = vi.fn(commitTarget);
  await act(async () => root.render(createElement(BuildTargetButton, {
    from: "codex", model: model.id, settings: session.modelSettings, onPick: picked,
  })));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Build with another model"]')!.click());
  const provider = document.querySelector('[data-provider-index="0"]')!;
  await act(async () => provider.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const modelRow = document.querySelector('[data-model-index="0"]')!;
  await act(async () => modelRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(option => option.textContent === "Extra high")!;
  expect(option).toBeDefined();
  await act(async () => option.click());
  expect(picked).toHaveBeenCalledWith({ harness: "codex", model: model.id, modelSettings: { reasoningEffort: "xhigh" } });
  expect(session.effortSource).toBe("user");
  expect(findMono("manager")).toMatchObject({ effortSource: "user", userLockedFields: ["modelSettings"], workerProfile: { modelSettings: { reasoningEffort: "xhigh" } } });
  await renderDetails();
  expect(container.querySelector('[data-mono-role-effort]')?.textContent).toContain("Extra high");
  expect(container.querySelector('[data-mono-role-effort]')?.textContent).toContain("Set by you");
  await act(async () => {
    setHarnessModels("codex", [{ ...model, settings: model.settings!.map(setting => ({ ...setting, value: "medium" })) }]);
    refreshCatalog();
  });
  expect(session.modelSettings.reasoningEffort).toBe("xhigh");
  expect(session.effortSource).toBe("user");
  await renderDetails();
  expect(container.querySelector('[data-mono-role-effort]')?.textContent).toContain("Extra high");
});

it("retains role ownership when the Build target supplies no effort choice", () => {
  commitTarget({ harness: "codex", model: model.id, modelSettings: {} });
  expect(session.effortSource).toBe("role");
  expect(findMono("manager")?.userLockedFields ?? []).not.toContain("modelSettings");
  refreshCatalog();
  expect(session.modelSettings.reasoningEffort).toBe("medium");
});
