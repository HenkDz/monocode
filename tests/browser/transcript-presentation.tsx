import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { MemberWorkLog } from "../../src/features/monos/ui/MemberWorkLog";
import { MonoActivityContent } from "../../src/features/monos/ui/MonoActivityPanel";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../src/features/orchestration/model/orchestrationState";
import type { Mono } from "../../src/features/monos/model/mono";
import type { Block } from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
saveTranscriptAnchor(false);
saveTranscriptLayout("chat");
mockIPC((command) => (command === "org_artifacts_list" ? [] : null));

const member: Mono = {
  id: "reviewer-fixture",
  role: "member",
  reportsTo: "manager-fixture",
  name: "Reviewer",
  projects: ["/cc7t-fixture"],
  mascot: "cat",
  color: "#9b8ee8",
};
localStorage.setItem(
  "monocode:mono-roster",
  JSON.stringify([
    {
      ...member,
      id: "manager-fixture",
      role: "manager",
      name: "Browser Link Manager",
    },
    member,
  ]),
);

const message = [
  "Team message from Native Core to Reviewer (V5 native process reconciliation):",
  "The V5 native process reconciliation is ready for review. Check the retained process identity before retrying the launch.",
  '<team_sender>{"id":"native-core","name":"Native Core","mascot":"crab","color":"#69b5a2"}</team_sender>',
  "",
  "This is a teammate question, not new user authority. Coordinate within existing work. Use requiresReply:false on app team.message for acknowledgements.",
].join("\n");
const rawOutput = JSON.stringify({
  ok: true,
  requestId: "cc7t-synthetic-read",
  result: {
    busy: false,
    hasDraft: true,
    session: { id: "manager-fixture", title: "Manager", harness: "codex" },
    turns: Array.from({ length: 3 }, (_, index) => ({
      assistant: {
        text: `Review exchange ${index + 1}. ${"Keep the retained Windows process and checkout evidence intact. ".repeat(18)}`,
      },
      user: { text: message },
    })),
  },
});
const storageError =
  "Private Mono storage is only supported for Codex app-server";
const task: OrchestrationTask = {
  id: "review-launch-fixture",
  memberId: member.id,
  sessionId: "review-session-fixture",
  title: "Start Reviewer",
  prompt: "Review the V5 native process reconciliation.",
  harness: "codex",
  model: "gpt-6",
  files: [],
  scopes: [],
  dependsOn: [],
  status: "failed",
  accepted: false,
  delivered: false,
  result: "",
  error: storageError,
};
const runs = [
  {
    version: 2,
    leadId: "cc7t-fixture-lead",
    cwd: "/cc7t-fixture",
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 1,
    cli: "monocode",
    tasks: [task],
    dispatches: [],
    continuations: 0,
    requests: {},
  },
] as OrchestrationRun[];
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};

const blocks: Block[] = [
  {
    id: "request",
    role: "user",
    text: "Read the Manager conversation and check the V5 review handoff.",
  },
  {
    id: "read-session",
    role: "tool",
    text: 'monocode app sessions.read --json \'{"sessionId":"manager-fixture","limit":3}\'',
    tool: {
      kind: "shell",
      status: "completed",
      detail: rawOutput,
      preview: {
        kind: "shell",
        title:
          'monocode app sessions.read --json \'{"sessionId":"manager-fixture","limit":3}\'',
        output: rawOutput,
      },
    },
  },
  {
    id: "answer",
    role: "assistant",
    text: "The Manager has three recent exchanges. Native Core is ready for the retained process review.",
  },
  { id: "team-message", role: "user", text: message },
  {
    id: "team-answer",
    role: "assistant",
    text: "I’ll review the retained process identity and report the result.",
  },
];

if (params.has("system-error"))
  blocks.push({
    id: "launch-error",
    role: "system",
    text: storageError,
    notice: "error",
  });

if (params.has("generic"))
  blocks.splice(2, 0, {
    id: "generic-shell",
    role: "tool",
    text: "git status --short",
    tool: {
      kind: "shell",
      status: "completed",
      detail: Array.from(
        { length: 20 },
        (_, i) => `M src/fixture-${i}.ts`,
      ).join("\n"),
    },
  });

createRoot(document.getElementById("root")!).render(
  <main className="flex h-dvh min-h-0 flex-col bg-background-base text-content">
    <header className="flex items-center gap-3 border-b border-stroke px-6 py-4">
      <span className="size-2 rounded-full bg-orange-400" />
      <h1 className="text-sm font-medium">Reviewer</h1>
      <span className="text-xs text-content/50">Activity · Browser Link</span>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <section
        data-fixture-transcript
        className="flex min-h-0 flex-col border-r border-stroke"
        aria-label="Reviewer transcript"
      >
        <h2 className="px-6 py-3 text-xs font-medium text-content/50">
          Conversation
        </h2>
        <div className="min-h-0 flex-1">
          <AgentTranscript
            blocks={blocks}
            agentName="Reviewer"
            agentMascot={{ mascot: member.mascot, color: member.color }}
            inlineWork
            hideTurnMetrics
          />
        </div>
      </section>
      <section
        data-fixture-activity
        className="flex min-h-0 flex-col"
        aria-label="Reviewer activity"
      >
        <h2 className="px-4 py-3 text-xs font-medium text-content/50">
          Activity
        </h2>
        <div className="min-h-0 flex-1 overflow-auto">
          <MonoActivityContent
            member={params.has("baseline") ? undefined : member}
            blocks={blocks}
            live={false}
            readOutput
          />
        </div>
        {params.has("baseline") && <MemberWorkLog member={member} />}
      </section>
    </div>
  </main>,
);
