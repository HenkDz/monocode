// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionPane, type SessionPaneProps } from "./SessionPane";
import { clearComposerDraft, setComposerDraft } from "../model/draftCache";

const probes = vi.hoisted(() => ({
  mono: true,
  member: false,
  pick: vi.fn(),
  transcript: vi.fn(),
  composer: vi.fn(),
  checkoutNotice: vi.fn(),
  runs: [],
}));
vi.mock("./Composer", () => ({ Composer: (props: { disabled?: boolean; onSubmit: (text: string, attachments: []) => void }) => {
  probes.composer(props);
  return createElement("button", { disabled: props.disabled, onClick: () => props.onSubmit("Continue my work", []) }, "Send user message");
} }));
vi.mock("../hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: probes.pick,
}));
vi.mock("./AgentTranscript", () => ({
  AgentTranscript: (props: { onAddToChat: (text: string) => void }) => {
    probes.transcript(props);
    return createElement(
      "button",
      { onClick: () => props.onAddToChat("Selected response") },
      "Quote response",
    );
  },
}));
vi.mock("../../orchestration/model/orchestration", async (original) => ({
  ...(await original<
    typeof import("../../orchestration/model/orchestration")
  >()),
  orchestrator: {
    subscribe: () => () => {},
    snapshot: () => probes.runs,
    hydrate: async () => {},
    checkoutNotice: probes.checkoutNotice,
  },
}));
vi.mock("../../monos/model/mono", async (original) => ({
  ...(await original<typeof import("../../monos/model/mono")>()),
  monoForSession: () =>
    probes.mono
      ? {
          id: "mono",
          role: probes.member ? "member" : undefined,
          sessionId: "chat",
          name: "Captain",
          mascot: "cat",
          color: "#6ba",
          projects: [],
        }
      : undefined,
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  probes.mono = true;
  probes.member = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.clear();
  probes.transcript.mockClear();
  probes.composer.mockClear();
  probes.checkoutNotice.mockReset().mockReturnValue(null);
  clearComposerDraft("chat");
  probes.pick.mockReset().mockResolvedValue([
    {
      id: "file",
      name: "note.txt",
      kind: "file",
      mimeType: "text/plain",
      size: 12,
      path: "/tmp/note.txt",
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearComposerDraft("chat");
  vi.unstubAllGlobals();
});
const noop = () => {};
function props(): SessionPaneProps {
  return {
    session: {
      id: "chat",
      title: "Chat",
      cwd: "/repo",
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [{ id: "user", role: "user", text: "Hello" }],
    },
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
    onSubmit: noop,
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
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
}
function render(pane: SessionPaneProps) {
  act(() => root.render(createElement(SessionPane, pane)));
}
function field() {
  return container.querySelector<HTMLTextAreaElement>(
    '[aria-label="Message Captain"]',
  )!;
}

it("shows the member work log without a full-height greeting hiding it below the fold", () => {
  probes.member = true;
  const pane = props();
  pane.session.blocks = [];
  render(pane);
  expect(
    container.querySelector('[aria-label="Member work log"]')?.textContent,
  ).toContain("No assignments yet.");
  expect(
    container.querySelector("header")?.classList.contains("min-h-full"),
  ).toBe(false);
  expect(field()).not.toBeNull();
});

it("updates the member header from live session and roster state", () => {
  probes.member = true;
  const pane = props();
  pane.session.blocks = [];
  pane.session.busy = true;
  render(pane);
  expect(
    container.querySelector('header [data-mono-status="working"]')?.textContent,
  ).toContain("Working");

  render({
    ...pane,
    monoState: { status: "needs-you", activity: "Review decision" },
  });
  expect(
    container.querySelector('header [data-mono-status="needs-you"]')
      ?.textContent,
  ).toContain("Review decision");

  render({ ...pane, session: { ...pane.session, busy: false } });
  expect(
    container.querySelector('header [data-mono-status="idle"]')?.textContent,
  ).toContain("Idle");
});

it("keeps the same input, current draft and attachments when a question appears and closes", async () => {
  setComposerDraft("chat", "Initial draft");
  const pane = props();
  pane.onSubmit = vi.fn();
  render(pane);
  const input = field();
  const inputProps = Object.entries(input).find(([key]) =>
    key.startsWith("__reactProps"),
  )![1];
  act(() => inputProps.onChange({ target: { value: "Fresh draft" } }));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!
      .click(),
  );
  const questioned = {
    ...pane,
    session: {
      ...pane.session,
      pendingQuestion: {
        requestId: 1,
        questions: [
          {
            id: "q",
            prompt: "Which project?",
            multiSelect: false,
            allowCustom: true,
            options: [],
          },
        ],
      },
    },
  };
  render(questioned);
  expect(container.querySelector("[data-question-form]")).not.toBeNull();
  expect(field()).toBe(input);
  expect(field().value).toBe("Fresh draft");
  expect(container.querySelector('[title="/tmp/note.txt"]')).not.toBeNull();
  render(pane);
  expect(field()).toBe(input);
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
  );
  expect(pane.onSubmit).toHaveBeenCalledWith("chat", "Fresh draft", [
    expect.objectContaining({ id: "file" }),
  ]);
});

it("routes transcript quotes to the Mono draft", () => {
  render(props());
  const quote = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Quote response")!;
  act(() => quote.click());
  expect(field().value).toBe("> Selected response\n\n");
});

it("shows usage recovery above the Mono input and routes the reset option", () => {
  setComposerDraft("chat", "Keep my draft");
  const pane = props();
  pane.session.usageLimit = { resetsAt: Date.now() + 3600_000 };
  pane.onUsageLimitResumeAtReset = vi.fn();
  render(pane);
  expect(container.querySelector("[data-usage-limit]")?.textContent).toContain(
    "usage limit reached",
  );
  expect(
    container.querySelector('[aria-label="Choose another model"]'),
  ).not.toBeNull();
  expect(field().value).toBe("Keep my draft");
  const reset = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === "Resume at reset")!;
  act(() => reset.click());
  expect(pane.onUsageLimitResumeAtReset).toHaveBeenCalledWith("chat", true);
  render({ ...pane, session: { ...pane.session, usageLimit: undefined } });
  expect(container.querySelector("[data-usage-limit]")).toBeNull();
  expect(field().value).toBe("Keep my draft");
});

it("shows pending messages in the conversation and routes retry from the bubble", () => {
  const pane = props();
  pane.onResumeQueue = vi.fn();
  pane.session = {
    ...pane.session,
    busy: true,
    queueStatus: "paused",
    queuedMessages: [
      {
        id: "first",
        text: "Follow up",
        attachments: [],
        error: "Connection lost",
      },
    ],
  };
  render(pane);
  expect(container.querySelector("[data-message-queue]")).toBeNull();
  const transcript = probes.transcript.mock.calls.at(-1)![0];
  expect(
    transcript.blocks.map((block: { text: string }) => block.text),
  ).toEqual(["Hello", "Follow up"]);
  expect(transcript.messageDeliveries.get("first")).toEqual({
    status: "failed",
    error: "Connection lost",
  });
  act(() => transcript.onRetryMessage("first"));
  expect(pane.onResumeQueue).toHaveBeenCalledWith("chat");
  expect(field()).not.toBeNull();
});

it("shows a worker checkout notice while keeping the user's composer send enabled", () => {
  probes.mono = false;
  probes.checkoutNotice.mockReturnValue("Native Core is working here; your changes may conflict");
  const pane = props();
  pane.session.worktreeCwd = "/worktrees/native-core";
  pane.onSubmit = vi.fn();
  render(pane);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Native Core is working here; your changes may conflict",
  );
  expect(probes.checkoutNotice).toHaveBeenCalledWith("chat", pane.session);
  const send = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "Send user message")!;
  expect(send.disabled).toBe(false);
  act(() => send.click());
  expect(pane.onSubmit).toHaveBeenCalledWith("chat", "Continue my work", [], undefined);
});

it("routes a previously blocked user's failed-send Retry through the existing queue", () => {
  probes.mono = false;
  const pane = props();
  pane.onResumeQueue = vi.fn();
  pane.session.queueStatus = "paused";
  pane.session.queuedMessages = [{
    id: "blocked", text: "Continue my work", attachments: [],
    error: "This checkout has an active orchestrator. Stop that run before starting independent work.",
  }];
  render(pane);
  const transcript = probes.transcript.mock.calls.at(-1)![0];
  expect(transcript.messageDeliveries.get("blocked").status).toBe("failed");
  act(() => transcript.onRetryMessage("blocked"));
  expect(pane.onResumeQueue).toHaveBeenCalledWith("chat");
  expect(probes.composer.mock.calls.at(-1)![0].disabled).toBe(false);
});

it("keeps internal notifications out of the Mono's composer and user outbox", () => {
  const pane = props();
  pane.session = {
    ...pane.session,
    busy: true,
    pendingMonoEvents: [
      {
        id: "notification",
        text: "Hidden completion review prompt",
        attachments: [],
        monoSessionCompletion: {
          sessionId: "worker",
          title: "API fix",
          status: "completed",
        },
      },
    ],
  };
  render(pane);
  expect(container.querySelector("[data-message-queue]")).toBeNull();
  expect(container.textContent).not.toContain(
    "Hidden completion review prompt",
  );
  expect(container.textContent).not.toContain("Session completed: API fix");
  expect(field()).not.toBeNull();
});

it("keeps rapid sends out of the queue and steer interface", () => {
  const pane = props();
  pane.session = {
    ...pane.session,
    busy: true,
    blocks: [
      ...pane.session.blocks,
      { id: "first", role: "user", text: "Also this", sentAt: 1000 },
      { id: "second", role: "user", text: "And that", sentAt: 1100 },
    ],
    queuedMessages: [
      { id: "first", blockId: "first", text: "Also this", attachments: [] },
      { id: "second", blockId: "second", text: "And that", attachments: [] },
    ],
  };
  render(pane);
  const transcript = probes.transcript.mock.calls.at(-1)![0];
  expect(transcript.blocks).toBe(pane.session.blocks);
  expect(transcript.messageDeliveries.size).toBe(2);
  expect(container.querySelector("[data-message-queue]")).toBeNull();
  expect(
    container.querySelector('[aria-label="Edit queued message"]'),
  ).toBeNull();
  expect(container.textContent).not.toContain("Steer");
});

it.each([true, false])(
  "wires a rejected turn's retry notice for Mono and normal sessions (Mono: %s)",
  (mono) => {
    probes.mono = mono;
    const pane = props();
    pane.onResumeQueue = vi.fn();
    pane.session = {
      ...pane.session,
      queueStatus: "paused",
      queuedMessages: [
        {
          id: "user",
          blockId: "user",
          text: "Hello",
          attachments: [],
          error: "Checkout controlled",
        },
      ],
    };
    render(pane);
    const transcript = probes.transcript.mock.calls.at(-1)![0];
    expect(transcript.messageDeliveries.get("user")).toEqual({
      status: "failed",
      error: "Checkout controlled",
    });
    act(() => transcript.onRetryMessage("user"));
    expect(pane.onResumeQueue).toHaveBeenCalledWith("chat");
  },
);
