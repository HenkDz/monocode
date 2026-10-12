// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoComposer } from "./MonoComposer";
import { ContextMeter } from "../../sessions/ui/ContextMeter";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { saveComposerAutocorrect } from "../../settings/model/displayPrefs";
import { MonoManagerGoals, type ManagerGoalHost } from "../model/monoManagerGoals";
import { submitMonoGoal, type MonoGoalRoutingContext, type MonoGoalSubmission } from "../model/monoGoalRouting";

const { pick } = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock("../../sessions/model/attachments", async (original) => ({
  ...(await original<typeof import("../../sessions/model/attachments")>()),
  pickAttachments: pick,
}));
vi.mock("../../sessions/hooks/useFileDrop", () => ({
  useFileDrop: () => false,
}));
// The picker itself is covered on its own; here it just hands over a pick.
vi.mock("../../../shared/ui/EmojiPicker", async () => {
  const { createElement } = await import("react");
  return {
    EmojiPickerPopover: ({ onPick }: { onPick: (emoji: string) => void }) =>
      createElement(
        "button",
        { type: "button", "data-pick": "", onClick: () => onPick("😀") },
        "pick",
      ),
  };
});

let container: HTMLDivElement;
let root: Root;
const file = {
  id: "file",
  name: "note.txt",
  kind: "file" as const,
  mimeType: "text/plain",
  size: 12,
  path: "/tmp/note.txt",
};
beforeEach(() => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "true");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  clearComposerDraft("chat");
  pick.mockReset().mockResolvedValue([file]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.unstubAllEnvs();
  act(() => root.unmount());
  container.remove();
  clearComposerDraft("chat");
  vi.unstubAllGlobals();
});
function render(extra: Partial<Parameters<typeof MonoComposer>[0]> = {}) {
  act(() =>
    root.render(
      createElement(MonoComposer, {
        sessionId: "chat",
        name: "Captain",
        onSubmit: () => true,
        ...extra,
      }),
    ),
  );
}
function field() {
  return container.querySelector<HTMLTextAreaElement>(
    '[aria-label="Message Captain"]',
  )!;
}
function type(text: string) {
  const input = field();
  const props = Object.entries(input).find(([key]) =>
    key.startsWith("__reactProps"),
  )![1];
  act(() => props.onChange({ target: { value: text } }));
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
const goalRouting: MonoGoalRoutingContext = {
  ownerId: "grand",
  projects: [{
    id: "dzdistro", name: "DZDistro", path: "C:/projects/dzdistro",
    managerMonoId: "manager", available: true,
  }],
};
function newGoal() {
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "New goal")!.click());
}

it("keeps ordinary chat on the two-argument submit path even when goal routing is available", () => {
  const onSubmit = vi.fn(() => true);
  render({ goalRouting, onSubmit });
  type("What is DZDistro doing?");
  act(submit);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("What is DZDistro doing?", []);
});

it("submits a default-off new goal to the Grand callback without route predictions", () => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "false");
  const onSubmit = vi.fn(() => true);
  render({ goalRouting, onSubmit });
  type("Fix DZDistro and every registered project");
  newGoal();
  expect(container.querySelector('[data-mono-goal-route] [role="status"]')).toBeNull();
  expect(container.querySelector('[aria-label="Goal route: Auto route"]')).toBeNull();
  act(submit);
  expect(onSubmit.mock.calls[0][2]).not.toHaveProperty("projectId");
});

it("routes a stale explicit embedded selection through Grand without Manager writes", async () => {
  const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
  const project = { id: "dzdistro", name: "DZDistro", folder: "C:/projects/dzdistro", managerId: "engine",
    managerMonoId: "manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
  const goals: ManagerGoalHost = { mayDelegate: () => true, projects: async () => [project], deliver: vi.fn(async () => {}),
    status: async () => ({}), ready: async () => [] };
  const grand = vi.fn(() => true);
  const onSubmit = vi.fn((text: string, files: unknown[], submission?: MonoGoalSubmission) => submitMonoGoal({
    text, attachmentCount: files.length, origin: "user", submission: submission!,
  }, { context: () => ({ ...goalRouting, ownerId: "grand" }), resolve: async () => project, ledger, goals,
    persistOrigin: async () => {}, hasOrigin: () => false, persistPending: async () => {}, persistCard: async () => {}, grand }));
  render({ goalRouting, onSubmit });
  type("Fix the checkout"); newGoal();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(button => button.textContent?.trim() === "DZDistro Manager")!.click());
  type("Fix DZDistro C:/outside/repo/index.ts");
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "false");
  render({ goalRouting, onSubmit });
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(submit);
  await act(async () => {});
  expect(grand).toHaveBeenCalledOnce();
  expect(goals.deliver).not.toHaveBeenCalled();
  expect(ledger.goals("grand")).toHaveLength(0);
});

it("captures the displayed route with stable IDs on retry and fresh IDs after acceptance", () => {
  const onSubmit = vi.fn((_text: string, _files: unknown[], _goal?: MonoGoalSubmission) => false);
  render({ goalRouting, onSubmit });
  type("Fix DZDistro checkout");
  newGoal();
  act(submit);
  const first = onSubmit.mock.calls[0][2]!;
  expect(first).toEqual({
    ownerId: "grand",
    choice: { mode: "goal", override: "auto" },
    projectId: "dzdistro", managerMonoId: "manager", reason: "Exact project name",
    requestId: expect.any(String), userMessageId: expect.any(String),
  });
  act(submit);
  expect(onSubmit.mock.calls[1][2]).toEqual(first);
  onSubmit.mockReturnValueOnce(true);
  act(submit);
  expect(field().value).toBe("");
  expect(container.querySelector('[data-mono-goal-route] [aria-pressed="true"]')?.textContent).toBe("Chat");
  expect(container.querySelector('[data-mono-goal-route] [role="status"]')).toBeNull();
  type("What is DZDistro doing?");
  act(submit);
  expect(onSubmit.mock.calls[3]).toEqual(["What is DZDistro doing?", []]);
  type("Fix DZDistro checkout");
  newGoal();
  act(submit);
  expect(onSubmit.mock.calls[4][2]!.requestId).not.toBe(first.requestId);
  expect(onSubmit.mock.calls[4][2]!.userMessageId).not.toBe(first.userMessageId);
});

it("gives an edited rejected goal a new request identity", () => {
  const onSubmit = vi.fn((_text: string, _files: unknown[], _goal?: MonoGoalSubmission) => false);
  render({ goalRouting, onSubmit });
  type("Fix DZDistro checkout");
  newGoal();
  act(submit);
  type("Fix DZDistro checkout and add a regression test");
  act(submit);
  expect(onSubmit.mock.calls[1][2]!.requestId).not.toBe(onSubmit.mock.calls[0][2]!.requestId);
});

it("gives changed route choices and attachments new request identities after rejection", async () => {
  const onSubmit = vi.fn((_text: string, _files: unknown[], _goal?: MonoGoalSubmission) => false);
  render({ goalRouting, onSubmit });
  type("Fix DZDistro checkout");
  newGoal();
  act(submit);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(button => button.textContent?.trim() === "Grand Orch")!.click());
  act(submit);
  expect(onSubmit.mock.calls[1][2]!.requestId).not.toBe(onSubmit.mock.calls[0][2]!.requestId);
  expect(onSubmit.mock.calls[1][2]!.choice.override).toBe("grand");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!.click());
  act(submit);
  expect(onSubmit.mock.calls[2][2]!.requestId).not.toBe(onSubmit.mock.calls[1][2]!.requestId);
  expect(onSubmit.mock.calls[2][1]).toEqual([file]);
  onSubmit.mockReturnValueOnce(true);
  act(submit);
  newGoal();
  expect(container.querySelector('[aria-label="Goal route: Auto route"]')).not.toBeNull();
});

it("locks route controls during Send and retains the authorized snapshot while the roster changes", async () => {
  let resolve!: (accepted: boolean) => void;
  const onSubmit = vi.fn((_text: string, _files: unknown[], _goal?: MonoGoalSubmission) =>
    new Promise<boolean>(done => { resolve = done; }));
  render({ goalRouting, onSubmit });
  type("Fix DZDistro checkout");
  newGoal();
  act(() => { submit(); submit(); });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const first = onSubmit.mock.calls[0][2]!;
  for (const button of container.querySelectorAll<HTMLButtonElement>("[data-mono-goal-route] button"))
    expect(button.disabled).toBe(true);
  render({ goalRouting: { ...goalRouting, projects: [{ ...goalRouting.projects[0], available: false }] }, onSubmit });
  expect(first.managerMonoId).toBe("manager");
  expect(container.querySelector('[data-mono-goal-route] [role="status"]')?.textContent).toContain("Send to DZDistro Manager");
  await act(async () => resolve(false));
  expect(container.querySelector('[data-mono-goal-route] [aria-pressed="true"]')?.textContent).toBe("New goal");
  expect(container.querySelector('[data-mono-goal-route] [role="status"]')?.textContent).toContain("Send to Grand Orch");
  act(submit);
  expect(onSubmit.mock.calls[1][2]!.requestId).not.toBe(first.requestId);
  expect(onSubmit.mock.calls[1][2]).not.toHaveProperty("projectId");
  expect(onSubmit.mock.calls[1][2]!.reason).toBe("Project has no available local Manager");
  await act(async () => resolve(true));
  expect(container.querySelector('[data-mono-goal-route] [aria-pressed="true"]')?.textContent).toBe("Chat");
});

it("sends attached goals through Grand with their full attachment content", async () => {
  const onSubmit = vi.fn(() => false);
  render({ goalRouting, onSubmit });
  type("Fix DZDistro checkout");
  newGoal();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!.click());
  act(submit);
  expect(onSubmit).toHaveBeenCalledWith("Fix DZDistro checkout", [file], expect.objectContaining({
    reason: "Attachments need the full Grand submission",
  }));
  expect(onSubmit.mock.calls[0]).toHaveLength(3);
  expect(onSubmit.mock.calls[0][2]).not.toHaveProperty("projectId");
});

it("renders scheduled and unknown context labels beside the primary Mono input", async () => {
  render({
    controls: createElement(ContextMeter, {
      usage: { used: 150_000, window: 200_000 },
      rotationScheduled: true,
      onCompact: vi.fn(),
    }),
  });
  expect(
    container
      .querySelector('[title="Context usage"]')
      ?.getAttribute("aria-label"),
  ).toContain("Will refresh context before next turn");
  type("Keep this draft");
  render({
    controls: createElement(ContextMeter, {
      usage: { used: 150_000 },
      onCompact: vi.fn(),
    }),
  });
  expect(container.textContent).toContain("Context window unknown");
  expect(container.querySelector("svg[role=img]")).toBeNull();
  expect(field().value).toBe("Keep this draft");
  const controls = container.querySelector("[data-mono-composer-controls]")!;
  expect(controls.querySelectorAll('[title="Context usage"]')).toHaveLength(1);
  expect(
    field().compareDocumentPosition(controls) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("shows a refresh deferral and keeps manual compact guarded while busy", async () => {
  const compact = vi.fn(() => true);
  const reason =
    "Context refresh deferred: brief and next input too large (15000 chars). Compact manually or trim constraints.";
  render({
    controls: createElement(ContextMeter, {
      rotationDeferredReason: reason,
      onCompact: compact,
      compactDisabled: true,
    }),
  });
  expect(container.querySelector('[role="status"]')?.textContent).toBe(reason);
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
  expect(compact).not.toHaveBeenCalled();
});
it("renders the regular four-mode AccessPicker chip in the Mono composer", async () => {
  const change = vi.fn();
  render({ runtimeMode: "full-access", onRuntimeModeChange: change });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Full access"]')!.click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(4);
  for (const label of ["Supervised", "Auto-accept edits", "Auto", "Full access"])
    expect(options.some(option => option.textContent?.includes(label))).toBe(true);
  await act(async () => options.find(option => option.textContent?.includes("Supervised"))!.click());
  expect(change).toHaveBeenCalledWith("supervised");
  render({ runtimeMode: "supervised", onRuntimeModeChange: change });
  expect(container.querySelector('[aria-label="Supervised"]')).not.toBeNull();
});

it("keeps permissions beside the tools and one context meter beneath the goal composer", () => {
  container.style.width = "260px";
  render({
    runtimeMode: "auto-accept-edits",
    onRuntimeModeChange: vi.fn(),
    goalRouting,
    controls: createElement(ContextMeter, {
      usage: { used: 150_000, window: 200_000 },
      rotationScheduled: true,
      onCompact: vi.fn(),
    }),
  });
  const attach = container.querySelector('[aria-label="Attach files"]')!;
  const emoji = container.querySelector('[aria-label="Add emoji"]')!;
  const picker = container.querySelector('[data-access-picker-trigger]')!;
  const send = container.querySelector('[aria-label="Send"]')!;
  const toolbar = container.querySelector<HTMLElement>("[data-mono-composer-toolbar]")!;
  expect(toolbar.className).toContain("min-w-0");
  expect([...toolbar.querySelectorAll("button")].slice(0, 3)).toEqual([attach, emoji, picker]);
  expect(send.closest("[data-mono-composer-toolbar]")).toBeNull();
  expect(field().parentElement!.contains(send)).toBe(true);
  expect(field().compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const route = container.querySelector("[data-mono-goal-route]")!;
  expect(route.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const controls = toolbar.querySelector("[data-mono-composer-controls]")!;
  expect(controls.querySelectorAll('[title="Context usage"]')).toHaveLength(1);
  expect(container.querySelectorAll('[title="Context usage"]')).toHaveLength(1);
  const pickerCell = picker.parentElement!.parentElement!;
  expect(pickerCell.className).toContain("min-w-0");
  expect(pickerCell.className).toContain("[&_button]:max-w-full");
});

it.each([{}, { runtimeMode: "supervised" as const }, { onRuntimeModeChange: vi.fn() }])(
  "keeps the compact inline composer when a permissions picker is unavailable: %j",
  (extra) => {
    render(extra);
    expect(container.querySelector<HTMLElement>("[data-layout]")!.dataset.layout).toBe("inline");
    expect(container.querySelector('[data-access-picker-trigger]')).toBeNull();
    expect(field().className).toContain("col-start-2");
  },
);

it("returns keyboard focus to the input after changing or dismissing permissions without losing the draft", async () => {
  const change = vi.fn();
  const onSubmit = vi.fn(() => true);
  const draft = vi.fn();
  const settings = { runtimeMode: "full-access" as const, onRuntimeModeChange: change, onSubmit, onDraftChange: draft };
  render(settings);
  type("Keep my message");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!.click());
  const input = field();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-access-picker-trigger]')!.click());
  const menu = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Access"]')!;
  expect(document.activeElement).toBe(menu);
  for (let step = 0; step < 3; step++) {
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
  }
  await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(change).toHaveBeenCalledExactlyOnceWith("supervised");
  expect(document.activeElement).toBe(input);
  expect(field()).toBe(input);
  expect(input.value).toBe("Keep my message");
  expect(container.querySelector('[title="/tmp/note.txt"]')).not.toBeNull();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(draft).toHaveBeenCalledExactlyOnceWith("Keep my message");
  render({ ...settings, runtimeMode: "supervised" });
  await act(async () => container.querySelector<HTMLButtonElement>('[data-access-picker-trigger]')!.click());
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="listbox"][aria-label="Access"]')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Keep my message");
  expect(change).toHaveBeenCalledTimes(1);
  act(submit);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Keep my message", [file]);
});

it("consumes quotes once and adds them to the current draft", () => {
  const consumed = vi.fn();
  render();
  type("My question");
  const quoteRequest = { id: 1, text: "Selected answer" };
  render({ quoteRequest, onQuoteRequestConsumed: consumed });
  expect(field().value).toBe("My question\n\n> Selected answer\n\n");
  render({ quoteRequest, onQuoteRequestConsumed: consumed, enabled: false });
  expect(field().value.match(/Selected answer/g)).toHaveLength(1);
  expect(consumed).toHaveBeenCalledWith(1);
});

it("sends consecutive messages without duplicating rapid Enter presses", () => {
  const onSubmit = vi.fn(() => true);
  render({ onSubmit });
  type("First");
  act(() => {
    submit();
    submit();
  });
  type("Second");
  act(submit);
  expect(onSubmit.mock.calls).toEqual([
    ["First", []],
    ["Second", []],
  ]);
  expect(field().value).toBe("");
});

it("retains text and attachments if the message is rejected", async () => {
  const onSubmit = vi.fn(() => false);
  render({ onSubmit });
  type("Keep these");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!
      .click(),
  );
  act(submit);
  expect(onSubmit).toHaveBeenCalledWith("Keep these", [file]);
  expect(field().value).toBe("Keep these");
  expect(container.querySelector('[title="/tmp/note.txt"]')).not.toBeNull();
});

it("waits for attachment reads so they cannot leak into the next message", async () => {
  let accept!: (files: (typeof file)[]) => void;
  pick.mockReturnValue(
    new Promise((resolve) => {
      accept = resolve;
    }),
  );
  const onSubmit = vi.fn(() => true);
  render({ onSubmit });
  type("With this file");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!
      .click(),
  );
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.disabled,
  ).toBe(true);
  act(submit);
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => accept([file]));
  act(submit);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("With this file", [file]);
  expect(container.querySelector('[title="/tmp/note.txt"]')).toBeNull();
});

it("waits for delivery and keeps a rejected message available to retry", async () => {
  let acknowledge!: (accepted: boolean) => void;
  const onSubmit = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      }),
  );
  render({ onSubmit });
  type("Keep this draft");
  act(() => {
    submit();
    submit();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(field().value).toBe("Keep this draft");
  expect(field().disabled).toBe(true);
  await act(async () => {
    acknowledge(false);
  });
  expect(field().value).toBe("Keep this draft");
  expect(field().disabled).toBe(false);
  act(() => submit());
  await act(async () => {
    acknowledge(true);
  });
  expect(field().value).toBe("");
  expect(onSubmit).toHaveBeenCalledTimes(2);
});

it("follows the composer autocorrect setting", () => {
  render();
  expect(field().getAttribute("spellcheck")).toBe("true");
  expect(field().getAttribute("autocorrect")).toBe("on");

  act(() => saveComposerAutocorrect(false));
  expect(field().getAttribute("spellcheck")).toBe("false");
  expect(field().getAttribute("autocorrect")).toBe("off");

  act(() => saveComposerAutocorrect(true));
  expect(field().getAttribute("spellcheck")).toBe("true");
});

it("inserts a picked emoji where the cursor was, beside attach", async () => {
  render({ controls: createElement("span", null, "Model") });
  const field = container.querySelector("textarea")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(field, "hi there");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  field.setSelectionRange(2, 2);
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Add emoji"]',
  )!;
  expect(button.previousElementSibling?.getAttribute("aria-label")).toBe(
    "Attach files",
  );
  // The picker loads on first open.
  await act(async () => button.click());
  await vi.waitFor(() =>
    expect(container.querySelector("[data-pick]")).not.toBeNull(),
  );
  expect(button.getAttribute("aria-expanded")).toBe("true");
  act(() => container.querySelector<HTMLButtonElement>("[data-pick]")!.click());
  expect(field.value).toBe("hi😀 there");
  expect(container.querySelector("[data-pick]")).toBeNull();

  // The floating chat keeps its inline input, without the extra row.
  render();
  expect(container.querySelector('button[aria-label="Add emoji"]')).toBeNull();
});
