import { startTransition, useEffect, useState } from "react";
// @ts-expect-error supplied by the source-bound fixture Vite plugin
import { bindVisionApp } from "virtual:ccvision-app";
import { TitleBar } from "../../src/app/shell/TitleBar";
import { resolveAppShortcut } from "../../src/features/settings/model/appShortcuts";
import { loadRightPanelOpen, saveRightPanelOpen } from "../../src/features/settings/model/appearance";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Sidebar } from "../../src/app/shell/Sidebar";
import {
  WorkspaceContextTabs,
  WorkspaceGoals,
  WorkspaceWorktree,
  WorkspaceWorktrees,
  WorkspaceUsage,
  type WorkspaceContextTab,
} from "../../src/app/shell/WorkspaceContext";
import { monoLiveState } from "../../src/features/monos/model/monoNavigation";
import { findMono, monoLook, monoState, listMonos, type Mono } from "../../src/features/monos/model/mono";
import {
  monoManagerGoals,
  type MonoManagerGoal,
} from "../../src/features/monos/model/monoManagerGoals";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type { OrchestrationRun } from "../../src/features/orchestration/model/orchestrationState";
import {
  newSession,
  type Session,
} from "../../src/features/sessions/model/session";
import {
  SessionPane,
  type SessionPaneProps,
} from "../../src/features/sessions/ui/SessionPane";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import { recordPullRequest } from "../../src/features/source-control/model/pullRequests";
import type { UsageDashboardSnapshot } from "../../src/features/providers/model/usageDashboard";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const empty = params.has("empty");
const project = "C:/synthetic/browser-link-4";
const second = "C:/synthetic/empty-project";
const events: { action: string; value?: unknown }[] = [];
Object.assign(window, { visionFixture: { events } });
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
const mono = (
  id: string,
  role: Mono["role"],
  mascot: string,
  extra: Partial<Mono> = {},
): Mono => ({
  id,
  name: id,
  role,
  mascot,
  color: "#7aa2ff",
  projects: [project],
  sessionId: `${id}-chat`,
  ...extra,
});
const roster = [
  mono("Boss", "orchestrator", "owl", { projects: [] }),
  ...(empty
    ? []
    : [
        mono("Manager", "manager", "fox", {
          reportsTo: "Boss",
          managerProject: project,
          managerEngineId: "Manager-chat",
        }),
        mono("Atlas", "member", "cat", { reportsTo: "Manager" }),
        mono("Sentinel", "member", "dragon", {
          reportsTo: "Manager",
          color: "#eab308",
        }),
        mono("Iris", "member", "bunny", {
          reportsTo: "Manager",
          color: "#f472b6",
        }),
      ]),
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
setHarnessModels("codex", [
  {
    id: "codex:synthetic",
    harness: "codex",
    name: "Synthetic model",
    settings: [],
  },
]);
const rejectLiveTurn = async () => {
  throw Error("Fixture has no live provider.");
};
registerHarness({
  id: "codex",
  live: true,
  canSteer: true,
  sendTurn: rejectLiveTurn,
  steerTurn: rejectLiveTurn,
  cancelTurn: rejectLiveTurn,
  respondApproval: () => {},
  stopSession: async () => {},
  forgetSession: async () => {},
  bindSession: () => {},
});
const sessions: Session[] = roster.map((mono) => ({
  ...newSession("codex", project, "codex:synthetic"),
  id: mono.sessionId!,
  title: `${mono.name} chat`,
  busy: mono.id === "Atlas",
  blocks: [],
}));
const managerSession =
  sessions.find((session) => session.id === "Manager-chat") ?? sessions[0];
managerSession.blocks = [
  {
    id: "user",
    role: "user",
    text: "How is the chooser coming along?",
    sentAt: Date.now() - 70000,
  },
  {
    id: "answer",
    role: "assistant",
    text: "The chooser implementation is ready for review. Atlas is finishing keyboard focus, and Sentinel reviews the saved change next. Merging remains your decision.",
    streaming: false,
    startedAt: Date.now() - 69000,
    finishedAt: Date.now() - 1000,
  },
];
const trees: Worktree[] = [
  {
    path: project,
    branch: "main",
    head: "base",
    isMain: true,
    locked: false,
    prunable: false,
    missing: false,
    dirty: false,
    unpushed: 0,
    sessionIds: [],
  },
  ...(empty
    ? []
    : [
        {
          path: `${project}/chooser`,
          branch: "feat/chooser-dialog",
          head: "accepted-head",
          isMain: false,
          locked: false,
          prunable: false,
          missing: false,
          dirty: false,
          unpushed: 0,
          sessionIds: ["Atlas-chat"],
        },
        {
          path: `${project}/spike`,
          branch: "spike/profile-catalog",
          head: "spike-head",
          isMain: false,
          locked: false,
          prunable: false,
          missing: false,
          dirty: true,
          unpushed: 1,
          sessionIds: [],
        },
      ]),
];
const tasks = empty
  ? []
  : [
      {
        id: "chooser",
        memberId: "Atlas",
        memberName: "Atlas",
        sessionId: "Atlas-chat",
        title: "Chooser dialog: Escape and focus return",
        monoGoalId: "goal",
        status: "running",
        workspace: {
          id: "chooser",
          projectCwd: project,
          checkoutCwd: trees[1].path,
          branch: trees[1].branch,
          kind: "worktree",
        },
        accepted: false,
      },
      {
        id: "review",
        memberId: "Sentinel",
        memberName: "Sentinel",
        sessionId: "Sentinel-chat",
        title: "Review chooser change",
        monoGoalId: "goal",
        status: "queued",
        dependsOn: ["chooser"],
        accepted: false,
      },
      {
        id: "spec",
        memberId: "Iris",
        memberName: "Iris",
        sessionId: "Iris-chat",
        title: "Chooser interaction specification",
        monoGoalId: "goal",
        status: "completed",
        accepted: true,
      },
    ];
const runs = (
  empty
    ? []
    : [
        {
          leadId: "Manager-chat",
          ownerMonoId: "Manager",
          projectManager: true,
          cwd: project,
          status: params.has("paused") ? "paused" : "active",
          lastPauseReason: params.has("paused") ? "Owner paused this run" : undefined,
          tasks,
          dispatches: [],
        },
      ]
) as OrchestrationRun[];
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};
const goal: MonoManagerGoal = {
  id: "goal",
  monoId: "Boss",
  projectId: project,
  managerId: "Manager-chat",
  userMessageId: "user",
  requestId: "request",
  title: "Profile routing and one-time Open with chooser",
  state: "running",
  prUrls: [],
  createdAt: Date.now() - 100000,
  updatedAt: Date.now(),
};
const pr = {
  number: 41,
  title: "Preserve chooser keyboard focus",
  url: "https://github.com/example/fixture/pull/41",
  state: "open",
  headOid: "accepted-head",
  headRefName: "feat/chooser-dialog",
  baseRefName: "main",
  reviewDecision: "APPROVED",
  checksStatus: "success" as const,
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  additions: 38,
  deletions: 12,
};
mockWindows("main");
mockIPC(
  (command, args) => {
    if (command === "plugin:window|is_maximized") return false;
    if (["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"].includes(command)) { events.push({ action: command }); return null; }
    if (command === "control_load")
      return JSON.stringify({
        version: 1,
        goals: empty ? [] : [goal],
        receipts: {},
      });
    if (command === "git_worktrees")
      return {
        defaultRoot: project,
        worktrees: (args as { cwd: string }).cwd === second ? [] : trees,
      };
    if (command === "git_pr_list")
      return (args as { cwd: string }).cwd === trees[1]?.path ? [pr] : [];
    if (command === "git_pr_status" || command === "git_pr_status_by_url")
      return (args as { cwd: string }).cwd === trees[1]?.path ? pr : null;
    if (command === "git_diff_index")
      return {
        branch: "feat/chooser-dialog",
        head: "accepted-head",
        files: [
          {
            path: "src/chooser.tsx",
            additions: 22,
            deletions: 8,
            staged: false,
            unstaged: true,
            status: "modified",
          },
          {
            path: "src/focus.ts",
            additions: 16,
            deletions: 4,
            staged: false,
            unstaged: true,
            status: "modified",
          },
        ],
        additions: 38,
        deletions: 12,
        remote: "origin",
        upstream: "origin/feat/chooser-dialog",
        defaultBranch: "main",
        ahead: 2,
        behind: 1,
        aheadOfDefault: 2,
        headPushed: true,
      };
    if (command === "git_diff_stats")
      return { files: 2, additions: 38, deletions: 12, untracked: 0 };
    if (
      [
        "git_nested_worktrees",
        "list_dir",
        "list_external_editors",
        "list_project_files",
        "list_skills",
        "list_agent_files",
        "list_automations",
        "list_harness_accounts",
      ].includes(command)
    )
      return [];
    if (command === "git_branches")
      return { current: "main", detached: false, branches: [] };
    if (
      command.includes("remove") ||
      command.includes("create") ||
      command.includes("action") ||
      command.includes("send") ||
      command.includes("save")
    ) {
      events.push({ action: `blocked:${command}`, value: args });
      throw Error("Fixture blocks mutations and providers.");
    }
    return null;
  },
  { shouldMockEvents: true },
);
if (!empty)
  recordPullRequest(trees[1].path, pr, {
    sessionId: "Atlas-chat",
    sessionTitle: "Atlas",
    turnId: "answer",
    blockId: "pr",
    at: Date.now(),
    taskId: "chooser",
    acceptedHead: pr.headOid,
  });
await monoManagerGoals.hydrate("Boss");
const usage: UsageDashboardSnapshot = {
  now: Date.now(),
  unknownAssignments: [],
  groups: [
    {
      provider: "codex",
      label: "Codex",
      poolNote: "",
      accounts: empty
        ? []
        : [
            {
              key: "codex:studio",
              provider: "codex",
              accountId: "studio",
              label: "Studio",
              freshness: "fresh",
              status: { tone: "ready", label: "Ready", detail: null },
              limits: { weekly: { usedPercent: 38 } } as never,
              assignments: [
                {
                  monoId: "Manager",
                  name: "Manager",
                  sessionId: "Manager-chat",
                  kind: "home",
                  state: "idle",
                },
              ],
            },
          ],
    },
  ],
};
const noop = () => {};
function Fixture() {
  const [cwd, setCwd] = useState(project);
  const [selected, setSelected] = useState<string>();
  const [context, setContext] = useState<WorkspaceContextTab>("goal");
  const [, refresh] = useState(0);
  const [app] = useState(() => {
    const host: any = {
      insetLayout: true, insetLayoutRef: { current: true }, settingsOpen: false, activeAppView: undefined,
      chromeSurfaceOpen: false, setWorktreeOverview: noop,
      sidebarCwd: project, looksLikeProject: (path: string) => path.startsWith("C:/synthetic/"),
      rightPanelOpen: loadRightPanelOpen(), rightPanelClosing: false,
      rightPanelOpenRef: { current: loadRightPanelOpen() }, rightPanelToggleRef: { current: null },
      saveRightPanelOpen, onToggleSessionSidebar: noop,
      setRightPanelOpenState(value: boolean) { host.rightPanelOpen = value; refresh(n => n + 1); },
      setRightPanelClosing(value: boolean) { host.rightPanelClosing = value; refresh(n => n + 1); },
      actions: { current: {} }, resolveAppShortcut, run: (_name: string, callback: () => void) => callback(),
      monoLook, monoState, monoCovers: true, monoViewMono: undefined, monoViewSession: undefined,
      monoRail: { states: new Map() }, teamMap: { open: false, close: noop },
      monoSidebarOpen: false, monoDetailsPanel: null, monoOverviewOpen: false, monoOverviewPanel: null,
      monoViewId: managerSession.id, monoViewIdRef: { current: managerSession.id },
      monoViewRequest: { current: 0 }, workspaceSessionRequest: { current: 0 }, lastMonoIdRef: { current: "Manager" },
      workspaceNavigation: { cancel: noop }, sessionsRef: { current: sessions }, homeDir: "C:/synthetic",
      findMono, updateMono: noop, saveMonoPermissions: noop, saveOpenMono: noop,
      ensureOpenSession: async (id: string) => sessions.find(session => session.id === id),
      ensureMonoSession: async (id: string) => sessions.find(session => session.id === findMono(id)?.sessionId),
      newDefaultSession: () => { throw Error("Fixture cannot create sessions"); },
      setMonoTeamRequest: noop, setMonoActivity: noop, setSettingsOpen: noop,
      setMonoShownSession: noop, setMonoShownSessionFocused: noop, setMonoOverviewDocument: noop,
      startTransition, rememberAppView: noop, setFilePickerOpen: noop, setSearchViewFocusToken: noop,
      closeMonoView() { host.monoViewId = null; host.monoViewIdRef.current = null; refresh(n => n + 1); },
      setSearchViewOpen(open: boolean) { host.activeAppView = open ? "search" : undefined; refresh(n => n + 1); },
      setInboxViewOpen: noop, setNotesViewOpen: noop, setAutomationsViewOpen: noop,
      setProjectTerminalFocused: noop, setComposerFocused: noop, setComposerFocusToken: noop,
      setOpenMonoTabs: noop, setSessions: noop,
      setMonoViewId(id: string) {
        host.monoViewId = id;
        setDestination(roster.find(mono => mono.sessionId === id)?.id ?? id);
        refresh(n => n + 1);
      },
    };
    return bindVisionApp(host);
  });
  app.sidebarCwd = cwd;
  app.monoViewSession = sessions.find(session => session.id === app.monoViewId);
  app.monoViewMono = roster.find(mono => mono.sessionId === app.monoViewId);
  const production = app.contextState();
  const contextOpen = production.shown;
  const setContextOpen = (open: boolean) => { if (app.rightPanelOpen !== open) app.onToggleRightPanel(); };
  useEffect(() => {
    window.addEventListener("keydown", app.keydown, true);
    return () => window.removeEventListener("keydown", app.keydown, true);
  }, [app]);
  useEffect(() => {
    if (!app.rightPanelClosing) return;
    // The synthetic shell finishes the real callback's close transition on the next frame.
    const frame = requestAnimationFrame(() => app.setRightPanelClosing(false));
    return () => cancelAnimationFrame(frame);
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [destination, setDestination] = useState("Manager");
  const route = (action: string, value?: unknown) => {
    events.push({ action, value });
    if (action === "mono") void app.onOpenMono(String(value));
    else setDestination(String(value ?? action));
  };
  const states = new Map(
    listMonos().map((mono) => [
      mono.id,
      monoLiveState(listMonos(), runs, sessions, mono.id),
    ]),
  );
  const pane: SessionPaneProps = {
    session: app.monoViewSession ?? managerSession,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    hideProjectPicker: true,
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: (_id, text, _attachments, options) => {
      route("submit", { text, options });
      return false;
    },
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: noop,
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
  return (
    <div className="vision-shell">
      <TitleBar {...production.title} tabs={[]} activeId={app.monoViewId} cwd={cwd}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} onSelect={noop} onClose={noop} onCloseMany={noop} onReorder={noop} />
      <div className="vision-body">
        <Sidebar
          cwd={cwd}
          open={sidebarOpen}
          inset
          titleBarAbove
          projectRailOpen={false}
          compactProjectRail={false}
          sessions={[]}
          openSessions={[]}
          busySessionIds={new Set()}
          approvalSessionIds={new Set()}
          status="idle"
          pending={false}
          tab="sessions"
          filesSearchOpen={false}
          onTabChange={noop}
          onFilesSearchOpenChange={noop}
          onSelectSession={(id) => route("chat", id)}
          onOpenFile={noop}
          recents={[
            { path: project, openedAt: 1 },
            { path: second, openedAt: 1 },
          ]}
          onSelectProject={(path) => {
            setCwd(path);
            setSelected(undefined);
            route("project", path);
          }}
          onOpenProject={() => route("open-project")}
          onSearch={app.onOpenSearch}
          onOpenTeamMap={() => route("command-map")}
          onOpenAttentionQueue={() => route("decisions")}
          onOpenInbox={() => route("inbox")}
          onOpenNotes={() => route("notes")}
          onOpenAutomations={() => route("automations")}
          onOpenUsage={() => route("usage")}
          onNew={() => route("new-chat")}
          monos={{
            states,
            activeId: destination,
            onOpen: (id) => route("mono", id),
            onCreate: () => route("new-mono"),
            onDelete: noop,
          }}
          projectStatus={
            cwd === project && !empty
              ? "1 working · 0 decisions"
              : "0 working · 0 decisions"
          }
          decisionCounts={new Map()}
          workspaceUsage={
            <WorkspaceUsage
              snapshot={usage}
              monoIds={new Set(["Manager"])}
              compact
            />
          }
          workspaceWorktrees={
            <WorkspaceWorktrees
              project={cwd}
              sessions={sessions}
              selectedPath={selected}
              onNew={() => route("new-worktree")}
              onSelect={(tree) => {
                setSelected(tree.path);
                setContext("worktree");
                setContextOpen(true);
              }}
            />
          }
        />
        <main className="vision-main" data-app-view={app.activeAppView ?? "conversation"}>
          <div className="vision-manager">
            {destination}
            <small data-active-session={pane.session.id}>Production App Mono callback · synthetic sessions</small>
          </div>
          <SessionPane {...pane} />
        </main>
        {contextOpen && (
          <aside className="vision-context">
            <WorkspaceContextTabs
              tab={context}
              onChange={setContext}
              onClose={() => setContextOpen(false)}
            >
              {context === "goal" ? (
                <WorkspaceGoals
                  project={cwd}
                  sessions={sessions}
                  usage={usage}
                  onOpenMono={(id) => route("mono", id)}
                />
              ) : context === "worktree" ? (
                <WorkspaceWorktree
                  project={cwd}
                  path={selected}
                  sessions={sessions}
                  onOpen={(tree) => route("open-worktree", tree.branch)}
                  onChanges={() => route("changes")}
                  onRemove={async () => {
                    throw Error("No real deletion in fixture");
                  }}
                />
              ) : (
                <p>Existing Files & changes portal</p>
              )}
            </WorkspaceContextTabs>
          </aside>
        )}
      </div>
      <style>{`.vision-shell{height:100dvh;display:flex;flex-direction:column;overflow:hidden;background:var(--color-background-base);color:var(--color-content);font:13px/1.5 var(--font-sans)}.vision-title{height:38px;display:flex;align-items:center;gap:20px;padding:0 12px;border-bottom:1px solid var(--color-stroke);font-size:11px;flex:none}.vision-title button:last-child{margin-left:auto}.vision-body{position:relative;display:flex;flex:1;min-height:0;min-width:0}.vision-main{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--color-stroke);border-radius:10px 0 0 0;overflow:hidden}.vision-main>section{flex:1;min-height:0}.vision-manager{padding:16px 24px;border-bottom:1px solid var(--color-stroke);font-weight:600}.vision-manager small{display:block;font-size:10px;font-weight:400;color:color-mix(in srgb,var(--color-content) 45%,transparent)}.vision-context{width:320px;display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--color-stroke);background:var(--color-background-base)}@media(max-width:900px){.vision-context{position:absolute;inset:0 0 0 auto;z-index:20;max-width:100%}}@media(max-width:600px){.vision-title span{display:none}}`}</style>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
