// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TrackedCiRepair } from "../model/ciRepairTracking";
import { useCiRepairLifecycle } from "./useCiRepairLifecycle";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  stop: vi.fn(),
  settle: vi.fn(),
  attempts: [] as TrackedCiRepair[],
  goals: [] as { id: string; state: string }[],
}));
vi.mock("../model/githubPrChecks", () => ({
  fetchGithubPrChecks: mocks.fetch,
}));
vi.mock("../model/ciRepairTracking", () => ({
  getCiRepairs: () => mocks.attempts,
  subscribeCiRepairs: () => () => {},
  settleCiRepair: mocks.settle,
  stopCiRepairs: mocks.stop,
}));
vi.mock("../../monos/model/monoManagerGoals", () => ({
  monoManagerGoals: {
    subscribe: () => () => {},
    snapshot: () => 0,
    goals: () => mocks.goals,
  },
}));

let root: Root;
let host: HTMLDivElement;
const stop = vi.fn();
function Consumer() {
  useCiRepairLifecycle(stop);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  mocks.stop.mockResolvedValue(undefined);
  mocks.attempts = [
    {
      id: "repair",
      cwd: "/web",
      repo: "acme/web",
      number: 42,
      sessionId: "chat",
      headOid: "abc",
      checks: [{ name: "tests", workflow: "CI", url: null }],
      startedAt: Date.now(),
      phase: "running",
    },
  ];
  mocks.goals = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("stops a tracked repair when the PR merges while the Inbox is closed", async () => {
  mocks.fetch
    .mockResolvedValueOnce({ state: "open" })
    .mockResolvedValue({ state: "merged" });
  await act(async () => root.render(createElement(Consumer)));
  expect(mocks.stop).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(mocks.stop).toHaveBeenCalledWith(
    "/web",
    "acme/web",
    42,
    "merged",
    expect.any(Function),
  );
  await mocks.stop.mock.calls[0][4](mocks.attempts[0]);
  expect(stop).toHaveBeenCalledWith(mocks.attempts[0], "merged");
});

it("retains work after a failed refresh and retries at the next poll", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.fetch
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ state: "closed" });
    await act(async () => root.render(createElement(Consumer)));
    expect(mocks.stop).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.stop).toHaveBeenCalledWith(
      "/web",
      "acme/web",
      42,
      "closed",
      expect.any(Function),
    );
  } finally {
    log.mockRestore();
  }
});

it("drops a late PR result when no repair is being watched anymore", async () => {
  let resolve!: (value: { state: string }) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => root.render(createElement(Consumer)));
  mocks.attempts = [];
  await act(async () => root.render(createElement(Consumer)));
  await act(async () => resolve({ state: "merged" }));
  expect(mocks.stop).not.toHaveBeenCalled();
});

it("tracks a Manager repair through goal completion instead of its initial chat turn", async () => {
  mocks.fetch.mockResolvedValue({ state: "open" });
  mocks.attempts = [
    { ...mocks.attempts[0], goalId: "goal", goalOwnerId: "manager" },
  ];
  mocks.goals = [{ id: "goal", state: "ready" }];
  await act(async () => root.render(createElement(Consumer)));
  expect(mocks.settle).toHaveBeenCalledWith("repair", "completed");
});

it("stops polling a Manager repair after its own goal is done", async () => {
  mocks.attempts = [
    { ...mocks.attempts[0], goalId: "goal", goalOwnerId: "manager" },
  ];
  mocks.goals = [{ id: "goal", state: "done" }];
  await act(async () => root.render(createElement(Consumer)));
  expect(mocks.settle).toHaveBeenCalledWith("repair", "completed");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
