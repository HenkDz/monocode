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
import { upsertSession, writeSession } from "../../sessions/data/sessionStore";
import { getMonoGoalRecoveryBlocks, mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession } from "../../sessions/data/monoGoalRecovery";
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

async function fixture(surface: "embedded" | "floating", interrupt: boolean, fault?: "before-write" | "after-write") {
  let context = interrupt ? initial : { ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) };
  let source: Session = { ...newSession("codex", "C:/code/Atlas"), id: "cc5cg-ack" };
  if (fault) source = { ...source, id: `cc5ch-retry-${surface}-${crypto.randomUUID()}`,
    blocks: [{ id: "prior-user", role: "user", text: "Previous chat" }],
    monoTranscript: { before: null, firstBlockId: "prior-user" } };
  const sessionsRef = { current: [source] };
  let disk: Block[] = structuredClone(source.blocks);
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
    mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession, submitMonoGoal,
    appendMonoGoalOrigin, appendMonoGoalPendingCard, appendMonoGoalCard, submitSession: host.grand,
  }) : undefined;
  const submissions: MonoGoalSubmission[] = [];
  const submit = (text: string, attachments: unknown[], submission: MonoGoalSubmission) => {
    submissions.push(submission);
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
      if (fault === "after-write" && !interrupted) {
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
          submit: (_id, text, attachments, options) => submit(text, attachments, options!.monoGoal),
          stop() {}, approval() {}, question() {}, questionInteraction() {}, reveal: async () => {}, openFile() {}, resume() {},
        }, async () => true);
      } catch (reason) {
        // mono_chat_reply/action transport the owner's error string verbatim.
        throw reason instanceof Error ? reason.message : String(reason);
      }
    }
  });
  const render = () => surface === "floating"
    ? root.render(createElement(FloatingMonoChat, { onShown() {} }))
    : root.render(createElement(MonoComposer, { sessionId: source.id, name: "Grand", goalRouting: context,
      onSubmit: (text, attachments, submission) => submit(text, attachments, submission!) }));
  await act(async () => render());
  const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!;
  const props = Object.entries(field).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: "Fix Atlas checkout" } }));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New goal")!.click());
  return { host, goals, submissions, source: () => source, disk: () => disk, field,
    blockReads: (blocked: boolean) => { readsBlocked = blocked; },
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
