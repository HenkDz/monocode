// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { NestedWorktreeWarning } from "./NestedWorktreeWarning";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: () => () => {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.clearAllMocks());

it("warns and offers cleanup without automatic deletion; cancellation preserves files", async () => {
  const tree = {
    path: ".codex-worktrees/fix",
    leftovers: [{ path: "tmp/pr.md", digest: "hash" }],
  };
  vi.mocked(invoke).mockResolvedValue([tree]);
  vi.mocked(ask).mockResolvedValue(false);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<NestedWorktreeWarning cwd="/repo" />));
    expect(host.textContent).toContain("Nested worktree inside this checkout");
    expect(host.textContent).toContain(".gitignore");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(ask).toHaveBeenCalledWith(
      expect.stringContaining("tmp/pr.md"),
      expect.objectContaining({ okLabel: "Delete listed files" }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "git_cleanup_nested_leftovers",
      expect.anything(),
    );
    vi.mocked(ask).mockResolvedValue(true);
    await act(async () => host.querySelector("button")!.click());
    expect(invoke).toHaveBeenCalledWith("git_cleanup_nested_leftovers", {
      cwd: "/repo",
      path: tree.path,
      files: tree.leftovers,
    });
  } finally {
    await act(async () => root.unmount());
  }
});

it("shows cleanup unavailable when no untracked temporary files exist", async () => {
  vi.mocked(invoke).mockResolvedValue([
    { path: ".codex-worktrees/fix", leftovers: [] },
  ]);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<NestedWorktreeWarning cwd="/repo" />));
    expect(host.querySelector("button")!.disabled).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
