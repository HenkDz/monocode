// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session, type Block } from "../features/sessions/model/session";
import { createMono, saveMonoSessionId, monoForSession, isMonoSession } from "../features/monos/model/mono";
import { createMonoUsageFailoverController } from "../features/monos/model/monoUsageFailover";
import { resumeMonoUsageLimit, switchMonoUsageLimitAccount } from "../features/monos/model/monoUsageLimit";
import { canDispatchQueuedHead } from "../features/sessions/model/messageQueue";
import * as queue from "../features/sessions/model/messageQueue";
import { consumeHandoff } from "../features/sessions/model/handoff";
import { USAGE_LIMIT_RESUME_GRACE_MS, usageLimitResumeDue } from "../features/sessions/model/usageLimit";
import { identityKey } from "../features/providers/model/providerAccountIdentity";
import { supportsAccountProfiles, supportsProviderAccounts } from "../features/providers/model/providerAccounts";
import { parseClaudeOAuthUsage } from "../features/providers/model/rateLimits";
import { applyHarnessEvent, applyHarnessEvents, stopStreaming } from "../integrations/harness/core/apply";
import { assertManagerDelivery, managerRequestBinding, type ManagerRequestRecovery } from "../features/monos/model/managerAuthorizedWork";

const transport = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
const { writeSession, retainSessionWrite, resetMonoSessionWriteBaseline, sessionWriteNeedsReconciliation, upsertSession, readPersistedSession } = await import("../features/sessions/data/sessionStore");

// Execute the production callbacks, including their queue/save dependencies.
const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (predicate(node)) result = node; else if (!result) ts.forEachChild(node, visit); };
  visit(app);
  if (!result) throw Error("Actual App usage seam not found");
  return result;
}
function execute(source: string, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), ts.transpile(`return ${source};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
function callback(name: string, scope: Record<string, unknown>) {
  const node = find(node => ts.isVariableDeclaration(node) && node.name.getText(app) === name) as ts.VariableDeclaration;
  return execute((node.initializer as ts.CallExpression).arguments[0].getText(app), scope);
}

type Stored = Record<string, unknown> & { id: string; blocks: Block[]; providerAccountId?: string; queueStatus?: string };
let records: Map<string, Stored>;
let afterCandidate: (() => void | Promise<void>) | undefined;
let rejectRepair: boolean;
let loseAcknowledgement: boolean;
let rejectCandidate: boolean;
let now: number;
beforeEach(() => {
  vi.stubGlobal("localStorage", new Window({ url: "http://synthetic.local" }).localStorage);
  now = Date.now(); records = new Map(); afterCandidate = undefined; rejectRepair = false; loseAcknowledgement = false; rejectCandidate = false;
  transport.invoke.mockReset();
  transport.invoke.mockImplementation(async (command: string, args: { sessionId: string; session: Stored; blocksChanged: boolean; afterBlockId?: string; fromBlockId?: string }) => {
    if (command === "mono_session_get") return structuredClone(records.get(args.sessionId));
    if (command !== "mono_session_upsert") return null;
    const previous = records.get(args.session.id);
    if (rejectCandidate && args.session.providerAccountId === "work") throw Error("Synthetic candidate rejected before write");
    if (rejectRepair && args.session.providerAccountId === "default") throw Error("Synthetic repair write rejected");
    let blocks = previous?.blocks ?? [];
    if (args.blocksChanged) {
      const anchor = args.afterBlockId ?? args.fromBlockId;
      const index = anchor ? blocks.findIndex(block => block.id === anchor) : 0;
      if (anchor && index < 0) throw Error(`Missing actual diff anchor ${anchor}`);
      blocks = [...blocks.slice(0, index + (args.afterBlockId ? 1 : 0)), ...args.session.blocks];
    }
    records.set(args.session.id, structuredClone({ ...args.session, blocks, createdAt: 1, updatedAt: 2,
      monoTranscript: { before: null, firstBlockId: blocks[0]?.id ?? null } }));
    if (args.session.providerAccountId === "work") {
      await afterCandidate?.();
      if (loseAcknowledgement) { loseAcknowledgement = false; throw Error("Synthetic save acknowledgement lost"); }
    }
    return { id: args.session.id, cwd: "/synthetic", harness: "claude", model: "", title: "", runtimeMode: "supervised", createdAt: 1, updatedAt: 2 };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function fixture(windowed = false) {
  const mono = createMono(["/synthetic"]);
  const original: Session = { ...newSession("claude", "/synthetic"), providerAccountId: "default", providerSessionId: "old-thread",
    blocks: [{ id: "request", role: "user", text: "Finish the parser only. Never publish." }],
    usageLimit: {}, queueStatus: "paused", monoTranscript: { before: windowed ? 2 : null, firstBlockId: "request" } };
  saveMonoSessionId(mono.id, original.id);
  const earlier: Block[] = windowed ? [{ id: "unseen-request", role: "user", text: "Unseen original scope" }, { id: "unseen-answer", role: "assistant", text: "Preserved history" }] : [];
  records.set(original.id, { id: original.id, blocks: [...earlier, ...original.blocks] });
  await upsertSession(original);
  const sessionsRef = { current: [original] };
  const turnGen = { current: new Map([[original.id, 1]]) };
  const events = vi.fn();
  const flush = vi.fn();
  let recoveryErrors: Record<string, string> = {};
  const setSessions = (value: Session[] | ((previous: Session[]) => Session[])) => {
    sessionsRef.current = typeof value === "function" ? value(sessionsRef.current) : value;
  };
  let runs: { leadId: string; tasks: { sessionId: string; status: string; monoGoalId?: string }[]; status: string }[] = [];
  const goals: { id: string; state: string }[] = [];
  const scope = {
    sessionsRef, setSessions, turnGen, writeSession, retainSessionWrite, resetMonoSessionWriteBaseline, sessionWriteNeedsReconciliation, isMonoSession,
    lastPersisted: { current: new Map([[original.id, "unchanged-fingerprint"]]) },
    setUsageRecoveryErrors: (change: (previous: Record<string, string>) => Record<string, string>) => { recoveryErrors = change(recoveryErrors); },
    flushSync: (run: () => void) => run(), enqueueHarnessEvent: events, flushHarnessEvents: flush,
    automaticUsageRecovery: { current: createMonoUsageFailoverController() }, usageRecoveryStopped: { current: new Set<string>() },
    removingSessionIds: { current: new Set<string>() }, switchingWorktrees: { current: new Map() },
    removingWorktreePaths: { current: new Set<string>() }, usageResumingRef: { current: new Set<string>() },
    workspaceNavigation: { isSwitching: () => false }, remoteProjectFor: () => undefined,
    sessionWorkCwd: (session: Session) => session.cwd, isEqualOrInside: (path: string, parent: string) => path.startsWith(parent),
    monoForSession, orchestrator: { snapshot: () => runs, stopForSession: () => undefined },
    monoManagerGoals: { goals: () => goals, isCancelling: () => false }, supportsAccountProfiles, identityKey,
    usageIdentitiesRef: { current: { "claude:work": { name: "Synthetic signed-in account" } } },
    providerAccounts: () => [{ provider: "claude", id: "work", label: "Work" }],
    getAllRateLimits: () => ({ "claude:work": limits }),
    loadUsageFailoverPolicy: () => policy,
  };
  const limits = { ...parseClaudeOAuthUsage(JSON.stringify({ five_hour: { utilization: 20, resets_at: new Date(now + 3_600_000).toISOString() },
    seven_day: { utilization: 50, resets_at: new Date(now + 86_400_000).toISOString() } })), updatedAt: now };
  const policy = { enabled: true, rankedAccountIds: ["work"] };
  const retry = callback("retryUsageRecovery", scope);
  const commit = callback("commitUsageFailover", { ...scope, retryUsageRecovery: retry });
  const recover = callback("recoverUsageLimit", { ...scope, commitUsageFailover: commit });
  const resume = callback("onUsageLimitResume", { ...scope, resumeMonoUsageLimit, onSubmit: vi.fn(), onUsageLimitDismiss: vi.fn() });
  const stop = callback("onStop", { ...scope, monoGoalOrigins: new Map(), upsertSession,
    sessionChildHarnesses: () => [], finishSessionTurn: async () => {}, stopStreaming,
    isPreparingHandoff: () => false, notifyReviewChanged: () => {}, nudgeWorkspace: () => {}, notifyGitChanged: () => {}, nudgeWatchedFiles: () => {} });
  return { original, earlier, scope, policy, limits, recover: () => recover(original.id), commit, resume: () => resume(original.id), stop: () => stop(original.id),
    current: () => sessionsRef.current[0], change: (patch: Partial<Session>) => setSessions([{ ...sessionsRef.current[0], ...patch }]),
    setRuns: (next: typeof runs) => { runs = next; }, retry: () => retry(original.id), recoveryErrors: () => recoveryErrors, events, flush };
}

it("the actual App path stays manual when OFF, for generic 401, and for bound Codex homes", async () => {
  const f = await fixture(); f.policy.enabled = false;
  expect(await f.recover()).toEqual({ kind: "manual" });
  f.policy.enabled = true; f.change(applyHarnessEvent({ ...f.current(), usageLimit: undefined }, { type: "session.error", message: "401 Unauthorized. Please sign in" }));
  expect(await f.recover()).toEqual({ kind: "manual" });
  f.change({ harness: "codex", usageLimit: {}, codexStorageHome: "/synthetic/account-home", providerSessionIdByHome: { home: "thread" } });
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "home-binding" });
  expect(f.current().providerAccountId).toBe("default");
  expect(transport.invoke.mock.calls.filter(([command]) => command === "mono_session_upsert")).toHaveLength(1);
});

it("publishes only after a paused durable save and deduplicates concurrent App polls", async () => {
  const f = await fixture();
  afterCandidate = () => { expect(f.current()).toBe(f.original); expect(records.get(f.original.id)?.queueStatus).toBe("paused"); };
  const results = await Promise.all([f.recover(), f.recover()]);
  expect(results.map(result => result.kind).sort()).toEqual(["pause-and-ask", "switched"]);
  expect(f.current().providerAccountId).toBe("work");
  expect(canDispatchQueuedHead(f.current())).toBe(true);
  const reload = await readPersistedSession(f.original.id);
  expect(reload?.providerAccountId).toBe("work"); expect(reload?.queueStatus).toBe("paused");
  expect(reload?.blocks.filter(block => block.id === "usage-failover-request")).toHaveLength(1);
  f.change({ ...reload!, usageLimit: {} });
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "held" });
  f.change(consumeHandoff(f.current()));
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "already-attempted" });
});

it.each(["Stop", "generation", "policy", "account", "authority", "reset choice", "source"])("repairs an acknowledged save rejected by actual App %s and reloads the authoritative live state", async reason => {
  const f = await fixture(true);
  afterCandidate = async () => {
    if (reason === "Stop") await f.stop();
    if (reason === "generation") f.scope.turnGen.current.set(f.original.id, 2);
    if (reason === "policy") f.policy.enabled = false;
    if (reason === "account") f.limits.weekly!.usedPercent = 100;
    if (reason === "authority") f.setRuns([{ leadId: f.original.id, status: "stopped", tasks: [] }]);
    if (reason === "reset choice") callback("onUsageLimitResumeAtReset", f.scope)(f.original.id, true);
    if (reason === "source") f.change({ title: "Latest authoritative edit", blocks: [...f.current().blocks, { id: "latest", role: "system", text: "Keep this live edit" }] });
  };
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
  expect(f.current().providerAccountId).toBe("default");
  const reload = await readPersistedSession(f.original.id);
  expect(reload?.providerAccountId).toBe("default"); expect(reload?.providerSessionId).toBe("old-thread");
  expect(reload?.blocks).toEqual([...f.earlier, ...f.current().blocks]);
  expect(reload?.blocks.some(block => block.id.startsWith("usage-failover-") || block.handoff)).toBe(false);
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(false);
  expect(f.scope.lastPersisted.current.has(f.original.id)).toBe(false);
  if (reason === "Stop") expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "held" });
  if (reason === "generation") {
    const repair = transport.invoke.mock.calls.filter(([command]) => command === "mono_session_upsert").pop()![1];
    expect(repair.afterBlockId).toBe("request"); expect(repair.session.blocks).toEqual([]); expect(repair.blocksChanged).toBe(true);
  }
});

it.each([false, true])("repairs uncertain initial save outcomes, windowed=%s", async windowed => {
  const f = await fixture(windowed); loseAcknowledgement = true;
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
  expect((await readPersistedSession(f.original.id))?.blocks).toEqual([...f.earlier, ...f.original.blocks]);
  expect(records.get(f.original.id)?.providerAccountId).toBe("default");
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(false);
});

it("an actual manual account choice flushes its state and invalidates a saved switch", async () => {
  const f = await fixture(true);
  afterCandidate = () => callback("onUsageLimitAccountChange", { ...f.scope, supportsProviderAccounts,
    providerAccountExists: () => true, switchMonoUsageLimitAccount })(f.original.id, "manual");
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
  expect(f.current().providerAccountId).toBe("manual");
  const reload = await readPersistedSession(f.original.id);
  expect(reload?.providerAccountId).toBe("manual");
  expect(reload?.providerSessionId).toBeUndefined();
  expect(reload?.blocks.some(block => block.id.startsWith("usage-failover-") || block.handoff)).toBe(false);
  expect(reload?.blocks.slice(0, 2)).toEqual(f.earlier);
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(false);
});

it.each(["edit", "pending deletion", "delete click", "Stop", "manual account", "independent Mono", "repair edit", "manual account with sibling", "reset wait with sibling"])("retains %s through the real React state-publication boundary", async mode => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const f = await fixture(true);
  f.change({ queuedMessages: [{ id: "queued-user", text: "Before edit", attachments: [] }], queueStatus: "paused" });
  await upsertSession(f.current());
  const other = await fixture();
  other.change({ queuedMessages: [{ id: "other-queue", text: "Before independent edit", attachments: [] }], queueStatus: "paused" });
  await upsertSession(other.current());
  f.scope.sessionsRef.current = [f.current(), other.current()];
  let publish!: (next: Session[] | ((previous: Session[]) => Session[])) => void;
  function StateHost() {
    const [sessions, setSessions] = React.useState(f.scope.sessionsRef.current);
    f.scope.sessionsRef.current = sessions;
    publish = setSessions;
    return React.createElement("button", { onClick: () => callback("onDeleteQueuedMessage", { ...f.scope, ...queue, setSessions })(f.original.id, "queued-user") }, "Delete queued request");
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(StateHost)));
    const scope = { ...f.scope, ...queue, setSessions: publish, flushSync };
    const retry = callback("retryUsageRecovery", scope);
    const commit = callback("commitUsageFailover", { ...scope, retryUsageRecovery: retry });
    const recover = callback("recoverUsageLimit", { ...scope, commitUsageFailover: commit });
    if (mode === "repair edit") {
      const base = transport.invoke.getMockImplementation()!;
      let edited = false;
      transport.invoke.mockImplementation(async (command, args) => {
        const result = await base(command, args);
        if (command === "mono_session_upsert" && args.session.providerAccountId === "default" && !edited) {
          edited = true;
          callback("onEditQueuedMessage", scope)(f.original.id, "queued-user", "Latest operator queue edit");
        }
        return result;
      });
    }
    afterCandidate = () => {
      if (mode.includes("with sibling")) callback("onEditQueuedMessage", scope)(other.original.id, "other-queue", "Latest independent edit");
      if (mode === "edit") callback("onEditQueuedMessage", scope)(f.original.id, "queued-user", "Latest operator queue edit");
      if (mode === "pending deletion") callback("onDeleteQueuedMessage", scope)(f.original.id, "queued-user");
      if (mode === "delete click") container.querySelector<HTMLButtonElement>("button")!.click();
      if (mode.startsWith("manual account")) callback("onUsageLimitAccountChange", { ...scope, supportsProviderAccounts, providerAccountExists: () => true, switchMonoUsageLimitAccount })(f.original.id, "manual");
      if (mode === "reset wait with sibling") callback("onUsageLimitResumeAtReset", scope)(f.original.id, true);
      if (mode === "independent Mono") callback("onEditQueuedMessage", scope)(other.original.id, "other-queue", "Latest independent edit");
      if (mode === "repair edit") f.scope.turnGen.current.set(f.original.id, 2);
      if (mode === "Stop") void callback("onStop", { ...scope, monoGoalOrigins: new Map(), upsertSession, sessionChildHarnesses: () => [],
        finishSessionTurn: async () => {}, stopStreaming, isPreparingHandoff: () => false, notifyReviewChanged: () => {}, nudgeWorkspace: () => {}, notifyGitChanged: () => {}, nudgeWatchedFiles: () => {} })(f.original.id);
    };
    let result: unknown;
    await React.act(async () => { result = await recover(f.original.id); });
    if (sessionWriteNeedsReconciliation(f.original.id)) await React.act(async () => { await retry(f.original.id); });
    if (mode === "independent Mono") {
      expect(result).toEqual({ kind: "switched", accountId: "work" });
      const latest = f.scope.sessionsRef.current.find(session => session.id === other.original.id)!;
      expect(latest.queuedMessages?.[0].text).toBe("Latest independent edit");
      await upsertSession(latest);
      expect((await readPersistedSession(latest.id))?.queuedMessages?.[0].text).toBe("Latest independent edit");
    } else {
      expect(result).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
      expect(f.current().providerAccountId).toBe(mode.startsWith("manual account") ? "manual" : "default");
      if (mode.includes("with sibling")) expect(f.scope.sessionsRef.current.find(session => session.id === other.original.id)?.queuedMessages?.[0].text).toBe("Latest independent edit");
      if (mode === "reset wait with sibling") expect(f.current().usageLimit?.resumeAtReset).toBe(true);
      if (mode === "edit" || mode === "repair edit") expect(f.current().queuedMessages?.[0].text).toBe("Latest operator queue edit");
      if (mode.includes("delet")) expect(f.current().queuedMessages?.some(message => message.id === "queued-user") ?? false).toBe(false);
      const reload = await readPersistedSession(f.original.id);
      expect(reload?.providerAccountId).toBe(f.current().providerAccountId);
      expect(reload?.queuedMessages).toEqual(f.current().queuedMessages?.length ? f.current().queuedMessages : undefined);
      expect(reload?.blocks).toEqual([...f.earlier, ...f.current().blocks]);
      expect(reload?.blocks.some(block => block.id.startsWith("usage-failover-"))).toBe(false);
      expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(false);
    }
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});

it.each(["without recovery", "with recovery", "combined target edit"])("preserves the actual async sibling queue rejection %s", async mode => {
  const React = await import("react"), { createRoot } = await import("react-dom/client"), { flushSync } = await import("react-dom");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const f = await fixture(true), sibling = await fixture();
  f.change({ queuedMessages: [{ id: "target-queue", text: "Before edit", attachments: [] }], queueStatus: "paused" });
  const queuedSibling: Session = { ...sibling.current(), usageLimit: undefined, queueStatus: "active",
    queuedMessages: [{ id: "sibling-request", text: "Keep rejected request paused", attachments: [] }] };
  f.scope.sessionsRef.current = [f.current(), queuedSibling];
  let publish!: (next: Session[] | ((previous: Session[]) => Session[])) => void;
  function StateHost() { const [sessions, setSessions] = React.useState(f.scope.sessionsRef.current); f.scope.sessionsRef.current = sessions; publish = setSessions; return null; }
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(StateHost)));
    const scope = { ...f.scope, setSessions: publish, flushSync };
    const retry = callback("retryUsageRecovery", scope), commit = callback("commitUsageFailover", { ...scope, retryUsageRecovery: retry });
    const recover = callback("recoverUsageLimit", { ...scope, commitUsageFailover: commit });
    const scheduler = find(node => ts.isCallExpression(node) && node.expression.getText(app) === "useEffect" && node.arguments[0]?.getText(app).includes("queueDispatchingRef.current.add")) as ts.CallExpression;
    const timers: (() => Promise<void>)[] = [], submitted = vi.fn(() => false);
    const cleanup = execute(scheduler.arguments[0].getText(app), { ...scope, ...queue, sessions: [queuedSibling],
      window: { setTimeout: (run: () => Promise<void>) => timers.push(run), clearTimeout: vi.fn() }, queueDispatchingRef: { current: new Set<string>() },
      submitSession: submitted, setQueueDispatchVersion: vi.fn(), canSteerHarness: () => false, consumeOperatorCommand: () => ({ matched: false }) })();
    expect(timers).toHaveLength(1);
    afterCandidate = async () => {
      if (mode === "combined target edit") callback("onEditQueuedMessage", scope)(f.original.id, "target-queue", "Latest operator queue edit");
      await timers[0]();
    };
    await React.act(async () => { if (mode === "without recovery") await timers[0](); else await recover(f.original.id); }); cleanup();
    expect(submitted).toHaveBeenCalledOnce();
    const latest = f.scope.sessionsRef.current.find(session => session.id === queuedSibling.id)!;
    expect(latest.queueStatus).toBe("paused"); expect(latest.queuedMessages?.[0].error).toContain("Delivery is unavailable");
    await upsertSession(latest);
    expect((await readPersistedSession(latest.id))?.queuedMessages?.[0].error).toContain("Delivery is unavailable");
    if (mode === "combined target edit") {
      expect(f.current().providerAccountId).toBe("default");
      expect(f.current().queuedMessages?.[0].text).toBe("Latest operator queue edit");
      expect((await readPersistedSession(f.original.id))?.queuedMessages?.[0].text).toBe("Latest operator queue edit");
    }
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});

it.each([false, true])("preserves actual HarnessEventQueue delivery with concurrent recovery=%s", async recoverConcurrent => {
  const React = await import("react"), { createRoot } = await import("react-dom/client"), { flushSync } = await import("react-dom");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const f = await fixture(), sibling = await fixture();
  const streamed: Session = { ...sibling.current(), usageLimit: undefined, busy: true,
    blocks: [...sibling.current().blocks, { id: "stream-answer", role: "assistant", text: "Before", streaming: true }] };
  f.scope.sessionsRef.current = [f.current(), streamed];
  let publish!: (next: Session[] | ((previous: Session[]) => Session[])) => void;
  function StateHost() { const [sessions, setSessions] = React.useState(f.scope.sessionsRef.current); f.scope.sessionsRef.current = sessions; publish = setSessions; return null; }
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(StateHost)));
    const scope = { ...f.scope, setSessions: publish, flushSync };
    const retry = callback("retryUsageRecovery", scope), commit = callback("commitUsageFailover", { ...scope, retryUsageRecovery: retry });
    const recover = callback("recoverUsageLimit", { ...scope, commitUsageFailover: commit });
    const queueConstructor = find(node => ts.isNewExpression(node) && node.expression.getText(app) === "HarnessEventQueue") as ts.NewExpression;
    const deliver = execute(queueConstructor.arguments![1].getText(app), { ...scope, applyHarnessEvents, syncDockBadge: vi.fn() });
    const delta = () => deliver(new Map([[streamed.id, [{ type: "message.delta", text: " + preserved delta" }]]]));
    afterCandidate = delta;
    await React.act(async () => { if (recoverConcurrent) await recover(f.original.id); else delta(); });
    const latest = f.scope.sessionsRef.current.find(session => session.id === streamed.id)!;
    expect(latest.blocks.find(block => block.id === "stream-answer")?.text).toBe("Before + preserved delta");
    await upsertSession(latest);
    expect((await readPersistedSession(latest.id))?.blocks.find(block => block.id === "stream-answer")?.text).toBe("Before + preserved delta");
  } finally { await React.act(async () => root.unmount()); container.remove(); }
});

it("a rejected initial write preserves original disk state and unseen pages", async () => {
  const f = await fixture(true); rejectCandidate = true;
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
  expect(records.get(f.original.id)?.providerAccountId).toBe("default");
  expect((await readPersistedSession(f.original.id))?.blocks).toEqual([...f.earlier, ...f.original.blocks]);
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(false);
});

it.each(["identity", "telemetry", "source", "removal", "worktree", "unknown task"])("actual App host holds unavailable %s before a switch attempt", async reason => {
  const f = await fixture();
  if (reason === "identity") f.scope.usageIdentitiesRef.current = {} as typeof f.scope.usageIdentitiesRef.current;
  if (reason === "telemetry") f.limits.updatedAt = now - 3_600_000;
  if (reason === "source") f.scope.remoteProjectFor = () => ({} as never);
  if (reason === "removal") f.scope.removingSessionIds.current.add(f.original.id);
  if (reason === "worktree") f.scope.removingWorktreePaths.current.add("/synthetic");
  if (reason === "unknown task") f.change({ orchestrationLeadId: "missing-run" });
  // Rebind to changed fixture boundaries while keeping the production callback.
  const recover = callback("recoverUsageLimit", { ...f.scope, commitUsageFailover: f.commit });
  expect(await recover(f.original.id)).toEqual({ kind: "pause-and-ask", reason: ["identity", "telemetry"].includes(reason) ? "no-eligible-account" : "held" });
  expect(f.current().providerAccountId).toBe("default");
});

it("two independent Monos serialize their own writes and each recover once", async () => {
  const a = await fixture(true), b = await fixture(true);
  expect(await Promise.all([a.recover(), b.recover()])).toEqual([{ kind: "switched", accountId: "work" }, { kind: "switched", accountId: "work" }]);
  for (const f of [a, b]) {
    expect((await readPersistedSession(f.original.id))?.providerAccountId).toBe("work");
    expect(records.get(f.original.id)?.blocks.slice(0, 2)).toEqual(f.earlier);
  }
});

it("retains a visible repair hold, blocks actual submitSession, and retries without nested queue deadlock", async () => {
  const f = await fixture(true);
  afterCandidate = () => { f.scope.turnGen.current.set(f.original.id, 2); rejectRepair = true; };
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(true);
  expect(f.recoveryErrors()[f.original.id]).toContain("Usage recovery storage repair is pending");
  const unrepaired = await readPersistedSession(f.original.id);
  expect(unrepaired?.providerAccountId).toBe("work"); expect(unrepaired?.queueStatus).toBe("paused");
  expect(canDispatchQueuedHead(unrepaired!)).toBe(false);
  const guard = find(node => ts.isIfStatement(node) && node.expression.getText(app) === "sessionWriteNeedsReconciliation(sessionId)");
  const settled = vi.fn(); const dispatch = vi.fn();
  const submit = new Function("sessionId", "options", "sessionWriteNeedsReconciliation", "enqueueHarnessEvent", "flushHarnessEvents", "writeSession", "dispatch",
    ts.transpile(`${guard.getText(app)}; return dispatch();`, { target: ts.ScriptTarget.ES2022 }));
  expect(submit(f.original.id, { onSettled: settled }, sessionWriteNeedsReconciliation, f.events, f.flush, writeSession, dispatch)).toBe(false);
  await writeSession(f.original.id, async () => {}).catch(() => {});
  expect(dispatch).not.toHaveBeenCalled(); expect(settled).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(true);
  rejectRepair = false;
  await f.retry();
  expect(sessionWriteNeedsReconciliation(f.original.id)).toBe(false);
  expect(f.recoveryErrors()[f.original.id]).toBeUndefined();
  expect((await readPersistedSession(f.original.id))?.blocks).toEqual([...f.earlier, ...f.current().blocks]);
  expect(records.get(f.original.id)?.providerAccountId).toBe("default");
});

it("keeps Manager request authority on its original account through the actual App resume and delivery guard", async () => {
  const f = await fixture();
  const manager = { ...monoForSession(f.original.id)!, role: "manager" as const };
  const request: ManagerRequestRecovery = { monoId: manager.id, sessionId: f.original.id, managerId: "engine", projectId: "/synthetic",
    userMessageId: "request", providerAccountId: "default", binding: managerRequestBinding(f.original), state: "pending" };
  const source = { id: manager.id, name: "Manager", mascot: manager.mascot, color: manager.color, goalId: "goal", request };
  const receipt = `mono-goal-${manager.id}-continue-request`;
  f.change({ blocks: [...f.original.blocks, { id: "manager-request-request", role: "system", text: "Retained grant", managerRequestRecovery: request }],
    queuedMessages: [{ id: receipt, text: "Continue", attachments: [], monoSource: source }] });
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "held" });
  f.resume();
  const delivery = find(node => ts.isVariableDeclaration(node) && node.name.getText(app) === "validateManagerDelivery") as ts.VariableDeclaration;
  const validate = execute(delivery.initializer!.getText(app), { assertManagerDelivery, options: { monoSource: source, appRequestId: receipt },
    sessionId: f.original.id, sessionsRef: f.scope.sessionsRef, monoForSession: () => manager, monoManagerGoals: undefined });
  expect(validate).not.toThrow();
  expect(f.current().providerAccountId).toBe("default");
  const scheduler = find(node => ts.isCallExpression(node) && node.expression.getText(app) === "useEffect" && node.arguments[0]?.getText(app).includes("queueDispatchingRef.current.add")) as ts.CallExpression;
  const timers: (() => Promise<void>)[] = [];
  const submitted = vi.fn((_id, _text, _attachments, options) => {
    expect(options.monoSource.request).toEqual(request);
    expect(options.appRequestId).toBe(receipt);
    validate(); return true;
  });
  const cleanup = execute(scheduler.arguments[0].getText(app), { ...f.scope, ...queue, sessions: [f.current()],
    window: { setTimeout: (run: () => Promise<void>) => timers.push(run), clearTimeout: vi.fn() },
    queueDispatchingRef: { current: new Set<string>() }, submitSession: submitted, setQueueDispatchVersion: vi.fn(),
    canSteerHarness: () => false, consumeOperatorCommand: () => ({ matched: false }) })();
  expect(timers).toHaveLength(1); await timers[0](); cleanup();
  expect(submitted).toHaveBeenCalledOnce();
  f.change({ providerAccountId: "work" }); expect(validate).toThrow("changed or is held");
});

it("the actual reset owner retains the original account through later polls and a due-timer race", async () => {
  const f = await fixture(); vi.useFakeTimers(); vi.setSystemTime(now);
  callback("onUsageLimitResumeAtReset", f.scope)(f.original.id, true);
  f.change({ usageLimit: { ...f.current().usageLimit, resetsAt: now - USAGE_LIMIT_RESUME_GRACE_MS - 1 } });
  const effect = find(node => ts.isCallExpression(node) && node.expression.getText(app) === "useEffect" && node.arguments[0]?.getText(app).includes("usageLimitResumeDue")) as ts.CallExpression;
  const timers: (() => void)[] = [];
  const cleanup = execute(effect.arguments[0].getText(app), { ...f.scope, sessions: [f.current()], usageLimitResumeDue, USAGE_LIMIT_RESUME_GRACE_MS,
    window: { setTimeout: (run: () => void) => timers.push(run), clearTimeout: vi.fn() },
    onUsageLimitResume: f.resume, setUsageLimitTick: vi.fn() })();
  expect(await f.recover()).toEqual({ kind: "pause-and-ask", reason: "held" });
  expect(timers).toHaveLength(1); timers[0]();
  expect(f.current().usageLimit).toBeUndefined(); expect(f.current().providerAccountId).toBe("default");
  expect(await f.recover()).toEqual({ kind: "manual" });
  cleanup();
});
