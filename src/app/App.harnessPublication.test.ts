// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../features/sessions/model/session";
import { createMono, saveMonoSessionId, monoForSession } from "../features/monos/model/mono";
import * as queue from "../features/sessions/model/messageQueue";
import { applyHarnessEvents, stopStreaming } from "../integrations/harness/core/apply";
import { acknowledgeMonoMessage } from "../features/monos/model/monoMessaging";
import { HarnessEventQueue } from "./model/harnessFlush";

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
const { upsertSession, readPersistedSession } = await import("../features/sessions/data/sessionStore");
const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  function visit(node: ts.Node) { if (predicate(node)) result = node; else if (!result) ts.forEachChild(node, visit); }
  visit(app);
  if (!result) throw Error("Production App seam not found");
  return result;
}
function execute(node: ts.Node, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), ts.transpile(`return ${node.getText(app)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
function callback(name: string, scope: Record<string, unknown>) {
  const node = find(node => ts.isVariableDeclaration(node) && node.name.getText(app) === name) as ts.VariableDeclaration;
  return execute((node.initializer as ts.CallExpression).arguments[0], scope);
}
const constructor = find(node => ts.isNewExpression(node) && node.expression.getText(app) === "HarnessEventQueue") as ts.NewExpression;
const scheduler = find(node => ts.isCallExpression(node) && node.expression.getText(app) === "useEffect" && node.arguments[0]?.getText(app).includes("queueDispatchingRef.current.add")) as ts.CallExpression;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const records = new Map<string, Session>();
  transport.invoke.mockReset();
  transport.invoke.mockImplementation(async (command, args) => {
    if (command === "mono_session_get") return structuredClone(records.get(args.sessionId));
    if (command !== "mono_session_upsert") return null;
    const previous = records.get(args.session.id);
    let blocks = previous?.blocks ?? [];
    if (args.blocksChanged) {
      const anchor = args.afterBlockId ?? args.fromBlockId;
      const index = anchor ? blocks.findIndex(block => block.id === anchor) : 0;
      if (anchor && index < 0) throw Error("Missing diff anchor");
      blocks = [...blocks.slice(0, index + (args.afterBlockId ? 1 : 0)), ...args.session.blocks];
    }
    records.set(args.session.id, structuredClone({ ...args.session, blocks, createdAt: 1, updatedAt: 2 }));
    return { id: args.session.id, cwd: "/synthetic", harness: "claude", model: "", title: "", runtimeMode: "supervised", createdAt: 1, updatedAt: 2 };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mono(): Session {
  const session: Session = { ...newSession("claude", "/synthetic"), queueStatus: "paused",
    blocks: [{ id: "answer", role: "assistant", text: "Before", streaming: true }],
    queuedMessages: [{ id: "exact-request", text: "Retain rejected request", attachments: [] }] };
  saveMonoSessionId(createMono([session.cwd]).id, session.id);
  return session;
}

async function stateHost(initial: Session[], strict: boolean, layoutDelivery = false) {
  const sessionsRef = { current: initial };
  let publish!: React.Dispatch<React.SetStateAction<Session[]>>;
  const updateCalls = new Map<Function, number>();
  const setSessions: typeof publish = next => publish(typeof next === "function" ? previous => {
    updateCalls.set(next, (updateCalls.get(next) ?? 0) + 1); return next(previous);
  } : next);
  const syncDockBadge = vi.fn();
  const scope = { sessionsRef, setSessions, syncDockBadge, applyHarnessEvents };
  const events = new HarnessEventQueue(() => layoutDelivery, execute(constructor.arguments![1], scope));
  function Host() {
    const [sessions, setter] = React.useState(initial); sessionsRef.current = sessions; publish = setter;
    React.useLayoutEffect(() => { if (layoutDelivery) events.flushForeground(); });
    return null;
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Host)) : React.createElement(Host)));
  return { ...scope, events, updateCalls,
    close: async () => { events.cancelScheduled(); await React.act(async () => root.unmount()); container.remove(); } };
}

for (const strict of [false, true]) {
  it(`keeps generated identities across removed/reordered sessions and successive batches, StrictMode=${strict}`, async () => {
    const original = [mono(), mono(), mono()].map(session => ({ ...session, busy: true,
      blocks: [{ id: `turn-${session.id}`, role: "user" as const, text: "Run", startedAt: 100 }] }));
    const [removed, target, sibling] = original;
    const host = await stateHost(original, strict);
    let at = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => at++);
    const snapshots = new Map<string, Session["blocks"]>();
    try {
      await React.act(async () => {
        host.setSessions(previous => [previous[2], previous[1]]);
        callback("onEditQueuedMessage", host)(target.id, "exact-request", "Latest pending edit");
        for (const session of original) {
          host.events.enqueue(session.id, { type: "message.delta", text: `Answer ${session.id}` });
          host.events.enqueue(session.id, { type: "tool.started", callId: "first", title: "First tool" });
        }
        host.events.flush();
        for (const session of original) host.events.enqueue(session.id, { type: "message.delta", text: "Second batch" });
        host.events.flush();
        for (const session of host.sessionsRef.current) snapshots.set(session.id, structuredClone(session.blocks));
        at += 1_000;
      });
      expect(host.sessionsRef.current.map(session => session.id)).toEqual([sibling.id, target.id]);
      expect(host.sessionsRef.current.find(session => session.id === removed.id)).toBeUndefined();
      for (const session of host.sessionsRef.current) expect(session.blocks).toEqual(snapshots.get(session.id));
      expect(host.sessionsRef.current[1].queuedMessages?.[0].text).toBe("Latest pending edit");
    } finally { await host.close(); }
  });

  it.each(["same", "sibling", "combined"])(`retains generated block IDs and timestamps through %s pending updates, StrictMode=${strict}`, async placement => {
    const target = { ...mono(), busy: true, blocks: [{ id: "turn", role: "user" as const, text: "Run", startedAt: 100 }] };
    const sibling = { ...mono(), queueStatus: "active" as const };
    const host = await stateHost([target, sibling], strict);
    const timers: (() => Promise<void>)[] = [];
    const cleanup = execute(scheduler.arguments[0], { ...host, ...queue, monoForSession, sessions: [sibling],
      window: { setTimeout: (run: () => Promise<void>) => timers.push(run), clearTimeout: vi.fn() },
      queueDispatchingRef: { current: new Set<string>() }, submitSession: async () => false, setQueueDispatchVersion: vi.fn(),
      canSteerHarness: () => false, consumeOperatorCommand: () => ({ matched: false }) })();
    let at = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => at++);
    let synchronous!: Session;
    try {
      await React.act(async () => {
        if (placement !== "same") await timers[0]();
        if (placement !== "sibling") callback("onEditQueuedMessage", host)(target.id, "exact-request", "Latest pending edit");
        host.events.enqueue(target.id, { type: "message.delta", text: "New answer" });
        host.events.enqueue(target.id, { type: "reasoning.delta", text: "Reason", reasoning: { itemId: "part", partIndex: 0, channel: "summary" } });
        host.events.enqueue(target.id, { type: "tool.started", callId: "call", title: "Run" });
        host.events.enqueue(target.id, { type: "approval.requested", callId: "call", requestId: 7, title: "Run" });
        host.events.enqueue(target.id, { type: "session.error", message: "Synthetic final error" });
        host.events.flush();
        synchronous = structuredClone(host.sessionsRef.current[0]);
        expect(host.syncDockBadge).toHaveBeenLastCalledWith(host.sessionsRef.current);
        at += 1_000;
      });
      expect(host.sessionsRef.current[0].blocks).toEqual(synchronous.blocks);
      expect(host.sessionsRef.current[0].blocks.map(block => block.role)).toEqual(["user", "assistant", "reasoning", "tool", "system"]);
      if (placement !== "same") expect(host.sessionsRef.current[1].queueStatus).toBe("paused");
      if (placement !== "sibling") expect(host.sessionsRef.current[0].queuedMessages?.[0].text).toBe("Latest pending edit");
    } finally { cleanup(); await host.close(); }
  });

  for (const placement of ["same", "sibling", "combined"] as const) {
    it.each([false, true])(`actual async scheduler rejection survives delivery=%s, ${placement}, StrictMode=${strict}`, async deliver => {
      const rejected = mono(), streamed = placement === "same" ? rejected : mono(), edited = mono();
      rejected.queueStatus = "active";
      const initial = placement === "same" ? [rejected, edited] : [rejected, streamed, edited];
      for (const session of initial) await upsertSession(session);
      const host = await stateHost(initial, strict);
      const timers: (() => Promise<void>)[] = [];
      const submitSession = vi.fn(async (..._args: unknown[]) => { await Promise.resolve(); return false; });
      const cleanup = execute(scheduler.arguments[0], { ...host, ...queue, monoForSession, sessions: [rejected],
        window: { setTimeout: (run: () => Promise<void>) => timers.push(run), clearTimeout: vi.fn() },
        queueDispatchingRef: { current: new Set<string>() }, submitSession, setQueueDispatchVersion: vi.fn(),
        canSteerHarness: () => false, consumeOperatorCommand: () => ({ matched: false }) })();
      try {
        expect(timers).toHaveLength(1);
        await React.act(async () => {
          await timers[0]();
          if (placement === "combined") callback("onEditQueuedMessage", host)(edited.id, "exact-request", "Latest pending edit");
          // The actual async production updater is queued but has not rendered.
          expect(host.sessionsRef.current.find(session => session.id === rejected.id)?.queueStatus).toBe("active");
          if (deliver) {
            host.events.enqueue(streamed.id, { type: "message.delta", text: " + delivered" });
            host.events.flush();
            expect(host.sessionsRef.current.find(session => session.id === streamed.id)?.blocks[0].text).toBe("Before + delivered");
            expect(host.syncDockBadge).toHaveBeenLastCalledWith(host.sessionsRef.current);
          }
        });
        expect(submitSession).toHaveBeenCalledOnce();
        expect(submitSession.mock.calls[0][3]).toMatchObject({ queuedMessageId: "exact-request" });
        const latest = host.sessionsRef.current.find(session => session.id === rejected.id)!;
        expect(latest.queueStatus).toBe("paused");
        expect(latest.queuedMessages).toHaveLength(1);
        expect(latest.queuedMessages?.[0]).toMatchObject({ id: "exact-request", error: "Delivery is unavailable. Retry when the agent is ready." });
        expect(queue.canDispatchQueuedHead(latest)).toBe(false);
        if (strict) expect([...host.updateCalls.values()].some(count => count >= 2)).toBe(true);
        expect(host.sessionsRef.current.find(session => session.id === streamed.id)?.blocks[0].text).toBe(deliver ? "Before + delivered" : "Before");
        if (placement === "combined") expect(host.sessionsRef.current.find(session => session.id === edited.id)?.queuedMessages?.[0].text).toBe("Latest pending edit");
        for (const session of host.sessionsRef.current) {
          await upsertSession(session);
          const reload = await readPersistedSession(session.id);
          expect(reload?.queuedMessages).toEqual(session.queuedMessages);
          expect(reload?.blocks).toEqual(session.blocks.map(({ streaming: _streaming, ...block }) => block));
          expect(reload?.queueStatus).toBe(session.queueStatus);
        }
      } finally { cleanup(); await host.close(); }
    });
  }

  it(`keeps multiple rebased batches, exact receipt IDs and unrelated removal, StrictMode=${strict}`, async () => {
    const target = mono(), edited = mono(), removed = mono();
    const message = { ...target.queuedMessages![0], blockId: "exact-request", appRequestId: "exact-event" };
    target.queuedMessages = [message];
    target.blocks.unshift({ id: message.id, role: "user", text: message.text });
    const host = await stateHost([target, edited, removed], strict);
    try {
      const scope = { ...host, sessionId: target.id };
      const changeNode = find(node => ts.isVariableDeclaration(node) && node.name.getText(app) === "change" &&
        !!node.initializer?.getText(app).includes("session.id === sessionId ? update(session)")) as ts.VariableDeclaration;
      const change = execute(changeNode.initializer!, scope);
      const followUp = find(node => ts.isCallExpression(node) && node.expression.getText(app) === "deliverQueuedFollowUp") as ts.CallExpression;
      const deliveredNode = (followUp.arguments[0] as ts.ObjectLiteralExpression).properties.find(property => property.name?.getText(app) === "delivered") as ts.PropertyAssignment;
      const delivered = execute(deliveredNode.initializer, { ...scope, change, message, acknowledgeMonoMessage,
        submittedText: message.text, attachments: [], displayAttachments: (value: unknown) => value,
        userTurnCards: () => ({}), noteCard: undefined, options: { appRequestId: message.appRequestId },
        flushHarnessEvents: host.events.flush });
      await React.act(async () => {
        host.events.enqueue(target.id, { type: "message.delta", text: " + before receipt" });
        delivered();
        expect(host.sessionsRef.current[0].queuedMessages).toBeUndefined();
        expect(host.sessionsRef.current[0].blocks.filter(block => block.appRequestId === "exact-event")).toHaveLength(1);
        callback("onEditQueuedMessage", host)(edited.id, "exact-request", "Latest pending edit");
        host.setSessions(previous => previous.filter(session => session.id !== removed.id));
        host.events.enqueue(target.id, { type: "message.delta", text: " + after receipt" });
        host.events.enqueue(removed.id, { type: "message.delta", text: "Must not resurrect" });
        host.events.flush();
        host.events.enqueue(target.id, { type: "message.delta", text: " + last batch" });
        host.events.flush(); host.events.flush();
      });
      const latest = host.sessionsRef.current[0];
      expect(latest.blocks.map(block => block.id)).toEqual(["exact-request", "answer"]);
      expect(latest.blocks.filter(block => block.appRequestId === "exact-event")).toHaveLength(1);
      expect(latest.blocks[1].text).toBe("Before + before receipt + after receipt + last batch");
      expect(latest.queuedMessages).toBeUndefined();
      expect(host.sessionsRef.current.find(session => session.id === removed.id)).toBeUndefined();
      expect(host.sessionsRef.current[1].queuedMessages?.[0].text).toBe("Latest pending edit");
    } finally { await host.close(); }
  });

  it(`preserves actual Stop and generation filtering through sibling delivery, StrictMode=${strict}`, async () => {
    const target = { ...mono(), busy: true, turnReady: true }, sibling = mono();
    const host = await stateHost([target, sibling], strict);
    const turnGen = { current: new Map([[target.id, 1]]) };
    const routeNode = find(node => ts.isVariableDeclaration(node) && node.name.getText(app) === "routeTurnEvent") as ts.VariableDeclaration;
    const route = execute(routeNode.initializer!, { turnGen, sessionId: target.id, gen: 1, editedResend: undefined,
      applyTurnEvent: (event: Parameters<HarnessEventQueue["enqueue"]>[1]) => host.events.enqueue(target.id, event) });
    const stop = callback("onStop", { ...host, turnGen, usageRecoveryStopped: { current: new Set() }, remoteProjectFor: () => undefined,
      monoForSession, orchestrator: { snapshot: () => [], stopForSession: () => undefined },
      flushHarnessEvents: host.events.flush, sessionChildHarnesses: () => [], finishSessionTurn: async () => {},
      sessionWorkCwd: (session: Session) => session.cwd, stopStreaming, isPreparingHandoff: () => false,
      notifyReviewChanged: vi.fn(), nudgeWorkspace: vi.fn(), notifyGitChanged: vi.fn(), nudgeWatchedFiles: vi.fn(),
      window: { setTimeout: vi.fn() } });
    try {
      await React.act(async () => {
        route({ type: "message.delta", text: " + before Stop" });
        const stopped = stop(target.id);
        expect(turnGen.current.get(target.id)).toBe(2);
        route({ type: "message.delta", text: " + stale generation" });
        host.events.enqueue(sibling.id, { type: "message.delta", text: " + sibling" });
        host.events.flush();
        await stopped;
      });
      expect(host.sessionsRef.current[0]).toMatchObject({ busy: false, turnReady: false, queueStatus: "paused" });
      expect(host.sessionsRef.current[0].blocks[0]).toMatchObject({ text: "Before + before Stop", streaming: false });
      expect(host.sessionsRef.current[1].blocks[0].text).toBe("Before + sibling");
    } finally { await host.close(); }
  });

  it(`delivers a foreground batch during the App layout-effect ordering, StrictMode=${strict}`, async () => {
    const target = mono();
    const host = await stateHost([target], strict, true);
    try {
      await React.act(async () => {
        callback("onEditQueuedMessage", host)(target.id, "exact-request", "Latest pending edit");
        host.events.enqueue(target.id, { type: "message.delta", text: " + layout delivery" });
      });
      expect(host.sessionsRef.current[0].queuedMessages?.[0].text).toBe("Latest pending edit");
      expect(host.sessionsRef.current[0].blocks[0].text).toBe("Before + layout delivery");
    } finally { await host.close(); }
  });
}
