// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionPane, type SessionPaneProps } from "./SessionPane";
import { clearComposerDraft, setComposerDraft } from "../model/draftCache";
import { acceptMonoRotation, discardMonoRotationPendingInputs, loadMonoRotation, saveMonoRotation } from "../../monos/model/monoRotation";
import { registerBuiltinHarnesses } from "../../../integrations/harness/core/register";
import { resetHarnessModelOverlays, setHarnessModels } from "../model/models";

const probes = vi.hoisted(() => ({
  mono: true,
  member: false,
  org: false,
  actualPane: false,
  pick: vi.fn(),
  transcript: vi.fn(),
  composer: vi.fn(),
  modelPicker: vi.fn(),
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
vi.mock("./ModelPicker", async (original) => {
  const actual = await original<typeof import("./ModelPicker")>();
  return {
    ...actual,
    ModelPicker: (props: Parameters<typeof actual.ModelPicker>[0]) => {
      probes.modelPicker(props);
      return createElement(actual.ModelPicker, props);
    },
  };
});
vi.mock("./Composer", async (original) => {
  const actual = await original<typeof import("./Composer")>();
  return { ...actual,
  Composer: (props: Parameters<typeof actual.Composer>[0]) => {
    probes.composer(props);
    if (probes.actualPane) return createElement(actual.Composer, props);
    return createElement(
      "button",
      {
        disabled: props.disabled,
        onClick: () => props.onSubmit("Continue my work", []),
      },
      "Send user message",
    );
  },
  };
});
vi.mock("../hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: probes.pick,
}));
vi.mock("./AgentTranscript", async (original) => {
  const actual = await original<typeof import("./AgentTranscript")>();
  return { ...actual,
  MonoActivityTrail: () => createElement("p", null, "Activity steps"),
  AgentTranscript: (props: Parameters<typeof actual.AgentTranscript>[0]) => {
    probes.transcript(props);
    if (probes.actualPane) return createElement(actual.AgentTranscript, props);
    return createElement(
      "button",
      { onClick: () => props.onAddToChat?.("Selected response") },
      "Quote response",
    );
  },
  };
});
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
          role: probes.member ? "member" : probes.org ? "manager" : undefined,
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
  probes.org = false;
  probes.actualPane = false;
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
  resetHarnessModelOverlays();
  probes.transcript.mockClear();
  probes.composer.mockClear();
  probes.modelPicker.mockClear();
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
  resetHarnessModelOverlays();
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

it("passes a new-goal route from the embedded composer to the shared submit boundary", async () => {
  const pane = props();
  const onSubmitGoal = vi.fn(async () => true);
  pane.onSubmitGoal = onSubmitGoal;
  pane.onSubmit = vi.fn();
  pane.monoGoalRouting = {
    ownerId: "grand",
    projects: [{ id: "dzdistro", name: "DZDistro", path: "C:/projects/dzdistro", managerMonoId: "manager", available: true }],
  };
  setComposerDraft("chat", "Fix DZDistro checkout");
  render(pane);
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "New goal")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(onSubmitGoal).toHaveBeenCalledWith("chat", "Fix DZDistro checkout", [],
    expect.objectContaining({
      projectId: "dzdistro", managerMonoId: "manager", reason: "Exact project name",
      requestId: expect.any(String), userMessageId: expect.any(String),
    }),
  );
  expect(pane.onSubmit).not.toHaveBeenCalled();
  expect(field().value).toBe("");
  expect(container.querySelector('[data-mono-goal-route] [aria-pressed="true"]')?.textContent).toBe("Chat");
});

it("shows the member work log without a full-height greeting hiding it below the fold", () => {
  probes.member = true;
  const pane = props();
  pane.session.blocks = [];
  render(pane);
  expect(
    container.querySelector('[aria-label="Member work log"]')?.textContent,
  ).toContain("No assignments yet");
  expect(
    container.querySelector("header")?.classList.contains("min-h-full"),
  ).toBe(false);
  expect(field()).not.toBeNull();
  expect(
    container.querySelector("[data-member-work]")!.classList.contains("cc7u-work"),
  ).toBe(true);
  expect(
    container
      .querySelector('[data-workbench-conversation] [role="tabpanel"]')!
      .classList.contains("flex-1"),
  ).toBe(true);
});

it("updates the member header from live session and roster state", () => {
  probes.member = true;
  const pane = props();
  pane.session.blocks = [];
  pane.session.busy = true;
  render(pane);
  expect(
    container.querySelector('header [data-agent-state="thinking"]')?.textContent,
  ).toBe("Thinking");

  render({
    ...pane,
    monoState: { status: "needs-you", liveState: { status: "needs-you", reason: "decision", detail: "Review decision" } },
  });
  expect(
    container.querySelector('header')?.textContent,
  ).toContain("Review decision");

  render({ ...pane, session: { ...pane.session, busy: false } });
  expect(
    container.querySelector('header [data-agent-state="idle"]')?.textContent,
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
    '[aria-label="Conversation couldn’t start"]',
  )!;
  const log = container.querySelector('[aria-label="Member work log"]')!;
  const queue = container.querySelector('[aria-label="Message queue"]')!;
  const conversation = container.querySelector('[data-workbench-conversation] [role="tabpanel"]')!;
  expect(
    notice.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    queue.compareDocumentPosition(conversation) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const delivery = "Message will queue until storage is repaired.";
  expect(queue.textContent).not.toContain(delivery);
  expect(container.querySelector("[data-session-composer]")?.textContent).toContain(delivery);
  expect(container.textContent?.split(delivery)).toHaveLength(2);
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
  const tabs = container.querySelectorAll<HTMLButtonElement>('[aria-label="Member view"] [role="tab"]');
  const conversation =
    container.querySelector<HTMLElement>('[data-workbench-conversation] [role="tabpanel"]')!;
  const notice = container.querySelector(
    '[aria-label="Conversation couldn’t start"]',
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
    container.querySelector('[aria-label="Conversation couldn’t start"]'),
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
    '[aria-label="Conversation couldn’t start"]',
  )!;
  expect(notice.textContent).toContain("Assigned worker: Review the patch");
  const repair = [...notice.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Resolve storage",
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
  expect(header.textContent).toContain("1.2k in");
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
    "Last conversation turn",
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
    "Last conversation turn",
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

it("steers through the existing submission boundary and retains a rejected draft", async () => {
  probes.member = true;
  const pane = props();
  pane.session.busy = true;
  pane.session.blocks[0].startedAt = Date.now();
  pane.onSubmit = vi.fn(() => false);
  setComposerDraft("chat", "Check the new evidence first");
  render(pane);
  const steer = [...container.querySelectorAll<HTMLButtonElement>("header button")].find((button) => button.textContent === "Steer")!;
  expect(steer.disabled).toBe(false);
  act(() => steer.click());
  expect(container.querySelector(".cc7u-delivery")?.textContent).toContain("steer the current turn");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(pane.onSubmit).toHaveBeenCalledWith("chat", "Check the new evidence first", [], { followUpBehavior: "steer" });
  expect(field().value).toBe("Check the new evidence first");
});

it("disables Workbench steering while recovery or a decision holds the conversation", () => {
  probes.member = true;
  const pane = props();
  pane.session.busy = true;
  for (const held of [
    { codexStorageError: "Storage unavailable" },
    { worktreeRemoved: true },
    { pendingQuestion: { requestId: 1, questions: [] } },
    { worktreePreparing: true },
  ]) {
    render({ ...pane, session: { ...pane.session, ...held } });
    const steer = [...container.querySelectorAll<HTMLButtonElement>("header button")].find((button) => button.textContent === "Steer")!;
    expect(steer.disabled).toBe(true);
  }
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

it.each([false, true])(
  "forwards setting IDs from the embedded Mono picker and effort control (member: %s)",
  async (member) => {
    probes.member = member;
    setHarnessModels("codex", [{
      id: "codex:up1-test",
      harness: "codex",
      name: "UP1 test model",
      settings: [{
        id: "reasoningEffort",
        label: "Effort",
        kind: "select",
        value: "medium",
        options: [
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      }],
    }]);
    const pane = props();
    pane.session.model = "codex:up1-test";
    pane.session.modelSettings = { reasoningEffort: "medium" };
    pane.onModelSettingsChange = vi.fn();
    render(pane);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Effort: Medium"]')!.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find(button => button.textContent?.trim() === "High")!;
    await act(async () => option.click());
    expect(pane.onModelSettingsChange).toHaveBeenCalledExactlyOnceWith(
      "chat", { reasoningEffort: "high" }, "reasoningEffort",
    );

    // The beside-picker layout hides its settings; retain its callback too.
    const settings = { reasoningEffort: "medium", serviceTier: "fast" };
    act(() => probes.modelPicker.mock.calls.at(-1)![0].onSettingsChange(settings, "serviceTier"));
    expect(pane.onModelSettingsChange).toHaveBeenLastCalledWith(
      "chat", settings, "serviceTier",
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

it("keeps ready completion notifications out of the composer while they deliver", () => {
  const pane = props();
  const notification = {
    id: "notification",
    text: "Hidden completion review prompt",
    attachments: [],
    monoSessionCompletion: {
      sessionId: "worker",
      title: "API fix",
      status: "completed" as const,
    },
  };
  pane.session = {
    ...pane.session,
    busy: false,
    queueStatus: "active",
    queuedMessages: [notification],
  };
  render(pane);
  expect(container.querySelector("[data-message-queue]")).toBeNull();
  expect(container.textContent).not.toContain(
    "Hidden completion review prompt",
  );
  expect(pane.session.queuedMessages).toEqual([notification]);
  expect(probes.transcript.mock.calls.at(-1)![0].messageDeliveries.size).toBe(
    0,
  );
  expect(field()).not.toBeNull();
});

it("keeps failed completion notifications visible and lets the user retry them", () => {
  const pane = props();
  pane.onResumeQueue = vi.fn();
  pane.session = {
    ...pane.session,
    busy: false,
    queueStatus: "paused",
    queuedMessages: [
      {
        id: "notification",
        text: "Hidden completion review prompt",
        attachments: [],
        error: "Connection lost",
        monoSessionCompletion: {
          sessionId: "worker",
          title: "API fix",
          status: "completed",
        },
      },
    ],
  };
  render(pane);
  const queue = container.querySelector("[data-message-queue]")!;
  expect(queue.textContent).toContain("Session completed: API fix");
  expect(queue.textContent).toContain("Connection lost");
  expect(queue.textContent).not.toContain("Hidden completion review prompt");
  const retry = [...queue.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Retry",
  )!;
  act(() => retry.click());
  expect(pane.onResumeQueue).toHaveBeenCalledWith("chat");
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
    "Context refresh deferred: constraints, scope or references too large",
  );
  expect(container.textContent).toContain(
    "Compact manually or trim the next input",
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

it("clears an initial oversized draft deferral after real meter compaction and draft trimming", async () => {
  const pane = props();
  pane.session.providerSessionId = "thread";
  pane.session.context = { used: 700_000, window: 1_000_000 };
  setComposerDraft("chat", "x".repeat(8001));
  pane.onCompactContext = vi.fn(() => {
    pane.session = { ...pane.session, context: { used: 0, window: 1_000_000 } };
    render(pane);
    return true;
  });
  render(pane);
  expect(container.textContent).toContain("Compact manually or trim the next input");
  await act(async () => container.querySelector<HTMLButtonElement>('[title="Context usage"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Compact now")!.click());
  expect(pane.onCompactContext).toHaveBeenCalledExactlyOnceWith("chat");
  expect(container.textContent).not.toContain("Context refresh deferred");
  expect(field().value).toHaveLength(8001);
  render({ ...pane, session: { ...pane.session, context: { used: 700_000, window: 1_000_000 } } });
  const inputProps = Object.entries(field()).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => inputProps.onChange({ target: { value: "Continue" } }));
  expect(container.querySelector('[title="Context usage"]')?.getAttribute("aria-label")).toContain("Will refresh context before next turn");
  expect(container.textContent).not.toContain("Context refresh deferred");
});

it("plans a retained task edit with its replacement input and retained assignment", () => {
  probes.mono = false;
  probes.runs = [{ leadId: "lead", tasks: [{ id: "task", title: "Patch", sessionId: "chat", memberId: "worker", status: "queued", prompt: "Verify the parser only." }], dispatches: [] }];
  const pane = props();
  pane.session.harness = "opencode";
  pane.session.blocks = [{ id: "scope", role: "user", text: "Do not publish." }, { id: "failed", role: "user", text: "x".repeat(8001) }];
  pane.session.providerSessionId = "thread";
  pane.session.context = { used: 70_000, window: 100_000 };
  render(pane);
  expect(probes.transcript.mock.calls.at(-1)![0].onEditLastTurn).toBeTypeOf("function");
  expect(probes.composer.mock.calls.at(-1)![0].rotationScheduled).toBe(false);
  act(() => {
    probes.composer.mock.calls.at(-1)![0].onEditingLastTurnChange(true);
    probes.composer.mock.calls.at(-1)![0].onDraftChange("Verify tests only.");
  });
  expect(probes.composer.mock.calls.at(-1)![0].rotationScheduled).toBe(true);
  expect(probes.composer.mock.calls.at(-1)![0].rotationDeferredReason).toBeUndefined();
});

it("locks the actual task Edit and keyboard recall until the original carry is accepted", async () => {
  probes.mono = false;
  probes.actualPane = true;
  probes.runs = [{ leadId: "lead", tasks: [{ id: "task", title: "Patch", sessionId: "chat", memberId: "worker", status: "queued", prompt: "Verify the parser only." }], dispatches: [] }];
  const pane = props();
  pane.session.harness = "opencode";
  pane.session.blocks = [{ id: "scope", role: "user", text: "Do not publish." }, { id: "failed", role: "user", text: "Original continuation" }];
  saveMonoRotation("chat", { at: 1, reason: "context", afterBlockId: "scope", earlier: [],
    pendingBrief: "Do not publish.\nOriginal assignment: Verify the parser only.", pendingInput: "Original continuation" });
  render(pane);
  const reason = "Retry the original first. Editing is available after it's accepted.";
  const edit = container.querySelector<HTMLButtonElement>('[aria-label="Edit and resend"]')!;
  expect(edit.disabled).toBe(true);
  expect(edit.title).toBe(reason);
  expect(container.textContent).toContain(reason);
  expect(container.querySelectorAll(".user-message-actions")).toHaveLength(1);
  const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    edit.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    edit.click();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  });
  expect(input.value).toBe("");
  expect(container.querySelector('[aria-label="Cancel edit"]')).toBeNull();
  expect(loadMonoRotation("chat")?.pendingInput).toBe("Original continuation");
  await acceptMonoRotation("chat", 1);
  render({ ...pane, session: { ...pane.session } });
  const enabled = container.querySelector<HTMLButtonElement>('[aria-label="Edit and resend"]')!;
  expect(enabled.disabled).toBe(false);
  await act(async () => {
    enabled.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    enabled.click();
  });
  expect(input.value).toBe("Original continuation");
  expect(container.querySelector('[aria-label="Cancel edit"]')).not.toBeNull();
  expect(container.textContent).not.toContain(reason);
});

it.each(["primary", "org", "member", "task"])(
  "previews every oversized pending input and only discards after confirmation in a %s pane",
  async (kind) => {
    probes.mono = kind !== "task";
    probes.org = kind === "org";
    probes.member = kind === "member";
    probes.actualPane = true;
    if (kind === "task") probes.runs = [{ leadId: "lead", tasks: [{ id: "task", title: "Patch", sessionId: "chat", memberId: "worker", status: "queued", prompt: "Verify the parser only." }], dispatches: [] }];
    const pane = props();
    pane.session.harness = "opencode";
    const original = `Pending start ${"x".repeat(8_001)} pending end`;
    pane.session.blocks = [{ id: "scope", role: "user", text: "Do not publish." }, { id: "failed", role: "user", text: "Visible failed continuation" }];
    const before = { at: 1, reason: "context" as const, afterBlockId: "scope", earlier: ["Retained history"], userRequests: [{ id: "scope", text: "Do not publish." }],
      pendingBrief: "Do not publish.\nOriginal assignment: Verify the parser only.", pendingInput: original, pendingInputs: ["Saved second continuation"] };
    saveMonoRotation("chat", before);
    pane.onDiscardRotationPendingInput = vi.fn((_id, preview) => discardMonoRotationPendingInputs(pane.session, preview));
    render(pane);
    if (kind !== "task") expect(container.querySelector('[aria-label="Edit and resend"]')).toBeNull();
    const discard = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Discard pending input")!;
    await act(async () => {
      discard.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      discard.click();
    });
    const preview = document.querySelector<HTMLElement>('[aria-label="Pending input to discard"]')!;
    expect(preview.textContent).toContain(original);
    expect(preview.textContent).toContain("Saved second continuation");
    expect(preview.textContent).toContain("Visible failed continuation");
    expect(preview.textContent).not.toContain("Do not publish.");
    expect(pane.onDiscardRotationPendingInput).not.toHaveBeenCalled();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Cancel")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(loadMonoRotation("chat")).toEqual(before);
    await act(async () => discard.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Discard pending input")!.click());
    expect(pane.onDiscardRotationPendingInput).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(loadMonoRotation("chat")).toMatchObject({ pendingBrief: before.pendingBrief, userRequests: before.userRequests, earlier: before.earlier });
    expect(loadMonoRotation("chat")?.pendingInputs).toBeUndefined();
    expect(loadMonoRotation("chat")?.pendingInput).toBeUndefined();
    expect(pane.session.blocks).toHaveLength(2);
  },
);

it("keeps a changed carry after stale discard confirmation and reports the failure", async () => {
  const pane = props();
  const before = { at: 1, reason: "context" as const, afterBlockId: "user", earlier: [], pendingBrief: "Continue safely", pendingInput: "x".repeat(8_001) };
  saveMonoRotation("chat", before);
  pane.onDiscardRotationPendingInput = vi.fn((_id, preview) => discardMonoRotationPendingInputs(pane.session, preview));
  render(pane);
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Discard pending input")!.click());
  saveMonoRotation("chat", { ...before, pendingInputs: ["New pending input"] });
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Discard pending input")!.click());
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Could not discard pending input");
  expect(loadMonoRotation("chat")?.pendingInputs).toEqual(["New pending input"]);
});

it("shows acceptance-clearing recovery as a small status warning", () => {
  const pane = props();
  pane.session.rotationWarning = "Context refresh accepted; saving the cleared pending input is retrying.";
  pane.session.busy = true;
  render(pane);
  expect([...container.querySelectorAll('[role="status"]')].some(node => node.textContent === pane.session.rotationWarning)).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
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
  ).toContain("constraints, scope or references too large");
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
