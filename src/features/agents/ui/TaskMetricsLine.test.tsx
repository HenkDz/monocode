// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TaskMetricsLine } from "./TaskMetricsLine";

it("shows completed elapsed time and separate provider counters without assuming cached input semantics", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<TaskMetricsLine
      metrics={{ turns: 1, elapsedMs: 65_000, startedAt: 1000, endedAt: 66_000,
        inputTokens: 100, cacheReadTokens: 90, outputTokens: 10, modelCalls: 2,
        compactions: 1, partial: false }}
      state={{ status: "done" }}
    />));
    expect(host.textContent).toBe("1m 5s · 100 in / 90 cached / 10 out tokens · Done");
    expect(host.querySelector("p")?.title).toContain("Cached 90");
    expect(host.querySelector("p")?.title).toContain("Model calls 2");
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
