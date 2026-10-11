// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TaskMetricsLine, taskMetricsDetail } from "./TaskMetricsLine";
import { AgentDetailTooltip } from "./AgentDetailTooltip";

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
    expect(host.textContent).toBe("1m 5s · 100 in / 90 cached / 10 out tokens · Done");
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
    expect(host.textContent).toContain("Elapsed unavailable · Tokens unavailable · Blocked");
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
    expect(host.textContent).toContain("10s · Tokens unavailable · Thinking");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(host.textContent).toContain("15s · Tokens unavailable · Thinking");
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
    expect(host.textContent).toBe("Elapsed unavailable · Tokens unavailable · Done");
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
    expect(host.textContent).toBe("Elapsed unavailable · Tokens unavailable");
    expect(host.querySelector("p")?.title).toBe("Blocked · storage");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
