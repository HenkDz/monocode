// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FloatingMonoChat } from "./FloatingMonoChat";
import { MonoComposer } from "./MonoComposer";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { newSession } from "../../sessions/model/session";
import { deliverFloatingMonoRequest, type FloatingMonoAction, type FloatingMonoView } from "../model/floatingMono";
import { appendMonoGoalOrigin, submitMonoGoal, type MonoGoalRoutingContext, type MonoGoalSubmission } from "../model/monoGoalRouting";
import { MonoManagerGoals, type ManagerGoalHost } from "../model/monoManagerGoals";

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

async function fixture(surface: "embedded" | "floating", interrupt: boolean) {
  let context = interrupt ? initial : { ...initial, projects: initial.projects.map(project => ({ ...project, available: false })) };
  let source = { ...newSession("codex", "C:/code/Atlas"), id: "cc5cg-ack" };
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
  const submissions: MonoGoalSubmission[] = [];
  const submit = (text: string, attachments: unknown[], submission: MonoGoalSubmission) => {
    submissions.push(submission);
    return submitMonoGoal({ text, attachmentCount: attachments.length, origin: "user", submission }, host);
  };
  const view = (): FloatingMonoView => ({ monoId: "grand", error: null,
    monos: [{ id: "grand", name: "Grand", mascot: "crab", color: "#aaf", sessionId: source.id, status: "idle", role: "orchestrator" }],
    session: { ...source, monoGoalRouting: context } });
  let receive!: (event: { payload: FloatingMonoView }) => void;
  native.listen.mockImplementation(async (_name, callback) => { receive = callback; return () => {}; });
  native.invoke.mockImplementation(async (command: string, args?: { action: FloatingMonoAction }) => {
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
  return { host, goals, submissions, source: () => source, field,
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
