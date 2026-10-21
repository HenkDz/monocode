// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, vi, describe, expect, it } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { openTranscriptWork, openSubagentOutput } from "./transcriptTestActions";

import { createRoot, type Root } from "react-dom/client";
let container: HTMLDivElement, root: Root;
let renderId = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function renderWork(blocks: Block[], busy = false, output = false) {
  act(() => root.render(createElement(AgentTranscript, { key: ++renderId, blocks, busy })));
  expect(container.querySelector('[data-transcript-turn-work] > button')?.getAttribute('aria-expanded')).toBe('false');
  openTranscriptWork(container);
  if (output) openSubagentOutput(container);
  return container.innerHTML + [...document.querySelectorAll('[role="dialog"]')].map(dialog => dialog.outerHTML).join('');
}

function tool(id: string, approval?: Block["approval"]): Block {
  return {
    id,
    role: "tool",
    text: `Inspect hidden-detail-${id}`,
    tool: { kind: "shell", status: approval ? "pending" : "completed" },
    ...(approval ? { approval } : {}),
  };
}

function render(
  blocks: Block[],
  busy = false,
  latestTurnAccessory?: ReactNode,
) {
  return renderToStaticMarkup(
    createElement(AgentTranscript, { blocks, busy, latestTurnAccessory }),
  );
}

describe("AgentTranscript running turn clock", () => {
  it("times a message sent mid-turn from the turn it joined", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const markup = render(
        [
          { id: "user", role: "user", text: "Go", startedAt: 10_000 },
          tool("first"),
          { id: "steer", role: "user", text: "Also this", sentAt: 95_000 },
          { id: "reply", role: "assistant", text: "On it", streaming: true },
        ],
        true,
      );
      // Started 90s ago; without the joined turn's start it read from mount.
      expect(markup).toContain("Working for 1m 30s");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("AgentTranscript collapsed work", () => {
  it("keeps the completed time beside actions when a turn has no BTW control", () => {
    const markup = render([
      {
        id: "user",
        role: "user",
        text: "Inspect",
        startedAt: 1_000,
        durationMs: 2_000,
      },
      { id: "answer", role: "assistant", text: "Done" },
    ]);
    expect(markup).toContain('aria-label="Worked for 2s"');
    expect(markup).toContain("flex shrink-0 items-center gap-2.5");
    expect(markup).not.toContain("ml-auto flex shrink-0 items-center gap-2.5");
  });

  it("shows a /operator request without the command in its amber bubble", () => {
    const markup = render([
      { id: "user", role: "user", text: "list my notes", monocode: true },
    ]);
    expect(markup).toContain('data-monocode="true"');
    expect(markup).toContain("list my notes");
    expect(markup).not.toContain("/operator");

    const legacy = render([
      { id: "old", role: "user", text: "/monocode list my notes" },
    ]);
    expect(legacy).toContain('data-monocode="true"');
    expect(legacy).not.toContain("/monocode");
  });

  it("shows MonoCode CLI actions instead of their long shell commands", () => {
    const command =
      "/repo/target/debug/MonoCode.app/Contents/MacOS/monocode";
    const markup = renderWork(
      [
        { id: "user", role: "user", text: "/monocode list my notes" },
        {
          id: "help",
          role: "tool",
          text: `${command} app --help`,
          tool: { kind: "shell", status: "completed" },
        },
        {
          id: "notes",
          role: "tool",
          text: `${command} app notes.list --json '{}'`,
          tool: { kind: "shell", status: "in_progress" },
        },
      ],
      true,
    );
    expect(container.querySelectorAll("[data-monocode-tool-call]")).toHaveLength(2);
    expect(markup).toContain('data-monocode-tool-call="--help"');
    expect(markup).toContain('data-monocode-tool-call="notes.list"');
    expect(markup).toContain("View CLI commands");
    expect(markup).toContain("List notes");
    expect(container.querySelector(".compact-work-spinner")).not.toBeNull();
    expect(container.querySelector("[data-compact-tool-group]")?.textContent).not.toContain("monocode app");
    expect(container.querySelector("[data-compact-tool-group]")?.textContent).not.toContain("Contents/MacOS/monocode");
    expect(markup).not.toContain("Show error details for MonoCode");
  });

  it("offers command details and approval controls for a MonoCode CLI call", () => {
    const command = "monocode app sessions.send --json '{\"prompt\":\"private-marker\"}'";
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          { id: "user", role: "user", text: "Send a follow-up" },
          {
            id: "call",
            role: "tool",
            text: command,
            tool: { kind: "shell", status: "pending" },
            approval: { requestId: 1 },
          },
        ],
        busy: true,
        onApproval: () => {},
      }),
    );
    expect(markup).toContain('data-monocode-tool-call="sessions.send"');
    expect(markup).toContain("Continue a session");
    expect(markup).toContain("View command");
    expect(markup).toContain('aria-haspopup="dialog"');
    // A pending approval always shows the exact command it will run beside Allow/Deny.
    expect(markup).toContain('aria-label="Command awaiting approval"');
    expect(markup).toContain("private-marker");
    expect(markup).toContain("Allow</button>");

    const compound = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          { id: "user", role: "user", text: "List notes" },
          {
            id: "call",
            role: "tool",
            text: "monocode app notes.list && echo extra",
            tool: { kind: "shell", status: "pending" },
            approval: { requestId: 2 },
          },
        ],
        busy: true,
        onApproval: () => {},
      }),
    );
    expect(compound).not.toContain("data-monocode-tool-call");
    expect(compound).toContain("echo extra");
    expect(compound).toContain("Allow</button>");
  });

  it("keeps a failed MonoCode call compact until its error is opened", () => {
    const markup = renderWork([
      { id: "user", role: "user", text: "/monocode list notes" },
      {
        id: "notes",
        role: "tool",
        text: "monocode app notes.list",
        tool: { kind: "shell", status: "failed", detail: "Connection refused" },
      },
    ]);
    expect(markup).toContain('data-monocode-tool-call="notes.list"');
    expect(markup).toContain("List notes");
    expect(markup).toContain('data-transcript-error="transport"');
    expect(markup).toContain("Open details");
    expect(markup).toContain("Copy diagnostics");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain("Connection refused");
  });

  it("offers the saved CI context in a collapsed disclosure beside the short request", () => {
    const markup = render([
      {
        id: "ci-repair",
        role: "user",
        text: "Fix 1 failed CI check for acme/web PR #42.",
        ciContext:
          "Checked commit: abc123\n\nRun tests: expected <main>, received <script>",
      },
    ]);
    expect(markup).toContain("Fix 1 failed CI check for acme/web PR #42.");
    expect(markup).toContain("data-work-disclosure");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Show work");
    expect(markup).toContain("CI context");
    expect(markup).toContain(
      "Checked commit: abc123\n\nRun tests: expected &lt;main&gt;, received &lt;script&gt;",
    );
  });

  it("hides provider authentication errors handled by the sign-in modal", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        harness: "grok",
        blocks: [
          {
            id: "auth-error",
            role: "system",
            notice: "error",
            text: "Authentication required\n\nGrok Build is not signed in.",
          },
        ],
      }),
    );

    expect(markup).not.toContain("Authentication required");
    expect(markup).not.toContain("Sign in to Grok Build");
    expect(markup).not.toContain("<button");
  });

  it("reveals an orchestration result after the finished turn and before its action row", () => {
    const card: Block = {
      id: "proposal",
      role: "plan",
      text: "Assignment plan",
      orchestration: {
        version: 1,
        leadId: "lead",
        cwd: "/repo",
        request: "Build",
        author: { harness: "claude", model: "claude:test", name: "Lead" },
        settings: {
          choices: [
            { harness: "claude", model: "claude:test", name: "Worker" },
          ],
          maxWorkers: 2,
        },
        status: "ready",
        title: "Proposed assignments",
        summary: "Implement and verify",
        tasks: [],
      },
    };
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Build",
        startedAt: 1000,
        durationMs: 500,
      },
      card, // Existing records have the card before the work.
      tool("inspection"),
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];
    expect(render(blocks, true)).not.toContain("data-orchestration-review");
    const finished = render(blocks);
    expect(finished.indexOf("The investigation is complete.")).toBeLessThan(
      finished.indexOf("data-orchestration-result"),
    );
    expect(finished.indexOf("data-orchestration-review")).toBeLessThan(
      finished.indexOf('aria-label="Worked for 1s"'),
    );
    expect(finished.match(/data-orchestration-review/g)).toHaveLength(1);
    card.orchestration!.status = "planning";
    expect(render(blocks)).not.toContain("data-orchestration-review");
  });
  it("renders a standalone user URL as a compact link preview", () => {
    const markup = render([
      { id: "user", role: "user", text: "https://www.example.com/docs" },
    ]);

    expect(markup).toContain("data-user-link-preview");
    expect(markup).toContain("example.com/docs");
    expect(markup).toContain("Open example.com");
    expect(markup).toContain("user-link-preview-title");
    expect(markup).toContain("user-message-with-link");
    expect(markup).toContain("user-message-bubble");
    expect(markup).not.toContain("text-ellipsis");
  });

  it("renders an unsent turn with send and remove controls", () => {
    const markup = render([
      { id: "draft", role: "user", text: "Explore this", draft: true },
    ]);

    expect(markup).toContain('data-draft="true"');
    expect(markup).toContain("border-dashed");
    expect(markup).toContain('aria-label="Send draft"');
    expect(markup).toContain('aria-label="Remove draft"');
    expect(markup).toContain(">Draft</span>");
  });

  it("keeps surrounding prose and previews its first URL", () => {
    const markup = render([
      {
        id: "user",
        role: "user",
        text: "Please check https://example.com/docs",
      },
    ]);

    expect(markup).toContain("data-user-link-preview");
    expect(markup).toContain("Please check");
    expect(markup).toContain("Open example.com");
    expect(markup).not.toContain("Please check https://example.com/docs");
  });

  it("renders GitHub pull requests as compact work item chips", () => {
    const markup = render([
      {
        id: "user",
        role: "user",
        text: "Review https://github.com/acme/widgets/pull/73 please",
      },
    ]);

    expect(markup).toContain('data-github-work-item-chip="pr"');
    expect(markup).toContain('data-compact="true"');
    expect(markup).toContain("#73");
    expect(markup).not.toContain(">acme/widgets</span>");
    expect(markup).toContain("Review");
    expect(markup).toContain("please");
    expect(markup).not.toContain("user-link-preview-title");
  });

  it("keeps each completed turn's recorded model label", () => {
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Remember this",
        durationMs: 9_000,
        turnModel: {
          harness: "claude",
          id: "claude:sonnet-5",
          name: "Claude Sonnet 5",
        },
      },
      { id: "answer", role: "assistant", text: "Remembered." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5",
      }),
    );

    expect(markup).toContain("Claude Sonnet 5 worked for 9s");
    expect(markup).not.toContain("Claude Opus 5 worked for 9s");
  });

  it("credits a Mono's turns to the Mono, whichever model ran them", () => {
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Remember this",
        durationMs: 9_000,
        turnModel: {
          harness: "claude",
          id: "claude:sonnet-5",
          name: "Claude Sonnet 5",
        },
      },
      { id: "answer", role: "assistant", text: "Remembered." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        agentName: "MonoCat",
        harness: "claude",
        model: "claude:opus-5",
      }),
    );

    expect(markup).toContain("MonoCat worked for 9s");
    expect(markup).not.toContain("Claude Sonnet 5 worked for 9s");
  });

  it("marks when a Mono's messages were sent, and keeps its footer to copy, note and time", () => {
    const now = new Date(2026, 9, 5, 12).getTime();
    vi.setSystemTime(now);
    const turn = (id: string, startedAt: number): Block[] => [
      {
        id,
        role: "user",
        text: `Ask ${id}`,
        startedAt,
        durationMs: 2_000,
        turnMetrics: { outputTokens: 900 },
      },
      { id: `${id}-answer`, role: "assistant", text: "Done." },
    ];
    const blocks = [
      ...turn("yesterday", now - 26 * 60 * 60 * 1000),
      ...turn("morning", now - 3 * 60 * 60 * 1000),
      ...turn("soon-after", now - 3 * 60 * 60 * 1000 + 10 * 60 * 1000),
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        agentName: "MonoCat",
        daySeparators: true,
        hideTurnMetrics: true,
        onSaveNote: () => {},
      }),
    );
    expect(markup.match(/data-day-separator/g)).toHaveLength(2);
    expect(markup).toContain(">Yesterday</span>");
    expect(markup).toContain(">Today</span>");
    expect(markup).toContain("Save as note");
    expect(markup).not.toContain("900");
    vi.useRealTimers();
  });

  it("does not assign the current model to a legacy completed turn", () => {
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Old prompt",
        durationMs: 9_000,
      },
      { id: "answer", role: "assistant", text: "Old answer." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5",
      }),
    );

    expect(markup).toContain("Worked for 9s");
    expect(markup).not.toContain("Claude Opus 5 worked for 9s");
  });
  it("marks the edited message with a quiet visual state instead of a text banner", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [{ id: "user", role: "user", text: "Edit this prompt" }],
        onEditLastTurn: () => {},
        editingLastTurn: true,
      }),
    );

    expect(markup).toContain('data-editing-last-turn="true"');
    expect(markup).toContain("edit-last-turn-bubble");
    expect(markup).toContain('aria-label="Cancel edit"');
    expect(markup).not.toContain("Editing this message");
  });

  it("renders the summary and answer without mounting a large completed tool trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check the project" },
      ...Array.from({ length: 1357 }, (_, index) => tool(String(index))),
      { id: "answer", role: "assistant", text: "The project checks passed." },
    ];
    const markup = render(blocks);
    expect(markup).toContain("The project checks passed.");
    expect(markup).toContain("Show the work");
    expect(markup.includes("hidden-detail-")).toBe(false);
    const short = render([blocks[0], tool("one"), tool("two"), blocks.at(-1)!]);
    const tagCount = (html: string) => html.match(/<[a-z]/g)?.length ?? 0;
    expect(tagCount(markup)).toBe(tagCount(short));
  });

  it("keeps live work visible before the assistant answers", () => {
    expect(render([tool("live")], true)).toContain("hidden-detail-live");
  });

  it("keeps an unresolved approval visible even when narration follows it", () => {
    const markup = render(
      [
        tool("approval", { requestId: 1 }),
        {
          id: "answer",
          role: "assistant",
          text: "Please approve the command.",
        },
      ],
      true,
    );
    expect(markup).toContain("hidden-detail-approval");
    expect(markup).not.toContain("Please approve the command.");
    expect(markup.includes('aria-label="Show the work"')).toBe(true);
  });

  it("opens a failed subagent's output reader on its provider reason", () => {
    const markup = renderWork(
      [
        { id: "user", role: "user", text: "Delegate this", startedAt: 1_000 },
        {
          id: "agent",
          role: "tool",
          text: "Inspect auth",
          tool: {
            callId: "agent-1",
            kind: "agent",
            status: "failed",
            detail: "Child process disconnected",
          },
        },
        { id: "answer", role: "assistant", text: "I could not finish." },
      ],
      // The full reason stays available in both live and settled output readers.
      true, true,
    );

    expect(markup).toContain("Inspect auth");
    expect(markup).toContain("failed");
    expect(markup).toContain("Child process disconnected");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close"]')!.click());

    renderWork([
      { id: "user", role: "user", text: "Delegate this", startedAt: 1_000 },
      {
        id: "agent",
        role: "tool",
        text: "Inspect auth",
        tool: {
          callId: "agent-1",
          kind: "agent",
          status: "failed",
          detail: "Child process disconnected",
        },
      },
      { id: "answer", role: "assistant", text: "I could not finish." },
    ]);
    const output = openSubagentOutput(container);
    expect(output.textContent).toContain("Child process disconnected");
  });

  it("keeps each running subagent and model in its own expanded work row", () => {
    const markup = renderWork(
      [
        { id: "user", role: "user", text: "Review this", startedAt: 1_000 },
        { id: "lead", role: "assistant", text: "I will run two reviews." },
        {
          id: "a1",
          role: "tool",
          text: "Correctness review",
          tool: { callId: "agent-1", kind: "agent", status: "in_progress" },
          agentRun: {
            name: "Correctness review",
            model: "claude-haiku-4-5",
            steps: [
              {
                id: "s1",
                kind: "tool",
                text: "Read src/App.tsx",
                status: "completed",
              },
            ],
          },
        },
        {
          id: "a2",
          role: "tool",
          text: "Quality review",
          tool: { callId: "agent-2", kind: "agent", status: "in_progress" },
          agentRun: {
            name: "Quality review",
            model: "custom-review-model",
            steps: [],
          },
        },
        tool("t1"),
        { id: "answer", role: "assistant", text: "Both reviewers agree." },
      ],
      true,
    );

    // Expanded work preserves each delegated run and its recorded model.
    expect(markup).toContain("Correctness review");
    expect(markup).toContain("Quality review");
    expect(markup).toContain("Haiku 4.5");
    expect(markup).toContain("custom-review-model");
    expect(container.querySelectorAll("[data-flat-subagent]")).toHaveLength(2);
    expect(markup).not.toContain("are working");
    // A row counts its agent's work; it does not echo the call in flight,
    // which put a second scrolling command line on every row.
    expect(markup).toContain("1 step");
    expect(markup).not.toContain("Read src/App.tsx");
    expect(markup).not.toContain("starting up");
    // Live work keeps its activity indicator and an output reader for each run.
    expect(container.querySelector(".compact-work-spinner")).not.toBeNull();
    expect(markup).toContain("View full output");
    // Narration remains readable inside expanded work.
    expect(markup).toContain("Both reviewers agree.");
    const dialog = openSubagentOutput(container);
    expect(dialog.textContent).toContain("Read src/App.tsx");
  });

  it("keeps the turn's status line at the top of the turn above a stack", () => {
    const markup = renderWork(
      [
        { id: "user", role: "user", text: "Review this", startedAt: 1_000 },
        { id: "lead", role: "assistant", text: "I will run two reviews." },
        tool("t0"),
        { id: "plan", role: "assistant", text: "Splitting the review in two." },
        {
          id: "a1",
          role: "tool",
          text: "Independently review the current repository's recent changes for correctness and regressions. Inspect the uncommitted diff.",
          tool: { callId: "agent-1", kind: "agent", status: "in_progress" },
        },
        tool("t1"),
        { id: "answer", role: "assistant", text: "Both reviewers agree." },
      ],
      true,
    );

    // The line the work folds behind sits above everything it folds, and a
    // stack of delegated runs no longer pushes it down the turn.
    const statusAt = markup.indexOf("Hide the work");
    const stackAt = markup.indexOf("Independently review");
    expect(statusAt).toBeGreaterThan(-1);
    expect(stackAt).toBeGreaterThan(statusAt);
    // The expanded timeline retains surrounding calls and narration.
    expect(markup).toContain("hidden-detail-t1");
    expect(markup).toContain("Splitting the review in two.");
    // A row-length name is capped, and the whole brief stays on the hover.
    expect(markup).toContain(
      "Independently review the current repository",
    );
    expect(markup).toContain("Inspect the uncommitted diff.");
  });

  it("retains an opened subagent's full trail in one output reader", () => {
    const markup = renderWork(
      [
        { id: "user", role: "user", text: "Review this", durationMs: 4_000 },
        {
          id: "a1",
          role: "tool",
          // A failed run remains available through its output reader.
          text: "Correctness review",
          tool: { callId: "agent-1", kind: "agent", status: "failed" },
          agentRun: {
            name: "Correctness review",
            steps: [
              { id: "s1", kind: "message", text: "Reading the diff first." },
              { id: "s2", kind: "tool", text: "Read src/App.tsx" },
              { id: "s3", kind: "tool", text: "Read src/lib/session.ts" },
            ],
          },
        },
        { id: "answer", role: "assistant", text: "It could not finish." },
      ],
      true, true,
    );

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Reading the diff first.");
    expect(dialog.textContent).toContain("Read src/App.tsx");
    expect(dialog.textContent).toContain("Read src/lib/session.ts");
    expect(dialog.querySelectorAll('[data-mono-activity-block]')).toHaveLength(3);
    expect(dialog.querySelectorAll('.zen-phase-live')).toHaveLength(0);
  });

  it("offers failed subagent tool results in the same error control as top-level tools", () => {
    const markup = renderWork([
      { id: "user", role: "user", text: "Run tests" },
      {
        id: "agent",
        role: "tool",
        text: "Run tests",
        tool: { callId: "agent-1", kind: "agent", status: "failed" },
        agentRun: {
          name: "Run tests",
          steps: [
            {
              id: "bash",
              kind: "tool",
              text: "npm test",
              toolKind: "execute",
              status: "failed",
              detail: "Tests failed: assertion error\n    at retained-test.ts:42",
            },
          ],
        },
      },
    ], false, true);

    expect(document.querySelector('[role="dialog"] [aria-label^="Failed tool call:"]')).not.toBeNull();
    expect(markup).toContain("View full output");
    const dialog = document.querySelector('[role="dialog"]')!;
    const reader = dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    expect(dialog.textContent).toContain("Tests failed: assertion error");
    expect(dialog.textContent).not.toContain("at retained-test.ts:42");
    act(() => reader.click());
    expect(document.querySelectorAll('[role="dialog"]')[1].querySelector("pre")?.textContent).toBe("Tests failed: assertion error\n    at retained-test.ts:42");
    expect(document.querySelectorAll('[role="dialog"]')[1].textContent).toContain("Copy output");
    expect(container.textContent).not.toContain("Tests failed: assertion error");
  });

  it("counts a failed step on a folded subagent row, so it is not hidden", () => {
    const markup = renderWork([
      { id: "user", role: "user", text: "Run tests" },
      {
        id: "agent",
        role: "tool",
        text: "Run tests",
        // The run itself finished; only one of its steps did not.
        tool: { callId: "agent-1", kind: "agent", status: "completed" },
        agentRun: {
          name: "Run tests",
          steps: [
            { id: "read", kind: "tool", text: "Read package.json" },
            {
              id: "bash",
              kind: "tool",
              text: "npm test",
              status: "failed",
              detail: "Tests failed: assertion error",
            },
            { id: "fix", kind: "tool", text: "Edit src/App.tsx" },
          ],
        },
      },
    ]);

    expect(markup).toContain("3 steps, 1 failed");
  });

  it("opens a lone subagent straight into its own transcript", () => {
    const markup = renderWork(
      [
        { id: "user", role: "user", text: "Review this", durationMs: 4_000 },
        {
          id: "a1",
          role: "tool",
          text: "Correctness review",
          tool: { callId: "agent-1", kind: "agent", status: "completed" },
          agentRun: {
            name: "Correctness review",
            steps: [
              {
                id: "s1",
                kind: "tool",
                text: "Read src/App.tsx",
                status: "completed",
              },
              { id: "s2", kind: "message", text: "Nothing to flag." },
            ],
          },
        },
        { id: "answer", role: "assistant", text: "Clean." },
      ],
      true,
    );

    // One agent needs no stack header: its own row is the row.
    expect(markup).not.toContain("Show every subagent");
    expect(markup).toContain("Correctness review");
    expect(markup).toContain("1 step");
    expect(markup).not.toContain("done");
    expect(markup).toContain("View full output");
  });

  it("places a session accessory after the latest reply and before its action row", () => {
    const markup = render(
      [
        {
          id: "user",
          role: "user",
          text: "Change the files",
          startedAt: 1_000,
          durationMs: 500,
        },
        { id: "answer", role: "assistant", text: "Done changing files." },
      ],
      false,
      createElement("aside", { "data-test-review": true }, "Changed files"),
    );

    expect(markup.indexOf("Done changing files.")).toBeLessThan(
      markup.indexOf("Changed files"),
    );
    expect(markup.indexOf("Changed files")).toBeLessThan(
      markup.indexOf('aria-label="Worked for 1s"'),
    );
  });

  it("keeps a habit artifact attached to a reaction visible", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        agentMascot: { mascot: "cat", color: "#6ba" },
        inlineWork: true,
        blocks: [
          { id: "user", role: "user", text: "Thanks" },
          {
            id: "habit",
            role: "assistant",
            text: "<reaction>👍</reaction>",
            monoHabit: { id: "daily", name: "Daily report", at: 1 },
            artifactCards: [{ id: "report", kind: "document", title: "Durable habit report" }],
          },
        ],
      }),
    );
    expect(markup).toContain('data-mono-reaction="👍"');
    expect(markup).toContain("Durable habit report");
    expect(markup).toContain("data-artifact-results");
    expect(markup).not.toContain("&lt;reaction&gt;");
  });

  it("keeps a Mono's changes action with its historical org output", () => {
    const blocks: Block[] = [
      {
        id: "edit-user",
        role: "user",
        text: "Write the report",
        startedAt: 1_000,
        durationMs: 500,
      },
      {
        id: "edit",
        role: "tool",
        text: "Write report.md",
        tool: { kind: "edit", status: "completed" },
      },
      { id: "edit-answer", role: "assistant", text: "Report written." },
      {
        id: "later-user",
        role: "user",
        text: "Rerun the checks",
        startedAt: 2_000,
        durationMs: 500,
      },
      { id: "later-answer", role: "assistant", text: "Checks rerunning." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        editTurnAction: createElement("button", {}, "+7 -0"),
        turnAccessories: new Map([
          ["edit-user", createElement("div", {}, "Team review receipt")],
        ]),
        latestTurnAccessory: createElement("div", {}, "Member work log"),
      }),
    );
    const action = markup.indexOf("+7 -0");
    expect(markup.match(/\+7 -0/g)).toHaveLength(1);
    expect(action).toBeGreaterThan(markup.indexOf("Report written."));
    expect(action).toBeLessThan(markup.indexOf("Rerun the checks"));
    expect(markup.indexOf("Team review receipt")).toBeLessThan(action);
    expect(markup.indexOf("Member work log")).toBeGreaterThan(
      markup.indexOf("Checks rerunning."),
    );
    expect(markup.lastIndexOf("data-turn-actions", action)).toBeGreaterThan(
      markup.indexOf("Report written."),
    );
  });

  it("renders an advisor interjection between answered work phases", () => {
    // Live: the interjection lands on its own labeled row. Once the turn
    // settles it folds into the work trail — covered below.
    const markup = renderWork(
      [
        tool("before"),
        { id: "answer", role: "assistant", text: "Complete answer." },
        {
          id: "advisor",
          role: "system",
          text: "Check the fallback.",
          interjection: { customType: "advisor", severity: "concern" },
        },
        tool("after"),
        { id: "ack", role: "assistant", text: "Checked." },
      ],
      true,
    );

    expect(markup).toContain("Complete answer.");
    expect(markup).toContain('aria-label="Interjection: Advisor"');
    expect(markup).toContain("Concern");
    expect(markup).toContain("Check the fallback.");
    expect(markup).toContain("Checked.");
  });

  it("folds a settled turn's interjections into the work trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Keep me posted" },
      tool("t1"),
      {
        id: "i1",
        role: "system",
        text: "ping from #general",
        interjection: { customType: "irc:incoming" },
      },
      {
        id: "i2",
        role: "system",
        text: "another ping",
        interjection: { customType: "irc:incoming" },
      },
      tool("t2"),
      {
        id: "i3",
        role: "system",
        text: "last ping",
        interjection: { customType: "irc:incoming" },
      },
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];

    const settled = render(blocks);
    // One fold line for the whole trail: the calls, and the notes they
    // absorbed. The dividers themselves stay behind the fold until opened.
    expect(settled.match(/data-transcript-turn-work/g)).toHaveLength(1);
    expect(settled).toContain("The investigation is complete.");
    expect(settled).not.toContain('aria-label="Interjection:');
    expect(settled).not.toContain("ping from #general");

    // While the turn is live the same notes still land as their own rows.
    const live = renderWork(blocks, true);
    expect(live.match(/aria-label="Interjection: irc:incoming"/g)).toHaveLength(
      3,
    );
    expect(live).toContain("ping from #general");
  });
});

describe("Mono inline work", () => {
  function renderMono(blocks: Block[], busy = false) {
    return renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        busy,
        inlineWork: true,
        agentName: "MonoCat",
        onApproval: () => {},
      }),
    );
  }

  it.each([true, false])(
    "keeps narration hidden and shows the final reply only after completion (busy=%s)",
    (busy) => {
      const blocks: Block[] = [
        { id: "user", role: "user", text: "Check this", durationMs: 9_000 },
        {
          id: "intro",
          role: "assistant",
          text: "I will check the first part.",
        },
        tool("one"),
        tool("two"),
        {
          id: "progress",
          role: "assistant",
          text: "The first part passed. Checking the next part.",
        },
        {
          ...tool("three"),
          tool: { kind: "shell", status: busy ? "in_progress" : "completed" },
        },
        ...(!busy
          ? [
              {
                id: "answer",
                role: "assistant" as const,
                text: "Everything passed.",
              },
            ]
          : []),
      ];
      const markup = renderMono(blocks, busy);
      const header = markup.indexOf(
        busy ? "Working for" : "Worked for 9s",
      );
      expect(header).toBeGreaterThan(0);
      expect(markup).not.toContain("I will check the first part.");
      expect(markup).not.toContain(
        "The first part passed. Checking the next part.",
      );
      expect(markup.match(/data-transcript-turn-work/g)).toHaveLength(1);
      if (!busy)
        expect(markup.indexOf("Everything passed.")).toBeGreaterThan(header);
      expect(markup).not.toContain("data-compact-tool-call");
      expect(markup).toContain('aria-label="Show the work"');
      expect(markup).toContain('aria-expanded="false"');
      expect(markup).not.toContain("zen-phase-step");
    },
  );

  it.each([true, false])(
    "keeps a single tool call in the activity trail (busy=%s)",
    (busy) => {
      const markup = renderMono(
        [
          { id: "user", role: "user", text: "Run this", durationMs: 1_000 },
          {
            ...tool("single"),
            tool: { kind: "shell", status: busy ? "in_progress" : "completed" },
          },
        ],
        busy,
      );
      expect(markup).toContain(
        busy ? "Working for" : "Worked for 1s",
      );
      expect(markup).not.toContain('data-compact-tool-call="single"');
      expect(markup).toContain('aria-expanded="false"');
    },
  );

  it("keeps approval controls available, then returns the call to the activity trail", () => {
    const user: Block = {
      id: "user",
      role: "user",
      text: "Run this",
      durationMs: 1_000,
    };
    const approval = tool("approval", { requestId: 1 });
    const waiting = renderMono([user, approval], true);
    expect(waiting).toContain("hidden-detail-approval");
    expect(waiting).toContain("Allow</button>");
    expect(waiting).toContain("Deny</button>");
    expect(waiting).toContain("Waiting for approval…");
    expect(waiting).not.toContain('aria-label="Show the steps');
    const approved = renderMono([
      user,
      {
        ...approval,
        approval: { requestId: 1, decided: "allow" },
        tool: { kind: "shell", status: "completed" },
      },
    ]);
    expect(approved).toContain("Worked for 1s");
    expect(approved).not.toContain("hidden-detail-approval");
    expect(approved).not.toContain("Allow</button>");
  });

  it("keeps delegated tool work compact, including failed runs", () => {
    const markup = renderMono([
      { id: "user", role: "user", text: "Delegate this", durationMs: 1_000 },
      { id: "intro", role: "assistant", text: "I will ask for a review." },
      {
        id: "agent",
        role: "tool",
        text: "Inspect auth",
        tool: {
          kind: "agent",
          status: "failed",
          detail: "Private provider failure detail",
        },
        agentRun: {
          name: "Auth review",
          steps: [
            { id: "step", kind: "message", text: "Private delegated work" },
          ],
        },
      },
      { id: "answer", role: "assistant", text: "The review could not finish." },
    ]);
    expect(markup).not.toContain("I will ask for a review.");
    expect(markup).not.toContain("Subagent failed");
    expect(markup).toContain("The review could not finish.");
    expect(markup).not.toContain("Private provider failure detail");
    expect(markup).not.toContain("Private delegated work");
    expect(markup).toContain('aria-expanded="false"');
  });
});

describe("worker assignment prompts", () => {
  it("hides the assignment envelope and keeps the task text", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        managed: true,
        blocks: [
          {
            id: "u1",
            role: "user",
            internal: true,
            text: "Review the current branch against main.\n\n<monocode_assignment>\nYou are a worker managed by a MonoCode lead. Your assigned write scope is: src/App.tsx.\n</monocode_assignment>",
          },
          { id: "a1", role: "assistant", text: "Looking now" },
        ],
      }),
    );
    expect(markup).toContain("Review the current branch against main.");
    expect(markup).toContain("Looking now");
    expect(markup).not.toContain("monocode_assignment");
    expect(markup).not.toContain("You are a worker managed by a MonoCode lead");
  });
});
