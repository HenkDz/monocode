// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionPane, type SessionPaneProps } from "./SessionPane";
import { clearComposerDraft, setComposerDraft } from "../model/draftCache";
import { saveMonoRotation } from "../../monos/model/monoRotation";
import { registerBuiltinHarnesses } from "../../../integrations/harness/core/register";

const probes = vi.hoisted(() => ({
  mono: true,
  member: false,
  pick: vi.fn(),
  transcript: vi.fn(),
  composer: vi.fn(),
  checkoutNotice: vi.fn(),
  runs: [] as {
    leadId: string;
    tasks: {
      id: string;
      title: string;
      sessionId: string;
      memberId: string;
      status: string;
      prompt?: string;
    }[];
    dispatches: [];
  }[],
}));
vi.mock("./Composer", () => ({
  Composer: (props: {
    disabled?: boolean;
    onSubmit: (text: string, attachments: []) => void;
  }) => {
    probes.composer(props);
    return createElement(
      "button",
      {
        disabled: props.disabled,
        onClick: () => props.onSubmit("Continue my work", []),
      },
      "Send user message",
    );
  },
}));
vi.mock("../hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: probes.pick,
}));
vi.mock("./AgentTranscript", () => ({
  MonoActivityTrail: () => createElement("p", null, "Activity steps"),
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
  registerBuiltinHarnesses();
  probes.mono = true;
  probes.member = false;
  probes.runs = [];
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
  expect(
    container.querySelector("[data-member-work]")!.classList.contains("flex-1"),
  ).toBe(true);
  expect(
    container
      .querySelector('[role="tabpanel"]')!
      .classList.contains("shrink-0"),
  ).toBe(true);
});

it("updates the member header from live session and roster state", () => {
  probes.member = true;
  const pane = props();
  pane.session.blocks = [];
  pane.session.busy = true;
  render(pane);
  expect(
    container.querySelector('header [data-mono-status="working"]')?.textContent,
  ).toBe("Thinking");

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

it("keeps member tasks outside the transcript for empty and ongoing conversations", () => {
  probes.member = true;
  const pane = props();
  setComposerDraft("chat", "Keep my draft");
  render(pane);
  const input = field();
  const log = container.querySelector('[aria-label="Member work log"]')!;
  expect(log).not.toBeNull();
  expect(
    probes.transcript.mock.calls.at(-1)![0].latestTurnAccessory,
  ).toBeUndefined();
  expect(log.contains(input)).toBe(false);
  expect(log.closest("[data-member-work]")).not.toBeNull();
  expect(log.contains(container.querySelector("[data-session-composer]"))).toBe(
    false,
  );
  render({ ...pane, session: { ...pane.session, blocks: [] } });
  expect(
    container.querySelectorAll('[aria-label="Member work log"]'),
  ).toHaveLength(1);
  expect(container.querySelector('[aria-label="Member work log"]')).toBe(log);
  expect(field()).toBe(input);
  expect(field().value).toBe("Keep my draft");
});

it("puts a member's blocked message queue above the conversation and routes edit/remove", () => {
  probes.member = true;
  const pane = props();
  pane.session.codexStorageError = "Synthetic account storage conflict";
  pane.session.queuedMessages = [
    {
      id: "queued",
      blockId: "queued-block",
      text: "Review the patch",
      attachments: [],
    },
  ];
  pane.session.blocks.push({
    id: "queued-block",
    role: "user",
    text: "Review the patch",
  });
  pane.onCodexStorageRepair = vi.fn(async () => {});
  pane.onEditQueuedMessage = vi.fn();
  pane.onDeleteQueuedMessage = vi.fn();
  render(pane);
  const notice = container.querySelector(
    '[aria-label="Codex storage needs repair"]',
  )!;
  const log = container.querySelector('[aria-label="Member work log"]')!;
  const queue = container.querySelector('[aria-label="Message queue"]')!;
  const conversation = container.querySelector('[role="tabpanel"]')!;
  expect(
    notice.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    queue.compareDocumentPosition(conversation) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(queue.textContent).toContain(
    "Message will queue until storage is repaired",
  );
  expect(
    probes.transcript.mock.calls
      .at(-1)![0]
      .blocks.map((block: { id: string }) => block.id),
  ).toEqual(["user"]);
  act(() =>
    queue
      .querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')!
      .click(),
  );
  expect(pane.onDeleteQueuedMessage).toHaveBeenCalledWith("chat", "queued");
  act(() =>
    queue
      .querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!
      .click(),
  );
  const input = queue.querySelector<HTMLTextAreaElement>(
    '[aria-label="Edit queued message"]',
  )!;
  const inputProps = Object.entries(input).find(([key]) =>
    key.startsWith("__reactProps"),
  )![1];
  act(() =>
    inputProps.onChange({ target: { value: "Review the latest patch" } }),
  );
  act(() =>
    queue
      .querySelector<HTMLButtonElement>('[aria-label="Save queued message"]')!
      .click(),
  );
  expect(pane.onEditQueuedMessage).toHaveBeenCalledWith(
    "chat",
    "queued",
    "Review the latest patch",
  );
});

it("keeps recovery, draft and the transcript mounted while member tabs change by keyboard", () => {
  probes.member = true;
  const pane = props();
  pane.session.codexStorageError = "Synthetic account storage conflict";
  pane.onCodexStorageRepair = vi.fn(async () => {});
  setComposerDraft("chat", "Keep my member draft");
  render(pane);
  const draft = field();
  const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  const conversation =
    container.querySelector<HTMLElement>('[role="tabpanel"]')!;
  const notice = container.querySelector(
    '[aria-label="Codex storage needs repair"]',
  );
  act(() =>
    tabs[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ),
  );
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs[1]);
  expect(conversation.hidden).toBe(true);
  expect(
    container.querySelector('[aria-label="Codex storage needs repair"]'),
  ).toBe(notice);
  expect(field()).toBe(draft);
  expect(field().value).toBe("Keep my member draft");
  act(() =>
    tabs[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  expect(conversation.hidden).toBe(false);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs[0]);
});

it("shows the assigned worker's storage recovery at the top and targets that worker", async () => {
  probes.member = true;
  probes.runs = [
    {
      leadId: "lead",
      tasks: [
        {
          id: "assigned",
          title: "Review the patch",
          sessionId: "worker",
          memberId: "mono",
          status: "queued",
        },
      ],
      dispatches: [],
    },
  ];
  const pane = props();
  pane.session.blocks = [];
  pane.monoState = {
    status: "needs-you",
    liveState: {
      status: "blocked",
      reason: "storage",
      detail: "Synthetic worker storage issue",
    },
  };
  pane.onCodexStorageRepair = vi.fn(async () => {});
  render(pane);
  const notice = container.querySelector(
    '[aria-label="Codex storage needs repair"]',
  )!;
  expect(notice.textContent).toContain("Assigned worker: Review the patch");
  const repair = [...notice.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Repair",
  )!;
  await act(async () => repair.click());
  expect(pane.onCodexStorageRepair).toHaveBeenCalledWith("worker");
  expect(
    container.querySelector("[data-session-composer]")!.textContent,
  ).toContain("Message will start the next turn");
});

it("labels the running member turn metrics separately from assignments", () => {
  probes.member = true;
  const pane = props();
  pane.session.busy = true;
  pane.session.blocks[0].startedAt = Date.now() - 60_000;
  pane.session.blocks[0].turnModel = {
    harness: "codex",
    id: "fixture",
    name: "Fixture",
  };
  pane.session.blocks[0].turnMetrics = {
    inputTokens: 1240,
    outputTokens: 78,
    modelCalls: 1,
  };
  render(pane);
  const header = container.querySelector("header")!;
  expect(header.textContent).toContain("Current conversation turn");
  expect(header.textContent).toContain("1,240 in");
  expect(header.textContent).not.toContain("No conversation turn running");
  render({
    ...pane,
    session: {
      ...pane.session,
      busy: false,
      codexStorageError: "Synthetic storage error",
    },
  });
  expect(container.querySelector("header")!.textContent).toContain(
    "No conversation turn running",
  );
  expect(
    container.querySelector('header [data-agent-state="blocked"]'),
  ).not.toBeNull();
  render({
    ...pane,
    session: { ...pane.session, busy: false },
    monoState: {
      status: "working",
      liveState: { status: "running-tool", detail: "Checking the worker task" },
    },
  });
  expect(container.querySelector("header")!.textContent).toContain(
    "Running tool",
  );
  expect(container.querySelector("header")!.textContent).toContain(
    "No conversation turn running",
  );
  expect(
    container.querySelector("[data-session-composer]")!.textContent,
  ).toContain("Message will start the next turn");
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
  probes.checkoutNotice.mockReturnValue(
    "Native Core is working here; your changes may conflict",
  );
  const pane = props();
  pane.session.worktreeCwd = "/worktrees/native-core";
  pane.onSubmit = vi.fn();
  render(pane);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Native Core is working here; your changes may conflict",
  );
  expect(probes.checkoutNotice).toHaveBeenCalledWith("chat", pane.session);
  const send = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Send user message")!;
  expect(send.disabled).toBe(false);
  act(() => send.click());
  expect(pane.onSubmit).toHaveBeenCalledWith(
    "chat",
    "Continue my work",
    [],
    undefined,
  );
});

it.each(["reasoningEffort", "serviceTier"])(
  "forwards the Composer's %s setting ID with the session ID",
  (settingId) => {
    probes.mono = false;
    const pane = props();
    pane.onModelSettingsChange = vi.fn();
    render(pane);
    const settings = { reasoningEffort: "high", serviceTier: "fast" };
    const composer = probes.composer.mock.calls.at(-1)![0];
    act(() => composer.onModelSettingsChange(settings, settingId));
    expect(pane.onModelSettingsChange).toHaveBeenCalledWith(
      "chat",
      settings,
      settingId,
    );
  },
);

it("routes a previously blocked user's failed-send Retry through the existing queue", () => {
  probes.mono = false;
  const pane = props();
  pane.onResumeQueue = vi.fn();
  pane.session.queueStatus = "paused";
  pane.session.queuedMessages = [
    {
      id: "blocked",
      text: "Continue my work",
      attachments: [],
      error:
        "This checkout has an active orchestrator. Stop that run before starting independent work.",
    },
  ];
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

it.each([false, true])(
  "shows scheduled refresh and unknown limit on real primary Mono surfaces (member: %s)",
  (member) => {
    probes.member = member;
    const pane = props();
    pane.session.providerSessionId = "thread";
    pane.session.context = { used: 70_000, window: 100_000 };
    render(pane);
    const trigger = container.querySelector('[title="Context usage"]')!;
    expect(container.querySelectorAll('[title="Context usage"]')).toHaveLength(
      1,
    );
    expect(
      field().compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(trigger.getAttribute("aria-label")).toContain(
      "Will refresh context before next turn",
    );
    render({
      ...pane,
      session: { ...pane.session, context: { used: 70_000 } },
    });
    expect(container.textContent).toContain("Context window unknown");
    expect(
      container
        .querySelector('[title="Context usage"]')
        ?.getAttribute("aria-label"),
    ).not.toContain("Will refresh");
    expect(field()).not.toBeNull();
  },
);

it("replaces a Mono refresh promise with the actual draft's size deferral and restores it after trimming", () => {
  const pane = props();
  pane.session.providerSessionId = "thread";
  pane.session.context = { used: 70_000, window: 100_000 };
  render(pane);
  const input = field();
  const inputProps = Object.entries(input).find(([key]) =>
    key.startsWith("__reactProps"),
  )![1];
  act(() => inputProps.onChange({ target: { value: "x".repeat(14_000) } }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Context refresh deferred: brief and next input too large",
  );
  expect(container.textContent).toContain(
    "Compact manually or trim constraints",
  );
  expect(
    container
      .querySelector('[title="Context usage"]')
      ?.getAttribute("aria-label"),
  ).not.toContain("Will refresh");
  expect(field().value).toHaveLength(14_000);
  act(() => inputProps.onChange({ target: { value: "Continue" } }));
  expect(
    container
      .querySelector('[title="Context usage"]')
      ?.getAttribute("aria-label"),
  ).toContain("Will refresh context before next turn");
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(field()).toBe(input);
});

it("explains an oversized protected carry at high occupancy and routes manual compaction", async () => {
  const pane = props();
  pane.session.providerSessionId = "thread";
  pane.session.context = { used: 990_000, window: 1_000_000 };
  pane.session.blocks[0].text = "x".repeat(8_001);
  pane.onCompactContext = vi.fn(() => true);
  render(pane);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "constraints, scope or references too large (8001 chars; limit 8,000)",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[title="Context usage"]')!
      .click(),
  );
  const action = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Compact now")!;
  await act(async () => action.click());
  expect(pane.onCompactContext).toHaveBeenCalledExactlyOnceWith("chat");
});

it("shows the pending carry's deferral after a detached failed startup without usage", () => {
  saveMonoRotation("chat", {
    at: 1,
    reason: "context",
    earlier: [],
    pendingBrief: "Continue safely",
    pendingInput: "x".repeat(8_001),
  });
  const pane = props();
  render(pane);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Context refresh deferred: constraints, scope or references too large",
  );
  expect(
    container
      .querySelector('[title="Context usage"]')
      ?.getAttribute("aria-label"),
  ).toContain("Context usage unknown");
});

it.each([
  { busy: true },
  { worktreePreparing: true },
  { codexStoragePreparing: true },
  { pendingQuestion: { requestId: 1, questions: [] } },
])(
  "keeps the Mono meter's manual compaction disabled during an operation or decision: %j",
  async (operation) => {
    const pane = props();
    Object.assign(pane.session, operation);
    pane.session.context = { used: 70_000, window: 100_000 };
    pane.onCompactContext = vi.fn(() => true);
    render(pane);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[title="Context usage"]')!
        .click(),
    );
    const action = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Compact now")!;
    expect(action.disabled).toBe(true);
    await act(async () => action.click());
    expect(pane.onCompactContext).not.toHaveBeenCalled();
  },
);

it("keeps compaction unavailable after the Mono's checkout was removed", () => {
  const pane = props();
  pane.session.worktreeRemoved = true;
  pane.session.context = { used: 70_000, window: 100_000 };
  render(pane);
  expect(container.querySelector('[title="Context usage"]')).toBeNull();
  expect(
    container.querySelector('svg[role="img"]')?.getAttribute("aria-label"),
  ).toContain("70% context used");
});

it("plans generic retained tasks with their current draft and full assignment scope", () => {
  probes.mono = false;
  probes.runs = [
    {
      leadId: "lead",
      tasks: [
        {
          id: "task",
          title: "Patch",
          sessionId: "chat",
          memberId: "mono",
          status: "queued",
          prompt: "Fix the parser",
        },
      ],
      dispatches: [],
    },
  ];
  const pane = props();
  pane.session.providerSessionId = "thread";
  pane.session.context = { used: 70_000, window: 100_000 };
  render(pane);
  expect(probes.composer.mock.calls.at(-1)![0].rotationScheduled).toBe(true);
  act(() =>
    probes.composer.mock.calls.at(-1)![0].onDraftChange("x".repeat(14_000)),
  );
  expect(probes.composer.mock.calls.at(-1)![0].rotationScheduled).toBe(false);
  expect(
    probes.composer.mock.calls.at(-1)![0].rotationDeferredReason,
  ).toContain("brief and next input too large");
  act(() => probes.composer.mock.calls.at(-1)![0].onDraftChange("Continue"));
  probes.runs[0].tasks[0].prompt = "x".repeat(8_001);
  render({ ...pane, session: { ...pane.session } });
  expect(probes.composer.mock.calls.at(-1)![0].rotationScheduled).toBe(false);
  expect(
    probes.composer.mock.calls.at(-1)![0].rotationDeferredReason,
  ).toContain("constraints, scope or references too large");
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
