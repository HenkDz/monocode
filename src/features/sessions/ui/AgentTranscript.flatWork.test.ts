// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { openTranscriptWork } from "./transcriptTestActions";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(
  blocks: Block[],
  props: Partial<ComponentProps<typeof AgentTranscript>> = {},
) {
  act(() => root.render(createElement(AgentTranscript, { blocks, ...props })));
}

const work: Block[] = [
  {
    id: "user",
    role: "user",
    text: "Review the native path",
    startedAt: 1000,
    durationMs: 2000,
  },
  { id: "intro", role: "assistant", text: "I will inspect the native path." },
  {
    id: "probe",
    role: "tool",
    text: "Inspect source",
    tool: {
      kind: "shell",
      title: "Inspect source",
      status: "completed",
      preview: {
        kind: "shell",
        title: "node scripts/native-check.mjs",
        output: '{"checks":4,"passed":4}',
      },
    },
  },
  {
    id: "progress",
    role: "assistant",
    text: "Checking the retained checkout next.",
  },
  {
    id: "verify",
    role: "tool",
    text: "Validate checkout",
    tool: { kind: "shell", title: "Validate checkout", status: "completed" },
  },
  { id: "answer", role: "assistant", text: "The native checks passed." },
];
const workDisclosures = () =>
  container.querySelectorAll(
    'button[aria-label="Show the work"], button[aria-label="Hide the work"]',
  );

it.each([true, false])(
  "keeps internal evidence hidden and preserves unsent draft controls in flat conversations (Mono chrome: %s)",
  (inlineWork) => {
    const onSendDraft = vi.fn(),
      onRemoveDraft = vi.fn();
    render(
      [
        work[0],
        {
          id: "internal",
          role: "assistant",
          text: "Private orchestration context",
          internal: true,
        },
        {
          id: "draft",
          role: "user",
          text: "Unsent draft request",
          draft: true,
        },
        ...work.slice(1),
      ],
      { inlineWork, flatWork: true, onSendDraft, onRemoveDraft },
    );
    expect(container.textContent).not.toContain(
      "Private orchestration context",
    );
    expect(
      container.querySelector('[data-chat-message="internal"]'),
    ).toBeNull();
    const draft = container.querySelector('[data-prompt-anchor="draft"]')!;
    expect(draft.textContent).toContain("Unsent draft request");
    expect(draft.querySelector('[data-draft="true"]')).not.toBeNull();
    expect(draft.textContent).toContain("Draft");
    act(() =>
      draft
        .querySelector<HTMLButtonElement>('[aria-label="Send draft"]')!
        .click(),
    );
    expect(onSendDraft).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "draft",
        text: "Unsent draft request",
        draft: true,
      }),
    );
    act(() =>
      draft
        .querySelector<HTMLButtonElement>('[aria-label="Remove draft"]')!
        .click(),
    );
    expect(onRemoveDraft).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "draft",
        text: "Unsent draft request",
        draft: true,
      }),
    );
    expect(container.textContent).not.toContain("I will inspect the native path.");
    openTranscriptWork(container);
    expect(container.textContent).toContain("I will inspect the native path.");
    expect(container.textContent).toContain("The native checks passed.");
  },
);

it.each([true, false])(
  "opens folded preliminary prose, tools and output readers in flat mode (Mono chrome: %s)",
  (inlineWork) => {
    render(work, { inlineWork, flatWork: true });
    expect(workDisclosures()).toHaveLength(1);
    expect(container.textContent).not.toContain("I will inspect the native path.");
    openTranscriptWork(container);
    for (const text of [
      "I will inspect the native path.",
      "Checking the retained checkout next.",
      "The native checks passed.",
    ])
      expect(container.textContent).toContain(text);
    expect(workDisclosures()).toHaveLength(1);
    const tool = container.querySelector('[data-compact-tool-call="probe"]');
    expect(tool).not.toBeNull();
    const output = [
      ...tool!.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "View full output");
    expect(output).toBeDefined();
    expect(container.textContent).not.toContain('"checks":4');
    act(() => output!.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      '{"checks":4,"passed":4}',
    );
    act(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [aria-label="Close"]',
        )!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

it.each([true, false])(
  "opens folded streamed preliminary prose and tools while work is still running (Mono chrome: %s)",
  (inlineWork) => {
    render(
      [
        {
          id: "user",
          role: "user",
          text: "Inspect the native path",
          startedAt: 1000,
        },
        {
          id: "intro",
          role: "assistant",
          text: "Starting the native inspection.",
        },
        { ...work[2], tool: { ...work[2].tool!, status: "in_progress" } },
        {
          id: "progress",
          role: "assistant",
          text: "The native inspection is still running.",
          streaming: true,
        },
      ],
      { inlineWork, flatWork: true, busy: true },
    );
    expect(container.textContent).not.toContain("Starting the native inspection.");
    openTranscriptWork(container);
    expect(container.textContent).toContain("Starting the native inspection.");
    expect(container.textContent).toContain(
      "The native inspection is still running.",
    );
    expect(
      container.querySelector('[data-compact-tool-call="probe"]'),
    ).not.toBeNull();
    expect(workDisclosures()).toHaveLength(1);
  },
);

it.each([true, false])(
  "keeps a saved delegated run's output reachable through folded work (Mono chrome: %s)",
  (inlineWork) => {
    render(
      [
        work[0],
        {
          id: "child",
          role: "tool",
          text: "Correctness review",
          tool: {
            callId: "child-review",
            kind: "agent",
            status: "completed",
            detail: "No correctness defects found.",
          },
          agentRun: {
            name: "Correctness review",
            steps: [
              {
                id: "child-note",
                kind: "message",
                text: "Reading the native source.",
              },
              {
                id: "child-probe",
                kind: "tool",
                text: "Read native source",
                toolKind: "shell",
                status: "completed",
                preview: {
                  kind: "shell",
                  title: "node scripts/read-native.mjs",
                  output: '{"files":3}',
                },
              },
            ],
          },
        },
        work[5],
      ],
      { inlineWork, flatWork: true },
    );
    expect(
      container.querySelector(
        'button[aria-label="Show Correctness review\'s work"], button[aria-label="Hide Correctness review\'s work"]',
      ),
    ).toBeNull();
    expect(workDisclosures()).toHaveLength(1);
    openTranscriptWork(container);
    const reader = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "View full output");
    expect(reader).toBeDefined();
    act(() => {
      reader!.focus();
      reader!.click();
    });
    const report = document.querySelector('[role="dialog"]')!;
    expect(report.textContent).toContain("Reading the native source.");
    expect(report.textContent).toContain("Read native source");
    expect(report.textContent).toContain("No correctness defects found.");
    expect(
      report.querySelector(
        'button[aria-label="Show Correctness review\'s work"]',
      ),
    ).toBeNull();
    const output = [
      ...report.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "View full output");
    expect(output).toBeDefined();
    act(() => output!.click());
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1].querySelector("pre")?.textContent).toBe('{"files":3}');
    act(() =>
      dialogs[1]
        .querySelector<HTMLButtonElement>('[aria-label="Close"]')!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBe(report);
    act(() =>
      report.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(reader);
  },
);

it.each([true, false])(
  "keeps ordinary command output in its reader rather than the flat conversation (Mono chrome: %s)",
  (inlineWork) => {
    const output =
      "First saved output line\nSecond saved output line\nThird saved output line\nFourth saved output line";
    render(
      [
        work[0],
        {
          ...work[2],
          tool: {
            ...work[2].tool!,
            preview: {
              kind: "shell",
              title: "node scripts/native-check.mjs",
              output,
            },
          },
        },
        work[5],
      ],
      { inlineWork, flatWork: true },
    );
    openTranscriptWork(container);
    expect(container.textContent).toContain("Inspect source");
    expect(container.textContent).not.toContain("First saved output line");
    const reader = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "View full output")!;
    expect(reader).toBeDefined();
    act(() => reader.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      output,
    );
  },
);

it.each([true, false])(
  "keeps the same collapsed-work default regardless of flat mode (Mono chrome: %s)",
  (inlineWork) => {
    render(work, { inlineWork });
    const original = container.textContent;
    const disclosures = workDisclosures().length;
    expect(container.textContent).not.toContain(
      "Checking the retained checkout next.",
    );
    expect(disclosures).toBe(1);
    render(work, { inlineWork, flatWork: false });
    expect(container.textContent).toBe(original);
    expect(workDisclosures()).toHaveLength(disclosures);
    render(work, { inlineWork, flatWork: true });
    expect(container.textContent).not.toContain(
      "Checking the retained checkout next.",
    );
    render(work, { inlineWork, flatWork: false });
    expect(container.textContent).toBe(original);
  },
);

it.each([true, false])(
  "retains the exact pending approval command and request identity in flat mode (Mono chrome: %s)",
  (inlineWork) => {
    const command =
      'node worker.mjs --json "<team_sender>{\"id\":\"worker\"}</team_sender>" # <monocode_context>raw-command</monocode_context>';
    const reason =
      "Not auto-approved: executable does not resolve to the running MonoCode app.";
    const onApproval = vi.fn();
    render(
      [
        {
          id: "user",
          role: "user",
          text: "Inspect worker status",
          startedAt: 1000,
        },
        {
          id: "intro",
          role: "assistant",
          text: "I will request the inspection.",
        },
        {
          id: "pending",
          role: "tool",
          text: "Run inspection",
          tool: {
            kind: "shell",
            title: "Inspect worker",
            status: "pending",
            detail: "Previous output",
            preview: {
              kind: "shell",
              title: command,
              output: "Previous output",
            },
          },
          approval: { requestId: 42, autoApprovalReason: reason },
        },
      ],
      { inlineWork, flatWork: true, busy: true, onApproval },
    );
    expect(
      container.querySelector('[aria-label="Command awaiting approval"]')
        ?.textContent,
    ).toBe(command);
    expect(
      container.querySelector('[aria-label="Automatic approval status"]')
        ?.textContent,
    ).toBe(reason);
    const view = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "View command");
    expect(view).toBeDefined();
    act(() => view!.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      command,
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("Previous output");
    expect(onApproval).not.toHaveBeenCalled();
    act(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [aria-label="Close"]',
        )!
        .click(),
    );
    const allow = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Allow");
    expect(allow).toBeDefined();
    act(() => allow!.click());
    expect(onApproval).toHaveBeenCalledExactlyOnceWith(42, "allow");
  },
);

it.each(["pending", "paused", "failed", "storage-blocked"] as const)(
  "keeps a %s follow-up visibly undelivered and renders it once in flat mode",
  (status) => {
    const onRetryMessage = vi.fn();
    const blocks: Block[] = [
      ...work.slice(0, 3),
      {
        id: "follow-up",
        role: "user",
        text: "Check the branch too",
        sentAt: 1100,
      },
      {
        id: "continued",
        role: "assistant",
        text: "Continuing the original inspection.",
        streaming: true,
      },
    ];
    const props = {
      inlineWork: true,
      flatWork: true,
      busy: true,
      agentMascot: { mascot: "cat", color: "#888" },
      onRetryMessage,
      messageDeliveries: new Map([
        [
          "follow-up",
          {
            status,
            ...(status === "failed"
              ? { error: "Synthetic connection refused" }
              : {}),
          },
        ],
      ]),
    };
    render(blocks, props);
    expect(
      container.querySelectorAll('[data-prompt-anchor="follow-up"]'),
    ).toHaveLength(1);
    const followUp = container.querySelector(
      '[data-prompt-anchor="follow-up"]',
    )!;
    expect(followUp.getAttribute("data-message-delivery")).toBe(status);
    expect(followUp.textContent).toContain("Check the branch too");
    expect(container.querySelectorAll("[data-transcript-turn]")).toHaveLength(
      1,
    );
    expect(workDisclosures()).toHaveLength(1);
    if (status === "failed") {
      const retry = [
        ...followUp.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent === "Retry");
      expect(retry).toBeDefined();
      act(() => retry!.click());
      expect(onRetryMessage).toHaveBeenCalledExactlyOnceWith("follow-up");
    } else if (status === "storage-blocked") {
      expect(followUp.textContent).toContain("Waiting for storage repair");
      expect(followUp.textContent).not.toMatch(
        /Retry|Resume|Synthetic connection/,
      );
    }
    render(
      blocks.map((block) => ({ ...block, streaming: false })),
      { ...props, messageDeliveries: new Map() },
    );
    expect(
      container.querySelectorAll('[data-prompt-anchor="follow-up"]'),
    ).toHaveLength(1);
    expect(
      container
        .querySelector('[data-prompt-anchor="follow-up"]')
        ?.hasAttribute("data-message-delivery"),
    ).toBe(false);
  },
);
