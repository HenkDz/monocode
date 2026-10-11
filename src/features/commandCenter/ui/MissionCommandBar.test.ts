// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { MonoManagerGoals, type ManagerGoalHost } from "../../monos/model/monoManagerGoals";
import { appendMonoGoalOrigin, submitMonoGoal, type MonoGoalRoutingContext, type MonoGoalSubmission } from "../../monos/model/monoGoalRouting";
import { MissionCommandBar } from "./MissionCommandBar";

const context: MonoGoalRoutingContext = {
  ownerId: "grand",
  projects: [
    { id: "c:/code/atlas", name: "Atlas", path: "C:/code/Atlas", managerMonoId: "atlas-manager", available: true },
    { id: "c:/code/beacon", name: "Beacon", path: "C:/code/Beacon", managerMonoId: "beacon-manager", available: true },
  ],
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function fixture() {
  let ctx = structuredClone(context);
  let source = newSession("codex", "C:/code/Atlas");
  const project = {
    id: "c:/code/atlas", name: "Atlas", folder: "C:/code/Atlas", managerId: "atlas-engine",
    managerMonoId: "atlas-manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [],
  };
  const goals: ManagerGoalHost = {
    mayDelegate: () => true, projects: async () => [project],
    deliver: vi.fn(async () => {}), status: async () => ({}), ready: async () => [],
  };
  const host = {
    context: () => ctx,
    ledger: new MonoManagerGoals({ load: async () => null, save: async () => {} }),
    goals, resolve: vi.fn(async () => project),
    persistOrigin: vi.fn(async (submission: MonoGoalSubmission, text: string) => { source = appendMonoGoalOrigin(source, submission, text); }),
    hasOrigin: (submission: MonoGoalSubmission) => source.blocks.some(block => block.id === submission.userMessageId),
    persistPending: vi.fn(async () => {}), persistCard: vi.fn(async () => {}),
    grand: vi.fn((): boolean | Promise<boolean> => true),
  };
  const onSubmit = vi.fn(async (text: string, submission?: MonoGoalSubmission) => submission
    ? submitMonoGoal({ text, attachmentCount: 0, origin: "user", submission }, host)
    : host.grand());
  const render = (open = true) => act(() => root.render(createElement(MissionCommandBar, { goalRouting: ctx, onSubmit, open })));
  return { host, onSubmit, render, change: (next: MonoGoalRoutingContext) => { ctx = next; render(); } };
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label)!;
}
function field() { return container.querySelector<HTMLTextAreaElement>('[aria-label="Ask or assign work"]')!; }
function enter(text = "Fix Atlas checkout", goal = true) {
  const props = Object.entries(field()).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: text } }));
  if (goal) act(() => button("New goal").click());
}
function send() { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
function chip() { return container.querySelector('[data-mono-goal-route] [role="status"]')?.textContent; }
async function override(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(item => item.textContent?.trim() === label)!.click());
}

it("defaults to Chat, uses the Grand callback and resets accepted goals to Chat", async () => {
  const f = fixture(); f.render();
  expect(button("Chat").getAttribute("aria-pressed")).toBe("true");
  expect(container.textContent).toContain("Send to Grand Orch");
  enter("What changed in Atlas?", false);
  await act(async () => send());
  expect(f.onSubmit).toHaveBeenCalledWith("What changed in Atlas?", undefined);
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
  expect(field().value).toBe("");
  enter(); await act(async () => send());
  expect(button("Chat").getAttribute("aria-pressed")).toBe("true");
});

it("routes an explicit exact project goal once through CC5-C with zero Grand submissions", async () => {
  const f = fixture(); f.render(); enter();
  expect(chip()).toContain("Send to Atlas Manager");
  await act(async () => send());
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.host.goals.deliver).toHaveBeenCalledOnce();
  expect(f.host.ledger.goals("grand")).toHaveLength(1);
  expect(f.onSubmit.mock.calls[0][1]).toMatchObject({ ownerId: "grand", projectId: "c:/code/atlas", managerMonoId: "atlas-manager" });
});

it.each(["Fix Atlas and Beacon", "Compare Atlas to the baseline", "Unmatched work"])("keeps conservative fallback for %s", async text => {
  const f = fixture(); f.render(); enter(text);
  expect(chip()).toContain("Send to Grand Orch");
  await act(async () => send());
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
});

it("uses the real route override picker and keeps cross-project safeguards", async () => {
  const f = fixture(); f.render(); enter("Do the next task");
  await override("Atlas Manager");
  expect(chip()).toContain("Send to Atlas Manager");
  enter("Fix Atlas and Beacon", false);
  expect(chip()).toContain("Send to Grand Orch");
  await act(async () => send());
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
});

it.each([false, true])("checks raw special whitespace before sending (explicit %s)", async explicit => {
  const f = fixture(); f.render(); enter("\ufeffFix Atlas checkout\u00a0");
  if (explicit) await override("Atlas Manager");
  expect(chip()).toContain("Send to Grand Orch");
  expect(chip()).toContain("Contains non-English or special characters, so Grand Orch will route it.");
  await act(async () => send());
  expect(f.onSubmit.mock.calls[0][1]?.projectId).toBeUndefined();
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
  expect(f.host.ledger.goals("grand")).toHaveLength(0);
});

it("treats a raw whitespace edit as a new goal after an uncertain send", async () => {
  const f = fixture(); f.render(); enter();
  f.onSubmit.mockRejectedValueOnce(Error("Acknowledgement interrupted"));
  await act(async () => send());
  const first = f.onSubmit.mock.calls[0][1]!;
  enter("Fix Atlas checkout\u00a0", false);
  expect(chip()).toContain("Send to Grand Orch");
  await act(async () => send());
  const edited = f.onSubmit.mock.calls[1][1]!;
  expect(edited.requestId).not.toBe(first.requestId);
  expect(edited.projectId).toBeUndefined();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
  expect(f.host.grand).toHaveBeenCalledOnce();
});

it("keeps a pending envelope and blocks repeat Send until explicit rejection", async () => {
  const f = fixture();
  let resolve!: (value: boolean) => void;
  f.host.grand.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  f.change({ ...context, projects: context.projects.map(project => ({ ...project, available: false })) });
  enter(); await act(async () => send());
  const first = f.onSubmit.mock.calls[0][1]!;
  f.change(context);
  expect(chip()).toContain("Send to Grand Orch");
  expect(field().disabled).toBe(true);
  act(send);
  expect(f.onSubmit).toHaveBeenCalledOnce();
  await act(async () => resolve(false));
  expect(field().value).toBe("Fix Atlas checkout");
  expect(chip()).toContain("Send to Atlas Manager");
  await act(async () => send());
  expect(f.onSubmit.mock.calls[1][1]!.requestId).not.toBe(first.requestId);
  expect(f.host.grand).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).toHaveBeenCalledOnce();
});

it("reuses request identity when an explicitly rejected route is unchanged", async () => {
  const f = fixture(); f.host.grand.mockReturnValue(false);
  f.render(); enter("No matching project");
  await act(async () => send()); await act(async () => send());
  expect(f.onSubmit.mock.calls[1][1]!.requestId).toBe(f.onSubmit.mock.calls[0][1]!.requestId);
  expect(f.onSubmit.mock.calls[1][1]!.userMessageId).toBe(f.onSubmit.mock.calls[0][1]!.userMessageId);
});

it("retains the durable route after an uncertain throw and never falls back to Grand on retry", async () => {
  const f = fixture();
  const persist = f.host.persistOrigin.getMockImplementation()!;
  f.host.persistOrigin.mockImplementationOnce(async (submission, text) => { await persist(submission, text); throw Error("Acknowledgement interrupted"); });
  f.render(); enter(); await act(async () => send());
  const first = f.onSubmit.mock.calls[0][1]!;
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Acknowledgement interrupted");
  f.change({ ...context, projects: [{ ...context.projects[0], name: "Atlas renamed", managerMonoId: "replacement-manager" }] });
  expect(chip()).toContain("Send to Atlas Manager");
  expect(chip()).not.toContain("Atlas renamed");
  await act(async () => send());
  expect(f.onSubmit.mock.calls[1][1]).toBe(first);
  expect(f.host.grand).not.toHaveBeenCalled();
  expect(f.host.persistPending).toHaveBeenCalledOnce();
  expect(f.host.goals.deliver).not.toHaveBeenCalled();
});

it("focuses on slash only while visible and leaves text editing and modal input alone", () => {
  const f = fixture(); f.render();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(field());
  const key = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  field().dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  field().blur(); f.render(false);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", cancelable: true })));
  expect(document.activeElement).not.toBe(field());
  f.render();
  const dialog = document.createElement("div"); dialog.setAttribute("aria-modal", "true"); container.append(dialog);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", cancelable: true })));
  expect(document.activeElement).not.toBe(field());
});

it("disables empty commands and handles a missing Grand without creating work", () => {
  const f = fixture(); f.render();
  expect(button("Send").disabled).toBe(true);
  act(send); expect(f.onSubmit).not.toHaveBeenCalled();
  act(() => root.render(createElement(MissionCommandBar, { onSubmit: f.onSubmit })));
  expect(field().disabled).toBe(true);
  expect(container.textContent).toContain("Set up Grand Orch");
});

it("submits on Enter while preserving Shift-Enter and IME composition", async () => {
  const f = fixture(); f.render(); enter("Ask Grand", false);
  for (const properties of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...properties });
    await act(async () => field().dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
  }
  expect(f.onSubmit).not.toHaveBeenCalled();
  const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => field().dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true);
  expect(f.host.grand).toHaveBeenCalledOnce();
});
