// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { CompactToolOutput } from "./CompactToolOutput";

vi.mock("../../../platform/tauri/clipboard", () => ({ copyMessage: vi.fn().mockResolvedValue(undefined) }));

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
  vi.clearAllMocks();
});

describe("compact tool output", () => {
  it("keeps generic output to three short lines and opens complete output in a dialog", () => {
    const output = ["first", "second", "third", "fourth", "fifth"].join("\n");
    act(() => root.render(createElement(CompactToolOutput, { output, title: "Run tests" })));
    expect(container.querySelector("pre")?.textContent).toBe("first\nsecond\nthird");
    expect(container.textContent).not.toContain("fourth");
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    act(() => trigger.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(output);
    expect(trigger.getAttribute("aria-expanded")).toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("bounds long single lines without losing full output", () => {
    const output = "a".repeat(1000);
    act(() => root.render(createElement(CompactToolOutput, { output, title: "Output" })));
    expect(container.querySelector("pre")?.textContent?.length).toBe(160);
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent?.length).toBe(1000);
  });

  it("keeps raw JSON out of the card and strips internal markers from details and copying", async () => {
    const output = JSON.stringify({ ok: true, result: { body: "Useful response\n<team_sender>{\"id\":\"private\"}</team_sender>" } });
    act(() => root.render(createElement(CompactToolOutput, { output, title: "Read conversation" })));
    expect(container.textContent).toContain("Structured output");
    expect(container.textContent).not.toContain("Useful response");
    expect(container.querySelector("pre")).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Useful response");
    expect(dialog.textContent).not.toContain("team_sender");
    const copy = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Copy output")!;
    await act(async () => copy.click());
    expect(copyMessage).toHaveBeenCalledWith(expect.stringContaining("Useful response"));
    expect(copyMessage).toHaveBeenCalledWith(expect.not.stringContaining("team_sender"));
  });

  it("shows approval commands only on demand", () => {
    const output = "monocode app sessions.send --json '{\"prompt\":\"Continue\"}'";
    act(() => root.render(createElement(CompactToolOutput, { output, title: "Continue a session", preview: false, command: true })));
    expect(container.textContent).toBe("View command");
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(output);
  });

  it("keeps compact output on demand with an accessible focus target", () => {
    act(() => root.render(createElement(CompactToolOutput, { output: "complete output", title: "Run tests", preview: false })));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="View full output"]')!;
    expect(trigger.textContent).toBe("View full output");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector(".tool-output-affordance")).not.toBeNull();
    act(() => trigger.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe("complete output");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
  });

  it("preserves exact command whitespace and markers in its full command view", () => {
    const output = "  echo '<team_sender>literal</team_sender>'\n\n";
    act(() => root.render(createElement(CompactToolOutput, { output, title: "Run", preview: false, command: true })));
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(output);
  });

  it("reports clipboard failures without discarding the output", async () => {
    vi.mocked(copyMessage).mockRejectedValueOnce(new Error("Clipboard unavailable"));
    act(() => root.render(createElement(CompactToolOutput, { output: "Saved output", title: "Tool result" })));
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const copy = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Copy output")!;
    await act(async () => copy.click());
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe("Couldn't copy output");
    expect(dialog.querySelector("pre")?.textContent).toBe("Saved output");
  });
});
