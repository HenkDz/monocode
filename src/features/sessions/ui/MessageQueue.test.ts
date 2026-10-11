// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { monoSessionCompletionMessage } from "../../monos/model/monoSessionCompletion";
import { MessageQueue } from "./MessageQueue";
import { newSession } from "../model/session";
import { selectAgentLiveState } from "../../agents/model/agentLiveState";

it.each(["active", "paused", "resuming"] as const)("holds %s queues visibly for storage repair with no steer or resume", (status) => {
  const message = { id: "held", text: "What have you done today?", attachments: [] };
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(createElement(MessageQueue, {
    messages: [message], status, liveState: selectAgentLiveState({ ...newSession("codex", "/fixture"), codexStorageError: "Repair hooks.json", queuedMessages: [message] }),
    onSteer: vi.fn(), onResume: vi.fn(), variant: "messages",
  }));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Blocked · storage");
  expect(container.textContent).toContain(message.text);
  expect(container.textContent).not.toMatch(/Steer|Resume|Retry|Waiting to send|Sending/);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')?.disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]')?.disabled).toBe(false);
  expect(message).toEqual({ id: "held", text: "What have you done today?", attachments: [] });
});

it("holds storage preparation using the same state as the roster", () => {
  const message = { id: "held", text: "Review", attachments: [] };
  const liveState = selectAgentLiveState({ ...newSession("codex", "/fixture"), codexStoragePreparing: true, queuedMessages: [message] });
  const markup = renderToStaticMarkup(createElement(MessageQueue, { messages: [message], liveState, onSteer: vi.fn(), onResume: vi.fn() }));
  expect(markup).toContain("Queued · waiting for storage");
  expect(markup).not.toMatch(/Steer|Resume|Retry/);
});

it("never exposes internal notifications in the user's outbox", () => {
  const message = monoSessionCompletionMessage({
    sessionId: "worker",
    requestId: "app-mono-monitor",
    project: "/code/project",
    prompt: "Review",
    session: undefined,
    outcome: { status: "completed", text: "Done" },
  });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(MessageQueue, {
      messages: [message],
      onSteer: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      variant: "messages",
    }),
  );
  expect(container.textContent).toBe("");
  expect(container.textContent).not.toContain(
    "MonoCode completion notification",
  );
  expect(container.textContent).not.toContain("Steer");
  expect(
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit queued message"]',
    )?.disabled,
  ).toBeUndefined();
  expect(
    container.querySelector('[aria-label="Remove queued message"]'),
  ).toBeNull();
});

it("keeps combined internal reports out of the user's outbox", () => {
  const message = monoSessionCompletionMessage({
    sessionId: "worker",
    requestId: "request",
    project: "/code/project",
    prompt: "Review",
    outcome: { status: "completed", text: "Done" },
  });
  message.monoSessionCompletion!.sessionCount = 3;
  const markup = renderToStaticMarkup(
    createElement(MessageQueue, { messages: [message] }),
  );
  expect(markup).toBe("");
  expect(markup).not.toContain("MonoCode completion notification");
});
