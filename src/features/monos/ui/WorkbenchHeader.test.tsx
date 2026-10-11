// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkbenchHeader, workbenchTurn } from "./WorkbenchHeader";
import { newSession, type Session } from "../../sessions/model/session";
import type { AgentLiveState } from "../../agents/model/agentLiveState";

let host: HTMLDivElement, root: Root;
const clock = 100_000;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function session(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", "C:/synthetic/work"),
    blocks: [
      {
        id: "turn",
        role: "user",
        text: "Review",
        startedAt: 1000,
        durationMs: 97_000,
        turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
        turnMetrics: {
          inputTokens: 326_569,
          cacheReadTokens: 289_408,
          outputTokens: 2318,
          endedAt: 98_000,
        },
      },
    ],
    ...patch,
  };
}

function render(
  value = session(),
  state: AgentLiveState = { status: "failed", detail: "Review couldn’t start" },
  canSteer = false,
) {
  const actions = {
    onMessage: vi.fn(),
    onSteer: vi.fn(),
    onOpenWorktree: vi.fn(),
    onDetails: vi.fn(),
  };
  act(() =>
    root.render(
      <WorkbenchHeader
        session={value}
        name="Reviewer"
        role="Quality & safety"
        state={state}
        canSteer={canSteer}
        {...actions}
      />,
    ),
  );
  return actions;
}

it("shows failed launch and only the last recorded turn's compact counters", () => {
  const value = session();
  value.blocks.unshift({
    ...value.blocks[0],
    id: "earlier",
    startedAt: 1,
    turnMetrics: { inputTokens: 9_000_000, outputTokens: 9000 },
  });
  render(value);
  expect(host.querySelector('[data-agent-state="failed"]')).not.toBeNull();
  expect(host.textContent).toContain("Failed · Review couldn’t start");
  const line = host.querySelector<HTMLElement>("[data-workbench-metrics]")!;
  expect(line.textContent).toBe(
    "Last conversation turn · 1m 37s · 326.6k in · 2.3k out",
  );
  expect(line.textContent).not.toContain("cached");
  expect(line.title).toContain(
    "Total input (including cache) 326,569 · Cached 289,408 · Output 2,318",
  );
  expect(line.title).not.toContain("9,000,000");
});

it("shows a dependency reason once and does not run a clock for a waiting member", () => {
  render(session(), {
    status: "waiting-on-member",
    reason: "dependency",
    detail: "Reviewer failed",
  });
  expect(host.querySelector(".cc7u-header-state")!.textContent).toBe(
    "Waiting · Reviewer failed",
  );
  const before = host.querySelector("[data-workbench-metrics]")!.textContent;
  act(() => vi.advanceTimersByTime(10_000));
  expect(host.querySelector("[data-workbench-metrics]")!.textContent).toBe(
    before,
  );
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["failed", "blocked"] as const)(
  "keeps %s storage internals out of the header",
  (status) => {
    render(session(), {
      status,
      reason: "storage",
      detail: "permission denied: C:/synthetic/account/sqlite\nStack trace",
    });
    expect(host.textContent).toContain(
      status === "failed"
        ? "conversation couldn’t start"
        : "storage recovery needed",
    );
    expect(host.textContent).not.toContain("permission denied");
    expect(host.textContent).not.toContain("sqlite");
  },
);

it("ticks a running conversation and stops when the turn is saved", () => {
  const value = session({ busy: true });
  value.blocks[0] = {
    ...value.blocks[0],
    startedAt: clock - 1000,
    durationMs: undefined,
    turnMetrics: { inputTokens: 100, outputTokens: 0 },
  };
  render(value, { status: "running-tool", detail: "Checking files" }, true);
  expect(host.textContent).toContain(
    "Current conversation turn · 1s · 100 in · 0 out",
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(host.textContent).toContain("Current conversation turn · 3s");
  render({
    ...value,
    busy: false,
    blocks: [{ ...value.blocks[0], durationMs: 3000 }],
  });
  expect(host.textContent).toContain("Last conversation turn · 3s");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps zero and unknown measurements honest", () => {
  render(session({ blocks: [] }), { status: "idle" });
  expect(host.querySelector("[data-workbench-metrics]")!.textContent).toBe(
    "No conversation turn recorded",
  );
  render(
    session({
      blocks: [
        {
          id: "unknown",
          role: "user",
          text: "Review",
          turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
          turnMetrics: { inputTokens: 0 },
        },
      ],
    }),
  );
  expect(host.querySelector("[data-workbench-metrics]")!.textContent).toBe(
    "Last conversation turn · Elapsed unavailable · 0 in · Output unavailable",
  );
  act(() => vi.advanceTimersByTime(20_000));
  expect(host.textContent).toContain("Elapsed unavailable");
});

it("does not attribute queued message metrics or assignment time to the conversation", () => {
  const value = session();
  value.blocks.push({
    ...value.blocks[0],
    id: "queued",
    startedAt: clock,
    turnMetrics: { inputTokens: 999_999, outputTokens: 10 },
  });
  value.queuedMessages = [
    { id: "queued-message", blockId: "queued", text: "Later", attachments: [] },
  ];
  render(value, {
    status: "running-tool",
    detail: "Worker assignment running",
  });
  expect(host.querySelector("[data-workbench-metrics]")!.textContent).toBe(
    "Last conversation turn · 1m 37s · 326.6k in · 2.3k out",
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("uses a later recorded turn when its timing is unavailable", () => {
  const value = session();
  value.blocks.push({
    id: "later",
    role: "user",
    text: "Another review",
    turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
    turnMetrics: { inputTokens: 500, outputTokens: 0 },
  });
  render(value);
  expect(host.querySelector("[data-workbench-metrics]")!.textContent).toBe(
    "Last conversation turn · Elapsed unavailable · 500 in · 0 out",
  );
  expect(workbenchTurn(value)?.id).toBe("later");
  expect(value.blocks.map((block) => block.id)).toEqual(["turn", "later"]);
});

it("reuses the supplied action handlers and disables unavailable steering/worktree actions", () => {
  const actions = render();
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  act(() => buttons.forEach((button) => button.click()));
  expect(actions.onMessage).toHaveBeenCalledOnce();
  expect(actions.onSteer).not.toHaveBeenCalled();
  expect(actions.onOpenWorktree).toHaveBeenCalledOnce();
  expect(actions.onDetails).toHaveBeenCalledOnce();
  act(() =>
    root.render(
      <WorkbenchHeader
        session={session()}
        name="Reviewer"
        role="Quality & safety"
        state={{ status: "thinking" }}
        canSteer
        onMessage={actions.onMessage}
        onSteer={actions.onSteer}
        onDetails={actions.onDetails}
      />,
    ),
  );
  const next = [...host.querySelectorAll<HTMLButtonElement>("button")];
  act(() => next[1].click());
  expect(actions.onSteer).toHaveBeenCalledOnce();
  expect(next[2].disabled).toBe(true);
});
