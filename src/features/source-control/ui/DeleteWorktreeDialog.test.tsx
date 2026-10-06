// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import type { Worktree } from "../model/worktrees";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("retains sessions and does not repeat worktree deletion after branch cleanup fails", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const remove = vi.fn(async () => {});
  const branch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unmerged branch retained"))
    .mockResolvedValue(undefined);
  const deleted = vi.fn();
  try {
    await act(async () =>
      root.render(
        <DeleteWorktreeDialog
          cwd="/repo"
          tree={
            {
              path: "/tree",
              branch: "feature",
              dirty: true,
              unpushed: 2,
            } as Worktree
          }
          sessionCount={1}
          allowDeleteSessions={false}
          onRemove={remove}
          onDeleteBranch={branch}
          onClose={() => {}}
          onDeleted={deleted}
        />,
      ),
    );
    expect(document.body.textContent).toContain("uncommitted and untracked");
    expect(document.body.textContent).toContain("not on a remote");
    expect(document.querySelector('[role="switch"]')).toBeNull();
    await act(async () =>
      (
        document.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click(),
    );
    const submit = () =>
      act(async () =>
        document
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
    await submit();
    expect(remove).toHaveBeenCalledWith("/repo", "/tree", true, false);
    expect(document.body.textContent).toContain(
      "Worktree removed; branch cleanup failed",
    );
    expect(deleted).not.toHaveBeenCalled();
    await submit();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(branch).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
