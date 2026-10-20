import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
// @ts-expect-error production App expressions supplied by fixture plugin
import { bindPanelApp } from "virtual:ccux1-panel";
import { TitleBar } from "../../src/app/shell/TitleBar";
import { WorkspaceContextTabs, WorkspaceGoals, WorkspaceWorktree, WorkspaceChanges } from "../../src/app/shell/WorkspaceContext";
import { SearchableProjectPicker } from "../../src/features/projects/ui/SearchableProjectPicker";
import { ProjectManagerRow } from "../../src/features/orchestration/ui/ProjectManagerRow";
import { WorktreeChats } from "../../src/features/source-control/ui/WorktreeChats";
import { WorkspaceTeam, workspaceTeam } from "../../src/app/shell/WorkspaceTeam";
import { MonoDetails } from "../../src/features/monos/ui/MonoDetails";
import { MonoTeamActivity } from "../../src/features/monos/ui/MonoTeamActivity";
import { PullRequestsList } from "../../src/features/pullRequests/ui/PullRequestsList";
import { dedicatedMono, findMono, listMonos, monoForSession, monoLook, monoState, updateMono, saveMonoSessionId } from "../../src/features/monos/model/mono";
import { monoLiveState } from "../../src/features/monos/model/monoNavigation";
import { newSession, sessionWorkCwd } from "../../src/features/sessions/model/session";
import { loadRecents, projectRailItems, sameProjectPath, looksLikeProject } from "../../src/features/projects/model/recents";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { recordPullRequest } from "../../src/features/source-control/model/pullRequests";
import { IS_MAC } from "../../src/platform/tauri/platform";
import { resolveAppShortcut } from "../../src/features/settings/model/appShortcuts";
import { DECISIONS_SCOPE } from "../../src/features/commandCenter/ui/Decisions";
import { USAGE_DASHBOARD_SCOPE } from "../../src/features/providers/ui/UsageDashboard";
import { INTEGRATIONS_SCOPE } from "../../src/features/integrations/model/projectIntegrations";
import { shellPageTabId, appViewTabId } from "../../src/features/workspace/model/appViewTabs";
import { monoManagerGoals } from "../../src/features/monos/model/monoManagerGoals";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type { OrchestrationRun } from "../../src/features/orchestration/model/orchestrationState";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const project = "C:/synthetic/browser-link-4";
const trees = [project, `${project}/chooser`].map((path, i) => ({ path, branch: i ? "feat/chooser" : "main", head: "synthetic", isMain: !i, locked: false, prunable: false, missing: false, dirty: false, unpushed: 0, sessionIds: [] }));
const roster = [
  { id: "Manager", role: "manager", managerProject: project, name: "Manager", sessionId: "Manager-chat", mascot: "fox", projects: [project], color: "#7aa2ff" },
  { id: "Atlas", role: "member", name: "Atlas", specialty: "Frontend", sessionId: "Atlas-chat", reportsTo: "Manager", mascot: "cat", projects: [project], color: "#4fd1a1" },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
localStorage.setItem("monocode.recentProjects", JSON.stringify([{ path: project, openedAt: 1 }]));
setHarnessModels("codex", [{ id: "synthetic", harness: "codex", name: "Synthetic model", settings: [] }]);
const sessions = roster.map(mono => ({ ...newSession("codex", project, "synthetic"), id: mono.sessionId, title: `${mono.name} conversation` }));
const runs = [{ id: "chooser-run", leadId: "Manager-chat", ownerMonoId: "Manager", projectManager: true, cwd: project, status: "active", dispatches: [], tasks: [
  { id: "spec", title: "Chooser interaction specification", sessionId: "Atlas-chat", memberId: "Atlas", status: "completed", monoGoalId: "goal", accepted: true },
  { id: "focus", title: "Preserve chooser keyboard focus", sessionId: "Atlas-chat", memberId: "Atlas", status: "running", monoGoalId: "goal", workspace: { id: "chooser", projectCwd: project, checkoutCwd: trees[1].path, branch: trees[1].branch, kind: "worktree" } },
] }] as unknown as OrchestrationRun[];
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};
const goal = { id: "goal", monoId: "Manager", projectId: project, managerId: "Manager-chat", userMessageId: "user", requestId: "request", title: "Finish chooser routing and get it reviewed", state: "running", prUrls: [], createdAt: Date.now() - 100000, updatedAt: Date.now() };
const events: { command: string; args?: unknown }[] = [];
mockWindows("main");
mockIPC((command, args: any) => {
  events.push({ command, args });
  if (command === "plugin:window|is_maximized") return false;
  if (command === "plugin:window|set_title") return null;
  if (["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"].includes(command)) return null;
  if (command === "git_worktrees") return { defaultRoot: project, worktrees: trees };
  if (command === "git_diff_index") return { branch: "feat/chooser", files: [{ path: `${args.cwd}/src/chooser.tsx`, status: "modified", additions: 28, deletions: 9 }], additions: 28, deletions: 9, upstream: "origin/main", ahead: 2, behind: 1 };
  if (command === "git_pr_status") return null;
  if (command === "mono_codex_storage_info") return { home: "C:/synthetic/home", sourceHome: "C:/synthetic/account", sourceKind: "account", shareHooks: false };
  if (command === "mono_codex_skills_catalog") return { skills: [], plugins: [], roleDefaults: { manager: [], member: [], orchestrator: [], mono: [] } };
  if (command === "control_load") return JSON.stringify({ version: 1, goals: [goal], receipts: {} });
  if (command === "github_api_budget") return { status: "ok" };
  if (command === "read_text") return "";
  if (command.includes("list") || command.includes("load") || command.includes("files")) return [];
  throw Error(`Blocked synthetic boundary: ${command}`);
}, { shouldMockEvents: true });
await monoManagerGoals.hydrate("Manager");
recordPullRequest(trees[1].path, { number: 41, url: "https://github.com/synthetic/panel/pull/41", title: "Preserve chooser keyboard focus", state: "open", headOid: "synthetic", headRefName: "feat/chooser", baseRefName: "main", checksStatus: "success", reviewDecision: "APPROVED" } as any, { sessionId: "Atlas-chat", sessionTitle: "Atlas", turnId: "turn", blockId: "pr", at: Date.now() });
const noop = () => {};
function Fixture() {
  const [, refresh] = useState(0);
  const [app] = useState(() => {
    const state: Record<string, any> = {
      React, TitleBar, WorkspaceContextTabs, WorkspaceGoals, WorkspaceWorktree, WorkspaceChanges, PullRequestsList, MonoDetails, MonoTeamActivity,
      resolveAppShortcut, actions: { current: {} }, rightPanelToggleRef: { current: null }, run: (_name: string, action: () => void) => action(),
      DECISIONS_SCOPE, USAGE_DASHBOARD_SCOPE, INTEGRATIONS_SCOPE, shellPageTabId, appViewTabId,
      startTransition: (action: () => void) => action(), loadNotesEnabled: () => true,
      workspaceTeam, listMonos, monoLook, monoState, monoLiveState, monoForSession, findMono, dedicatedMono, updateMono,
      loadRecents, projectRailItems, sameProjectPath, looksLikeProject, sessionWorkCwd, IS_MAC,
      insetLayout: true, insetLayoutRef: { current: true }, settingsOpen: false, activeAppView: undefined,
      sidebarCwd: project, projectCwdRef: { current: project }, projectCheckoutList: { data: { worktrees: trees } },
      rightPanelOpen: true, rightPanelOpenRef: { current: true }, rightPanelClosing: false, workspaceContextTab: "goal", rightPanelTab: "changes",
      monoDetailsOpen: false, monoPanelTab: "details", monoTeamRequest: 0, monoViewId: null, monoViewIdRef: { current: null },
      monoViewMono: undefined, monoViewSession: undefined, monoViewTabId: undefined, projectWorktree: undefined, pageName: undefined, insetRightPanelShown: true,
      monoViewRequest: { current: 0 }, workspaceSessionRequest: { current: 0 }, lastMonoIdRef: { current: null },
      monoActivity: null, monoSessions: null, monoArtifact: null, monoChanges: null, selectedMonoActivity: null, selectedMonoSessions: null,
      monoActivityPanel: null, monoSessionsPanel: null, monoArtifactPanel: null, monoChangesPanel: null, monoOverviewPanel: null,
      monoRail: { states: new Map() }, monoOverviewOpen: false, monoSidebarOpen: false, monoCovers: false,
      sessions, sessionsRef: { current: sessions }, orchestrationRuns: runs, managerPrStatuses: new Map(), homeDir: "C:/synthetic/home",
      usage: { snapshot: undefined }, rightPanelResize: { width: 340 }, projectRailOpen: false, sessionSidebarOpen: true,
      compactTitleNavigation: false, titleTabs: [], activeTabId: "workspace", openPage: undefined, managerActive: false,
      showRightPanelToggle: true, rightPanelChanges: undefined, tabVisitNav: {}, workspaceNavigation: { cancel: noop, selectWorkspace: (_project: string, tree: unknown) => { state.projectWorktree = tree; state.monoCovers = false; state.monoViewId = null; state.monoViewIdRef.current = null; update(); } },
      teamMap: { open: false, scope: undefined, close: () => { state.teamMap.open = false; state.teamMap.scope = undefined; update(); }, show: (scope: string) => { state.teamMap.open = true; state.teamMap.scope = scope; update(); } }, settingsOpenRef: { current: false }, settingsReturnViewRef: { current: {} },
      closeMonoView: () => { state.monoViewId = null; state.monoViewIdRef.current = null; update(); },
      searchViewOpen: false, inboxViewOpen: false, notesViewOpen: false, automationsViewOpen: false,
      searchViewOpenRef: { current: false }, inboxViewOpenRef: { current: false }, notesViewOpenRef: { current: false }, automationsViewOpenRef: { current: false },
      rememberAppView: (view: string) => { state.activeAppView = view; },
      ensureMonoSession: async (id: string) => {
        const session = sessions.find(session => session.id === findMono(id)?.sessionId) ?? sessions.find(session => session.id === `${id}-chat`);
        if (!findMono(id)?.sessionId && session) saveMonoSessionId(id, session.id);
        return session;
      },
      message: (text: string) => { events.push({ command: "notice", args: text }); },
      setRightPanelRef: (element: HTMLElement | null) => { if (element) element.style.width = "340px"; },
    };
    const update = () => {
      state.monoViewSession = sessions.find(session => session.id === state.monoViewId);
      state.monoViewMono = state.monoViewSession && monoForSession(state.monoViewSession.id);
      state.monoCovers = !!state.monoViewSession;
      state.insetRightPanelShown = state.rightPanelOpen;
      refresh(n => n + 1);
    };
    for (const key of ["settingsOpen", "searchViewOpen", "inboxViewOpen", "notesViewOpen", "automationsViewOpen", "rightPanelOpen", "rightPanelClosing", "workspaceContextTab", "rightPanelTab", "monoPanelTab", "monoDetailsOpen", "monoTeamRequest", "monoViewId", "monoActivity", "monoSessions", "monoArtifact", "monoChanges"]) {
      const setter = `set${key[0].toUpperCase()}${key.slice(1)}${key === "rightPanelOpen" || key === "rightPanelTab" ? "State" : ""}`;
      state[setter] = (value: any) => {
        state[key] = typeof value === "function" ? value(state[key]) : value;
        if (key === "rightPanelOpen") state.rightPanelOpenRef.current = state[key];
        if (key === "rightPanelClosing") state[key] = false;
        update();
      };
    }
    const host = new Proxy(state, { has: () => true, get: (target, key) => key === Symbol.unscopables ? undefined : key in target ? target[key as string] : key in globalThis ? (globalThis as any)[key] : noop });
    state.host = host;
    bindPanelApp(host);
    state.actions.current.onToggleSessionSidebar = state.onToggleSessionSidebarShortcut;
    state.actions.current.onToggleSidebar = () => events.push({ command: "left-sidebar-toggle" });
    state.rightPanelToggleRef.current = state.onToggleRightPanel;
    Object.assign(window, { panelFixture: { events, app: host, trees, updateMono, firstOpen: () => updateMono("Manager", mono => ({ ...mono, sessionId: undefined })) } });
    return host;
  });
  useEffect(() => { window.addEventListener("keydown", app.keydown, true); return () => window.removeEventListener("keydown", app.keydown, true); }, [app]);
  app.openPage = app.openPageValue();
  const blankTab = { id: "workspace", project: "Synthetic project", title: "", more: [], sessionCount: 1, harnesses: [], busyHarnesses: [], files: [] };
  app.titleTabs = app.openPage ? [{ ...blankTab, id: shellPageTabId(app.openPage), page: app.openPage }] : app.activeAppView ? [{ ...blankTab, id: appViewTabId(app.activeAppView), appView: app.activeAppView }] : [];
  app.monoDetailsPanel = app.monoDetailsPanel instanceof Function ? app.monoDetailsPanel : noop;
  // Keep the selected production Details expression separate from the resulting React node.
  const details = app.monoDetailsPanel();
  const renderPanel = app.panel;
  const saved = app.monoDetailsPanel;
  app.monoDetailsPanel = details;
  const panel = renderPanel();
  app.monoDetailsPanel = saved;
  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background-base text-content">
    {app.workspaceTitleBar()}
    <div className="relative flex min-h-0 flex-1">
      <aside className="min-h-0 w-64 shrink-0 overflow-y-auto border-r border-stroke p-2 max-[700px]:w-44">
        <WorkspaceTeam project={project} roster={listMonos()} states={new Map()} activeId={app.monoViewMono?.id} onOpen={app.onOpenRailMono} onCreate={noop} onDelete={noop} />
        <SearchableProjectPicker cwd={project} recents={[{ path: project, openedAt: 1 }]} onSelectProject={noop} onProjectSettings={app.onOpenProjectSettings} />
        <ProjectManagerRow project={project} sessions={sessions} onOpen={app.onOpenProjectManager} onOpenMember={app.onOpenMember} />
        <WorktreeChats project={project} selectedPath={app.projectWorktree?.path ?? project} sessions={sessions} history={[]} openSessions={[]} unseen={new Set()} onSelect={app.selectRow} onChat={noop} onNew={noop} onCreate={noop} />
        {(['Command map', 'Decisions', 'Integrations', 'Usage', 'Inbox', 'Notes', 'Automations', 'Search', 'Settings', 'PR page'] as const).map(page => <button key={page} className="block px-3 py-1 text-xs" onClick={() => {
          app.pageName = page;
          if (page === 'Command map') app.onOpenTeamMap();
          else if (page === 'Decisions') app.onOpenTeamMap(DECISIONS_SCOPE);
          else if (page === 'Integrations') app.onOpenTeamMap(INTEGRATIONS_SCOPE);
          else if (page === 'Usage') app.onOpenTeamMap(USAGE_DASHBOARD_SCOPE);
          else if (page === 'Inbox' || page === 'PR page') app.onOpenInbox();
          else if (page === 'Notes') app.onOpenNotes();
          else if (page === 'Automations') app.onOpenAutomations();
          else if (page === 'Search') app.onOpenSearch();
          else app.onOpenSettings();
          refresh(n => n + 1);
        }}>{page}</button>)}
      </aside>
      <main data-chat className="flex min-w-0 flex-1 flex-col"><h1 className="border-b border-stroke px-6 py-4 text-sm">{app.pageName || app.monoViewMono?.name || "Chooser conversation"}</h1><div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-6 text-sm"><p className="self-end rounded-xl border border-stroke bg-selection p-4">Finish the chooser work and get it reviewed.</p><p className="rounded-xl border border-stroke p-4">The chooser implementation is ready for review. Merging remains your decision.</p><div className="mt-auto rounded-xl border border-stroke p-4 text-content/45">Ask, build, / for commands, @ for files…</div></div></main>
      {panel}
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
