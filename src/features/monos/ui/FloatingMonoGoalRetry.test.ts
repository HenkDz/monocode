// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { FloatingMonoChat } from "./FloatingMonoChat";
import { MonoComposer } from "./MonoComposer";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { getSession, upsertSession, writeSession, flushSessionWrites, persistFingerprint, shouldPersistSession, retainSessionWrite, sessionWriteNeedsReconciliation } from "../../sessions/data/sessionStore";
import { getMonoGoalRecoveryBlocks, mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession, reconcileMonoGoalOrigin } from "../../sessions/data/monoGoalRecovery";
import { deliverFloatingMonoRequest, type FloatingMonoAction, type FloatingMonoView } from "../model/floatingMono";
import { appendMonoGoalCard, appendMonoGoalOrigin, appendMonoGoalPendingCard, submitMonoGoal, type MonoGoalRoutingContext, type MonoGoalSubmission } from "../model/monoGoalRouting";
import { MonoManagerGoals, type ManagerGoalHost } from "../model/monoManagerGoals";
import { pathKey } from "../../../shared/lib/paths";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: native.listen }) }));
vi.mock("../../sessions/hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("../../sessions/ui/AgentTranscript", () => ({ AgentTranscript: () => null }));
vi.mock("../hooks/useMonoTranscript", () => ({ useMonoTranscript: (session: unknown) => session }));

const initial: MonoGoalRoutingContext = { ownerId: "grand", projects: [{
  id: "c:/code/atlas", name: "Atlas", path: "C:/code/Atlas", available: true, managerMonoId: "atlas-manager",
}] };
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  clearComposerDraft("floating:cc5cg-ack");
  clearComposerDraft("cc5cg-ack");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearComposerDraft("floating:cc5cg-ack");
  clearComposerDraft("cc5cg-ack");
  vi.unstubAllGlobals();
});

function appSubmit(dependencies: Record<string, unknown>) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("  submitMonoGoalRef.current = async (");
  const end = app.indexOf("\n  useEffect(() => {\n    const stopCards", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn submitMonoGoalRef.current;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as
    (sessionId: string, text: string, attachments: unknown[], submission: MonoGoalSubmission) => Promise<boolean>;
}

function exactOrdinaryPersist(ref: { current: Session[] }, original: Session) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("  const persistSession = useCallback((session: Session | undefined) => {");
  const end = app.indexOf("\n  useEffect(() => {", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn persistSession;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("useCallback", "shouldPersistSession", "removingSessionIds", "switchingWorktrees",
    "persistFingerprint", "lastPersisted", "writeSession", "sessionsRef", "sidebarCwdRef", "setHistory", "mergeProjectHistorySummary", code)(
    (callback: unknown) => callback, shouldPersistSession, { current: new Set() }, { current: new Set() },
    persistFingerprint, { current: new Map([[original.id, persistFingerprint(original)]]) }, writeSession, ref,
    { current: "" }, () => {}, () => {},
  ) as (session: Session) => void;
}

function exactChatGate(startProvider: () => boolean) {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("      if (sessionWriteNeedsReconciliation(sessionId)) {");
  const end = app.indexOf("      const owner = monoForSession(sessionId)", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn startProvider();", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("sessionWriteNeedsReconciliation", "writeSession", "enqueueHarnessEvent", "flushHarnessEvents", "startProvider",
    `return function(sessionId, options) { ${code} };`)(
    sessionWriteNeedsReconciliation, writeSession, () => {}, () => {}, startProvider,
  ) as (sessionId: string) => boolean;
}

async function fixture(surface: "embedded" | "floating", interrupt: boolean, fault?: "before-write" | "after-write", empty: boolean | "history" | "removed-draft" = false) {
  let context = interrupt ? initial : { ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) };
  let source: Session = { ...newSession("codex", "C:/code/Atlas"), id: "cc5cg-ack" };
  if (fault) source = { ...source, id: `cc5ch-retry-${surface}-${crypto.randomUUID()}`,
    blocks: empty ? [] : [{ id: "prior-user", role: "user", text: "Previous chat" }],
    monoTranscript: { before: null, firstBlockId: empty === "removed-draft" ? "removed-draft" : empty ? null : "prior-user" } };
  const sessionsRef = { current: [source] };
  let disk: Block[] = empty === "history" || empty === "removed-draft" ? [{ id: "older-history", role: "user", text: "Retain earlier history" }]
    : structuredClone(source.blocks);
  let readsBlocked = false;
  const project = { id: "c:/code/atlas", name: "Atlas", folder: "C:/code/Atlas", managerId: "atlas-engine",
    managerMonoId: "atlas-manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
  const goals: ManagerGoalHost = { mayDelegate: () => true, projects: async () => [project],
    deliver: vi.fn(async () => {}), status: async () => ({}), ready: async () => [] };
  let interrupted = false;
  const host = { context: () => context, ledger: new MonoManagerGoals({ load: async () => null, save: async () => {} }),
    goals, resolve: async () => project,
    persistOrigin: async (submission: MonoGoalSubmission, text: string) => {
      source = appendMonoGoalOrigin(source, submission, text);
      if (interrupt && !interrupted) { interrupted = true; throw Error("Origin saved; acknowledgement interrupted"); }
    },
    hasOrigin: (submission: MonoGoalSubmission) => source.blocks.some(block => block.id === submission.userMessageId),
    persistPending: vi.fn(async () => {}), persistCard: vi.fn(async () => {}), grand: vi.fn(() => false) };
  const adapter = fault ? appSubmit({
    submitMonoGoalRef: { current: undefined }, sessionsRef, setSessions: () => { source = sessionsRef.current[0]; },
    monoForSession: () => ({ id: "grand", role: "orchestrator" }),
    goalRoutingForMono: () => context, monoManagerGoals: host.ledger, managerGoalHost: { current: goals },
    invoke: native.invoke, pathKey, writeSession, getMonoGoalRecoveryBlocks,
    mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession, reconcileMonoGoalOrigin, retainSessionWrite, submitMonoGoal,
    appendMonoGoalOrigin, appendMonoGoalPendingCard, appendMonoGoalCard, submitSession: host.grand,
  }) : undefined;
  const submissions: MonoGoalSubmission[] = [];
  const texts: string[] = [];
  const ordinaryChat = vi.fn(() => true);
  const submitChat = exactChatGate(ordinaryChat);
  const submit = (text: string, attachments: unknown[], submission: MonoGoalSubmission) => {
    if (!submission) return submitChat(source.id);
    submissions.push(submission);
    texts.push(text);
    if (adapter) return adapter(source.id, text, attachments, submission);
    return submitMonoGoal({ text, attachmentCount: attachments.length, origin: "user", submission }, host);
  };
  const view = (): FloatingMonoView => ({ monoId: "grand", error: null,
    monos: [{ id: "grand", name: "Grand", mascot: "crab", color: "#aaf", sessionId: source.id, status: "idle", role: "orchestrator" }],
    session: { ...source, monoGoalRouting: context } });
  let receive!: (event: { payload: FloatingMonoView }) => void;
  native.listen.mockImplementation(async (_name, callback) => { receive = callback; return () => {}; });
  native.invoke.mockImplementation(async (command: string, args?: { action: FloatingMonoAction }) => {
    if (command === "project_root") return project.folder;
    if (command === "session_get") return { ...source, createdAt: 1, updatedAt: 2 };
    if (command === "mono_session_page") {
      if (readsBlocked) throw Error("Database read unavailable");
      return { blocks: structuredClone(disk), before: null, hasNewer: false };
    }
    if (command === "mono_session_upsert") {
      if (fault === "before-write" && !interrupted) {
        interrupted = true;
        throw Error("Database temporarily unavailable before saving");
      }
      const payload = args as unknown as { session: Session; blocksChanged: boolean;
        afterBlockId: string | null; fromBlockId: string | null; appendOnly: boolean };
      if (payload.blocksChanged) {
        const start = payload.afterBlockId ? disk.findIndex(block => block.id === payload.afterBlockId) + 1
          : payload.fromBlockId ? disk.findIndex(block => block.id === payload.fromBlockId)
          : payload.appendOnly ? disk.length : 0;
        expect(start).toBeGreaterThanOrEqual(0);
        disk = [...disk.slice(0, start), ...structuredClone(payload.session.blocks)];
        expect(new Set(disk.map(block => block.id)).size).toBe(disk.length);
      }
      if (fault === "after-write" && !interrupted && payload.session.blocks.some(block => block.monoGoalSubmission)) {
        interrupted = true;
        throw Error("Origin write acknowledgement interrupted before App publication");
      }
      return { ...payload.session, createdAt: 1, updatedAt: 2 };
    }
    if (command === "mono_chat_state") return view();
    if (command === "mono_chat_action") {
      try {
        await deliverFloatingMonoRequest({ id: submissions.length + 1, monoId: "grand", action: args!.action }, {
          open: async () => source,
          submit: (_id, text, attachments, options) => submit(text, attachments, options?.monoGoal!),
          stop() {}, approval() {}, question() {}, questionInteraction() {}, reveal: async () => {}, openFile() {}, resume() {},
        }, async () => true);
      } catch (reason) {
        // mono_chat_reply/action transport the owner's error string verbatim.
        throw reason instanceof Error ? reason.message : String(reason);
      }
    }
  });
  if (empty) await getSession(source.id);
  const render = () => surface === "floating"
    ? root.render(createElement(FloatingMonoChat, { onShown() {} }))
    : root.render(createElement(MonoComposer, { sessionId: source.id, name: "Grand", goalRouting: context,
      onSubmit: (text, attachments, submission) => submit(text, attachments, submission!) }));
  await act(async () => render());
  const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!;
  const props = Object.entries(field).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: "Fix Atlas checkout" } }));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New goal")!.click());
  const persistOrdinary = exactOrdinaryPersist(sessionsRef, source);
  return { host, goals, submissions, texts, ordinaryChat, source: () => source, disk: () => disk, field,
    blockReads: (blocked: boolean) => { readsBlocked = blocked; },
    saveOrdinaryBeforeReconcile: async () => {
      const original = sessionsRef.current[0];
      const next = original.blocks.some(block => block.id === "ordinary-during-uncertain") ? original
        : { ...original, blocks: [...original.blocks,
          { id: "ordinary-during-uncertain", role: "user" as const, text: "Continue chat from another composer" }] };
      sessionsRef.current = [next];
      source = next;
      persistOrdinary(next);
      await flushSessionWrites();
    },
    saveChat: async () => {
      const next = { ...source, blocks: [...source.blocks, { id: "later-user", role: "user" as const, text: "Later chat" }] };
      await upsertSession(next);
    },
    change: async (next: MonoGoalRoutingContext) => {
      context = next;
      await act(async () => surface === "floating" ? receive({ payload: view() }) : render());
    } };
}
function send() {
  return act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
}
function chip() {
  return container.querySelector('[data-mono-goal-route] [role="status"]')?.textContent;
}

it.each(["embedded", "floating"] as const)("retains the %s durable envelope after an interrupted acknowledgement", async surface => {
  const f = await fixture(surface, true);
  await send();
  expect(f.source().blocks).toHaveLength(1);
  expect(f.field.value).toBe("Fix Atlas checkout");
  expect(container.textContent).toContain("acknowledgement interrupted");
  await f.change({ ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) });
  expect(chip()).toContain("Send to Atlas Manager");
  await send();
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.submissions[1]).toBe(f.submissions[0]);
  expect(f.source().blocks).toHaveLength(1);
  expect(f.host.persistPending).toHaveBeenCalledOnce();
  expect(f.goals.deliver).not.toHaveBeenCalled();
});

it.each(["embedded", "floating"] as const)("recalculates the %s route only after a proven rejection", async surface => {
  const f = await fixture(surface, false);
  await send();
  expect(f.source().blocks).toHaveLength(0);
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.field.value).toBe("Fix Atlas checkout");
  await f.change(initial);
  expect(chip()).toContain("Send to Atlas Manager");
  await send();
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.submissions[1].requestId).not.toBe(f.submissions[0].requestId);
  expect(f.submissions[1].userMessageId).not.toBe(f.submissions[0].userMessageId);
  expect(f.goals.deliver).toHaveBeenCalledOnce();
  expect(f.field.value).toBe("");
});

it.each(["embedded", "floating"] as const)("reconciles the %s durable origin after failure before App publication", async surface => {
  const f = await fixture(surface, true, "after-write");
  await send();
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  expect(f.source().blocks.some(block => block.monoGoalSubmission)).toBe(false);
  expect(f.host.ledger.goals("grand")).toHaveLength(0);
  await f.change({ ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) });
  expect(chip()).toContain("Send to Atlas Manager");
  await send();
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.submissions[1]).toBe(f.submissions[0]);
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  expect(f.source().blocks.filter(block => block.monoGoalSubmission)).toHaveLength(1);
  expect(f.disk().find(block => block.id === `route-${f.submissions[0].userMessageId}`)?.text).toContain("Delivery blocked");
  await f.saveChat();
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  expect(f.disk().at(-1)?.id).toBe("later-user");
  expect(f.goals.deliver).not.toHaveBeenCalled();
});

it.each(["embedded", "floating"] as const)("refreshes the %s chip after proving a pre-save rejection before a fresh Send", async surface => {
  const f = await fixture(surface, true, "before-write");
  await send();
  expect(f.disk().some(block => block.monoGoalSubmission)).toBe(false);
  expect(f.source().blocks.some(block => block.monoGoalSubmission)).toBe(false);
  expect(container.textContent).toContain("Database temporarily unavailable");
  await f.change({ ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) });
  expect(chip()).toContain("Send to Atlas Manager");
  await send();
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.submissions[1]).toBe(f.submissions[0]);
  expect(chip()).toContain("Send to Grand Orch");
  expect(f.field.value).toBe("Fix Atlas checkout");
  await send();
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.submissions[2].requestId).not.toBe(f.submissions[0].requestId);
  expect(f.submissions[2].userMessageId).not.toBe(f.submissions[0].userMessageId);
});

it.each(["embedded", "floating"] as const)("blocks the %s original route while durable identity cannot be checked", async surface => {
  const f = await fixture(surface, true, "after-write");
  await send();
  await f.change({ ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) });
  f.blockReads(true);
  await send();
  expect(chip()).toContain("Send to Atlas Manager");
  expect(container.textContent).toContain("Checking previous send");
  expect(container.textContent).toContain("Retry original");
  expect(f.field.value).toBe("Fix Atlas checkout");
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.submissions[1]).toBe(f.submissions[0]);
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  f.blockReads(false);
  await send();
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.submissions[2]).toBe(f.submissions[0]);
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
});

it.each(["embedded", "floating"] as const)("preserves the %s unpublished origin against Chat before retry reconciliation", async surface => {
  const f = await fixture(surface, true, "after-write");
  await send();
  const origin = f.submissions[0];
  expect(f.source().blocks.some(block => block.id === origin.userMessageId)).toBe(false);
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  await f.saveOrdinaryBeforeReconcile();
  expect(f.disk().filter(block => block.id === origin.userMessageId)).toHaveLength(1);
  expect(f.disk().some(block => block.id === "ordinary-during-uncertain")).toBe(true);
  expect(f.source().blocks.filter(block => block.id === origin.userMessageId)).toHaveLength(1);
  expect(f.host.ledger.goals("grand")).toHaveLength(0);
  expect(f.goals.deliver).not.toHaveBeenCalled();
  expect((await getMonoGoalRecoveryBlocks(f.source().id)).filter(block => block.monoGoalSubmission)).toHaveLength(1);
});

it.each(["embedded", "floating"] as const)("holds %s ordinary saves until unreadable origin history becomes available", async surface => {
  const f = await fixture(surface, true, "after-write");
  await send();
  f.blockReads(true);
  const writesBefore = native.invoke.mock.calls.filter(call => call[0] === "mono_session_upsert").length;
  await f.saveOrdinaryBeforeReconcile();
  expect(native.invoke.mock.calls.filter(call => call[0] === "mono_session_upsert")).toHaveLength(writesBefore);
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  expect(sessionWriteNeedsReconciliation(f.source().id)).toBe(true);
  f.blockReads(false);
  await f.saveOrdinaryBeforeReconcile();
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
  expect(sessionWriteNeedsReconciliation(f.source().id)).toBe(false);
});

it.each(["embedded", "floating"] as const)("preserves the %s first unpublished origin from an initially empty transcript", async surface => {
  const f = await fixture(surface, true, "after-write", true);
  await send();
  await f.saveOrdinaryBeforeReconcile();
  expect(f.disk().filter(block => block.id === f.submissions[0].userMessageId)).toHaveLength(1);
  expect(f.disk().some(block => block.id === "ordinary-during-uncertain")).toBe(true);
});

it.each(["embedded", "floating"] as const)("preserves earlier history before the %s cached-empty writable tail", async surface => {
  const f = await fixture(surface, true, "after-write", "history");
  await send();
  await f.saveOrdinaryBeforeReconcile();
  expect(f.disk()[0].id).toBe("older-history");
  expect(f.disk().filter(block => block.id === f.submissions[0].userMessageId)).toHaveLength(1);
  expect(f.disk().some(block => block.id === "ordinary-during-uncertain")).toBe(true);
});

it.each(["embedded", "floating"] as const)("reconciles the %s origin after its empty tail's draft anchor was removed", async surface => {
  const f = await fixture(surface, true, "after-write", "removed-draft");
  await send();
  await f.saveOrdinaryBeforeReconcile();
  expect(f.disk()[0].id).toBe("older-history");
  expect(f.disk().filter(block => block.id === f.submissions[0].userMessageId)).toHaveLength(1);
  expect(f.source().monoTranscript?.firstBlockId).toBe(f.submissions[0].userMessageId);
  expect(sessionWriteNeedsReconciliation(f.source().id)).toBe(false);
});

it.each(["embedded", "floating"] as const)("retains the %s Chat draft without provider work until reconciliation completes", async surface => {
  const f = await fixture(surface, true, "after-write");
  await send();
  f.blockReads(true);
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Chat")!.click());
  const props = Object.entries(f.field).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: "Ordinary Chat while the goal is uncertain" } }));
  await send();
  await flushSessionWrites();
  expect(f.ordinaryChat).not.toHaveBeenCalled();
  expect(f.field.value).toBe("Ordinary Chat while the goal is uncertain");
  expect(sessionWriteNeedsReconciliation(f.source().id)).toBe(true);
  f.blockReads(false);
  await send();
  await flushSessionWrites();
  expect(f.ordinaryChat).not.toHaveBeenCalled();
  expect(f.field.value).toBe("Ordinary Chat while the goal is uncertain");
  expect(sessionWriteNeedsReconciliation(f.source().id)).toBe(false);
  await send();
  expect(f.ordinaryChat).toHaveBeenCalledOnce();
  expect(f.field.value).toBe("");
  expect(f.disk().filter(block => block.monoGoalSubmission)).toHaveLength(1);
});

for (const explicit of [false, true]) {
  it.each([
    " \tFix Atlas and every registered project\r\n",
    "Apply this fix to Atlas and all our registered projects",
    "Fix Atlas and both remaining registered repositories",
    "Each registered repository needs the Atlas fix",
    "Registered projects: all need the Atlas fix",
    "Fix Atlas and every **registered** project",
    "Fix Atlas and all,\tremaining repositories",
    "Fix Atlas and the remaining projects",
    "Fix Atlas and other registered projects",
    "Apply Atlas changes to other repositories too",
    "Fix Atlas and any other registered repo",
    "Fix Atlas and another project",
    "Fix Atlas and the rest of our repositories",
    "Additional registered projects need the Atlas fix",
    "Fix Atlas workspace startup",
    "Fix Atlas codebase startup",
    "Fix Atlas and 42 repositories",
    "Fix Atlas and every other code base",
    "Fix Atlas and every other code-base",
    "Fix Atlas and every other work space",
    "Fix Atlas and every other work-space",
  ])("retains floating Grand scope and retry identity for %s (explicit " + explicit + ")", async text => {
    const f = await fixture("floating", true);
    await f.change({ ...initial, projects: [...initial.projects, {
      id: "c:/code/beacon", name: "Beacon", path: "C:/code/Beacon",
      managerMonoId: "beacon-manager", available: false,
    }] });
    const props = Object.entries(f.field).find(([key]) => key.startsWith("__reactProps"))![1];
    act(() => props.onChange({ target: { value: text } }));
    if (explicit) {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
        .find(button => button.textContent?.trim() === "Atlas Manager")!.click());
    }
    expect(chip()).toContain("Send to Grand Orch");
    expect(chip()).toContain("Comparison or cross-project goal");
    await send();
    expect(f.field.value).toBe(text);
    f.host.grand.mockReturnValue(true);
    await send();
    const first = f.submissions[0];
    expect(f.texts).toEqual([text, text]);
    expect(f.submissions[1]).toMatchObject({ requestId: first.requestId, userMessageId: first.userMessageId });
    expect(first).toMatchObject({ ownerId: "grand", choice: { mode: "goal", override: explicit ? "manager" : "auto" } });
    expect(first.projectId).toBeUndefined();
    expect(first.managerMonoId).toBeUndefined();
    expect(f.host.grand).toHaveBeenCalledTimes(2);
    expect(f.source().blocks).toHaveLength(0);
    expect(f.goals.deliver).not.toHaveBeenCalled();
    expect(f.host.ledger.goals("grand")).toHaveLength(0);
    expect(f.field.value).toBe("");
  });
}
