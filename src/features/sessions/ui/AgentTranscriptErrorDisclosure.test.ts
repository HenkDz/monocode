// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript, MonoActivityTrail } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

describe("tool error disclosure", () => {
  it("opens grouped error output in a dialog from the failed row", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Start the app" },
      {
        id: "command",
        role: "tool",
        text: "Run npm run dev",
        tool: {
          kind: "shell",
          status: "failed",
          detail: "Error: listen EPERM\n    at Server.setupListenHandle",
        },
      },
    ];

    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBeNull();
    expect(container.textContent).not.toContain("Server.setupListenHandle");

    const failedRow = container.querySelector<HTMLElement>(
      '[aria-label^="Failed tool call:"]',
    );
    const message = Array.from(failedRow?.querySelectorAll("span") ?? []).find(
      (element) => element.textContent?.includes("npm run dev"),
    );
    expect(message).not.toBeNull();

    act(() => trigger?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Server.setupListenHandle");
    expect(container.textContent).not.toContain("Server.setupListenHandle");

    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("Server.setupListenHandle");
  });
});

describe("MonoCode CLI disclosure", () => {
  it("shows a compact card with output available in a dialog for a successful call", () => {
    const command =
      "/repo/target/debug/MonoCode.app/Contents/MacOS/monocode app notes.list";
    const blocks: Block[] = [
      { id: "user", role: "user", text: "/monocode list notes" },
      {
        id: "notes",
        role: "tool",
        text: command,
        tool: {
          kind: "shell",
          status: "completed",
          detail: '{"ok":true,"result":{"notes":[{"title":"Ideas"}]}}',
        },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );

    const row = container.querySelector<HTMLElement>(
      '[data-monocode-tool-call="notes.list"]',
    );
    expect(row?.querySelector("button")?.textContent).toBe("View full output");
    expect(row?.querySelector("pre")).toBeNull();
    expect(row?.textContent).toContain("List notes");
    expect(row?.querySelector('img[src="/monocode.png"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Contents/MacOS/monocode");
    expect(container.textContent).not.toContain('"title":"Ideas"');
    act(() => row?.querySelector<HTMLButtonElement>("button")?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('"title":"Ideas"');
    expect(row?.querySelector("pre")).toBeNull();
  });

  it("reveals a failed call's error when clicked", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "/monocode list notes" },
      {
        id: "notes",
        role: "tool",
        text: "monocode app notes.list",
        tool: { kind: "shell", status: "failed", detail: "Connection refused" },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBeNull();
    expect(container.textContent).not.toContain("Connection refused");

    act(() => trigger?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Connection refused");
    expect(container.textContent).not.toContain("Connection refused");
  });
});

describe("tool approval command details", () => {
  it.each(["node worker.mjs", "monocode app sessions.send"])("exposes the exact pending %s command without substituting output and preserves approval", (action) => {
    const command = `${action} --json '${JSON.stringify({ prompt: "Scope ".repeat(35) })}'`;
    const onApproval = vi.fn();
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Run the worker" },
      { id: "pending", role: "tool", text: "Run", tool: { kind: "shell", title: "Run worker", status: "pending", detail: "Previous output", preview: { kind: "shell", title: command, output: "Previous output" } }, approval: { requestId: 42 } },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks, busy: true, onApproval })));
    expect(container.textContent).not.toContain(command);
    const trigger = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "View command")!;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(command);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Previous output");
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
    const allow = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.trim() === "Allow")!;
    expect(allow).toBeDefined();
    act(() => allow.click());
    expect(onApproval).toHaveBeenCalledWith(42, "allow");
  });
});

describe("bare tool result rendering", () => {
  it.each(["transcript", "activity"])("keeps bare JSON output out of the %s surface", (surface) => {
    const text = JSON.stringify({ ok: true, result: { turns: [{ user: { text: "Useful question\n<team_sender>{\"id\":\"private\"}</team_sender>" } }] } });
    const blocks: Block[] = [{ id: "user", role: "user", text: "Inspect conversation" }, { id: "bare-result", role: "tool", text }];
    act(() => root.render(surface === "activity"
      ? createElement(MonoActivityTrail, { blocks, live: true, readOutput: true })
      : createElement(AgentTranscript, { blocks, busy: true })));
    expect(container.textContent).not.toContain('"ok":true');
    expect(container.textContent).not.toContain("Useful question");
    expect(container.textContent).not.toContain("team_sender");
    const trigger = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "View full output")!;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toContain("Useful question");
    expect(document.querySelector('[role="dialog"] pre')?.textContent).not.toContain("team_sender");
  });
});
