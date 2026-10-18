// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import { MonoActivityPanel } from "./MonoActivityPanel";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onApproval = vi.fn();
const agent = {
  name: "Captain Awesome",
  mascot: "cat",
  color: "#6ba",
  projects: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(blocks: Block[], live = false) {
  act(() =>
    root.render(
      createElement(MonoActivityPanel, {
        agent,
        blocks,
        live,
        cwd: "/repo",
        onClose,
        onApproval,
      }),
    ),
  );
}

function openWork() {
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Show work")!.click());
  return document.querySelector('[role="dialog"]')!;
}

it("shows the complete chronological trail", () => {
  render([
    { id: "user", role: "user", text: "Update my instructions" },
    {
      id: "thinking",
      role: "reasoning",
      text: "Check the current instructions.",
    },
    { id: "intro", role: "assistant", text: "I will check what is there." },
    {
      id: "read",
      role: "tool",
      text: "monocode app soul.read",
      tool: {
        kind: "shell",
        status: "completed",
        detail: "Current soul contents",
      },
    },
    { id: "progress", role: "assistant", text: "Now I will update it." },
    {
      id: "write",
      role: "tool",
      text: "monocode app soul.update",
      tool: { kind: "shell", status: "completed", detail: "Saved soul" },
    },
    { id: "reply", role: "assistant", text: "Your instructions are updated." },
  ]);
  expect(container.querySelector("aside")?.getAttribute("aria-label")).toBe(
    "Captain Awesome activity",
  );
  expect(container.querySelector("[data-mono-activity-block]")).toBeNull();
  const reader = openWork();
  expect(
    Array.from(reader.querySelectorAll("[data-mono-activity-block]")).map(
      (el) => el.getAttribute("data-mono-activity-block"),
    ),
  ).toEqual(["thinking", "intro", "read", "progress", "write", "reply"]);
  expect(reader.textContent).toContain("Current soul contents");
  expect(reader.textContent).toContain("Saved soul");
  act(() => reader.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Hide activity"]')!
      .click(),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("updates a live trail and keeps approval controls actionable", () => {
  const blocks: Block[] = [
    { id: "user", role: "user", text: "Inspect" },
    {
      id: "call",
      role: "tool",
      text: "ls",
      tool: { kind: "shell", status: "in_progress", detail: "Partial output" },
    },
  ];
  render(blocks, true);
  const reader = openWork();
  const call = reader.querySelector('[data-mono-activity-block="call"]');
  render(
    [
      blocks[0],
      {
        ...blocks[1],
        tool: { kind: "shell", status: "completed", detail: "Complete output" },
      },
      {
        id: "approval",
        role: "tool",
        text: "monocode app soul.update",
        tool: { kind: "shell", status: "pending" },
        approval: { requestId: 42 },
      },
    ],
    true,
  );
  expect(reader.querySelector('[data-mono-activity-block="call"]')).toBe(call);
  expect(reader.querySelectorAll("[data-mono-activity-block]")).toHaveLength(2);
  expect(reader.textContent).toContain("Complete output");
  expect(container.textContent).toContain("Working");
  const allow = Array.from(reader.querySelectorAll("button")).find(
    (button) => button.textContent === "Allow",
  )!;
  act(() => allow.click());
  expect(onApproval).toHaveBeenCalledWith(42, "allow");
});

it("dismisses Show work when opening its document reader", async () => {
  const opened = vi.fn();
  window.addEventListener("monocode:open-artifact", opened);
  try {
    render([{ id: "report", role: "assistant", text: "See artifact-work-report" }]);
    const reader = openWork();
    await act(async () => reader.querySelector<HTMLButtonElement>('[data-org-artifact="artifact-work-report"]')!.click());
    expect(opened.mock.calls[0][0].detail.id).toBe("artifact-work-report");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    window.removeEventListener("monocode:open-artifact", opened);
  }
});
