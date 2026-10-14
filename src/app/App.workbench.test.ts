// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { workbenchAppDeclarations } from "../../tests/browser/ccwb1AppPaths";
import { newSession, type Session } from "../features/sessions/model/session";
import * as queue from "../features/sessions/model/messageQueue";
import {
  enqueueMonoMessage,
  acknowledgeMonoMessage,
} from "../features/monos/model/monoMessaging";
import { deliverQueuedFollowUp } from "../features/sessions/model/queuedFollowUp";
import { displayAttachments } from "../features/sessions/model/attachments";
import { inboxAskPrompt } from "../features/inbox/model/inboxAsk";
import { TurnNotReadyError } from "../integrations/harness/core/types";
import * as visits from "../features/workspace/model/tabVisitHistory";

afterEach(() => vi.useRealTimers());
const noop = () => {};
const declarations = workbenchAppDeclarations(
  readFileSync("src/app/App.tsx", "utf8"),
);
function bind(host: any) {
  Function("host", `with (host) { ${declarations.compiled} }`)(host);
  return host;
}
function deliveryHost(choice?: "queue" | "steer") {
  const session = {
    ...newSession("codex", "/synthetic"),
    id: "home",
    busy: true,
    turnReady: true,
  };
  const host: any = {
    ...queue,
    enqueueMonoMessage,
    acknowledgeMonoMessage,
    deliverQueuedFollowUp,
    displayAttachments,
    inboxAskPrompt,
    sessions: [session],
    sessionsRef: { current: [session] },
    current: session,
    sessionId: "home",
    mono: true,
    options: { followUpBehavior: choice },
    text: "Follow-up",
    submittedText: "Follow-up",
    attachments: [],
    noteCard: undefined,
    handoffCard: undefined,
    intent: "default",
    rawCommand: false,
    userTurnCards: () => ({}),
    dismissNoticesForContinuedSession: noop,
    monoForSession: () => ({ role: "member" }),
    canSteerHarness: () => true,
    consumeOperatorCommand: (text: string) => ({
      matched: text.startsWith("/operator"),
    }),
    operatorCommand: { matched: false },
    queueDispatchingRef: { current: new Set() },
    codexStorageRecovery: { current: { isRepairingAccount: () => false } },
    codexStorageAccountId: () => undefined,
    selectedProviderAccountId: () => undefined,
    window,
    setQueueDispatchVersion: noop,
    turnGen: { current: new Map([["home", 1]]) },
    upsertSession: vi.fn(async () => null),
    prepareAttachments: async (files: unknown) => files,
    preparePrompt: async (text: string) => text,
    harnessText: "Follow-up",
    initialWorkCwd: "/synthetic",
    savedRotation: undefined,
    assertMonoRotationCurrent: noop,
    flushHarnessEvents: noop,
    steerHarnessTurn: vi.fn(async () => {}),
    setSessions(update: Session[] | ((sessions: Session[]) => Session[])) {
      host.sessionsRef.current =
        typeof update === "function"
          ? update(host.sessionsRef.current)
          : update;
      host.sessions = host.sessionsRef.current;
    },
    submitSession: vi.fn(
      async (id: string, text: string, attachments: unknown, options: any) => {
        host.current = host.sessionsRef.current.find(
          (s: Session) => s.id === id,
        );
        host.options = options;
        host.text = host.submittedText = host.harnessText = text;
        host.attachments = attachments;
        if (
          !queue.queuedMessageForSubmit(
            host.current,
            options.queuedMessageId,
            options.followUpBehavior === "steer" ? "steer" : "dispatch",
          )
        )
          return false;
        if (host.current.busy) return host.deliver();
        // The idle provider boundary accepts a new turn; acknowledgement is production code.
        host.setSessions(
          host.sessions.map((s: Session) =>
            s.id === id
              ? acknowledgeMonoMessage(s, queue.queuedHead(s)!, {
                  mode: "new-turn",
                })
              : s,
          ),
        );
        return true;
      },
    ),
  };
  return bind(host);
}

it.each(["queue", "steer", undefined] as const)(
  "actual Home enqueue/scheduler/submission retains %s delivery",
  async (choice) => {
    vi.useFakeTimers();
    const host = deliveryHost(choice);
    expect(host.enqueue()).toBe(true);
    expect(queue.queuedHead(host.sessions[0])?.followUpBehavior).toBe(choice);
    host.dispatchQueue();
    await vi.runAllTimersAsync();
    if (choice === "queue") {
      expect(host.submitSession).not.toHaveBeenCalled();
      host.setSessions(
        host.sessions.map((s: Session) => ({ ...s, busy: false })),
      );
      host.dispatchQueue();
      await vi.runAllTimersAsync();
      expect(host.submitSession).toHaveBeenCalledOnce();
      expect(host.steerHarnessTurn).not.toHaveBeenCalled();
    } else {
      expect(host.submitSession).toHaveBeenCalledWith(
        "home",
        "Follow-up",
        [],
        expect.objectContaining({ followUpBehavior: "steer" }),
      );
      expect(host.steerHarnessTurn).toHaveBeenCalledOnce();
    }
    expect(host.sessions[0].queuedMessages).toBeUndefined();
    expect(
      host.sessions[0].blocks.filter((b: any) => b.role === "user"),
    ).toHaveLength(1);
  },
);

it.each([
  { queueStatus: "paused" },
  { turnReady: false },
  { editingQueuedMessageId: "head" },
  { worktreeRemoved: true },
  { pendingSwitch: { harness: "claude" } },
  { codexStorageError: "raw storage failure" },
])(
  "actual scheduler retains paused/non-ready guarded messages: %j",
  async (patch) => {
    vi.useFakeTimers();
    const host = deliveryHost("steer");
    host.enqueue();
    const id = queue.queuedHead(host.sessions[0])!.id;
    host.setSessions(
      host.sessions.map((s: Session) => ({
        ...s,
        ...patch,
        ...(patch.editingQueuedMessageId ? { editingQueuedMessageId: id } : {}),
      })),
    );
    host.dispatchQueue();
    await vi.runAllTimersAsync();
    expect(host.submitSession).not.toHaveBeenCalled();
    expect(queue.queuedHead(host.sessions[0])?.id).toBe(id);
  },
);

it("rechecks delivery choice at the timer and keeps later Steer behind Queue", async () => {
  vi.useFakeTimers();
  const host = deliveryHost("steer");
  host.enqueue();
  host.dispatchQueue();
  host.setSessions(
    host.sessions.map((s: Session) => ({
      ...s,
      queuedMessages: s.queuedMessages?.map((m) => ({
        ...m,
        followUpBehavior: "queue" as const,
      })),
    })),
  );
  host.current = host.sessions[0];
  host.options = { followUpBehavior: "steer" };
  host.enqueue();
  await vi.runAllTimersAsync();
  host.dispatchQueue();
  await vi.runAllTimersAsync();
  expect(host.submitSession).not.toHaveBeenCalled();
  expect(
    host.sessions[0].queuedMessages.map((m: any) => m.followUpBehavior),
  ).toEqual(["queue", "steer"]);
});

it("a deliberate Steer can still send the explicit Queue head", async () => {
  const host = deliveryHost("queue");
  host.enqueue();
  const head = queue.queuedHead(host.sessions[0])!;
  expect(
    await host.submitSession("home", head.text, [], {
      queuedMessageId: head.id,
      followUpBehavior: "steer",
    }),
  ).toBe(true);
  expect(host.steerHarnessTurn).toHaveBeenCalledOnce();
});

it.each(["stop", "not-ready", "failure"])(
  "queued submission retains generation/defer/raw failure handling: %s",
  async (kind) => {
    vi.useFakeTimers();
    const host = deliveryHost("steer");
    host.enqueue();
    host.preparePrompt = async () => {
      if (kind === "stop") host.turnGen.current.set("home", 2);
      if (kind === "not-ready") throw new TurnNotReadyError();
      if (kind === "failure") throw Error("raw preparation failure");
      return "Prepared";
    };
    host.dispatchQueue();
    await vi.runAllTimersAsync();
    expect(host.steerHarnessTurn).not.toHaveBeenCalled();
    expect(queue.queuedHead(host.sessions[0])).toBeDefined();
    if (kind === "failure")
      expect(queue.queuedHead(host.sessions[0])?.error).toBe(
        "raw preparation failure",
      );
    if (kind === "not-ready") expect(host.sessions[0].turnReady).toBe(false);
  },
);

it("explicit Task Queue wins over the background default while mandatory queues remain", () => {
  const follow = Function(
    "current",
    "mono",
    "options",
    "steerable",
    "intent",
    "operatorCommand",
    "loadFollowUpBehavior",
    `return ${declarations.followUp};`,
  );
  for (const mono of [true, false]) {
    expect(
      follow(
        { backgroundTasks: [{}] },
        mono,
        { followUpBehavior: "queue" },
        true,
        "default",
        { matched: false },
        () => "steer",
      ),
    ).toBe("queue");
    expect(
      follow(
        { backgroundTasks: [{}] },
        mono,
        {},
        true,
        "default",
        { matched: false },
        () => "queue",
      ),
    ).toBe("steer");
    expect(
      follow(
        {},
        mono,
        { followUpBehavior: "steer" },
        true,
        "plan",
        { matched: false },
        () => "steer",
      ),
    ).toBe("queue");
  }
});

it.each(["onVisitBack", "onVisitForward"])(
  "actual %s cancels cold loads, Mono opens and terminal focus",
  async (direction) => {
    let finish!: (session: Session) => void;
    const host: any = bind({
      ...visits,
      monoViewIdRef: { current: null },
      monoViewRequest: { current: 0 },
      activeTabIdRef: { current: "task-tab" },
      tabsRef: { current: [{ id: "task-tab" }] },
      tabVisitRef: {
        current: {
          current: "task-tab",
          back: direction === "onVisitBack" ? ["home"] : [],
          forward: direction === "onVisitForward" ? ["home"] : [],
        },
      },
      tabVisitFromHistoryRef: { current: false },
      workspaceSessionRequest: { current: 0 },
      monoForSession: (id: string) =>
        id === "home" ? { role: "member" } : undefined,
      listMonos: () => [{ role: "member", sessionId: "home" }],
      teamMap: { close: noop },
      workspaceNavigation: { cancel: vi.fn() },
      ensureOpenSession: () =>
        new Promise<Session>((resolve) => {
          finish = resolve;
        }),
      commitTabVisit: (next: unknown) => {
        host.tabVisitRef.current = next;
      },
      setMonoViewId: (id: string) => {
        host.view = id;
      },
      setMonoActivity: noop,
      setMonoSessions: noop,
      setMonoShownSessionFocused: vi.fn(),
      setProjectTerminalFocused: vi.fn(),
      setComposerFocused: vi.fn(),
      setComposerFocusToken: vi.fn(),
      activateTab: vi.fn(),
    });
    const pending = host.onSelectHistorySession("cold-task");
    const request = host.workspaceSessionRequest.current;
    host[direction]();
    expect(host.workspaceSessionRequest.current).toBe(request + 1);
    expect(host.monoViewRequest.current).toBe(1);
    finish({ ...newSession("codex", "/synthetic"), id: "cold-task" });
    await pending;
    expect(host.view).toBe("home");
    expect(host.activateTab).not.toHaveBeenCalled();
    expect(host.workspaceNavigation.cancel).toHaveBeenCalledTimes(2);
    expect(host.setProjectTerminalFocused).toHaveBeenCalledWith(false);
    expect(host.setMonoShownSessionFocused).toHaveBeenCalledWith(false);
    expect(host.setComposerFocused).toHaveBeenCalledWith(true);
    expect(host.setComposerFocusToken).toHaveBeenCalledOnce();
    expect(host.tabVisitRef.current.current).toBe("home");
  },
);
