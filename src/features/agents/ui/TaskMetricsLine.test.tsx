// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TaskMetricsLine, taskMetricsDetail } from "./TaskMetricsLine";
import { AgentDetailTooltip } from "./AgentDetailTooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { selectTaskMetrics } from "../model/agentMetrics";
import type { OrchestrationDispatch, OrchestrationTask } from "../../orchestration/model/orchestrationState";

it.each(["running", "completed"] as const)("leaves an unretained %s turn clock unavailable rather than claiming no conversation", status => {
  const task = { id: "task", sessionId: "worker", status } as OrchestrationTask;
  const dispatch = { id: "dispatch", taskId: task.id, sessionId: task.sessionId, state: status,
    stage: status === "completed" ? "settled" : "turn_submitted", startedAt: 1000, updatedAt: 11000,
    ...(status === "completed" ? { finishedAt: 10000, durationMs: 9000, result: "Retained report" } : {}) } as OrchestrationDispatch;
  const metrics = selectTaskMetrics(task, [dispatch], [], 12000);
  expect(metrics).toMatchObject({ turns: 0, partial: true });
  const html = renderToStaticMarkup(<TaskMetricsLine metrics={metrics} state={{ status: status === "completed" ? "done" : "running-tool" }} />);
  expect(html).toContain("Elapsed unavailable");
  expect(html).not.toContain("Conversation not started");
});

it("refuses a dispatch clock without a canonical recorded turn while retaining zero counters", () => {
  const html = renderToStaticMarkup(<TaskMetricsLine
    metrics={{ turns: 1, elapsedMs: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, partial: true }}
    startedAt={0}
    endedAt={3000}
    state={{ status: "failed" }}
  />);
  expect(html).toContain("Elapsed unavailable");
  expect(html).toContain('title="0 in / 0 cached / 0 out tokens"');
  expect(html).toContain(">Usage</span>");
  expect(html).not.toContain("3s");
});

it("uses recorded completed duration rather than delayed dispatch settlement", () => {
  const html = renderToStaticMarkup(<TaskMetricsLine
    metrics={{ turns: 1, startedAt: 0, endedAt: 60_000, elapsedMs: 5000, partial: false }}
    state={{ status: "done" }}
  />);
  expect(html).toContain("5s");
  expect(html).not.toContain("1m");
});

it("keeps an explicitly selected completed retry separate from aggregate elapsed", () => {
  const html = renderToStaticMarkup(<TaskMetricsLine
    metrics={{ turns: 2, startedAt: 1000, endedAt: 30_000, elapsedMs: 15_000, partial: false }}
    startedAt={20_000}
    endedAt={30_000}
    state={{ status: "done" }}
  />);
  expect(html).toContain("10s");
  expect(html).not.toContain("15s");
});

it("starts ticking only when the canonical turn is observed, including a zero start", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const host = document.createElement("div"), root = createRoot(host);
  const metrics = { turns: 1, elapsedMs: 0, partial: true };
  try {
    await act(async () => root.render(<TaskMetricsLine metrics={metrics} startedAt={0} state={{ status: "thinking" }} />));
    expect(host.textContent).toContain("Elapsed unavailable");
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => root.render(<TaskMetricsLine metrics={{ ...metrics, startedAt: 0 }} startedAt={0} state={{ status: "thinking" }} />));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(host.textContent).toContain("2s · Usage · Thinking");
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("describes the existing row button and shows the full metrics and blocker on keyboard focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  const metrics = { turns: 1, elapsedMs: 1000, inputTokens: 100, cacheReadTokens: 80, outputTokens: 10, modelCalls: 2, compactions: 1, partial: true };
  const state = { status: "blocked", reason: "storage", detail: "Repair AGENTS.md before the queued review" } as const;
  const open = vi.fn();
  try {
    await act(async () => root.render(<>
      <AgentDetailTooltip detail={taskMetricsDetail(metrics, state)}><button onClick={open}>Open Reviewer</button></AgentDetailTooltip>
      <TaskMetricsLine metrics={metrics} state={state} />
    </>));
    const row = host.querySelector("button")!;
    const id = row.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toContain("Model calls 2 · Compactions 1");
    expect(document.getElementById(id)?.textContent).toContain("Recorded metrics only");
    expect(document.getElementById(id)?.textContent).toContain(state.detail);
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(row.querySelector("button, [tabindex]")).toBeNull();
    await act(async () => row.focus());
    expect(document.activeElement).toBe(row);
    expect(document.getElementById(id)?.getAttribute("role")).toBe("tooltip");
    expect(document.getElementById(id)?.textContent).toBe(host.querySelector("[data-task-metrics]")?.getAttribute("title"));
    await act(async () => row.click());
    expect(open).toHaveBeenCalledOnce();
    await act(async () => row.blur());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.getElementById(id)?.hidden).toBe(true);
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});

it("shows completed elapsed time and separate provider counters without assuming cached input semantics", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskMetricsLine
      metrics={{ turns: 1, elapsedMs: 65_000, startedAt: 1000, endedAt: 66_000,
        inputTokens: 100, cacheReadTokens: 90, outputTokens: 10, modelCalls: 2,
        compactions: 1, partial: false, inputTokenConvention: "total-including-cache" }}
      state={{ status: "done" }}
    />));
    expect(host.textContent).toBe("1m 5s · Usage · Done");
    expect(host.querySelector("p")?.title).toContain("Cached 90");
    expect(host.querySelector("p")?.title).toContain("Model calls 2");
    expect(host.querySelector("p")?.title).toContain("Total input (including cache) 100");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows unavailable metrics and a queued storage blocker honestly", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskMetricsLine
      state={{ status: "blocked", reason: "storage", detail: "Queued message cannot start" }}
    />));
    expect(host.textContent).toContain("Elapsed unavailable · Usage · Blocked");
    expect(host.textContent).not.toContain("Idle");
    expect(host.querySelector("p")?.title).toContain("Queued message cannot start");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps the elapsed clock advancing for a running retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(30_000);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskMetricsLine
      metrics={{ turns: 2, elapsedMs: 10_050, startedAt: 1000, partial: true }}
      startedAt={20_000}
      state={{ status: "thinking" }}
    />));
    expect(host.textContent).toContain("10s · Usage · Thinking");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(host.textContent).toContain("15s · Usage · Thinking");
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("leaves an inactive historical turn with no end unavailable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskMetricsLine
      metrics={{ turns: 1, elapsedMs: 0, startedAt: 1000, partial: true }}
      state={{ status: "done" }}
    />));
    expect(host.textContent).toBe("Elapsed unavailable · Usage · Done");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("omits a repeated visible state while preserving the metrics tooltip", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <TaskMetricsLine
          showState={false}
          state={{ status: "blocked", reason: "storage" }}
        />,
      ),
    );
    expect(host.textContent).toBe("Elapsed unavailable · Usage");
    expect(host.querySelector("p")?.title).toBe("Blocked · storage");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
