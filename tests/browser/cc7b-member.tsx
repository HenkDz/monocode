import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import {
  SessionPane,
  type SessionPaneProps,
} from "../../src/features/sessions/ui/SessionPane";
import { SessionRightPanel } from "../../src/features/sessions/ui/SessionRightPanel";
import { MonoDetails } from "../../src/features/monos/ui/MonoDetails";
import { monoLook, type Mono } from "../../src/features/monos/model/mono";
import { publishCardSessions } from "../../src/features/monos/model/monoCards";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../src/features/orchestration/model/orchestrationState";
import type { Block, Session } from "../../src/features/sessions/model/session";
import { setComposerDraft } from "../../src/features/sessions/model/draftCache";
import { selectAgentLiveState } from "../../src/features/agents/model/agentLiveState";
import {
  forgetSessionPullRequests,
  recordPullRequest,
  type WorktreePr,
} from "../../src/features/source-control/model/pullRequests";
import type { GitPr } from "../../src/platform/tauri/fs";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "empty";
const sessionOnly = params.get("kind") === "session";
const panelOnly = params.get("kind") === "panel";
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
const now = Date.now();
const cwd = "/cc7b-fixture/monocode";
const sessionId = "reviewer-conversation";
const member: Mono = {
  id: "reviewer",
  role: "member",
  reportsTo: "manager",
  name: "Reviewer",
  reviewer: true,
  specialty: "Review changes and verify browser behavior",
  sessionId: sessionOnly || panelOnly ? undefined : sessionId,
  projects: [cwd],
  mascot: "cat",
  color: "#69b6a6",
};
localStorage.clear();
localStorage.setItem(
  "monocode:mono-roster",
  JSON.stringify([
    {
      ...member,
      id: "manager",
      role: "manager",
      name: "MonoCode Manager",
      sessionId: "manager-conversation",
    },
    member,
  ]),
);

const pr: GitPr = {
  number: 74,
  title: "Keep the member's current work visible",
  url: "https://github.com/fixture/monocode/pull/74",
  state: "open",
  headOid: "fixture-head",
  headRefName: "cc7b-member-view",
  baseRefName: "nour",
  additions: 87,
  deletions: 31,
  checksStatus: "success",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  updatedAt: new Date(now - 60_000).toISOString(),
};
mockWindows("main");
mockIPC(
  (command) => {
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
    if (command === "git_pr_status" || command === "git_pr_status_by_url")
      return scenario === "loaded-pr" ? pr : null;
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
    if (command === "github_pr_checks")
      return { headOid: "fixture-head", checks: [] };
    return null;
  },
  { shouldMockEvents: true },
);

const task = (
  id: string,
  status: OrchestrationTask["status"],
  title: string,
): OrchestrationTask => ({
  id,
  memberId: member.id,
  memberName: member.name,
  sessionId: `worker-${id}`,
  title,
  prompt:
    "Inspect the change, preserve the existing behavior, and report focused verification.",
  harness: "codex",
  model: "codex:gpt-5.4",
  files: [],
  scopes: [],
  dependsOn: [],
  status,
  accepted: status === "completed",
  result:
    status === "completed"
      ? "Focused checks passed. No retained worktree or profile was changed."
      : "",
  delivered: status === "completed",
  lastDispatchId: `dispatch-${id}`,
  ...(status === "completed"
    ? {
        acceptedDispatchId: `dispatch-${id}`,
        completionOutcome: "no-changes" as const,
      }
    : {}),
});
const current = task(
  "current",
  scenario === "blocked" ? "blocked" : "running",
  "Review current member layout and queue visibility",
);
if (scenario === "blocked") current.error = "Waiting for Codex storage repair";
if (scenario === "loaded-pr") current.prUrl = pr.url;
const tasks = sessionOnly
  ? []
  : [
      current,
      task(
        "queued",
        "queued",
        "Check the contextual PR panel after the current review",
      ),
      ...Array.from({ length: scenario === "long-log" ? 28 : 2 }, (_, i) =>
        task(
          `complete-${i}`,
          "completed",
          `Completed review ${i + 1}: browser layout and scroll checks`,
        ),
      ),
    ];
const runs: OrchestrationRun[] = [
  {
    version: 2,
    leadId: "manager-engine",
    ownerSessionId: "manager-conversation",
    cwd,
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 1,
    cli: "fixture",
    continuations: 0,
    requests: {},
    tasks,
    dispatches: tasks.map((value) => ({
      id: value.lastDispatchId!,
      taskId: value.id,
      sessionId: value.sessionId,
      workspace: {
        id: `fixture-${value.id}`,
        projectCwd: cwd,
        checkoutCwd: cwd,
        kind: "main" as const,
      },
      state:
        value.status === "completed"
          ? ("completed" as const)
          : value.status === "blocked"
            ? ("blocked" as const)
            : ("running" as const),
      stage:
        value.status === "completed"
          ? ("settled" as const)
          : ("turn_submitted" as const),
      startedAt: now - 120_000,
      turnStartedAt: now - 119_000,
      updatedAt: now - 1_000,
      ...(value.status === "completed"
        ? { finishedAt: now - 15_000, durationMs: 105_000 }
        : {}),
      turnMetrics: {
        inputTokens: 12_400,
        cacheReadTokens: 9_600,
        outputTokens: 640,
        modelCalls: 3,
      },
    })),
  },
];
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};
orchestrator.hydrate = async () => {};

const blocks: Block[] =
  scenario === "long-log"
    ? [
        {
          id: "turn",
          role: "user",
          text: "Review the member view and keep my place while reading.",
          startedAt: now - 120_000,
        },
        ...Array.from({ length: 40 }, (_, i): Block => ({
          id: `tool-${i}`,
          role: "tool",
          text: `Inspect layout ${i + 1}`,
          tool: {
            kind: "shell",
            title: `Check component ${i + 1}`,
            status: "completed",
            detail:
              "Focused output preserved for the Activity reader.\n".repeat(6),
          },
        })),
        {
          id: "reply",
          role: "assistant",
          text: "Current work and queued assignments are separate from completed history. The conversation remains available below the work log.",
        },
      ]
    : [];
const initialSession: Session = {
  id: sessionId,
  harness: "codex",
  model: "codex:gpt-5.4",
  modelSettings: { reasoning_effort: "high" },
  runtimeMode: "supervised",
  title: "Reviewer conversation",
  cwd,
  blocks,
  branch: "nour",
  ...(scenario === "blocked"
    ? {
        codexStorageError:
          "Synthetic fixture: account storage could not be prepared. Repair it to resume the queue.",
        queueStatus: "paused" as const,
        queuedMessages: [
          {
            id: "queue-1",
            text: "Review the member layout when storage is repaired.",
            attachments: [],
          },
          {
            id: "queue-2",
            text: "Then check keyboard resizing and focus restoration.",
            attachments: [],
          },
        ],
      }
    : {}),
};
publishCardSessions(
  [
    {
      id: sessionId,
      title: initialSession.title,
      harness: "codex",
      liveState: selectAgentLiveState(initialSession),
    },
    {
      id: current.sessionId,
      title: current.title,
      harness: "codex",
      busy: scenario !== "blocked",
      liveState: selectAgentLiveState(undefined, { task: current }),
    },
  ],
  () => {},
);
if (scenario === "loaded-pr")
  recordPullRequest(cwd, pr, {
    sessionId,
    sessionTitle: initialSession.title,
    taskId: sessionOnly ? undefined : current.id,
    turnId: "turn",
    blockId: "reply",
    at: now - 60_000,
  });
Object.assign(window, {
  dropPrContext: () => forgetSessionPullRequests(sessionId),
});
setComposerDraft(sessionId, "Keep my draft");
const noop = () => {};

function Fixture() {
  const [session, setSession] = useState(initialSession);
  const [panelOpen, setPanelOpen] = useState(
    ["empty-pr", "loaded-pr"].includes(scenario),
  );
  const [tab, setTab] = useState<"details" | "activity" | "prs">("prs");
  const [pinned, setPinned] = useState(false);
  const [retried, setRetried] = useState(false);
  const savedPr: WorktreePr = {
    cwd,
    pr,
    verifiedAt: now,
    unavailable: true,
    links: [
      {
        sessionId,
        sessionTitle: session.title,
        turnId: "turn",
        blockId: "reply",
        at: now,
      },
    ],
  };
  if (panelOnly)
    return (
      <main className="flex h-dvh justify-end bg-background-base text-content">
        <SessionRightPanel
          session={session}
          onClose={noop}
          pinned={pinned}
          onPinnedChange={setPinned}
          pullRequestState={{
            entries: scenario === "saved-pr" ? [savedPr] : [],
            loading: scenario === "loading",
            error:
              scenario === "error" && !retried
                ? "Synthetic fixture: connection unavailable"
                : undefined,
            onRetry: () => setRetried(true),
          }}
        />
      </main>
    );
  const props: SessionPaneProps = {
    session,
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    monoState: {
      status: scenario === "blocked" ? "needs-you" : "working",
      liveState: selectAgentLiveState(session, { task: current }),
    },
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: () => false,
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: noop,
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: (_, id) =>
      setSession((value) => ({
        ...value,
        queuedMessages: value.queuedMessages?.filter(
          (message) => message.id !== id,
        ),
      })),
    onEditQueuedMessage: (_, id, text) =>
      setSession((value) => ({
        ...value,
        queuedMessages: value.queuedMessages?.map((message) =>
          message.id === id ? { ...message, text } : message,
        ),
      })),
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onCodexStorageRepair: async () =>
      setSession((value) => ({ ...value, codexStorageError: undefined })),
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
  return (
    <main className="flex h-dvh min-h-0 overflow-hidden bg-background-base text-content">
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        data-fixture-member
      >
        <SessionPane {...props} />
      </div>
      {!sessionOnly && panelOpen && (
        <MonoDetails
          open
          monoId={member.id}
          sessionId={session.id}
          sessions={[session]}
          runs={runs}
          cwd={cwd}
          agent={monoLook(member)}
          state={{ status: "idle", liveState: selectAgentLiveState(session) }}
          harness={session.harness}
          model={session.model}
          modelSettings={session.modelSettings}
          runtimeMode={session.runtimeMode}
          onModelChange={noop}
          onModelSettingsChange={noop}
          onRuntimeModeChange={noop}
          tab={tab}
          onTabChange={setTab}
          activity={{ blocks: session.blocks, live: false, cwd }}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
