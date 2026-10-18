// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";
import { openTranscriptWork } from "./transcriptTestActions";
import { PACED_REVEAL_KEY, WORD_FADE_MS } from "./wordFade";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // Explicitly exercise pacing unless a test selects the fallback.
  localStorage.setItem(PACED_REVEAL_KEY, "1");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  localStorage.removeItem(PACED_REVEAL_KEY);
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function tool(id: string): Block {
  return {
    id,
    role: "tool",
    text: `Run ${id}`,
    tool: { kind: "shell", status: "in_progress" },
  };
}

function render(
  blocks: Block[],
  busy = true,
  visible = true,
  historicalBlockIds?: ReadonlySet<string>,
) {
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        visible,
        historicalBlockIds,
      }),
    ),
  );
}

it("keeps burst tools folded then readable in order without losing row identity", () => {
  const head: Block[] = [
    { id: "user", role: "user", text: "Review the diff" },
    { id: "intro", role: "assistant", text: "Checking the repo first." },
    tool("first"),
  ];
  render(head);
  render([...head, tool("second"), tool("third"), tool("fourth")]);

  expect(container.querySelectorAll('[data-compact-tool-call]')).toHaveLength(0);
  openTranscriptWork(container);
  const first = container.querySelector('[data-compact-tool-call="first"]');
  const ids = () => [...container.querySelectorAll<HTMLElement>('[data-compact-tool-call]')].map(row => row.dataset.compactToolCall);
  expect(ids()).toEqual(["first", "second", "third", "fourth"]);
  render([...head, tool("second"), tool("third"), tool("fourth")]);
  expect(container.querySelector('[data-compact-tool-call="first"]')).toBe(first);
  act(() => vi.advanceTimersByTime(480));
  expect(ids()).toEqual(["first", "second", "third", "fourth"]);
  act(() => vi.advanceTimersByTime(480));
  expect(ids()).toEqual(["first", "second", "third", "fourth"]);

});

it("does not replay or play in tool calls when their tab comes back", () => {
  const head: Block[] = [
    { id: "user", role: "user", text: "Review the diff" },
    { id: "intro", role: "assistant", text: "Checking the repo first." },
    tool("first"),
  ];
  const burst = [...head, tool("second"), tool("third")];
  render(head);
  render(burst);
  expect(stages()).toEqual(["settled", "entering", "waiting"]);

  // Leaving cuts the entrances short; they must not start over on return.
  render(burst, true, false);
  expect(stages()).toEqual(["settled", "settled", "settled"]);

  // Steps that ran while the tab was hidden land just after it returns.
  render(burst);
  render([...burst, tool("fourth"), tool("fifth")]);
  expect(stages()).toEqual([
    "settled",
    "settled",
    "settled",
    "settled",
    "settled",
  ]);

  // Once caught up, a step you watch arrive still enters.
  act(() => vi.advanceTimersByTime(1_000));
  render([...burst, tool("fourth"), tool("fifth"), tool("sixth")]);
  expect(stages().at(-1)).toBe("entering");
});

const reply =
  "The investigation is complete. The updated implementation keeps replies smooth while preserving your place in the transcript.";
const prompt: Block = { id: "prompt", role: "user", text: "Investigate" };

function answerText() {
  return container.querySelector(".agent-markdown")?.textContent ?? "";
}

it("paces a reply whose text and completion arrive in the same render", () => {
  render([prompt]);
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  expect(answerText()).toBe("");

  act(() => vi.advanceTimersByTime(100));
  expect(answerText().length).toBeGreaterThan(0);
  expect(answerText().length).toBeLessThan(reply.length);
  // A later transcript update must not flush the remainder.
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  act(() => vi.advanceTimersByTime(2_000));
  act(() => vi.advanceTimersByTime(WORD_FADE_MS));
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).toBeNull();
});

it("keeps the first nonempty streaming chunk folded and readable on expansion", () => {
  render([prompt, { id: "answer", role: "assistant", text: "", streaming: true }]);
  render([prompt, { id: "answer", role: "assistant", text: reply, streaming: true }]);
  expect(answerText()).toBe("");
  openTranscriptWork(container);
  expect(answerText()).toBe(reply);
  expect(container.querySelector('[data-transcript-work-details] .agent-markdown')).not.toBeNull();
  act(() => vi.advanceTimersByTime(100));
  expect(answerText()).toBe(reply);
});

it("shows an existing settled reply immediately when opening a conversation", () => {
  render([prompt, { id: "answer", role: "assistant", text: reply, streaming: false }], false);
  expect(answerText()).toBe(reply);
  expect(container.querySelector('[data-chat-message="answer"]')?.closest('[data-transcript-work-details]')).toBeNull();
});

it("shows a loaded history page immediately while still pacing a new reply", () => {
  render([prompt]);
  const older: Block[] = [
    { id: "older-prompt", role: "user", text: "Earlier question" },
    { id: "older-answer", role: "assistant", text: "Earlier answer in full." },
  ];
  render(
    [
      ...older,
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
    true,
    new Set(older.map((block) => block.id)),
  );
  const historicalAnswer = container.querySelector(
    '[data-chat-message="older-answer"]',
  )!;
  const liveAnswer = container.querySelector('[data-chat-message="answer"]')!;
  expect(historicalAnswer.textContent).toBe("Earlier answer in full.");
  expect(historicalAnswer.querySelector(".word-fading")).toBeNull();
  expect(historicalAnswer.querySelector("[data-word-fade]")).toBeNull();
  expect(liveAnswer.textContent).toBe("");
  expect(liveAnswer.querySelector(".word-fading")).not.toBeNull();
});

it("shows a page reached through history search without replaying its reply", () => {
  render([prompt]);
  const older: Block[] = [
    { id: "older-prompt", role: "user", text: "Earlier question" },
    { id: "older-answer", role: "assistant", text: reply },
  ];
  render(older, false, true, new Set(older.map((block) => block.id)));
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).toBeNull();
});

it("shows output received in a hidden tab immediately when switching to it", () => {
  render([prompt], true, false);
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
    false,
  );
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).toBeNull();
});

it("shows a new reply at once and fades it in without the paced reveal", () => {
  localStorage.setItem(PACED_REVEAL_KEY, "0");
  render([prompt]);
  render(
    [
      prompt,
      { id: "answer", role: "assistant", text: reply, streaming: false },
    ],
    false,
  );
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).not.toBeNull();

  act(() => vi.advanceTimersByTime(400));
  expect(answerText()).toBe(reply);
  expect(container.querySelector(".word-fading")).toBeNull();
});
