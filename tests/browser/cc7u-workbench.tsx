import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import {
  SessionPane,
  type SessionPaneProps,
} from "../../src/features/sessions/ui/SessionPane";
import { MonoRailSection } from "../../src/app/shell/MonoRailSection";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import { ProjectManagerRow } from "../../src/features/orchestration/ui/ProjectManagerRow";
import { ProjectWorktrees } from "../../src/features/source-control/ui/ProjectWorktrees";
import type { Mono } from "../../src/features/monos/model/mono";
import { OrchestrationActions } from "../../src/features/orchestration/ui/OrchestrationActions";
import { publishCardSessions } from "../../src/features/monos/model/monoCards";
import { recordCrewMessage } from "../../src/features/monos/model/monoCrewEvents";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../src/features/orchestration/model/orchestrationState";
import type { Block, Session } from "../../src/features/sessions/model/session";
import type { SessionSummary } from "../../src/features/sessions/data/sessionStore";
import { setComposerDraft } from "../../src/features/sessions/model/draftCache";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { selectAgentLiveState } from "../../src/features/agents/model/agentLiveState";
import type { AgentLiveState } from "../../src/features/agents/model/agentLiveState";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const drawerStress = params.get("drawerStress") === "yes";
const scenario = params.get("scenario") ?? "failed";
const historicalSession = params.get("kind") === "historical-session";
const workerSession = params.get("kind") === "session" || historicalSession;
const waiting = scenario === "waiting";
const working = scenario === "working";
const approval = params.get("approval") === "yes";
const child = params.get("child") === "yes";
const queued = params.get("queue") === "yes";
const approvalCommand =
  "printf '%s\\n' '<monocode_context>keep the exact command</monocode_context>'";
const zero = scenario === "zero";
const memberName = waiting || working ? "Native Core" : "Reviewer";
const now = Date.now();
const cwd = "C:/synthetic/BrowserLink";
const sessionId = historicalSession
  ? "old-review-worker"
  : workerSession
    ? "review-worker"
    : "member-conversation";
const events: { action: string; text?: string; options?: unknown }[] = [];
const rejectLiveTurn = async () => {
  throw Error("Synthetic fixture never sends provider turns.");
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
Object.assign(window, { workbenchFixture: { events } });
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
setHarnessModels(
  "codex",
  ["GPT-5.4", "GPT-5.3 Codex"].map((name, i) => ({
    id: i ? "codex:gpt-5.3-codex" : "codex:gpt-5.4",
    harness: "codex",
    name,
    settings: [
      {
        id: "reasoningEffort",
        label: "Reasoning effort",
        kind: "select",
        value: "high",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      },
    ],
  })),
);
const member: Mono = {
  id: "member",
  role: "member",
  reportsTo: "manager",
  name: memberName,
  specialty: waiting || working ? "Windows engineering" : "Quality & safety",
  reviewer: !waiting && !working,
  projects: [cwd],
  mascot: "cat",
  color: "#fcd34d",
  sessionId: workerSession ? "member-saved-conversation" : sessionId,
};
const grand: Mono = {
  ...member,
  id: "grand",
  role: "orchestrator",
  name: "GRAND ORCH",
  reportsTo: undefined,
  sessionId: "grand-conversation",
  mascot: "owl",
  color: "#7dd3fc",
};
const manager: Mono = {
  ...member,
  id: "manager",
  role: "manager",
  reportsTo: "grand",
  name: "Manager",
  sessionId: "manager-conversation",
  managerProject: cwd,
  managerEngineId: "manager-engine",
  mascot: "fox",
  color: "#7dd3fc",
};
localStorage.setItem(
  "monocode:mono-roster",
  JSON.stringify([grand, manager, member]),
);
const workspace = (id: string) => ({
  id: `workspace-${id}`,
  projectCwd: cwd,
  checkoutCwd: `${cwd}/${id}`,
  branch: `cc7-${id}`,
  kind: "worktree" as const,
});
const task = (
  id: string,
  status: OrchestrationTask["status"],
  title: string,
): OrchestrationTask => ({
  id,
  memberId: member.id,
  memberName,
  sessionId: id === "current" ? sessionId : `worker-${id}`,
  title,
  prompt:
    "Inspect the saved behavior, preserve validation and approvals, and report the remaining acceptance steps. No merge or deployment is requested.",
  harness: "codex",
  model: "codex:gpt-5.4",
  files: [],
  scopes: [],
  dependsOn: [],
  status,
  accepted: status === "completed",
  delivered: status === "completed",
  result:
    status === "completed"
      ? "Review delivered. Keyboard and pointer behavior checked."
      : "",
  lastDispatchId: `dispatch-${id}`,
  workspace: workspace(id),
  ...(status === "completed"
    ? {
        acceptedDispatchId: `dispatch-${id}`,
        completionOutcome: "no-changes" as const,
      }
    : {}),
});
const current = task(
  "current",
  waiting ? "completed" : working ? "running" : "blocked",
  waiting || working
    ? "Restore and focus the native Windows window"
    : "Review native window restoration, foreground focus and browser activation",
);
if (waiting) {
  current.accepted = false;
  current.acceptedDispatchId = undefined;
  current.completionOutcome = undefined;
  current.result =
    "Implementation is ready. Independent review is waiting on storage recovery.";
}
if (!waiting && !working)
  current.error =
    "Codex launch failed: conversation store could not be opened. SQLite error: database is locked (SQLITE_BUSY). Review attempt: not started.";
if (drawerStress) current.error += "\n" + "Synthetic diagnostic line; no real storage was opened.\n".repeat(80);
if (historicalSession) {
  current.sessionId = "new-review-worker";
  current.status = "blocked";
  current.error = "Latest worker failure must not rewrite the saved session";
  current.workspace = workspace("new-attempt");
}
const tasks = zero
  ? []
  : [
      current,
      ...Array.from({ length: scenario === "long-history" ? 28 : 2 }, (_, i) =>
        task(
          `history-${i}`,
          i === 1 ? "cancelled" : "completed",
          i === 0
            ? "Check worktree menu behavior"
            : i === 1
              ? "Explore alternate focus routing"
              : `Review ${i + 1}: retained worktree and browser routing`,
        ),
      ),
      ...Array.from({ length: 9 }, (_, i) => ({
        ...task(
          `sidebar-${i}`,
          "completed",
          `Sidebar saved review ${i + 1}: keyboard and routing`,
        ),
        memberId: "sidebar-member",
        memberName: "Frontend",
      })),
    ];
const runs: OrchestrationRun[] = [
  {
    version: 2,
    leadId: "manager-engine",
    ownerMonoId: manager.id,
    ownerSessionId: manager.sessionId,
    cwd,
    status: "active",
    projectManager: true,
    allowedHarnesses: ["codex"],
    maxWorkers: 1,
    cli: "synthetic",
    continuations: 0,
    requests: {},
    tasks,
    dispatches: tasks.map((value) => ({
      id: value.lastDispatchId!,
      taskId: value.id,
      sessionId: value.sessionId,
      workspace: value.workspace!,
      state:
        value.status === "completed"
          ? "completed"
          : value.status === "cancelled"
            ? "cancelled"
            : value.status === "blocked"
              ? "blocked"
              : "running",
      stage:
        value.status === "blocked"
          ? "session_prepared"
          : value.status === "running"
            ? "turn_submitted"
            : "settled",
      startedAt: now - 725_000,
      updatedAt: now - 1_000,
      ...(value.status === "completed"
        ? { finishedAt: now - 60_000, durationMs: 665_000 }
        : {}),
    })),
  },
];
if (historicalSession)
  runs[0].dispatches!.unshift({
    id: "dispatch-current-old",
    taskId: current.id,
    sessionId,
    workspace: workspace("old-attempt"),
    state: "completed",
    stage: "settled",
    startedAt: now - 725_000,
    turnStartedAt: now - 724_000,
    finishedAt: now - 627_000,
    durationMs: 97_000,
    updatedAt: now - 627_000,
  });
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};
orchestrator.hydrate = async () => {};
const blocks: Block[] = zero
  ? []
  : [
      ...(scenario === "long-history"
        ? Array.from({ length: 12 }, (_, i): Block => ({
            id: `earlier-${i}`,
            role: i % 2 ? "assistant" : "user",
            text: "Keep the foreground activation behavior consistent with the selected browser and preserve the existing review boundary. The saved changes will be checked before any integration action.",
            ...(i % 2
              ? {}
              : { startedAt: now - (900 + i * 60) * 1000, durationMs: 10_000 }),
          }))
        : []),
      {
        id: "turn",
        role: "user",
        text: "Check restore and foreground focus. Keep the review tied to the saved change, and show me what still needs a real Windows check.",
        startedAt: now - 157_000,
        durationMs: working ? undefined : 97_000,
        turnModel: { harness: "codex", id: "codex:gpt-5.4", name: "GPT-5.4" },
        turnMetrics: {
          inputTokens: 326_569,
          cacheReadTokens: 289_408,
          outputTokens: 2_318,
          endedAt: working ? undefined : now - 60_000,
        },
      },
      {
        id: "reply",
        role: "assistant",
        text: "I’ll check the window lifecycle, then follow the activation route into the selected browser. I’ll keep source evidence and live acceptance separate.",
      },
      {
        id: "read",
        role: "tool",
        text: "Read window lifecycle and routing",
        tool: {
          kind: "shell",
          title: "Read files",
          status: "completed",
          detail:
            "3 files read. Window lifecycle, foreground routing, acceptance brief.",
        },
      },
      {
        id: "manager-note",
        role: "user",
        text:
          waiting || working
            ? "Please hold cc7-native-focus for independent review. Reviewer’s launch is blocked by storage; your implementation is retained."
            : "Native Core is ready on cc7-native-focus. Review the saved changes after storage recovery. No merge or live model turn is requested.",
        monoTeamMessage: {
          id: manager.id,
          name: "Manager",
          mascot: "fox",
          color: "#7dd3fc",
          topic: "Review hand-off",
          text: "Review the saved change after storage recovery. Keep the current branch. No merge or live model turn is requested.",
        },
      },
      {
        id: "checks",
        role: "tool",
        text: "Run focused routing checks",
        tool: {
          kind: "shell",
          title: "Run checks",
          status: working ? "running" : "completed",
          detail: "24 passed · 0 failed. Saved synthetic output.",
        },
      },
      {
        id: "last-reply",
        role: "assistant",
        text: waiting
          ? "The implementation checks pass. I’ve handed the change to Reviewer and am waiting for the independent verdict."
          : working
            ? "I’m checking the saved window activation changes against the focused acceptance steps."
            : "The earlier conversation is saved. The new review attempt has not started because Codex couldn’t open storage.",
      },
    ];
if (child)
  blocks.push({
    id: "child-review",
    role: "tool",
    text: "Review the retained routing paths",
    tool: {
      kind: "agent",
      title: "Routing review",
      status: "completed",
      detail: "Delegated review report: retained routing paths checked.",
    },
    agentRun: {
      name: "Routing review",
      agentType: "code-reviewer",
      model: "synthetic-review",
      steps: [
        {
          id: "child-read",
          kind: "tool",
          text: "Inspect routing",
          toolKind: "shell",
          status: "completed",
          detail: "Child routing check: 7 assertions passed.",
        },
        {
          id: "child-reply",
          kind: "message",
          text: "The retained routing paths match the saved review boundary.",
        },
      ],
    },
  });
if (approval)
  blocks.push({
    id: "approval-command",
    role: "approval",
    text: approvalCommand,
    tool: {
      kind: "shell",
      title: approvalCommand,
      status: "waiting",
      preview: { kind: "shell", title: approvalCommand },
    },
    approval: { requestId: 7001 },
  });
const initialSession: Session = {
  id: sessionId,
  harness: "codex",
  model: "codex:gpt-5.4",
  modelSettings: { reasoningEffort: "high" },
  runtimeMode: "supervised",
  title: workerSession
    ? "Window activation review"
    : `${memberName} conversation`,
  cwd,
  branch: "cc7-native-review",
  worktreeCwd: workspace(historicalSession ? "old-attempt" : "current")
    .checkoutCwd,
  blocks,
  context: { used: 178_000, window: 258_000 },
  busy: working,
  queuedMessages:
    queued || (!zero && !waiting && !working)
      ? [
          {
            id: "queued-review",
            text: "Review the saved changes when storage is repaired.",
            attachments: [],
          },
        ]
      : undefined,
  ...(!historicalSession && !zero && !waiting && !working
    ? {
        codexStorageError: current.error,
        queueStatus: "paused" as const,
      }
    : {}),
};
const history: SessionSummary[] = tasks.map((value) => ({
  id: value.sessionId,
  cwd,
  worktreeCwd: value.workspace!.checkoutCwd,
  harness: "codex",
  model: "codex:gpt-5.4",
  runtimeMode: "supervised",
  title: value.title,
  createdAt: now - 720_000,
  updatedAt: now - 1_000,
}));
if (!zero)
  recordCrewMessage({
    id: "manager-note",
    managerId: manager.id,
    senderId: manager.id,
    recipientId: member.id,
    topic: "Review hand-off",
    text: "Review the saved change after storage recovery. Keep the current branch. No merge or live model turn is requested." + (drawerStress ? "\nSynthetic Manager message line.\n".repeat(80) : ""),
    at: now - 60_000,
  });
const liveState: AgentLiveState =
  approval || historicalSession
    ? selectAgentLiveState(initialSession)
    : zero
      ? { status: "idle", detail: "Available · no assignment" }
      : waiting
        ? {
            status: "waiting-on-member",
            reason: "dependency",
            waitingOn: "Reviewer",
            detail: "Reviewer failed",
          }
        : working
          ? {
              status: "running-tool",
              detail: "Checking saved window activation",
            }
          : { status: "blocked", reason: "storage", detail: current.error };
publishCardSessions(
  [
    {
      id: sessionId,
      title: initialSession.title,
      harness: "codex",
      liveState,
      needsInput: approval,
    },
    ...tasks
      .filter((value) => value.id !== "current")
      .map((value) => ({
        id: value.sessionId,
        title: value.title,
        harness: "codex" as const,
        liveState: selectAgentLiveState(undefined, { task: value }),
      })),
  ],
  (id) => events.push({ action: "open-session", text: id }),
);
setComposerDraft(sessionId, "Keep my draft");
mockWindows("main");
let credentialNamespaces = Array.from({ length: 12 }, (_, i) => ({
  contextId: i === 0 ? "base" : i.toString(16).padStart(64, "0"),
  home: `//?/C:/Users/synthetic/.monocode/codex-monos/default/.monocode-skill-contexts/${i.toString(16).padStart(64, "0")}`,
  copies: 2,
  active: i < 2,
  receipt: { contextId: i === 0 ? "base" : i.toString(16).padStart(64, "0"), contextIdentity: `synthetic-${i}`, owners: [] },
}));
mockIPC(
  (command, args) => {
    if (drawerStress && command === "codex_mono_store_info") return {
      home: "C:/synthetic/mono", sourceHome: "//?/C:/Users/synthetic/.codex", sourceKind: "default", shareHooks: false, credentialNamespaces,
    };
    if (drawerStress && command === "codex_mono_store_retire_credentials") {
      events.push({ action: "retire-credentials", options: args });
      const receipt = (args as { receipt: { contextId: string } }).receipt;
      const namespace = credentialNamespaces.find(item => item.contextId === receipt.contextId);
      if (namespace?.active) throw new Error("Synthetic context is active; credentials preserved");
      credentialNamespaces = credentialNamespaces.filter(item => item !== namespace);
      return null;
    }
    if (command === "list_dir") return [];
    if (command === "git_worktrees")
      return {
        defaultRoot: cwd,
        worktrees: [
          {
            path: cwd,
            branch: "nour",
            head: "synthetic",
            isMain: true,
            locked: false,
            prunable: false,
            missing: false,
            dirty: false,
            unpushed: 0,
            sessionIds: [],
          },
          ...tasks.map((value, i) => ({
            path: value.workspace!.checkoutCwd,
            branch: value.workspace!.branch!,
            head: "synthetic",
            isMain: false,
            locked: false,
            prunable: false,
            missing: false,
            dirty: i === 5,
            unpushed: 0,
            sessionIds: [value.sessionId],
          })),
        ],
      };
    if (
      [
        "git_pr_list",
        "git_nested_worktrees",
        "list_external_editors",
        "list_project_files",
        "list_skills",
        "list_agent_files",
        "list_automations",
      ].includes(command)
    )
      return [];
    if (command === "git_diff_index")
      return {
        files: [],
        upstream: null,
        ahead: 0,
        behind: 0,
        additions: 0,
        deletions: 0,
      };
    if (command === "git_branches")
      return { current: "nour", local: ["nour"], remote: [] };
    if (command === "git_pr_status" || command === "git_pr_status_by_url")
      return null;
    events.push({ action: `ipc:${command}`, text: JSON.stringify(args) });
    return null;
  },
  { shouldMockEvents: true },
);
const noop = () => {};

function Fixture() {
  const [session, setSession] = useState(initialSession);
  const monos = {
    states: new Map([
      [
        grand.id,
        {
          status: zero ? ("idle" as const) : ("needs-you" as const),
          liveState: zero
            ? { status: "idle" as const }
            : {
                status: "failed" as const,
                detail:
                  "Failed launch in Browser Link · 1 member working below",
              },
        },
      ],
    ]),
    onOpen: noop,
    onCreate: noop,
    onDelete: noop,
  };
  const props: SessionPaneProps = {
    session,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    monoState: {
      status: working ? "working" : zero ? "idle" : "needs-you",
      liveState,
    },
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: (_id, harness, model) =>
      setSession((value) => ({ ...value, harness, model })),
    onModelSettingsChange: (_id, settings) =>
      setSession((value) => ({ ...value, modelSettings: settings })),
    onRuntimeModeChange: (_id, runtimeMode) =>
      setSession((value) => ({ ...value, runtimeMode })),
    onSubmit: (_id, text, _attachments, options) => {
      events.push({ action: "submit", text, options });
      return false;
    },
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: noop,
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: (targetSessionId, id) => {
      events.push({
        action: "remove-queue",
        text: id,
        options: { sessionId: targetSessionId },
      });
      setSession((value) => ({
        ...value,
        queuedMessages: value.queuedMessages?.filter(
          (message) => message.id !== id,
        ),
      }));
    },
    onEditQueuedMessage: (targetSessionId, id, text) => {
      events.push({
        action: "edit-queue",
        text: id,
        options: { sessionId: targetSessionId, text },
      });
      setSession((value) => ({
        ...value,
        queuedMessages: value.queuedMessages?.map((message) =>
          message.id === id ? { ...message, text } : message,
        ),
      }));
    },
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: (targetSessionId, id) => {
      events.push({
        action: "steer-queue",
        text: id,
        options: { sessionId: targetSessionId },
      });
    },
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onCodexStorageRepair: async () => {
      events.push({ action: "repair" });
      throw Error(
        "Synthetic recovery did not run; retained messages remain intact.",
      );
    },
    onCodexStorageCompare: async () => ({
      monoContent: "Saved Mono instructions",
      sourceContent: "Saved account instructions",
    }),
    onApproval: (id, requestId, decision) => {
      events.push({
        action: "approval",
        text: id,
        options: { requestId, decision },
      });
    },
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
  const worktrees = (
    <ProjectWorktrees
      project={cwd}
      currentProject={cwd}
      enabled
      history={history}
      openSessions={history.filter((value) => value.id === sessionId)}
      busySessionIds={new Set(working ? [sessionId] : [])}
      approvalSessionIds={new Set(["worker-history-3"])}
      unseenFinishedIds={new Set(["worker-history-4"])}
      liveAgents={[]}
      activeSessionId={sessionId}
      onLoadHistory={async () => true}
      onSelectWorktree={(_project, tree) =>
        events.push({ action: "open-worktree", text: tree.path })
      }
      onNewSession={noop}
      onSelectSession={(id) =>
        events.push({ action: "open-session", text: id })
      }
      renderManager={() => (
        <ProjectManagerRow
          project={cwd}
          sessions={[session]}
          onOpen={async () => {
            events.push({ action: "open-manager" });
          }}
          onOpenMember={async (id) => {
            events.push({ action: "open-member", text: id });
          }}
        />
      )}
    />
  );
  return (
    <OrchestrationActions.Provider
      value={{
        update: noop,
        confirm: async () => {},
        retry: noop,
        open: (id) => events.push({ action: "open-session", text: id }),
        openWorker: (id) => events.push({ action: "open-worktree", text: id }),
      }}
    >
      <div className="cc7u-fixture-shell">
        <aside
          className="cc7u-fixture-sidebar @container/sidebar"
          aria-label="Workspace navigation"
        >
          {params.get("sidebar") === "app" ? (
            <ProjectRail
              cwd={cwd}
              recents={[]}
              activeSessionId={sessionId}
              monos={monos}
              onSelectProject={noop}
              onOpenProject={noop}
              renderProjectWorktrees={() => worktrees}
            />
          ) : (
            <>
              <strong className="cc7u-fixture-brand">MonoCode</strong>
              <nav className="cc7u-fixture-nav">
                <button>Mission control</button>
                <button>Team</button>
              </nav>
              <MonoRailSection {...monos} />
              <section aria-label="Browser Link sidebar">
                <div className="cc7u-fixture-project">Browser Link</div>
                {worktrees}
              </section>
            </>
          )}
        </aside>
        <div className="cc7u-fixture-main">
          <div className="cc7u-fixture-topbar">
            Browser Link <span>/ {workerSession ? "Session" : "Member"}</span>
            <small>Synthetic workspace · saved just now</small>
          </div>
          <div className="cc7u-fixture-pane">
            <SessionPane {...props} />
          </div>
        </div>
        <style>{`.cc7u-fixture-shell{display:grid;grid-template-columns:232px minmax(0,1fr);height:100dvh;overflow:hidden;background:var(--color-background-base);color:var(--color-content);font:13px/1.5 var(--font-sans)}.cc7u-fixture-sidebar{min-width:0;overflow:auto;padding:23px 14px 16px;border-right:1px solid var(--color-stroke);background:color-mix(in srgb,var(--color-background-base) 94%,black)}.cc7u-fixture-brand{display:block;margin:0 10px 25px;font-size:16px}.cc7u-fixture-nav{display:grid;gap:4px;margin:0 0 22px}.cc7u-fixture-nav button{text-align:left;padding:8px 10px;font-size:12px}.cc7u-fixture-nav button:last-child{background:var(--color-selection);border-radius:6px}.cc7u-fixture-project{margin:26px 10px 8px;font-size:11px;color:var(--color-muted)}.cc7u-fixture-main{display:flex;flex-direction:column;min-height:0;min-width:0}.cc7u-fixture-topbar{height:47px;flex:none;display:flex;align-items:center;gap:10px;padding:0 30px;border-bottom:1px solid var(--color-stroke);font-size:11px}.cc7u-fixture-topbar span,.cc7u-fixture-topbar small{color:var(--color-muted)}.cc7u-fixture-topbar small{margin-left:auto;font-size:10px}.cc7u-fixture-pane{display:flex;position:relative;flex:1;min-height:0;min-width:0}.cc7u-fixture-pane>section{flex:1}.theme-light .cc7u-fixture-sidebar{background:#f0f0f0}@media(max-width:1200px){.cc7u-fixture-shell{grid-template-columns:210px minmax(0,1fr)}.cc7u-fixture-topbar{padding:0 24px}}@media(max-width:760px){.cc7u-fixture-shell{grid-template-columns:minmax(0,1fr)}.cc7u-fixture-sidebar{display:none}.cc7u-fixture-topbar{padding:0 16px}.cc7u-fixture-topbar small{display:none}}`}</style>
      </div>
    </OrchestrationActions.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
