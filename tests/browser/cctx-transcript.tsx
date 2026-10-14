import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
// @ts-expect-error Supplied by the browser fixture Vite plugin.
import { AgentTranscript as BaselineAgentTranscript } from "virtual:cctx-baseline-transcript";
import { QuestionForm } from "../../src/features/sessions/ui/QuestionForm";
import { applyHarnessEvent } from "../../src/integrations/harness/core/apply";
import { newSession } from "../../src/features/sessions/model/session";
import { sanitizeSessionForPersist } from "../../src/features/sessions/data/sessionStore";
import type {
  Block,
  HarnessId,
} from "../../src/features/sessions/model/session";
import {
  saveTranscriptAnchor,
  saveTranscriptLayout,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "completed";
const surface = params.get("surface") ?? "task";
const harness = (params.get("harness") ?? "codex") as HarnessId;
const Transcript = params.has("baseline")
  ? BaselineAgentTranscript
  : AgentTranscript;
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
saveTranscriptAnchor(false);
saveTranscriptLayout("chat");
mockIPC((command) => (command === "org_artifacts_list" ? [] : null));

export const approvalCommand = [
  "cargo check --features browser --manifest-path src-tauri/Cargo.toml",
  "Write-Output '$(UNTRUSTED_TEXT); & do-not-execute'",
].join("\n");

const finalAnswer = [
  "## Browser destination catalog is ready",
  "",
  "The dialog now loads **browser destinations** asynchronously and closes cleanly.",
  "",
  "- Updated `src/browser.rs` and the chooser lifecycle.",
  "- Preserved keyboard focus after opening and closing dialogs.",
  "- The first cargo check failed; the corrected focused check passed.",
  "",
  "```rust",
  "catalog.refresh().await?;",
  "```",
].join("\n");

function tool(index: number): Block {
  const path = `src/browser/destination-${index}.rs`;
  const failed = index === 42;
  const kind =
    failed || index === 49
      ? "shell"
      : ["read", "search", "shell", "write", "shell"][index % 5];
  const command = failed
    ? "cargo check --features browser"
    : index === 49
      ? "cargo test browser_destination --lib"
      : `rtk git diff -- src/browser/destination-${index}.rs`;
  const code = `const result = await tools.exec_command({cmd: ${JSON.stringify(command)}, max_output_tokens: 1000}); text(result);`;
  return {
    id: `atlas-tool-${index}`,
    role: "tool",
    text:
      kind === "shell"
        ? code
        : kind === "read"
          ? `Read ${path}`
          : kind === "search"
            ? `Search browser_destination_${index}`
            : `Edit ${path}`,
    tool: {
      callId: `atlas-call-${index}`,
      kind,
      status: failed ? "failed" : "completed",
      detail: failed
        ? "error[E0425]: cannot find value `browser_destination` in this scope\nProcess exited with code 101"
        : `Synthetic ${kind} output ${index}: completed.`,
      preview:
        kind === "read"
          ? {
              kind: "read",
              path,
              startLine: 1690 + index,
              lines: [
                {
                  number: 1690 + index,
                  kind: "context",
                  text: "fn browser_destination() {}",
                },
              ],
            }
          : kind === "search"
            ? {
                kind: "search",
                query: `browser_destination_${index}`,
                path: "src",
                output: `${path}:18:browser_destination`,
              }
            : kind === "write"
              ? {
                  kind: "write",
                  path,
                  additions: 42,
                  deletions: 8,
                  lines: [
                    {
                      number: 18,
                      kind: "add",
                      text: "catalog.refresh().await?;",
                    },
                  ],
                }
              : {
                  kind: "shell",
                  title: code,
                  output: failed
                    ? "error[E0425]: cannot find value `browser_destination` in this scope\nProcess exited with code 101"
                    : `Synthetic command output ${index}: completed.`,
                },
    },
  };
}

const work: Block[] = [
  {
    id: "reason-summary-0",
    role: "reasoning",
    text: "**Handling dialog updates and closures**\n\nKeep the chooser lifecycle and keyboard focus consistent.",
    reasoning: { itemId: "atlas-reasoning", partIndex: 0, channel: "summary" },
  },
  {
    id: "reason-summary-1",
    role: "reasoning",
    text: "**Managing browser destination catalog asynchronously**\n\nRefresh destinations after the dialog is ready.",
    reasoning: { itemId: "atlas-reasoning", partIndex: 1, channel: "summary" },
  },
  {
    id: "reason-raw",
    role: "reasoning",
    text: "Provider diagnostic reasoning\n\nRaw diagnostic reasoning from the captured event shape.",
    reasoning: { itemId: "atlas-reasoning", partIndex: 0, channel: "raw" },
  },
];
for (let index = 0; index < 50; index++) {
  if (index === 10)
    work.push({
      id: "narration-read",
      role: "assistant",
      text: "I found the dialog lifecycle boundary; I will update the destination chooser next.",
    });
  if (index === 30)
    work.push({
      id: "narration-test",
      role: "assistant",
      text: "The chooser changes are ready; I will check the focused Rust paths.",
    });
  work.push(tool(index));
}

function Fixture() {
  const [completed, setCompleted] = useState(
    scenario === "completed" || scenario === "two-turns",
  );
  const [decision, setDecision] = useState<string>();
  const [answer, setAnswer] = useState<string>();
  const [newSteps, setNewSteps] = useState(false);
  const running = scenario === "running" && !completed;
  const waiting = scenario === "background";
  const blocks: Block[] = [
    {
      id: "atlas-request",
      role: "user",
      text: "Implement the browser destination catalog and dialog lifecycle changes.",
      startedAt: Date.now() - 111_000,
      ...(!running && !waiting && scenario !== "approval" && scenario !== "question"
        ? { durationMs: 111_000 }
        : {}),
    },
    ...work.map((block) =>
      running && block.id === "atlas-tool-49"
        ? {
            ...block,
            streaming: true,
            tool: { ...block.tool, status: "in_progress" },
          }
        : block,
    ),
  ];
  if (scenario === "subagent") {
    const saved = newSession("cursor", "/synthetic");
    saved.blocks = [blocks[0], {
      id: "saved-child", role: "tool", text: "Auth review",
      tool: { kind: "agent", status: "completed", detail: "Saved review report" },
      agentRun: { name: "Auth review", model: "grok-4.6", steps: Array.from({ length: 40 }, (_, index) => ({ id: `saved-step-${index}`, kind: "message", text: `Saved step ${index}: read retained source.` })) },
    }];
    const reloaded = JSON.parse(JSON.stringify(sanitizeSessionForPersist(saved))) as typeof saved;
    if (newSteps) reloaded.blocks[1].agentRun!.steps.push({ id: "updated-step", kind: "message", text: "New saved progress" });
    blocks.splice(0, blocks.length, ...reloaded.blocks);
  }
  const background = applyHarnessEvent(newSession("claude", "/synthetic"), { type: "background.updated", tasks: waiting ? ["Review", "Build"] : [] }).backgroundTasks;
  if (scenario === "approval")
    blocks.push({
      id: "atlas-approval",
      role: "approval",
      text: approvalCommand,
      tool: { kind: "shell", title: approvalCommand, status: "waiting" },
      approval: {
        requestId: 731,
        ...(decision ? { decided: decision as "allow" | "deny" } : {}),
      },
    });
  if (scenario === "failure")
    blocks.push({
      id: "atlas-failure",
      role: "system",
      notice: "error",
      text: "Turn failed: the browser destination provider disconnected. Retry after reconnecting.",
    });
  if (completed)
    blocks.push({ id: "atlas-answer", role: "assistant", text: finalAnswer });
  if (scenario === "two-turns")
    blocks.push(
      {
        id: "follow-up-request",
        role: "user",
        text: "Check the final worktree status.",
        startedAt: Date.now() - 20_000,
        durationMs: 6_000,
      },
      {
        id: "follow-up-tool",
        role: "tool",
        text: "rtk git status --short",
        tool: {
          kind: "shell",
          status: "completed",
          detail: "M src/browser.rs",
        },
      },
      {
        id: "follow-up-answer",
        role: "assistant",
        text: "The follow-up check is complete.",
      },
    );
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background-base text-content">
      <header className="flex items-center justify-between border-b border-stroke px-6 py-3">
        <div className="text-sm font-medium">
          Atlas{" "}
          <span className="ml-2 text-xs font-normal text-content/45">
            Browser destination catalog · {surface} · {harness}
          </span>
        </div>
        {running && (
          <button
            className="text-xs text-content/60"
            onClick={() => setCompleted(true)}
          >
            Complete synthetic turn
          </button>
        )}
        {scenario === "subagent" && <button onClick={() => setNewSteps(true)}>Append synthetic saved progress</button>}
      </header>
      <section className="min-h-0 flex-1" aria-label="Atlas transcript">
        <Transcript
          blocks={blocks}
          busy={
            running || waiting ||
            (scenario === "approval" && !decision) ||
            (scenario === "question" && !answer)
          }
          pendingQuestion={scenario === "question" && !answer}
          backgroundTasks={background}
          harness={harness}
          agentName={surface === "task" ? undefined : "Atlas"}
          agentMascot={
            surface === "task" ? undefined : { mascot: "cat", color: "#9b8ee8" }
          }
          inlineWork={surface !== "task"}
          flatWork={surface === "workbench"}
          bottomAligned={surface === "floating"}
          hideTurnMetrics
          onApproval={(_, value) => setDecision(value)}
          latestTurnAccessory={
            scenario === "question" && !answer ? (
              <QuestionForm
                prompt={{
                  requestId: 732,
                  title: "Destination source",
                  questions: [
                    {
                      id: "source",
                      prompt: "Which browser destination source should I use?",
                      multiSelect: false,
                      allowCustom: false,
                      options: [
                        { id: "system", label: "System browsers" },
                        { id: "custom", label: "Custom catalog" },
                      ],
                    },
                  ],
                }}
                onReply={(_, reply) => setAnswer(JSON.stringify(reply))}
              />
            ) : undefined
          }
        />
      </section>
      {(decision || answer) && (
        <output aria-label="Fixture callback" className="px-6 py-2 text-xs">
          {decision ?? answer}
        </output>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
