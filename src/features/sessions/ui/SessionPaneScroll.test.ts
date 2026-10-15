// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionPane, type SessionPaneProps } from "./SessionPane";
import { TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";
import { getMonoTranscriptPage } from "../data/sessionStore";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";

const probes = vi.hoisted(() => ({
  composer: vi.fn(() => null),
  review: vi.fn(() => null),
  changes: vi.fn(() => null),
  member: false,
  runs: [] as OrchestrationRun[],
}));

vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("../../monos/ui/MonoComposer", () => ({
  MonoComposer: probes.composer,
}));
vi.mock("./SessionReview", () => ({
  SessionReview: probes.review,
  SessionChangesButton: probes.changes,
}));
vi.mock("../../inbox/model/githubTasks", () => ({
  formatRelativeTime: vi.fn(() => "Just now"),
  githubPrDiff: vi.fn(async () => ({ additions: 5, deletions: 0, files: [] })),
}));
vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: () => ({
    loading: false,
    error: null,
    checks: { checks: [] },
  }),
}));
vi.mock("../data/sessionStore", async (original) => ({
  ...(await original<typeof import("../data/sessionStore")>()),
  getMonoTranscriptPage: vi.fn(),
}));
vi.mock("../../orchestration/model/orchestration", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../orchestration/model/orchestration")
  >()),
  orchestrator: {
    subscribe: () => () => {},
    snapshot: () => probes.runs,
    hydrate: async () => {},
    checkoutNotice: () => null,
  },
}));
vi.mock("../../monos/model/mono", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../monos/model/mono")>()),
  monoForSession: () => ({
    id: "mono",
    sessionId: "chat",
    name: "Captain Awesome",
    mascot: "cat",
    color: "#6ba",
    projects: [],
    ...(probes.member ? { role: "member", reportsTo: "manager" } : {}),
  }),
}));

let container: HTMLDivElement;
let root: Root;
let observers: Array<{ targets: Element[]; resize: () => void }>;

beforeEach(() => {
  probes.runs = [];
  probes.composer.mockClear();
  probes.review.mockClear();
  probes.changes.mockClear();
  probes.member = false;
  vi.mocked(getMonoTranscriptPage).mockReset();
  observers = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(
    () => ({ cancel: vi.fn() }) as unknown as Animation,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets: Element[] = [];
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push({
          targets: this.targets,
          resize: () => callback([], this),
        });
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve() {}
      disconnect() {
        this.targets.length = 0;
      }
    },
  );
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noop = () => {};

function props(transcriptPool?: TranscriptPool): SessionPaneProps {
  return {
    session: {
      id: "chat",
      title: "Chat",
      cwd: "/repo",
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [
        { id: "user", role: "user", text: "Hello" },
        { id: "reply", role: "assistant", text: "Answer" },
      ],
    },
    visible: true,
    focused: false,
    inSplit: false,
    composerFocused: false,
    recents: [],
    transcriptPool,
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

it("shows an explicit usage storage repair hold, retries through its App callback, and clears after success", async () => {
  probes.member = false;
  const pane = props();
  const retry = vi.fn(async () => {});
  pane.session.usageLimit = {};
  pane.usageRecoveryError = () => "Usage recovery storage repair is pending: synthetic rejected write";
  pane.onRetryUsageRecovery = retry;
  pane.onOpenUsage = vi.fn();
  act(() => root.render(createElement(SessionPane, pane)));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sending stays paused until repair succeeds");
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Retry usage recovery repair")!;
  await act(async () => button.click());
  expect(retry).toHaveBeenCalledWith("chat");
  const usage = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "View all account usage")!;
  act(() => usage.click()); expect(pane.onOpenUsage).toHaveBeenCalledOnce();
  act(() => root.render(createElement(SessionPane, { ...pane, usageRecoveryError: () => undefined })));
  expect(container.textContent).not.toContain("Retry usage recovery repair");
});

it.each([false, true])("keeps Mono edit controls alongside member work logs (member: %s)", (member) => {
  probes.member = member;
  const pane = props();
  pane.session.blocks.splice(1, 0, {
    id: "edit",
    role: "tool",
    text: "Write report.md",
    tool: { kind: "edit", status: "completed", paths: ["/repo/report.md"] },
  });
  act(() => root.render(createElement(SessionPane, pane)));
  expect(probes.changes).toHaveBeenCalled();
  expect(probes.review).not.toHaveBeenCalled();
  expect(!!container.querySelector('[aria-label="Member work log"]')).toBe(member);
});

it.each([false, true])("shows reducer background waits through the actual SessionPane (pooled: %s)", (pooled) => {
  const pool = pooled ? new TranscriptPool() : undefined;
  const pane = props(pool);
  pane.session = applyHarnessEvent({ ...pane.session, busy: true }, { type: "background.updated", tasks: ["Review"] });
  act(() => root.render(createElement("div", null, createElement(SessionPane, pane), pool ? createElement(TranscriptPoolOutlet, { pool }) : null)));
  const action = container.querySelector('.compact-current-action')!;
  expect(action.textContent).toBe("Waiting for background task…");
  expect(action.getAttribute('title')).toBe("Review");
  expect(container.querySelector('[data-transcript-turn-work] > button')?.getAttribute('aria-expanded')).toBe('false');
  pane.session = applyHarnessEvent(pane.session, { type: "background.updated", tasks: [] });
  act(() => root.render(createElement("div", null, createElement(SessionPane, pane), pool ? createElement(TranscriptPoolOutlet, { pool }) : null)));
  expect(container.querySelector('.compact-current-action')?.textContent).not.toContain("background");
});

it("reveals the archived ready turn from the status count and keeps its card out of the latest-turn footer", async () => {
  const pane = props();
  pane.session.monoTranscript = { before: 20, firstBlockId: "user" };
  probes.runs = [
    {
      leadId: "manager",
      ownerSessionId: "chat",
      projectManager: true,
      cwd: "/repo",
      status: "active",
      tasks: [
        {
          id: "docs",
          title: "Docs",
          sessionId: "worker",
          harness: "codex",
          model: "codex:test",
          status: "completed",
          accepted: true,
          lastDispatchId: "dispatch",
          acceptedDispatchId: "dispatch",
          prUrl: "https://github.com/example/repo/pull/1",
          prReadyTurnId: "older-user",
          prReadyAt: 300,
          workspace: { checkoutCwd: "/worker", branch: "docs" },
        },
      ],
    },
  ] as OrchestrationRun[];
  vi.mocked(getMonoTranscriptPage).mockResolvedValueOnce({
    blocks: [
      { id: "older-user", role: "user", text: "Prepare docs", startedAt: 100 },
      { id: "older-reply", role: "assistant", text: "Docs are ready." },
    ],
    before: null,
    hasNewer: true,
  });
  const frames: FrameRequestCallback[] = [];
  vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  act(() => root.render(createElement(SessionPane, pane)));
  expect(container.querySelector("#manager-review-docs")).toBeNull();
  frames.length = 0;
  const count = [
    ...container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Manager queue status"] button',
    ),
  ].find((button) => button.textContent === "1 ready")!;
  await act(async () => count.click());
  expect(getMonoTranscriptPage).toHaveBeenCalledWith("chat", {
    aroundBlockId: "older-user",
  });
  act(() => {
    for (const callback of frames.splice(0)) callback(0);
  });
  await act(async () => {});
  const card = container.querySelector<HTMLElement>("#manager-review-docs")!;
  expect(
    card
      .closest("[data-transcript-turn]")
      ?.getAttribute("data-transcript-turn"),
  ).toBe("older-user");
  expect(container.querySelectorAll("#manager-review-docs")).toHaveLength(1);
  expect(document.activeElement).toBe(card);
  expect(scroll).not.toHaveBeenCalled();
});

it("routes a Mono footer activity click to its session and selected turn", () => {
  const pane = props();
  pane.session.blocks = [
    { id: "user", role: "user", text: "Inspect", durationMs: 23000 },
    {
      id: "call",
      role: "tool",
      text: "ls",
      tool: { kind: "shell", status: "completed" },
    },
    { id: "reply", role: "assistant", text: "Done" },
  ];
  const onShowMonoActivity = vi.fn();
  act(() =>
    root.render(createElement(SessionPane, { ...pane, onShowMonoActivity })),
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[data-turn-actions] [aria-label="Show activity"]',
      )!
      .click(),
  );
  expect(onShowMonoActivity).toHaveBeenCalledWith(
    "chat",
    "user",
    pane.session.blocks,
  );
  act(() =>
    root.render(
      createElement(SessionPane, {
        ...pane,
        onShowMonoActivity,
        monoActivityTurnId: "user",
      }),
    ),
  );
  expect(
    container
      .querySelector('[data-turn-actions] [aria-label="Hide activity"]')
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
});

it("routes a launched session's card to the Mono, its turn and the session", () => {
  const pane = props();
  pane.session.blocks[0] = {
    ...pane.session.blocks[0],
    monoSpawnedSessions: [
      {
        sessionId: "app-review",
        cwd: "/repo",
        title: "Review",
        harness: "codex",
        model: "gpt-6",
      },
    ],
  };
  const onOpenMonoSession = vi.fn();
  const monoLaunchedSessions = new Map([
    ["app-review", { state: { status: "thinking" as const }, title: "Review" }],
  ]);
  act(() =>
    root.render(
      createElement(SessionPane, {
        ...pane,
        onOpenMonoSession,
        monoLaunchedSessions,
      }),
    ),
  );
  const card = container.querySelector<HTMLButtonElement>(
    '[data-launched-session="app-review"]',
  )!;
  expect(card.dataset.state).toBe("thinking");
  act(() => card.click());
  expect(onOpenMonoSession).toHaveBeenCalledWith(
    "chat",
    "user",
    pane.session.blocks,
    "app-review",
  );
  act(() =>
    root.render(
      createElement(SessionPane, {
        ...pane,
        onOpenMonoSession,
        monoLaunchedSessions,
        openMonoSessionId: "app-review",
      }),
    ),
  );
  expect(
    container
      .querySelector('[data-launched-session="app-review"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
});

it("renders older replies immediately when scrolling up loads a Mono page", async () => {
  const pane = props();
  pane.session.monoTranscript = { before: 20, firstBlockId: "user" };
  vi.mocked(getMonoTranscriptPage).mockResolvedValueOnce({
    blocks: [
      { id: "older-user", role: "user", text: "Earlier question" },
      { id: "older-reply", role: "assistant", text: "Earlier answer in full." },
    ],
    before: null,
    hasNewer: true,
  });
  act(() => root.render(createElement(SessionPane, pane)));
  const scroller =
    container.querySelector<HTMLDivElement>(".agent-transcript")!;
  await act(async () => {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  });
  expect(getMonoTranscriptPage).toHaveBeenCalledOnce();
  expect(getMonoTranscriptPage).toHaveBeenCalledWith("chat", { before: 20 });
  const olderReply = container.querySelector(
    '[data-chat-message="older-reply"]',
  )!;
  expect(olderReply.textContent).toBe("Earlier answer in full.");
  expect(olderReply.querySelector(".word-fading")).toBeNull();
  expect(olderReply.querySelector("[data-word-fade]")).toBeNull();
  expect(
    container.querySelector('[data-chat-message="reply"]')?.textContent,
  ).toBe("Answer");
});

it.each([
  { pooled: false, nativeOverscroll: false },
  { pooled: false, nativeOverscroll: true },
  { pooled: true, nativeOverscroll: false },
  { pooled: true, nativeOverscroll: true },
])(
  "leaves the first upward scroll to the browser (pooled: $pooled, native overscroll: $nativeOverscroll)",
  ({ pooled, nativeOverscroll }) => {
    vi.stubGlobal(
      "CSS",
      new Proxy(CSS, {
        get(target, property, receiver) {
          return property === "supports"
            ? () => nativeOverscroll
            : Reflect.get(target, property, receiver);
        },
      }),
    );
    const pool = pooled ? new TranscriptPool() : undefined;
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(SessionPane, props(pool)),
          pool ? createElement(TranscriptPoolOutlet, { pool }) : null,
        ),
      ),
    );
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    const content = scroller.querySelector<HTMLElement>(
      "[data-transcript-content]",
    )!;
    content.lastElementChild!.getBoundingClientRect = () =>
      ({
        top:
          100 -
          top +
          Number.parseFloat(
            content.style.transform.match(/translateY\((.*)px\)/)?.[1] ?? "0",
          ),
      }) as DOMRect;
    let top = 0;
    let height = 1000;
    const writes: number[] = [];
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
      clientWidth: { get: () => 640 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          writes.push(value);
          top = Math.max(0, Math.min(value, height - 400));
        },
      },
    });
    act(() => {
      for (const observer of observers) {
        if (observer.targets.includes(scroller)) observer.resize();
      }
    });
    expect(top).toBe(600);
    expect(container.querySelector("[data-jump-to-bottom]")).toBeNull();
    const downward = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
    act(() => scroller.dispatchEvent(downward));
    expect(downward.defaultPrevented).toBe(!nativeOverscroll);
    const composerRenders = probes.composer.mock.calls.length;
    const reviewRenders = probes.review.mock.calls.length;
    const changesRenders = probes.changes.mock.calls.length;
    writes.length = 0;

    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      top -= 4;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector("[data-jump-to-bottom]")).not.toBeNull();
    expect(top).toBe(596);
    expect(writes).toEqual([]);
    expect(probes.composer).toHaveBeenCalledTimes(composerRenders);
    expect(probes.review).toHaveBeenCalledTimes(reviewRenders);
    expect(probes.changes).toHaveBeenCalledTimes(changesRenders);

    act(() =>
      container
        .querySelector<HTMLButtonElement>("[data-jump-to-bottom]")!
        .click(),
    );
    expect(top).toBe(600);
    expect(container.querySelector("[data-jump-to-bottom]")).toBeNull();
    expect(probes.composer).toHaveBeenCalledTimes(composerRenders);
    expect(probes.review).toHaveBeenCalledTimes(reviewRenders);
    expect(probes.changes).toHaveBeenCalledTimes(changesRenders);

    // An idle chat follows directly; revisiting history doesn't ease its layout.
    height += 40;
    act(() => {
      for (const observer of observers) {
        if (observer.targets.includes(scroller)) observer.resize();
      }
    });
    expect(top).toBe(640);
    expect(content.style.transform).toBe("");
  },
);
