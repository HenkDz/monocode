// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoComposer } from "./MonoComposer";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { saveComposerAutocorrect } from "../../settings/model/displayPrefs";

const { pick } = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock("../../sessions/model/attachments", async (original) => ({
  ...(await original<typeof import("../../sessions/model/attachments")>()),
  pickAttachments: pick,
}));
vi.mock("../../sessions/hooks/useFileDrop", () => ({
  useFileDrop: () => false,
}));

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

it("places permissions between attach and Send below the input with a flexible center column", () => {
  container.style.width = "260px";
  render({ runtimeMode: "auto-accept-edits", onRuntimeModeChange: vi.fn() });
  const layout = container.querySelector<HTMLElement>("[data-layout]")!;
  const attach = container.querySelector('[aria-label="Attach files"]')!;
  const picker = container.querySelector('[data-access-picker-trigger]')!;
  const send = container.querySelector('[aria-label="Send"]')!;
  const toolbar = container.querySelector<HTMLElement>("[data-mono-composer-toolbar]")!;
  expect(layout.dataset.layout).toBe("multiline");
  expect(picker.closest("[data-layout]")).toBe(layout);
  expect(layout.className).toContain("minmax(0,1fr)");
  expect(field().className).toContain("row-start-1");
  expect(field().className).toContain("col-span-3");
  expect(toolbar.className).toContain("row-start-2");
  expect(toolbar.className).toContain("col-span-3");
  expect(toolbar.className).toContain("min-w-0");
  expect([...toolbar.querySelectorAll("button")]).toEqual([attach, picker, send]);
  expect(field().compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const pickerCell = picker.parentElement!.parentElement!;
  expect(pickerCell.className).toContain("min-w-0");
  expect(pickerCell.className).toContain("flex-1");
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
