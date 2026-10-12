// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoComposer } from "./MonoComposer";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { newSession } from "../../sessions/model/session";
import { MonoManagerGoals, type ManagerGoalHost } from "../model/monoManagerGoals";
import {
  appendMonoGoalOrigin,
  submitMonoGoal,
  type MonoGoalRoutingContext,
  type MonoGoalSubmission,
} from "../model/monoGoalRouting";

vi.mock("../../sessions/hooks/useFileDrop", () => ({ useFileDrop: () => false }));

const context: MonoGoalRoutingContext = {
  ownerId: "grand",
  projects: [{
    id: "c:/code/atlas", name: "Atlas", path: "C:/code/Atlas",
    managerMonoId: "atlas-manager", available: true,
  }],
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "true");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  clearComposerDraft("cc5cf-retry");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.unstubAllEnvs();
  act(() => root.unmount());
  container.remove();
  clearComposerDraft("cc5cf-retry");
  vi.unstubAllGlobals();
});
function fixture() {
  let ctx = structuredClone(context);
  let source = newSession("codex", "C:/code/Atlas");
  const project = {
    id: "c:/code/atlas", name: "Atlas", folder: "C:/code/Atlas", managerId: "atlas-engine",
    managerMonoId: "atlas-manager", managerExists: true, running: 0, needsDecision: 0,
    ready: 0, blocked: [], goals: [],
  };
  const goals: ManagerGoalHost = {
    mayDelegate: () => true, projects: async () => [project],
    deliver: vi.fn(async () => {}), status: async () => ({}), ready: async () => [],
  };
  const host = {
    context: () => ctx,
    ledger: new MonoManagerGoals({ load: async () => null, save: async () => {} }),
    goals, resolve: vi.fn(async () => project),
    persistOrigin: vi.fn(async (submission: MonoGoalSubmission, text: string) => {
      source = appendMonoGoalOrigin(source, submission, text);
    }),
    hasOrigin: (submission: MonoGoalSubmission) =>
      source.blocks.some(block => block.id === submission.userMessageId),
    persistPending: vi.fn(async () => {}), persistCard: vi.fn(async () => {}),
    grand: vi.fn((): boolean | Promise<boolean> => false),
  };
  const onSubmit = vi.fn((text: string, files: unknown[], submission?: MonoGoalSubmission) =>
    submitMonoGoal({ text, attachmentCount: files.length, origin: "user", submission: submission! }, host));
  const render = () => act(() => root.render(createElement(MonoComposer, {
    sessionId: "cc5cf-retry", name: "Grand", goalRouting: ctx, onSubmit,
  })));
  return { host, onSubmit, render, change: (next: MonoGoalRoutingContext) => { ctx = next; render(); } };
}
function enterGoal(text = "Fix Atlas checkout") {
  const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!;
  const props = Object.entries(field).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: text } }));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "New goal")!.click());
}
function send() {
  container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
function chip() {
  return container.querySelector('[data-mono-goal-route] [role="status"]')?.textContent;
}

it("honors the visible Manager route after the actual adapter rejects a Grand fallback", async () => {
  const f = fixture();
  f.change({ ...context, projects: context.projects.map(project => ({ ...project, available: false })) });
  enterGoal();
  await act(async () => send());
  expect(f.host.grand).toHaveBeenCalledTimes(1);
  expect(chip()).toContain("Send to Grand Orch");
  const first = f.onSubmit.mock.calls[0][2]!;
  f.change(context);
  expect(chip()).toContain("Send to Atlas Manager");
  await act(async () => send());
  expect(f.host.grand).toHaveBeenCalledTimes(1);
  expect(f.onSubmit.mock.calls[1][2]).toEqual(expect.objectContaining({
    projectId: "c:/code/atlas", managerMonoId: "atlas-manager", reason: "Exact project name",
  }));
  expect(f.onSubmit.mock.calls[1][2]!.requestId).not.toBe(first.requestId);
  expect(f.onSubmit.mock.calls[1][2]!.userMessageId).not.toBe(first.userMessageId);
  expect(f.host.goals.deliver).toHaveBeenCalledOnce();
});

it("shows the retained Grand envelope until a pending adapter establishes rejection", async () => {
  const f = fixture();
  let reject!: (accepted: boolean) => void;
  f.host.grand.mockImplementationOnce(() => new Promise<boolean>(resolve => { reject = resolve; }));
  f.change({ ...context, projects: context.projects.map(project => ({ ...project, available: false })) });
  enterGoal();
  await act(async () => send());
  const first = f.onSubmit.mock.calls[0][2]!;
  f.change(context);
  expect(chip()).toContain("Send to Grand Orch");
  expect(chip()).toContain(first.reason);
  act(send);
  expect(f.onSubmit).toHaveBeenCalledTimes(1);
  await act(async () => reject(false));
  expect(chip()).toContain("Send to Atlas Manager");
  await act(async () => send());
  expect(f.host.grand).toHaveBeenCalledTimes(1);
  expect(f.host.goals.deliver).toHaveBeenCalledOnce();
});

it("keeps the durable envelope and chip after an ambiguous throw and a replacement roster", async () => {
  const f = fixture();
  const persist = f.host.persistOrigin.getMockImplementation()!;
  f.host.persistOrigin.mockImplementationOnce(async (submission, text) => {
    await persist(submission, text);
    throw Error("Origin saved; acknowledgement interrupted");
  });
  f.render();
  enterGoal();
  await act(async () => send());
  const first = f.onSubmit.mock.calls[0][2]!;
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("acknowledgement interrupted");
  f.change({ ...context, projects: [{
    ...context.projects[0], name: "Atlas renamed", managerMonoId: "replacement-manager",
  }] });
  expect(chip()).toContain("Send to Atlas Manager");
  expect(chip()).toContain(first.reason);
  expect(chip()).not.toContain("Atlas renamed");
  await act(async () => send());
  expect(f.onSubmit.mock.calls[1][2]).toBe(first);
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.host.persistPending).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
});

it("gives a raw whitespace edit new IDs after an uncertain goal send", async () => {
  const f = fixture(); f.render(); enterGoal();
  f.onSubmit.mockRejectedValueOnce(Error("Acknowledgement interrupted"));
  await act(async () => send());
  const first = f.onSubmit.mock.calls[0][2]!;
  const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!;
  const props = Object.entries(field).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: "Fix Atlas checkout\u00a0" } }));
  expect(chip()).toContain("Send to Grand Orch");
  await act(async () => send());
  const edited = f.onSubmit.mock.calls[1][2]!;
  expect(edited.requestId).not.toBe(first.requestId);
  expect(edited.projectId).toBeUndefined();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
  expect(f.host.grand).toHaveBeenCalledOnce();
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
  ])("retains embedded Grand scope and retry identity for %s (explicit " + explicit + ")", async text => {
    const f = fixture();
    f.change({ ...context, projects: [...context.projects, {
      id: "c:/code/beacon", name: "Beacon", path: "C:/code/Beacon",
      managerMonoId: "beacon-manager", available: false,
    }] });
    enterGoal(text);
    if (explicit) {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
        .find(button => button.textContent?.trim() === "Atlas Manager")!.click());
    }
    expect(chip()).toContain("Send to Grand Orch");
    expect(chip()).toContain("Comparison or cross-project goal");
    await act(async () => send());
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!.value).toBe(text);
    f.host.grand.mockReturnValue(true);
    await act(async () => send());
    const first = f.onSubmit.mock.calls[0][2]!;
    expect(f.onSubmit.mock.calls.map(call => call[0])).toEqual([text, text]);
    expect(f.onSubmit.mock.calls[1][2]).toMatchObject({ requestId: first.requestId, userMessageId: first.userMessageId });
    expect(first).toMatchObject({ ownerId: "grand", choice: { mode: "goal", override: explicit ? "manager" : "auto" } });
    expect(first.projectId).toBeUndefined();
    expect(first.managerMonoId).toBeUndefined();
    expect(f.host.grand).toHaveBeenCalledTimes(2);
    expect(f.host.resolve).not.toHaveBeenCalled();
    expect(f.host.persistOrigin).not.toHaveBeenCalled();
    expect(f.host.goals.deliver).not.toHaveBeenCalled();
    expect(f.host.ledger.goals("grand")).toHaveLength(0);
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!.value).toBe("");
  });
}
