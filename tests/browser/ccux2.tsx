import { startTransition, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { bindCCUX2 } from "virtual:ccux2-app";
import { TitleBar } from "../../src/app/shell/TitleBar";
import { RailAction } from "../../src/app/shell/RailAction";
import { WorkspaceGoals, WorkspaceWorktree } from "../../src/app/shell/WorkspaceContext";
import { WorkspaceTeam } from "../../src/app/shell/WorkspaceTeam";
import { CircleAlert } from "../../src/shared/ui/icons";
import { WorktreeChats } from "../../src/features/source-control/ui/WorktreeChats";
import { worktreeSessionGroups } from "../../src/features/source-control/model/worktreeSessions";
import { chatTabWorktree } from "../../src/features/source-control/model/chatWorktree";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import { SearchableProjectPicker } from "../../src/features/projects/ui/SearchableProjectPicker";
import { listMonos, findMono, monoLook, monoState, monoWorksOn, monoForSession, type Mono } from "../../src/features/monos/model/mono";
import { monoLiveState, workbenchSessionTask } from "../../src/features/monos/model/monoNavigation";
import { MonoTeamActivity } from "../../src/features/monos/ui/MonoTeamActivity";
import { orchestrator, type OrchestrationRun } from "../../src/features/orchestration/model/orchestration";
import { newSession, sessionDisplayTitle, sessionNeedsInput, sessionWorkCwd, type Session } from "../../src/features/sessions/model/session";
import { isBlankSession } from "../../src/features/projects/model/projectReturn";
import { summaryFromSession } from "../../src/features/sessions/data/sessionHistory";
import { sessionActivityAt } from "../../src/features/sessions/model/sessionActivity";
import { AgentMarkdown } from "../../src/features/sessions/ui/AgentMarkdown";
import { selectNeedsUser, type DecisionView } from "../../src/features/commandCenter/model/decisionView";
import { Decisions, DECISIONS_SCOPE, type DecisionUiActions } from "../../src/features/commandCenter/ui/Decisions";
import { AttentionQueueView, ATTENTION_QUEUE_SCOPE } from "../../src/features/commandCenter/ui/AttentionQueue";
import { MISSION_CONTROL_SCOPE } from "../../src/features/commandCenter/ui/MissionControl";
import type { AttentionCallbacks } from "../../src/features/commandCenter/model/attention";
import { INTEGRATIONS_SCOPE } from "../../src/features/integrations/model/projectIntegrations";
import { USAGE_DASHBOARD_SCOPE } from "../../src/features/providers/ui/UsageDashboard";
import { TeamMap } from "../../src/features/teamMap/TeamMap";
import { leafIds, newTab, focusedFileTab, isTerminalTab, isFilesystemTab, previewWorkspaceFile } from "../../src/features/workspace/model/layout";
import { filterTabsForProject, findOpenSessionTab, isManagerTab, workspaceTabCwd } from "../../src/features/workspace/model/workspaceTabGroups";
import * as appViews from "../../src/features/workspace/model/appViewTabs";
import { sameProjectPath, normalizeProjectPath, isLocalProject, isRemoteProjectPath, looksLikeProject, loadRecents, projectRailItems } from "../../src/features/projects/model/recents";
import { pathKey, projectName, isEqualOrInside } from "../../src/shared/lib/paths";
import { basename } from "../../src/platform/tauri/fs";
import { orderByIds } from "../../src/shared/lib/reorder";
import { packageScripts } from "../../src/features/projects/model/packageScripts";
import { applyUiScale } from "../../src/features/settings/model/uiScale";
import { monoManagerGoals, type MonoManagerGoal } from "../../src/features/monos/model/monoManagerGoals";
import { MonoOrgActivity } from "../../src/features/monos/ui/MonoOrgActivity";
import { TeamMessage } from "../../src/features/sessions/ui/TeamMessage";
import { TaskMetricsLine } from "../../src/features/agents/ui/TaskMetricsLine";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search), project = "C:/synthetic/Chooser", now = Date.now();
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const roster: Mono[] = [
  { id: "manager", name: "Manager", role: "manager", sessionId: "manager-home", managerProject: project, projects: [project], mascot: "fox", color: "#88aaff" },
  { id: "atlas", name: "Atlas", role: "member", reportsTo: "manager", sessionId: "atlas-home", projects: [project], mascot: "cat", color: "#4fd1a1" },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
localStorage.setItem("monocode:crew-messages", JSON.stringify([
  ...[1, 2, 3].map(index => ({ id: `update-${index}`, managerId: 'manager', senderId: 'atlas', recipientId: 'manager', topic: 'review', text: `[Review notes](https://example.com/review) update ${index}`, summary: 'Review notes are ready', at: now + index })),
  { id: 'unrelated', managerId: 'manager', senderId: 'other', recipientId: 'manager', topic: 'other', text: 'Unrelated member message', at: now },
]));
const goal: MonoManagerGoal = { id: 'goal', monoId: 'manager', projectId: project, managerId: 'manager-home', userMessageId: 'goal-user', requestId: 'goal-request', title: 'Finish chooser focus and preserve the existing navigation contract while checking commit 0123456789abcdef0123456789abcdef01234567', state: 'running', prUrls: [], createdAt: now, updatedAt: now };
const trees: Worktree[] = [project, `${project}/feature`, `${project}/empty`].map((path, index) => ({ path, branch: ["main", "feature", "empty"][index], head: "0123456789abcdef0123456789abcdef01234567", isMain: !index, locked: false, prunable: false, missing: false, dirty: false, unpushed: 0, sessionIds: [] }));
const sessions: Session[] = [
  ...roster.map(mono => ({ ...newSession("codex", project), id: mono.sessionId!, title: mono.name })),
  ...["task", "past-task", "older", "latest", "permission"].map((id, index) => ({ ...newSession("codex", project), id, title: ({ task: "Chooser focus", "past-task": "Earlier chooser review", older: "Older discussion", latest: "Latest discussion", permission: "Permission conversation" })[id]!, worktreeCwd: trees[1].path, providerSessionId: `retained-${id}`, blocks: [{ id: `${id}-user`, role: "user" as const, text: "Preserve this conversation", sentAt: now - 10000 + index * 1000 }] })),
];
const command = "git show 0123456789abcdef0123456789abcdef01234567";
sessions.find(row => row.id === "permission")!.blocks.push(...[1, 2].map(requestId => ({ id: `approval-${requestId}`, role: "tool" as const, text: command, approval: { requestId } })));
const runs: OrchestrationRun[] = [{ version: 2, allowedHarnesses: ["codex"], maxWorkers: 1, cli: "synthetic", continuations: 0, requests: {}, leadId: "manager-home", ownerMonoId: "manager", ownerSessionId: "manager-home", cwd: project, projectManager: true, status: "active", dispatches: [], tasks: ["task", "past-task"].map((id, index) => ({ id, memberId: "atlas", memberName: "Atlas", sessionId: id, title: index ? "Earlier chooser review" : "Chooser focus", prompt: "Preserve keyboard focus and report the result.", status: "completed", accepted: !!index, delivered: true, result: "", files: [], scopes: [], dependsOn: [], harness: "codex", model: "", workspace: { id: "feature", projectCwd: project, checkoutCwd: trees[1].path, kind: "worktree", branch: "feature" } })) }];
orchestrator.snapshot = () => runs; orchestrator.subscribe = () => () => {};
orchestrator.forSession = id => runs.find(run => run.tasks.some(task => task.sessionId === id));
orchestrator.run = id => runs.find(run => run.leadId === id);
const events: { action: string; value?: unknown }[] = [];
mockWindows("main");
mockIPC((command, args) => {
  if (command === "plugin:window|is_maximized") return false;
  if (command.startsWith("plugin:window|")) { events.push({ action: command, value: args }); return null; }
  if (command === "git_worktrees") return { defaultRoot: project, worktrees: trees };
  if (command === "git_diff_index") return { files: [], additions: 0, deletions: 0 };
  if (command === "git_pr_status") return null;
  if (command === "control_load") return JSON.stringify({ version: 1, goals: [goal], receipts: {} });
  if (command === "read_text_file") return JSON.stringify({ scripts: { dev: "vite", test: "vitest run", lint: "eslint ." } });
  if (command.includes("list") || command.includes("load") || command.includes("files")) return [];
  throw Error(`Blocked synthetic native operation: ${command}`);
}, { shouldMockEvents: true });
await monoManagerGoals.hydrate('manager');
const noop = () => {}, view: DecisionView = { pending: [], log: [], teamPending: 0, handledToday: 0, pruned: 0, skipped: 0 };
const decisionActions: DecisionUiActions = { answer: async () => ({ logFailed: false }), autonomy: async () => {}, openProject: noop };
let refresh = noop, focus: { path: string; branch: string | null } | undefined;
const tabs = [newTab("older"), newTab("latest"), newTab("task")];
const state = {
  tabs, sessions, projectCwd: project, sidebarCwd: project, projectWorktree: trees[1], history: [], orchestrationRuns: runs,
  activeTabId: tabs[1].id, active: sessions.find(row => row.id === "latest"), monoViewId: null as string | null,
  monoViewSession: undefined as Session | undefined, monoViewMono: undefined as Mono | undefined, monoViewTabId: undefined as string | undefined,
  monoCovers: false, openMonoTabs: ["atlas"], shownMonoTabs: ["atlas"],
  reusablePage: undefined as { page?: appViews.ShellPage; appView?: appViews.AppView } | undefined,
  pageTab: undefined as { page?: appViews.ShellPage; appView?: appViews.AppView } | undefined,
  activeAppView: undefined as appViews.AppView | undefined, settingsOpen: false, searchViewOpen: false, inboxViewOpen: false, notesViewOpen: false, automationsViewOpen: false,
  worktreeOverview: undefined as { project: string; tree: Worktree } | undefined,
  rightPanelOpen: true, rightPanelClosing: false, monoDetailsOpen: false,
};
const ports: Record<string, unknown> = {
  ...appViews, startTransition, DECISIONS_SCOPE, INTEGRATIONS_SCOPE, USAGE_DASHBOARD_SCOPE, ATTENTION_QUEUE_SCOPE, MISSION_CONTROL_SCOPE,
  leafIds, newTab, focusedFileTab, isTerminalTab, isFilesystemTab, previewWorkspaceFile, filterTabsForProject, findOpenSessionTab, isManagerTab, workspaceTabCwd,
  isBlankSession, sessionDisplayTitle, sessionNeedsInput, sessionWorkCwd, workbenchSessionTask, monoLiveState,
  findMono, monoForSession, listMonos, monoWorksOn, monoLook, monoState, sameProjectPath, normalizeProjectPath, looksLikeProject, isLocalProject, isRemoteProjectPath,
  loadRecents, projectRailItems, pathKey, projectName, basename, isEqualOrInside, orderByIds, worktreeSessionGroups, summaryFromSession, sessionActivityAt, orchestrator, packageScripts,
  remoteSessionFor: () => undefined, remotePendingWorktree: () => undefined,
  dirtyFiles: new Set(), unseenFinishedIds: new Set(), titleTabOrder: [], insetLayout: true, managerActive: false, NO_TITLE_TABS: [],
  monoRail: { states: new Map() }, sessionsRef: { current: sessions }, tabsRef: { current: tabs }, projectCwdRef: { current: project },
  monoViewIdRef: { current: null as string | null }, monoViewRequest: { current: 0 }, workspaceSessionRequest: { current: 0 }, lastMonoIdRef: { current: null },
  workerTaskTabs: { current: new Map<string, string>() }, workspacePins: { current: new Map() }, linkedSessionUpdatesRef: { current: new Map() },
  workspaceNavigation: { cancel: noop }, setRecents: noop, rememberProject: () => [], updateMono: noop, saveOpenMono: noop, saveMonoPermissions: noop,
  homeDir: "C:/synthetic/home", newDefaultSession: () => { throw Error("Opening a member must not create a session"); },
  setFilePickerOpen: noop,
  setPullRequestsViewScope: noop, setSearchViewFocusToken: noop,
  setMonoTeamRequest: noop, setMonoActivity: noop, setMonoSessions: noop, setMonoShownSession: noop, setMonoShownSessionFocused: noop, setMonoOverviewDocument: noop,
  setProjectTerminalFocused: noop, setComposerFocused: noop, setComposerFocusToken: noop, setMonoPanelTab: noop, setMonoArtifact: noop, setMonoChanges: noop, setWorkspaceContextTab: noop,
  ensureOpenSession: async (id: string) => sessions.find(row => row.id === id), ensureMonoSession: async (id: string) => sessions.find(row => row.id === findMono(id)?.sessionId),
  chooseProjectAddition: async () => ({ project }), sessionForProjectAddition: (session: Session) => session, persistSession: noop, isProjectManager: (id: string) => id === "manager-home",
  replaceBlankPaneWithSession: () => false, setSessions: noop,
  removingWorktreePaths: { current: new Set() }, worktreeFocus: () => focus, setWorktreeFocus: (_project: string, next: typeof focus) => { focus = next; state.projectWorktree = trees.find(tree => tree.path === (next?.path ?? project))!; },
  listWorktrees: async () => ({ defaultRoot: project, worktrees: trees }),
  ask: async () => window.confirm("Run this script in the selected checkout?"), openProjectTerminal: (cwd: string, command: string) => events.push({ action: "terminal", value: { cwd, command } }),
  loadNotesEnabled: () => true, rightPanelOpenRef: { current: true }, saveRightPanelOpen: noop,
};
const update = () => {
  state.monoViewSession = sessions.find(row => row.id === state.monoViewId);
  state.monoViewMono = state.monoViewSession && monoForSession(state.monoViewSession.id);
  state.monoViewTabId = state.monoViewMono && appViews.monoTabId(state.monoViewMono.id);
  state.monoCovers = !!state.monoViewSession;
  state.active = sessions.find(row => row.id === tabs.find(tab => tab.id === state.activeTabId)?.focusedId);
  state.activeAppView = state.searchViewOpen ? "search" : state.inboxViewOpen ? "inbox" : state.notesViewOpen ? "notes" : state.automationsViewOpen ? "automations" : undefined;
  state.shownMonoTabs = state.openMonoTabs; state.pageTab = state.reusablePage;
  refresh();
};
const set = <K extends keyof typeof state>(key: K, value: (typeof state)[K] | ((previous: (typeof state)[K]) => (typeof state)[K])) => {
  state[key] = typeof value === "function" ? (value as (previous: (typeof state)[K]) => (typeof state)[K])(state[key]) : value;
  update();
};
for (const key of Object.keys(state) as (keyof typeof state)[]) ports[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value: never) => set(key, value);
const activate = (id: string) => { state.activeTabId = id; state.monoViewId = null; (ports.monoViewIdRef as { current: string | null }).current = null; update(); };
Object.assign(ports, {
  activateTab: activate, setActiveTabId: activate, appendTab: (tab: typeof tabs[number]) => tabs.push(tab),
  focusOpenSession: (id: string) => { const tab = tabs.find(tab => tab.focusedId === id); if (!tab) return false; activate(tab.id); return true; },
  closeMonoView: () => { state.monoViewId = null; (ports.monoViewIdRef as { current: string | null }).current = null; update(); },
  tabWorkspace: (tab: typeof tabs[number], rows: Session[]) => chatTabWorktree(tab, rows, trees),
  createWorkspaceTab: (_project: string, workspace?: typeof focus) => { const session = { ...newSession("codex", project), worktreeCwd: workspace?.path }; sessions.push(session); const tab = newTab(session.id); tabs.push(tab); events.push({ action: "new-chat", value: session.id }); return tab.id; },
  rememberAppView: (appView: appViews.AppView) => { state.reusablePage = { appView }; },
  setRightPanelOpenState: (value: boolean) => { state.rightPanelOpen = value; (ports.rightPanelOpenRef as { current: boolean }).current = value; update(); },
  teamMap: { open: false, scope: undefined as string | undefined,
    show(scope?: string) { this.open = true; this.scope = scope; state.reusablePage = { page: scope === DECISIONS_SCOPE ? "decisions" : scope === INTEGRATIONS_SCOPE ? "integrations" : scope === USAGE_DASHBOARD_SCOPE ? "usage" : "commandMap" }; update(); },
    close() { this.open = false; update(); } },
});
const host = new Proxy(ports, { has: (target, key) => key in state || key in target, get: (target, key) => key in state ? state[key as keyof typeof state] : target[key as string], set: (target, key, value) => { target[key as string] = value; return true; } });
const routes = bindCCUX2(host);
const input = () => ({ roster, sessions, runs, goals: [] });
const callbacks: AttentionCallbacks = { inspect: id => { void routes.onSelectHistorySession(id); }, question: noop, repair: async () => {}, resume: noop, resumeAtReset: noop, retryDelivery: noop, continueManager: async () => {}, approval: (id, requestId, decision) => {
  events.push({ action: "approval", value: { id, requestId, decision } });
  const approval = sessions.find(session => session.id === id)?.blocks.find(block => block.approval?.requestId === requestId)?.approval;
  if (approval) approval.decided = decision; update();
} };
Object.assign(window, { ccux2: { state, routes, events, sessions, tabs, trees, command, zoom: applyUiScale } });
function Fixture() {
  const [, render] = useState(0); refresh = () => render(value => value + 1);
  const projection = routes.readTitle(), needs = selectNeedsUser(roster, sessions, runs, view, [], input());
  const title = projection.title;
  ports.displayedTabNavigation = { current: { tabs: title.tabs, activeId: title.activeId, select: routes.onSelectTitleTab } };
  const page = state.reusablePage?.page ?? state.reusablePage?.appView;
  const attention = <AttentionQueueView input={input()} readInput={input} callbacks={callbacks} open onClose={noop} presentation="panel" integrated items={needs.attention} />;
  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background-base text-content">
    <TitleBar {...title} inset onSelect={routes.onSelectTitleTab} onClose={routes.closeViewTab} onCloseMany={noop} onReorder={noop} onToggleSidebar={noop} />
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 overflow-auto border-r border-stroke p-2 max-[700px]:w-32">
        <WorkspaceTeam project={project} roster={roster} states={new Map(roster.map(mono => [mono.id, monoLiveState(roster, runs, sessions, mono.id)]))} activeId={state.monoViewMono?.id} onOpen={routes.onOpenMono} onCreate={noop} onDelete={noop} />
        <SearchableProjectPicker cwd={project} recents={[{ path: project, openedAt: 1 }]} onSelectProject={noop} />
        <WorktreeChats project={project} selectedPath={state.projectWorktree.path} sessions={sessions} history={[]} openSessions={sessions.filter(row => !isBlankSession(row)).map(row => ({ ...summaryFromSession(row), updatedAt: sessionActivityAt(row) }))} activeId={state.active?.id} unseen={new Set()} onSelect={tree => routes.onSelectProjectWorktree(project, tree)} onChat={routes.onSelectHistorySession} onNew={tree => routes.onNewWorktreeSession(project, tree)} onCreate={noop} />
        {([['Command map', undefined], ['Decisions', DECISIONS_SCOPE], ['Integrations', INTEGRATIONS_SCOPE], ['Usage', USAGE_DASHBOARD_SCOPE]] as const).map(([label, scope]) => <RailAction key={label} label={label} icon={CircleAlert} badge={label === 'Decisions' ? needs.count : undefined} onClick={() => routes.onOpenTeamMap(scope)} />)}
        {([['Inbox', routes.onOpenInbox], ['Notes', routes.onOpenNotes], ['Automations', routes.onOpenAutomations], ['Search', routes.onOpenSearch]] as const).map(([label, action]) => <RailAction key={label} label={label} icon={CircleAlert} onClick={action} />)}
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col overflow-auto">
        {projection.global ? page === 'decisions' ? <Decisions view={view} roster={roster} actions={decisionActions} attention={attention} attentionCount={needs.count} /> : page === 'commandMap' ? <TeamMap sessions={sessions} runs={runs} statuses={new Map()} onOpenMono={routes.onOpenMono} onClose={noop} /> : <h1 className="p-6">{title.tabs?.find(tab => tab.id === appViews.REUSABLE_PAGE_TAB_ID)?.title}</h1>
          : state.worktreeOverview ? <div className="m-auto p-6 text-center"><h1>{basename(state.worktreeOverview.tree.path)}</h1><p>No conversations here yet</p><button onClick={() => routes.onNewWorktreeSession(project, state.worktreeOverview!.tree)}>New chat here</button></div>
          : <div className="space-y-4 p-6"><h1 data-current-view>{state.monoViewMono?.name ?? state.active?.title}</h1><p>The selected conversation and its provider identity stay intact.</p><AgentMarkdown text="<details><summary>Command output</summary>\n\nRecovered command output; the final result passed.\n</details>" streaming={false} />
            <button onClick={() => routes.onSelectHistorySession('task')}>Open current assignment</button><button onClick={() => routes.onSelectHistorySession('past-task')}>Open previous assignment</button><button onClick={() => routes.onOpenMono('atlas')}>Tasks and history</button>
            {params.get('surface') === 'details' && <>
              <TeamMessage message={{ id: 'manager', name: 'Manager', mascot: 'fox', color: '#88aaff', topic: 'Chooser review', text: 'Finish the chooser review. ' + 'Keep navigation and focus stable. '.repeat(20) + '11111111-2222-3333-4444-555555555555' }} cwd={project} />
              <TaskMetricsLine metrics={{ turns: 1, elapsedMs: 840000, startedAt: now - 840000, endedAt: now, inputTokens: 1240, outputTokens: 240, partial: false }} state={{ status: 'waiting-review' }} />
              <MonoOrgActivity rootId="atlas" roster={roster} runs={runs} sessions={sessions} now={now} view="feed" />
              <AgentTranscript blocks={[{ id: 'user', role: 'user', text: 'Check chooser focus', startedAt: now - 840000, durationMs: 840000 }, ...Array.from({ length: 3 }, (_, index) => ({ id: `retry-${index}`, role: 'tool' as const, text: 'Temporary command failure', tool: { kind: 'shell', status: 'failed' as const, detail: 'Retry succeeded later' } })), { id: 'final', role: 'assistant', text: 'The final check passed.' }]} />
            </>}
          </div>}
      </main>
      {projection.contextVisible && <aside data-context-panel className="w-80 shrink-0 overflow-auto border-l border-stroke max-[900px]:w-56 max-[600px]:hidden">
        <WorkspaceGoals project={project} sessions={sessions} onOpenMono={routes.onOpenMono} />
        <WorkspaceWorktree project={project} path={state.projectWorktree.path} sessions={sessions} onOpen={tree => routes.onSelectProjectWorktree(project, tree)} onChanges={noop} onRemove={async () => {}} onRunScript={routes.onRunProjectScript} />
        <MonoTeamActivity monoId="manager" sessions={sessions} runs={runs} statuses={new Map()} onApproval={callbacks.approval} onQuestion={noop} onQuestionInteraction={noop} />
      </aside>}
    </div>
  </div>;
}
update();
createRoot(document.getElementById("root")!).render(<Fixture />);
