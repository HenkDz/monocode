import * as worker from "../../src/features/monos/model/workerPage";
import * as visits from "../../src/features/workspace/model/tabVisitHistory";
import * as layout from "../../src/features/workspace/model/layout";
import * as tabIds from "../../src/features/workspace/model/appViewTabs";
import { findOpenSessionTab } from "../../src/features/workspace/model/workspaceTabGroups";
import { findMono, listMonos, monoForSession, monoLook, monoState, isMonoSession, type Mono } from "../../src/features/monos/model/mono";
import { newSession, sessionWorkCwd, type Session } from "../../src/features/sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "../../src/features/orchestration/model/orchestrationState";
import { sameProjectPath, normalizeProjectPath } from "../../src/features/projects/model/recents";
import { projectName, isEqualOrInside } from "../../src/shared/lib/paths";
import { focusedBusyAgentSessionId, shouldStopFocusedTurnOnEscape, deferUnhandledEscape } from "../../src/features/workspace/model/tabKeys";

const noop = () => {};
export function createWorkerFixture(bind: (host: any) => unknown) {
  const project = "C:/synthetic/project", foreign = "C:/synthetic/foreign/task-checkout";
  const roster: Mono[] = [
    { id: "manager", role: "manager", name: "Mira", sessionId: "manager-home", managerEngineId: "engine", managerProject: project, projects: [project], mascot: "cat", color: "#c5b68d" },
    { id: "worker", role: "member", name: "Vale", sessionId: "worker-home", reportsTo: "manager", projects: [project], specialty: "Engineering", mascot: "cat", color: "#a5bbd1" },
  ];
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const make = (id: string, busy = false): Session => ({ ...newSession("codex", project), id, title: id, model: "codex:fixture", providerAccountId: `account-${id}`, providerSessionId: `provider-${id}`, busy,
    blocks: [{ id: `u-${id}`, role: "user", text: `Exact conversation ${id}`, startedAt: 1000 }, { id: `a-${id}`, role: "assistant", text: `Recorded answer in ${id}` }], queuedMessages: [{ id: `q-${id}`, text: `Keep draft for ${id}`, attachments: [], followUpBehavior: "queue" }] });
  const sessions = [make("worker-home", true), make("manager-home"), make("task-a", true), make("task-b"), make("past-a"), make("manager-task"), make("unrelated")];
  sessions.find(s => s.id === "task-a")!.worktreeCwd = foreign;
  const task = (id: string, sessionId: string, status: OrchestrationTask["status"] = "running"): OrchestrationTask => ({ id, sessionId, memberId: "worker", memberName: "Vale", title: `Assignment ${id}`, prompt: `Exact brief ${id}`, status, harness: "codex", model: "codex:fixture", files: [], scopes: [], dependsOn: [], result: "", accepted: false, delivered: false });
  const a = task("a", "task-a"), b = task("b", "task-b"), queued = task("queued", "queued-session", "queued"), gone = task("gone", "gone-session", "completed"), direct = { ...task("direct", "manager-task"), memberId: undefined };
  const workspace = { id: "foreign", projectCwd: project, checkoutCwd: foreign, kind: "worktree" as const, branch: "feature" };
  a.activeDispatchId = "a-2"; b.activeDispatchId = "b-1";
  const run: OrchestrationRun = { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: "manager-home", cwd: project, projectManager: true, status: "active", allowedHarnesses: ["codex"], maxWorkers: 1, cli: "fixture", continuations: 0, requests: {}, tasks: [a, b, queued, gone, direct], dispatches: [
    { id: "a-1", taskId: "a", sessionId: "past-a", state: "completed", stage: "settled", workspace, startedAt: 100, updatedAt: 200, finishedAt: 200 },
    { id: "a-2", taskId: "a", sessionId: "task-a", state: "running", stage: "turn_submitted", workspace, startedAt: 300, updatedAt: 300 },
    { id: "b-1", taskId: "b", sessionId: "task-b", state: "running", stage: "turn_submitted", workspace, startedAt: 400, updatedAt: 400 },
  ] };
  const events: any[] = [];
  const tabs = [layout.newTab("unrelated")];
  let refresh = noop;
  const pending = new Map<string, () => void>();
  const deferred = new Set<string>();
  const host: any = {
    ...worker, ...visits, ...layout, ...tabIds, findOpenSessionTab, findMono, listMonos, monoForSession, monoLook, monoState, isMonoSession, projectName,
    focusedBusyAgentSessionId, shouldStopFocusedTurnOnEscape, deferUnhandledEscape,
    workerPages: {}, workerPagesRef: { current: {} }, workerPageError: undefined,
    workerSelectedSessionIdRef: { current: undefined }, workerNavigationRef: { current: noop }, workerVisitTargets: { current: new Map() },
    workerLayoutReady: true, workerLayoutMigrated: { current: false },
    orchestrationRuns: [run], sessions, sessionsRef: { current: sessions }, tabs, tabsRef: { current: tabs },
    activeTabId: tabs[0].id, activeTabIdRef: { current: tabs[0].id }, active: sessions.find(s => s.id === "unrelated"),
    monoViewId: null, monoViewIdRef: { current: null }, monoViewSession: undefined,
    monoViewRequest: { current: 0 }, workspaceSessionRequest: { current: 0 }, lastMonoIdRef: { current: undefined },
    workerHistoryRef: { current: [] }, history: [], shownMonoSessionId: undefined, shownMonoSessionIdRef: { current: undefined }, monoShownSessionFocused: false,
    projectTerminalFocused: false, projectTerminalFocusedRef: { current: false }, composerFocused: false, composerFocusToken: 0,
    monoShownSessionActive: false, monoViewMono: undefined, monoActivityShownTurnId: undefined, monoSidebarOpen: false, monoPanelTab: "details", insetLayout: true,
    monoLaunchedSessions: undefined, selectedMonoActivity: undefined, monoActivity: undefined, monoShownSession: undefined,
    searchViewOpen: false, settingsOpen: false, inboxViewOpen: false, notesViewOpen: false, automationsViewOpen: false, inboxAskPortal: undefined,
    tabVisitRef: { current: visits.emptyTabVisitHistory(tabs[0].id) }, tabVisitFromHistoryRef: { current: false },
    workspaceNavigation: { cancel: () => events.push({ action: "cancel-navigation" }) },
    teamMap: { open: false, close: () => { host.teamMap.open = false; refresh(); } },
    orchestrator: { snapshot: () => host.orchestrationRuns, ownerSession: (id: string) => id, forSession: () => undefined, run: () => undefined },
    invoke: async () => [],
    ensureOpenSession: async (id: string) => {
      events.push({ action: "load", id });
      if (deferred.has(id)) await new Promise<void>(resolve => pending.set(id, resolve));
      return host.sessionsRef.current.find((session: Session) => session.id === id) ?? null;
    },
    ensureMonoSession: async (id: string) => {
      const owner = findMono(id);
      if (deferred.has(id)) await new Promise<void>(resolve => pending.set(id, resolve));
      return host.sessionsRef.current.find((session: Session) => session.id === owner?.sessionId);
    },
    newDefaultSession: () => { throw Error("No synthetic session creation allowed"); }, homeDir: async () => "C:/synthetic", saveMonoPermissions: noop, saveOpenMono: noop,
    setWorkerPages(value: any) { host.workerPages = value; refresh(); },
    setWorkerPageError(value: any) { host.workerPageError = value; refresh(); },
    setMonoViewId(id: string | null) { host.monoViewId = id; host.monoViewSession = host.sessions.find((s: Session) => s.id === id); host.monoViewMono = monoForSession(id ?? ""); refresh(); },
    setOpenMonoTabs(update: any) { host.openMonoTabs = typeof update === "function" ? update(host.openMonoTabs) : update; refresh(); }, openMonoTabs: [],
    setProjectTerminalFocused(value: boolean) { host.projectTerminalFocused = value; host.projectTerminalFocusedRef.current = value; },
    setComposerFocused(value: boolean) { host.composerFocused = value; }, setComposerFocusToken(update: any) { host.composerFocusToken = update(host.composerFocusToken); },
    setTabs(value: any) { host.tabs = typeof value === "function" ? value(host.tabs) : value; host.tabsRef.current = host.tabs; refresh(); },
    setSessions(value: any) { host.sessions = typeof value === "function" ? value(host.sessions) : value; host.sessionsRef.current = host.sessions; refresh(); },
    commitTabVisit(next: any) { host.tabVisitRef.current = next; },
    setSidebarTab: (...args: any[]) => events.push({ action: "sidebar", args }), setProjectCwd: (...args: any[]) => events.push({ action: "project", args }),
    setWorktreeFocus: (...args: any[]) => events.push({ action: "worktree", args }),
    chooseProjectAddition: async () => { events.push({ action: "project-addition" }); return { project }; },
    looksLikeProject: () => true, projectRailItems: () => [], loadRecents: () => [], sessionForProjectAddition: (s: Session) => s,
    setRecents: noop, rememberProject: () => [], isProjectManager: () => false, normalizeProjectPath, sameProjectPath, isEqualOrInside, sessionWorkCwd,
    focusOpenSession: (id: string) => { events.push({ action: "focus-workspace", id }); return false; }, replaceBlankPaneWithSession: () => false,
    appendTab(tab: any) { host.tabs.push(tab); events.push({ action: "append-tab" }); },
    setActiveTabId(id: string) { events.push({ action: "activate-tab", id }); host.activeTabId = id; host.activeTabIdRef.current = id; },
    activateTab(id: string) { host.closeMonoView(); host.setActiveTabId(id); },
    workspacePins: { current: new Map() }, linkedSessionUpdatesRef: { current: new Map() }, persistSession: () => events.push({ action: "persist" }),
    onStop: (id: string) => events.push({ action: "stop", id }),
    onShowMonoActivity: noop, onOpenMonoArtifact: noop, onOpenMonoDiff: noop, onCommitMonoChanges: noop, onOpenMonoSession: noop, goalRoutingForMono: () => undefined,
    monoRail: { states: new Map() }, onOpenTeamMap: () => { host.teamMap.open = true; refresh(); },
    onOpenSearch: noop, onOpenInbox: noop, onOpenNotes: noop, onOpenAutomations: noop, pageTab: undefined,
  };
  for (const name of ["setWorktreeOverview", "setMonoTeamRequest", "setMonoActivity", "setMonoSessions", "setMonoArtifact", "setMonoChanges", "setMonoDetailsOpen", "setMonoOverviewDocument", "setMonoPanelTab", "setWorkspaceContextTab", "setRightPanelOpenState", "setRightPanelClosing", "setFilePickerOpen", "setInspectedWorkerId"]) host[name] = noop;
  for (const name of ["Search", "Inbox", "Notes", "Automations", "Settings"]) host[`set${name}ViewOpen`.replace("SettingsView", "Settings")] = (value: boolean) => { host[`${name[0].toLowerCase()}${name.slice(1)}ViewOpen`.replace("settingsView", "settings")] = value; };
  host.setMonoShownSession = (value: any) => { host.monoShownSession = value; host.shownMonoSessionId = value; host.shownMonoSessionIdRef.current = value; };
  host.setMonoShownSessionFocused = (value: boolean) => { host.monoShownSessionFocused = value; };
  bind(host);
  return { host, roster, run, sessions, events, project, foreign,
    refresh: () => { host.refreshFocus(); refresh(); },
    onRefresh: (callback: () => void) => { refresh = () => { host.refreshFocus(); callback(); }; },
    defer: (id: string) => deferred.add(id),
    release: (id: string) => { deferred.delete(id); pending.get(id)?.(); pending.delete(id); },
  };
}
