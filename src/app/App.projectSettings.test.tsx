// @vitest-environment happy-dom
// Actual App gear/open callbacks and Details initializer; native/storage ports are synthetic.
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import { MonoDetails } from "../features/monos/ui/MonoDetails";
import { dedicatedMono, findMono, listMonos, monoForSession, monoLook, updateMono, saveMonoSessionId } from "../features/monos/model/mono";
import { monoLiveState } from "../features/monos/model/monoNavigation";
import { loadRecents, projectRailItems, sameProjectPath } from "../features/projects/model/recents";
import { newSession, sessionWorkCwd } from "../features/sessions/model/session";

vi.mock("../features/monos/model/monoFiles", async original => ({
  ...await original<object>(), loadMonoFiles: async () => ({ soul: "", memory: "", topics: [] }),
}));
vi.mock("../features/monos/ui/MonoHabits", async original => ({ ...await original<object>(), useHabits: () => [] }));
vi.mock("../features/sessions/data/sessionStore", async original => ({ ...await original<object>(), listSessionsByProject: async () => [] }));
vi.mock("../integrations/harness/core/child", async original => ({
  ...await original<object>(), monoCodexSkillsCatalog: async () => ({ skills: [], plugins: [], roleDefaults: { manager: [], member: [], orchestrator: [], mono: [] } }),
  // Storage-source display is unrelated to routing; never inspect native/profile storage here.
  monoCodexStorageInfo: async () => ({ home: "/synthetic-home/mono", sourceHome: "/synthetic-home/account", sourceKind: "account", shareHooks: false }),
}));
vi.mock("../features/sessions/ui/ModelPicker", () => ({
  ModelPicker: ({ project }: { project: string }) => React.createElement("span", { "data-model-project": project }, "Synthetic model control"),
  ModelSettingRows: () => null,
}));

const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
visit(ast);
function evaluate(expression: ts.Node, scope: Record<string, any>) {
  return Function(...Object.keys(scope), ts.transpile(`return (${expression.getText(ast)});`, {
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  }))(...Object.values(scope));
}
function declaration(name: string) {
  return nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration | undefined;
}
function callback(name: string, scope: Record<string, any>) {
  const node = declaration(name);
  expect(node, `actual App ${name}`).toBeTruthy();
  return evaluate((node!.initializer as ts.CallExpression).arguments[0], scope);
}
function sidebarProp(name: string, scope: Record<string, any>) {
  const sidebar = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "Sidebar") as ts.JsxSelfClosingElement;
  const prop = sidebar.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name) as ts.JsxAttribute;
  return evaluate((prop.initializer as ts.JsxExpression).expression!, scope);
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function fixture() {
  const projects = ["C:/synthetic/alpha", "C:/synthetic/beta"];
  const sessions = projects.map((cwd, index) => ({ ...newSession("codex", cwd), id: `manager-session-${index}`, providerAccountId: `account-${index}` }));
  localStorage.setItem("monocode.recentProjects", JSON.stringify(projects.map(path => ({ path, openedAt: 1 }))));
  localStorage.setItem("monocode:mono-roster", JSON.stringify(projects.map((path, index) => ({
    id: `manager-${index}`, sessionId: sessions[index].id, role: "manager", projects: [path], managerProject: path,
    name: `Manager ${index}`, mascot: "cat", color: "#6ba", createdAt: 1,
  }))));
  const noop = vi.fn();
  const scope: Record<string, any> = {
    React, MonoDetails, MonoTeamActivity: () => null, monoLook, monoLiveState, monoForSession, dedicatedMono, findMono, listMonos, updateMono,
    loadRecents, projectRailItems, sameProjectPath, sessionWorkCwd,
    sessions, sessionsRef: { current: sessions }, orchestrationRuns: [], managerPrStatuses: [], homeDir: "/synthetic-home",
    monoViewId: null, monoViewIdRef: { current: null }, monoViewRequest: { current: 0 }, lastMonoIdRef: { current: undefined },
    workerPages: {}, workerPagesRef: { current: {} }, workerSelectedSessionIdRef: { current: undefined }, workerPageError: undefined,
    openMonoTabs: [], composerFocusToken: 0,
    workspaceSessionRequest: { current: 0 }, workspaceNavigation: { cancel: vi.fn() }, projectCwdRef: { current: projects[0] },
    insetLayoutRef: { current: true }, insetLayout: true, teamMap: { close: vi.fn() },
    monoPanelTab: "activity", monoDetailsOpen: false, monoActivity: { sessionId: "old" }, monoSessions: { sessionId: "old" },
    monoArtifact: { sessionId: "old" }, monoChanges: { sessionId: "old" }, monoTeamRequest: 0,
    selectedMonoActivity: null, selectedMonoSessions: null, IS_MAC: true,
    settingsOpenRef: { current: false }, settingsReturnViewRef: { current: {} },
    searchViewOpenRef: { current: false }, inboxViewOpenRef: { current: false }, notesViewOpenRef: { current: false }, automationsViewOpenRef: { current: false },
    ensureMonoSession: vi.fn(async (id: string) => sessions.find(session => session.id === findMono(id)?.sessionId)),
    ensureOpenSession: vi.fn(), saveMonoPermissions: vi.fn(), newDefaultSession: vi.fn(),
    ensureProjectManager: vi.fn(), onSelectHistorySession: vi.fn(), closeMonoView: vi.fn(),
    onSubmit: vi.fn(), onSubmitGoal: vi.fn(), onModelChange: vi.fn(), onModelSettingsChange: vi.fn(), onRuntimeModeChange: vi.fn(),
    message: vi.fn(async () => {}), saveOpenMono: vi.fn(),
    onApproval: noop, onQuestionReply: noop, onQuestionInteraction: noop, onOpenFile: noop, onOpenDiff: noop,
    onWindowsSandboxChange: noop, onResetMono: noop, saveSettingsSection: vi.fn(), startTransition: (run: () => void) => run(),
  };
  for (const key of ["workerPages", "workerPageError", "openMonoTabs", "monoViewId", "monoTeamRequest", "monoActivity", "monoShownSession", "monoShownSessionFocused", "monoOverviewDocument",
    "worktreeOverview", "workspaceContextTab", "rightPanelOpenState", "rightPanelClosing", "monoPanelTab", "monoDetailsOpen", "monoSessions", "monoArtifact", "monoChanges", "settingsOpen", "filePickerOpen", "searchViewOpen",
    "inboxViewOpen", "notesViewOpen", "automationsViewOpen", "settingsSection", "settingsAnchor", "notificationProjectPath", "composerFocused",
    "composerFocusToken", "projectTerminalFocused", "sessions"]) {
    scope[`set${key[0].toUpperCase()}${key.slice(1)}`] = vi.fn((value: any) => { scope[key] = typeof value === "function" ? value(scope[key]) : value; });
  }
  scope.setWorkerPage = callback("setWorkerPage", scope);
  scope.onOpenMono = callback("onOpenMono", scope);
  scope.onOpenProjectManager = callback("onOpenProjectManager", scope);
  if (declaration("onOpenProjectSettings")) scope.onOpenProjectSettings = callback("onOpenProjectSettings", scope);
  scope.openSettings = callback("openSettings", scope);
  scope.onOpenSettings = callback("onOpenSettings", scope);
  const gear = sidebarProp("onProjectSettings", scope);
  async function render() {
    scope.monoViewSession = evaluate(declaration("monoViewSession")!.initializer!, scope);
    scope.monoViewMono = evaluate(declaration("monoViewMono")!.initializer!, scope);
    scope.monoCovers = evaluate(declaration("monoCovers")!.initializer!, scope);
    await act(async () => root.render(evaluate(declaration("monoDetailsPanel")!.initializer!, scope)));
  }
  function noLaunch() {
    for (const key of ["onSubmit", "onSubmitGoal", "onModelChange", "onModelSettingsChange", "onRuntimeModeChange", "ensureProjectManager", "onSelectHistorySession"]) expect(scope[key], key).not.toHaveBeenCalled();
  }
  return { projects, sessions, scope, gear, render, noLaunch };
}

it.each([0, 1])("actual App project gear opens Manager %s Details/settings with its own project context", async index => {
  const f = fixture();
  await act(async () => f.gear(f.projects[index]));
  expect(f.scope.monoDetailsOpen).toBe(true);
  await f.render();
  expect(f.scope.ensureMonoSession).toHaveBeenCalledExactlyOnceWith(`manager-${index}`, expect.any(Object));
  expect(f.scope.workspaceSessionRequest.current).toBe(1);
  expect(f.scope.monoViewRequest.current).toBe(1);
  expect(f.scope.monoViewIdRef.current).toBe(f.sessions[index].id);
  const panel = container.querySelector('[data-mono-details]')!;
  expect(panel).not.toBeNull();
  expect(panel.getAttribute("data-open")).toBe("true");
  // Part C embeds these settings under Activity; no second panel or tab strip.
  expect(panel.querySelector('[role="tab"]')).toBeNull();
  expect(panel.tagName).toBe("SECTION");
  expect(f.scope.workspaceContextTab).toBe("activity");
  expect(f.scope.rightPanelOpenState).toBe(true);
  expect(panel.querySelector('[data-mono-settings]')).not.toBeNull();
  expect(panel.querySelector('[data-model-project]')?.getAttribute("data-model-project")).toBe(f.projects[index]);
  expect(panel.querySelector('[data-mono-worktree]')?.textContent).toBe(f.projects[index]);
  expect(panel.textContent).toContain("Permissions");
  expect(panel.querySelector('[aria-label="Mono skills"]')).not.toBeNull();
  expect(f.scope.projectCwdRef.current).toBe(f.projects[0]);
  expect(f.scope.settingsOpen).toBe(false);
  expect(f.scope.message).not.toHaveBeenCalled();
  f.noLaunch();
});

it("keeps the actual Sidebar App Settings callback on global settings", () => {
  const f = fixture();
  sidebarProp("onOpenSettings", f.scope)();
  expect(f.scope.settingsOpen).toBe(true);
  expect(f.scope.monoDetailsOpen).toBe(false);
  expect(f.scope.ensureMonoSession).not.toHaveBeenCalled();
  expect(f.scope.monoViewIdRef.current).toBeNull();
  f.noLaunch();
});

it.each(["onOpenRailMono", "onOpenProjectManager"])("routes actual %s to Activity and keeps settings behind its explicit action (CC-UX2 supersedes automatic settings)", async entry => {
  const f = fixture();
  const open = entry === "onOpenProjectManager" ? f.scope.onOpenProjectManager : callback(entry, f.scope);
  await act(async () => open(entry === "onOpenProjectManager" ? f.projects[1] : "manager-1"));
  expect(f.scope.workspaceContextTab).toBe("activity");
  expect(f.scope.monoDetailsOpen).toBe(false);
  await f.render();
  expect(container.querySelector("[data-mono-details]")?.getAttribute("data-open")).toBe("false");
  expect(container.querySelector("aside.mono-details-panel")).toBeNull();
  await act(async () => f.gear(f.projects[1]));
  await f.render();
  expect(f.scope.monoDetailsOpen).toBe(true);
  expect(container.querySelector('[data-model-project]')?.getAttribute("data-model-project")).toBe(f.projects[1]);
  f.noLaunch();
});

it("refuses a stale Manager row open even when an older view still matches its session", async () => {
  const f = fixture();
  f.scope.monoViewIdRef.current = f.sessions[1].id;
  let finish!: (value: typeof f.sessions[number]) => void;
  f.scope.ensureMonoSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let opening!: Promise<void>;
  await act(async () => { opening = f.scope.onOpenProjectManager(f.projects[1]); });
  f.scope.monoViewRequest.current++;
  await act(async () => { finish(f.sessions[1]); await opening; });
  expect(f.scope.rightPanelOpenState).not.toBe(true);
  expect(f.scope.monoDetailsOpen).toBe(false);
  f.noLaunch();
});

it("explains absent Manager settings without creating a placeholder", async () => {
  const f = fixture();
  await act(async () => f.gear("C:/synthetic/unconfigured"));
  expect(f.scope.message).toHaveBeenCalledWith(expect.stringContaining("until a Manager is configured"), expect.objectContaining({ kind: "warning" }));
  expect(f.scope.ensureMonoSession).not.toHaveBeenCalled();
  expect(f.scope.monoDetailsOpen).toBe(false);
  f.noLaunch();
});

it.each(["removed Manager", "removed project", "newer navigation"])("refuses settings after pending open: %s", async reason => {
  const f = fixture();
  let finish!: (session: typeof f.sessions[number]) => void;
  f.scope.ensureMonoSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let opening: Promise<void>;
  await act(async () => { opening = f.gear(f.projects[1]); });
  if (reason === "removed Manager") updateMono("manager-1", mono => ({ ...mono, archivedAt: Date.now() }));
  if (reason === "removed project") localStorage.setItem("monocode.recentProjects", JSON.stringify([{ path: f.projects[0], openedAt: 1 }]));
  if (reason === "newer navigation") {
    await act(async () => f.scope.onOpenMono("manager-0"));
    expect(f.scope.monoViewIdRef.current).toBe(f.sessions[0].id);
  }
  await act(async () => { finish(f.sessions[1]); await opening!; });
  expect(f.scope.monoDetailsOpen).toBe(false);
  if (reason === "newer navigation") expect(f.scope.monoViewIdRef.current).toBe(f.sessions[0].id);
  f.noLaunch();
});

it("reports an existing Manager open failure without an unhandled rejection", async () => {
  const f = fixture();
  f.scope.ensureMonoSession.mockRejectedValueOnce(Error("Manager is unavailable"));
  await act(async () => f.gear(f.projects[0]));
  expect(f.scope.message).toHaveBeenCalledWith(expect.stringContaining("Manager is unavailable"), expect.objectContaining({ kind: "error" }));
  expect(f.scope.monoDetailsOpen).toBe(false);
  f.noLaunch();
});

it("independent first-open Manager settings uses the session just bound by the existing Mono loader", async () => {
  const f=fixture();
  updateMono("manager-1", mono=>({...mono,sessionId:undefined}));
  const created={...f.sessions[1],id:"new-existing-mono-session"};
  // Existing ensureMonoSession saves this binding before returning on first open; native workspace allocation is a synthetic port.
  f.scope.ensureMonoSession.mockImplementationOnce(async (id:string)=>{
    saveMonoSessionId(id,created.id);
    f.scope.sessions.push(created);
    return created;
  });
  await act(async()=>f.gear(f.projects[1]));
  console.log(JSON.stringify({phase:"first-open-settings",view:f.scope.monoViewIdRef.current,currentBinding:dedicatedMono(f.projects[1])?.sessionId,details:f.scope.monoDetailsOpen,noticeCount:f.scope.message.mock.calls.length}));
  expect(dedicatedMono(f.projects[1])?.sessionId).toBe(created.id);
  expect(f.scope.monoViewIdRef.current).toBe(created.id);
  const explained=f.scope.message.mock.calls.some((call:any[])=>typeof call[0]==="string"&&call[0].length>0);
  expect(f.scope.monoDetailsOpen||explained,"Configured Manager first-open gear must show Details or a clear refusal; silent chat-only opening is not settings").toBe(true);
  if(f.scope.monoDetailsOpen){
    await f.render();
    expect(container.querySelector('[data-mono-details]')?.getAttribute("data-open")).toBe("true");
    expect(container.querySelector('[data-model-project]')?.getAttribute("data-model-project")).toBe(f.projects[1]);
  }
  f.noLaunch();
});

it.each(["changed binding", "another Manager"])("refuses first-open settings after %s", async reason => {
  const f = fixture();
  updateMono("manager-1", mono => ({ ...mono, sessionId: undefined }));
  const created = { ...f.sessions[1], id: "new-existing-mono-session" };
  f.scope.ensureMonoSession.mockImplementationOnce(async (id: string) => {
    saveMonoSessionId(id, created.id);
    f.scope.sessions.push(created);
    if (reason === "changed binding") saveMonoSessionId(id, f.sessions[0].id);
    else {
      updateMono("manager-1", mono => ({ ...mono, projects: ["C:/synthetic/retired"] }));
      updateMono("manager-0", mono => ({ ...mono, projects: [f.projects[1]] }));
    }
    return created;
  });
  await act(async () => f.gear(f.projects[1]));
  expect(f.scope.ensureMonoSession).toHaveBeenCalledExactlyOnceWith("manager-1", expect.any(Object));
  expect(dedicatedMono(f.projects[1])?.id).toBe(reason === "changed binding" ? "manager-1" : "manager-0");
  expect(dedicatedMono(f.projects[1])?.sessionId).toBe(f.sessions[0].id);
  expect(f.scope.monoViewIdRef.current).toBe(reason === "changed binding" ? null : created.id);
  expect(f.scope.monoDetailsOpen).toBe(false);
  expect(f.scope.message).not.toHaveBeenCalled();
  f.noLaunch();
});
