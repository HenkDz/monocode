import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { bindWorkbenchApp, followUpBehavior } from "virtual:ccwb1-app";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import {
  SessionPane,
  type SessionPaneProps,
} from "../../src/features/sessions/ui/SessionPane";
import { publishCardSessions } from "../../src/features/monos/model/monoCards";
import {
  findMono,
  monoForSession,
  listMonos,
  type Mono,
} from "../../src/features/monos/model/mono";
import {
  newSession,
  type Session,
} from "../../src/features/sessions/model/session";
import { selectAgentLiveState } from "../../src/features/agents/model/agentLiveState";
import { selectTaskMetrics } from "../../src/features/agents/model/agentMetrics";
import { workbenchSessionTask } from "../../src/features/monos/model/monoNavigation";
import {
  orchestrator,
  type OrchestrationRun,
} from "../../src/features/orchestration/model/orchestration";
import { newTab } from "../../src/features/workspace/model/layout";
import * as visits from "../../src/features/workspace/model/tabVisitHistory";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
const project = "C:/synthetic/BrowserLink",
  checkout = `${project}/gpui-v4`;
const member: Mono = {
  id: "iris",
  sessionId: "iris-home",
  name: "Iris",
  role: "member",
  specialty: "Design",
  projects: [project],
  mascot: "cat",
  color: "#b8abd2",
};
localStorage.setItem("monocode:mono-roster", JSON.stringify([member]));
const home: Session = {
  ...newSession("codex", "C:/synthetic/member-home"),
  id: member.sessionId!,
  title: "Iris",
  model: "codex:fixture",
};
const other: Session = {
  ...newSession("codex", "C:/synthetic/OtherProject"),
  id: "other-session",
  title: "Other project",
};
const worker: Session = {
  ...newSession("codex", project),
  id: "task-session",
  title: "Iris task",
  worktreeCwd: checkout,
  model: "codex:fixture",
  busy: true,
  blocks: [
    {
      id: "assignment",
      role: "user",
      text: "Review the existing profile flow and prepare a proposal.",
      startedAt: Date.now() - 263_000,
      turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
      turnMetrics: { inputTokens: 8400, outputTokens: 1200 },
    },
    {
      id: "progress",
      role: "assistant",
      text: "I will check the profile list and switching behavior, then map the controls to the existing settings flow.",
    },
    {
      id: "read",
      role: "tool",
      text: "Read profile settings",
      tool: {
        kind: "shell",
        title: "Read profile settings",
        status: "running",
        detail: "Inspecting saved profile settings",
      },
    },
  ],
};
const status = params.get("state") ?? "running";
if (status === "queued") {
  worker.busy = false;
  worker.blocks = [];
}
if (status === "blocked")
  worker.codexStorageError = "Synthetic storage unavailable";
if (status === "approval")
  worker.blocks.push({
    id: "approval",
    role: "approval",
    text: "printf 'verbatim approval'",
    approval: { requestId: 42 },
  });
if (params.get("checkout") === "removed") worker.worktreeRemoved = true;
const task = {
  id: "profile-task",
  memberId: member.id,
  memberName: member.name,
  sessionId: worker.id,
  title: "Design profile management for Browser Link",
  prompt: Array(5)
    .fill(
      "Review Browser Link's existing profile management flow and propose a clear way to create, edit and switch profiles. Preserve inherited changes and current routing behavior.",
    )
    .join("\n\n"),
  harness: "codex",
  model: worker.model,
  files: [],
  scopes: [],
  dependsOn: [],
  status: status === "queued" ? "queued" : "running",
  readOnly: true,
  workspace: {
    id: "checkout",
    projectCwd: project,
    checkoutCwd: checkout,
    kind: "worktree",
    branch: "gpui-v4",
  },
  checkoutBaseline: {
    inheritedChangedPaths: Array.from({ length: 9 }, (_, i) => `file-${i}`),
  },
  result:
    "### Profile flow review\n\nThe existing list can support a compact default profile treatment.\n\n" +
    Array(18)
      .fill(
        "Review edit and unavailable states against the current settings flow.",
      )
      .join("\n\n"),
  reportArtifactId: "profile-report",
} as OrchestrationRun["tasks"][number];
const dispatch = {
  id: "dispatch",
  taskId: task.id,
  sessionId: worker.id,
  startedAt: Date.now() - 263_000,
  turnBlockId: "assignment",
  turnStartedAt: status === "queued" ? undefined : worker.blocks[0].startedAt,
  state: task.status,
  stage: status === "queued" ? "accepted" : "dispatched",
  workspace: task.workspace,
};
const run = {
  leadId: "manager",
  ownerSessionId: "manager-home",
  projectManager: true,
  tasks: [task],
  dispatches: [dispatch],
  status: "active",
  cwd: project,
} as unknown as OrchestrationRun;
task.activeDispatchId = dispatch.id;
const runs = status === "none" ? [] : [run];
Object.assign(orchestrator, {
  snapshot: () => runs,
  hydrate: async () => {},
  forSession: () => run,
  run: () => run,
});
const events: object[] = [];
let folderMissing = params.get("checkout") === "absent";
let deferFolder = false;
let finishFolder: (() => void) | undefined;
const rejectProvider = async () => {
  throw Error("Fixture must never call a provider");
};
registerHarness({
  id: "codex",
  live: true,
  canSteer: params.get("supports") !== "no",
  sendTurn: rejectProvider,
  steerTurn: rejectProvider,
  cancelTurn: rejectProvider,
  respondApproval: () => {},
  stopSession: rejectProvider,
  forgetSession: async () => {},
  bindSession: () => {},
});
setHarnessModels("codex", [
  { id: worker.model, harness: "codex", name: "Fixture Codex", settings: [] },
]);
mockWindows("main");
mockIPC(
  (command, args) => {
    if (command === "list_dir") {
      events.push({ action: "folder-check", args });
      if (folderMissing || args?.path !== checkout)
        throw Error("Checkout missing");
      if (deferFolder)
        return new Promise((resolve) => {
          finishFolder = () => resolve([]);
        });
      return [];
    }
    if (command === "reveal_path") {
      events.push({ action: "open-folder", args });
      return null;
    }
    if (command === "git_branches")
      return { current: "gpui-v4", local: [], remote: [] };
    if (command === "git_diff_index")
      return { files: [], additions: 0, deletions: 0 };
    if (command === "org_artifacts_list")
      return [{ id: "profile-report", name: "profile-management-review.md" }];
    if (
      [
        "git_nested_worktrees",
        "list_project_files",
        "list_external_editors",
        "list_skills",
        "list_agent_files",
        "list_automations",
        "git_pr_list",
      ].includes(command)
    )
      return [];
    return null;
  },
  { shouldMockEvents: true },
);
const noop = () => {};
const tabs = [newTab("other-session")];
let refresh = noop;
const host: any = {
  workbenchSessionTask, workerTaskTabs: { current: new Map() }, setOpenMonoTabs: noop,
  ...visits,
  monoForSession,
  findMono,
  listMonos,
  newTab,
  tabs,
  tabsRef: { current: tabs },
  sessionsRef: { current: [home, worker, other] },
  activeTabId: tabs[0].id,
  activeTabIdRef: { current: tabs[0].id },
  monoViewId: home.id,
  monoViewIdRef: { current: home.id },
  tabVisitRef: { current: visits.emptyTabVisitHistory(tabs[0].id) },
  tabVisitFromHistoryRef: { current: false },
  workspaceSessionRequest: { current: 0 },
  monoViewRequest: { current: 0 },
  lastMonoIdRef: { current: member.id },
  teamMap: { close: noop },
  workspaceNavigation: { cancel: noop },
  workspacePins: { current: new Map() },
  linkedSessionUpdatesRef: { current: new Map() },
  ensureOpenSession: async (id: string) =>
    [home, worker, other].find((session) => session.id === id),
  ensureMonoSession: async () => home,
  updateMono: noop,
  saveMonoPermissions: noop,
  homeDir: "C:/synthetic",
  newDefaultSession: () => {
    throw Error("No new sessions");
  },
  setMonoTeamRequest: noop,
  setWorktreeOverview: noop,
  setMonoActivity: noop,
  setMonoSessions: noop,
  setMonoShownSessionFocused: noop,
  setMonoShownSession: noop,
  setMonoOverviewDocument: noop,
  saveOpenMono: noop,
  setProjectTerminalFocused: noop,
  setComposerFocused: noop,
  setComposerFocusToken: noop,
  setMonoViewId(id: string) {
    host.monoViewId = id;
    host.recordVisit();
    refresh();
  },
  commitTabVisit(next: visits.TabVisitHistory) {
    host.tabVisitRef.current = next;
  },
  setActiveTabId(id: string) {
    host.activeTabId = id;
    host.activeTabIdRef.current = id;
    host.monoViewId = null;
    host.monoViewIdRef.current = null;
    host.recordVisit();
    refresh();
  },
  activateTab(id: string) {
    host.setActiveTabId(id);
  },
  appendTab(tab: (typeof tabs)[number]) {
    tabs.push(tab);
  },
  focusOpenSession(id: string) {
    const tab = tabs.find((tab) => tab.focusedId === id);
    if (!tab) return false;
    host.setActiveTabId(tab.id);
    return true;
  },
  replaceBlankPaneWithSession: () => false,
  looksLikeProject: () => true,
  chooseProjectAddition: async () => ({ project }),
  projectRailItems: () => [],
  loadRecents: () => [],
  sessionForProjectAddition: (session: Session) => session,
  setRecents: noop,
  rememberProject: () => [],
  isProjectManager: () => false,
  normalizeProjectPath: (path: string) => path,
  setProjectCwd: noop,
  setSearchViewOpen: noop,
  setInboxViewOpen: noop,
  setNotesViewOpen: noop,
  setAutomationsViewOpen: noop,
  setSettingsOpen: noop,
  settingsOpen: false,
  searchViewOpen: false,
  inboxViewOpen: false,
  notesViewOpen: false,
  automationsViewOpen: false,
  onCloseSettings: noop,
  closeMonoView() {
    host.monoViewIdRef.current = null;
    host.monoViewId = null;
    host.recordVisit();
    refresh();
  },
  orchestrator,
  persistSession: noop,
  setSessions: noop,
};
bindWorkbenchApp(host);
host.recordVisit();
publishCardSessions(
  [
    {
      id: worker.id,
      title: worker.title,
      harness: worker.harness,
      busy: !!worker.busy,
      needsInput: status === "approval",
      liveState: selectAgentLiveState(worker, { task }),
      taskMetrics: {
        [task.id]: selectTaskMetrics(task, run.dispatches, [worker]),
      },
    },
  ],
  (id) => {
    events.push({ action: "navigate", id });
    if (id === home.id) void host.onOpenMono(member.id);
    else void host.onSelectHistorySession(id);
  },
);
function Fixture() {
  const [, update] = useState(0);
  refresh = () => update((value) => value + 1);
  const session = host.monoViewId
    ? home
    : ([home, worker, other].find(
        (session) =>
          tabs.find((tab) => tab.id === host.activeTabId)?.focusedId ===
          session.id,
      ) ?? home);
  const props: SessionPaneProps = {
    session,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: (id, text, _attachments, options) => {
      events.push({
        action: "submit",
        id,
        text,
        options,
        behavior: followUpBehavior(
          [home, worker, other].find((session) => session.id === id),
          id === home.id ? member : undefined,
          options,
          true,
          undefined,
          { matched: false },
        ),
      });
      return false;
    },
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: (id) => events.push({ action: "stop", id }),
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: (id, requestId, decision) =>
      events.push({ action: "approval", id, requestId, decision }),
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
    onCodexStorageRepair: async () => {},
  };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <nav style={{ display: "flex", gap: 16, padding: 10, fontSize: 12 }}>
        <button onClick={host.onRailBack}>Back</button>
        <button onClick={host.onRailForward}>Forward</button>
        <span data-view>
          {session.id} · {session.worktreeCwd ?? session.cwd}
        </span>
      </nav>
      {[home, worker, other].map((entry) => (
        <div
          key={entry.id}
          style={{
            display: entry === session ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <SessionPane
            {...props}
            session={entry}
            visible={entry === session}
            focused={entry === session}
          />
        </div>
      ))}
    </div>
  );
}
Object.assign(window, {
  ccwb1: {
    events,
    host,
    removeFolder: () => {
      folderMissing = true;
    },
    deferFolderCheck: () => {
      deferFolder = true;
    },
    finishFolderCheck: () => {
      deferFolder = false;
      finishFolder?.();
    },
    ownBusy: () => {
      home.busy = true;
      home.blocks = [
        {
          id: "home-turn",
          role: "user",
          text: "Home conversation",
          startedAt: Date.now(),
        },
      ];
      refresh();
    },
  },
});
createRoot(document.getElementById("root")!).render(<Fixture />);
