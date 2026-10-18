import { beforeEach, expect, it, vi } from "vitest";
import type { GitPr } from "../../../platform/tauri/fs";
import { deleteSession } from "./sessionStore";
import * as model from "../../source-control/model/pullRequests";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock(
  "../../../integrations/harness/providers/cursor/cursorSubagents",
  () => ({ recoverCursorSubagents: vi.fn() }),
);
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
const pr: GitPr = {
  number: 23,
  title: "Fix",
  url: "https://github.com/example/repo/pull/23",
  state: "open",
  checksStatus: "success",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
};
const link = {
  sessionId: "delete-me",
  sessionTitle: "My chat",
  turnId: "turn",
  blockId: "pr",
  at: 1000,
};

it("removes PR links only after successful native session deletion and keeps forge history", async () => {
  model.recordPullRequest("/repo", pr, link);
  let resolve!: () => void;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const deletion = deleteSession(link.sessionId);
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("session_delete", {
      sessionId: link.sessionId,
      imagePaths: [],
    }),
  );
  expect(model.pullRequests()[0].links).toEqual([link]);
  resolve();
  await deletion;
  expect(model.pullRequests()[0].links).toEqual([]);
  expect(model.worktreePullRequests("/repo")).toEqual([pr]);
  expect(model.sessionPrAttention(model.pullRequests())).toEqual([]);
  model.recordPullRequest("/repo", pr, link);
  expect(model.pullRequests()[0].links).toEqual([]);
});

it("keeps session PR associations when native deletion fails", async () => {
  const failedLink = { ...link, sessionId: "delete-failed" };
  model.recordPullRequest("/repo", pr, failedLink);
  mocks.invoke.mockRejectedValueOnce(new Error("delete failed"));
  await expect(deleteSession(failedLink.sessionId)).rejects.toThrow(
    "delete failed",
  );
  expect(model.pullRequests()[0].links).toEqual([failedLink]);
  model.recordPullRequest("/repo", pr, { ...link, sessionId: "still-live" });
  expect(model.pullRequests()[0].links).toHaveLength(2);
});
