// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { applyProjectDiffStats, useProjectDiffStats } from "./useProjectDiffStats";

vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffStats: vi.fn(),
  subscribeGitChanged: () => () => {},
}));

it("publishes untracked count changes even when line and file totals stay the same", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const cwd = "/repo/untracked-stats";
  const container = document.createElement("div");
  const root = createRoot(container);
  function Stats() {
    return createElement("span", null, useProjectDiffStats(cwd, true)?.untracked);
  }
  const stats = { files: 1, additions: 0, deletions: 0, untracked: 1 };
  applyProjectDiffStats(cwd, stats);
  try {
    await act(async () => root.render(createElement(Stats)));
    expect(container.textContent).toBe("1");
    await act(async () => applyProjectDiffStats(cwd, { ...stats, untracked: 0 }));
    expect(container.textContent).toBe("0");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
