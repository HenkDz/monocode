// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import type { Block } from "../model/session";
import { appendUser, applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { newSession } from "../model/session";
import { mapApprovalRequest } from "../../../integrations/harness/providers/codex/codexProtocol";

vi.mock("../../settings/model/sounds", () => ({ playCue: vi.fn() }));
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
const user: Block = { id: "user", role: "user", text: "Fix the chooser", startedAt: 1000, durationMs: 111000 };
const thought: Block = { id: "reason", role: "reasoning", text: "**Reviewing dialog lifecycle**\n\nCheck callbacks once." };
const note: Block = { id: "note", role: "assistant", text: "I found the callback." };
const command: Block = { id: "tool", role: "tool", text: "cargo check", tool: { kind: "shell", status: "completed", detail: "Finished successfully" } };
const answer: Block = { id: "answer", role: "assistant", text: "**Fixed.**\n\n- Dialogs close correctly." };

it.each([false, true])("retains the automatic recovery receipt inside Worked and the accepted handoff divider outside (busy: %s)", busy => {
  const receipt: Block = { id: "usage-failover-request", role: "system", text: "Automatic usage recovery: continuing with Work on claude." };
  const handoff: Block = { id: "handoff", role: "handoff", text: "Preserve original constraints", handoff: { from: "claude", to: "claude", status: "ready", pending: true } };
  render([user, thought, receipt, handoff, answer], { busy });
  expect(container.textContent).not.toContain(receipt.text);
  act(() => toggle().click());
  const receiptNode = [...container.querySelectorAll('*')].filter(node => node.textContent === receipt.text).pop()!;
  expect(receiptNode.closest('[data-transcript-work-details]')).not.toBeNull();
  expect(container.querySelector('[role="separator"][aria-label^="Continued with Claude"]')).not.toBeNull();
});
function render(blocks: Block[], props = {}) {
  act(() => root.render(createElement(AgentTranscript, { blocks, ...props })));
}
function toggle() { return container.querySelector<HTMLButtonElement>('[data-transcript-turn-work] > button')!; }

it("retains reducer background waits and task names, with approval and question precedence", () => {
  const session = applyHarnessEvent({ ...newSession("claude", "/synthetic"), busy: true, blocks: [{ ...user, durationMs: undefined }, { ...note, streaming: true }] }, { type: "background.updated", tasks: ["Review", "Build"] });
  const props = { busy: session.busy, backgroundTasks: session.backgroundTasks };
  render(session.blocks, props);
  expect(toggle().querySelector('.compact-current-action')?.textContent).toBe("Waiting for background tasks…");
  expect(toggle().querySelector('.compact-current-action')?.getAttribute('title')).toBe("Review, Build");
  render(session.blocks, { ...props, pendingQuestion: true });
  expect(toggle().textContent).toContain("Waiting for answers");
  render([...session.blocks, { ...command, approval: { requestId: 7, command: " exact command " } }], props);
  expect(toggle().textContent).toContain("Waiting for approval…");
  expect(container.querySelector('[aria-label="Command awaiting approval"]')?.textContent).toBe(" exact command ");
  render(session.blocks, { busy: true, backgroundTasks: [] });
  expect(toggle().textContent).not.toContain("background");
});

it.each([{}, { inlineWork: true }, { inlineWork: true, flatWork: true }, { managed: true }])("folds work by default with final markdown outside on every presentation path %j", props => {
  render([user, thought, note, command, answer], props);
  expect(toggle().textContent).toContain("Worked for 1m 51s");
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain(note.text);
  expect(container.textContent).not.toContain("Reviewing dialog lifecycle");
  expect(container.querySelector('[data-chat-message="answer"]')?.textContent).toContain("Fixed.");
  act(() => toggle().click());
  expect(container.textContent).toContain(note.text);
  expect(container.textContent).toContain("Reviewing dialog lifecycle");
  expect(container.querySelector('[data-chat-message="answer"]')?.closest('[data-transcript-work-details]')).toBeNull();
});

it("keeps live work folded through completion, with a single current action and no raw reasoning", () => {
  const raw: Block = { id: "raw", role: "reasoning", text: "Private diagnostic", reasoning: { itemId: "r", partIndex: 0, channel: "raw" } };
  render([{ ...user, durationMs: undefined }, note, command, raw], { busy: true });
  expect(toggle().textContent).toContain("Working for");
  expect(toggle().textContent).toContain("cargo check");
  expect(container.textContent).not.toContain("Private diagnostic");
  expect(container.textContent).not.toContain(note.text);
  act(() => toggle().click());
  render([user, note, command, raw, answer]);
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Raw reasoning");
  expect(container.textContent).not.toContain("Private diagnostic");
});

it("keeps exact approval bytes and decision callbacks outside the fold even for a hidden generic tool", () => {
  const onApproval = vi.fn();
  const raw = "  echo safe\n\tremove-item example # <monocode_context>keep</monocode_context>  ";
  render([user, { id: "approval", role: "tool", text: "", tool: { kind: "other", title: "Tool call", status: "pending", preview: { kind: "shell", title: raw } }, approval: { requestId: 7 } }], { busy: true, onApproval });
  const shown = container.querySelector('[aria-label="Command awaiting approval"]')!;
  expect(shown.textContent).toBe(raw);
  expect(shown.closest('[data-transcript-work-details]')).toBeNull();
  act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Allow")!.click());
  expect(onApproval).toHaveBeenCalledWith(7, "allow");
});

it("counts nonfatal failures quietly and reveals the failed command and diagnostics inside expanded work", () => {
  const failed: Block = { ...command, tool: { ...command.tool, status: "failed", detail: "exit code 101: missing import" } };
  render([user, failed, answer]);
  expect(toggle().textContent).toContain("1 failed command");
  expect(container.textContent).not.toContain("exit code 101");
  act(() => toggle().click());
  expect(container.querySelector('[data-compact-tool-call="tool"]')?.textContent).toContain("cargo check");
  expect(container.textContent).toContain("missing import");
});

it("replaces an interrupted result with the terminal error outside the fold", () => {
  render([user, thought, note, { id: "failure", role: "system", notice: "error", text: "Provider disconnected" }]);
  expect(container.querySelector('[data-transcript-error]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.closest('[data-transcript-work-details]')).toBeNull();
  expect(container.textContent).not.toContain(note.text);
});

it("opens a group when a watched live command fails", () => {
  render([user, { ...command, tool: { ...command.tool, status: "running" } }], { busy: true });
  act(() => toggle().click());
  expect(container.querySelector('[data-compact-tool-group] > button')?.getAttribute('aria-expanded')).toBe('false');
  render([user, { ...command, tool: { ...command.tool, status: "failed", detail: "exit 101: missing import" } }], { busy: true });
  expect(container.querySelector('[data-compact-tool-group] > button')?.getAttribute('aria-expanded')).toBe('true');
  expect(container.textContent).toContain("exit 101: missing import");
});

it("reveals a search result through the turn fold and nested command group", () => {
  let navigate: ((id: string, query: string) => boolean) | undefined;
  render([user, command, answer], { onNavigateReady: (callback: typeof navigate) => { navigate = callback; } });
  act(() => { expect(navigate?.('tool', 'cargo')).toBe(true); });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('[data-compact-tool-call="tool"]')?.textContent).toContain('cargo check');
});

it("renders the provider approval command without the label normalizer changing it", () => {
  const raw = "  cargo check\n\tWrite-Output '$UNTRUSTED'  ";
  const mapped = mapApprovalRequest("item/commandExecution/requestApproval", { itemId: "provider-tool", command: raw }, 17)!;
  let session = appendUser(newSession("codex", "/synthetic"), "Check the build");
  session = applyHarnessEvent(session, mapped.event);
  render(session.blocks, { busy: true, onApproval: vi.fn() });
  expect(container.querySelector('[aria-label="Command awaiting approval"]')?.textContent).toBe(raw);
});
