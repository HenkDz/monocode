import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  notifyGitChanged,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";
import { isRemoteProjectPath } from "../../projects/model/recents";

type Leftover = { path: string; digest: string };
type NestedWorktree = { path: string; leftovers: Leftover[] };

export function NestedWorktreeWarning({
  cwd,
  enabled = true,
}: {
  cwd: string;
  enabled?: boolean;
}) {
  const [trees, setTrees] = useState<NestedWorktree[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setTrees([]);
    setError(undefined);
    if (!enabled || !cwd || cwd === "~" || isRemoteProjectPath(cwd)) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const found = await invoke<NestedWorktree[]>("git_nested_worktrees", {
          cwd,
        });
        if (active) setTrees(found);
      } catch (error) {
        console.debug("[monocode] nested worktrees", error);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const unsubscribe = subscribeGitChanged(() => void refresh());
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [cwd, enabled]);

  async function clean(tree: NestedWorktree) {
    if (busy || !tree.leftovers.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const confirmed = await ask(
        `Permanently delete these untracked temporary files from ${tree.path}? Review that they are agent leftovers before continuing.\n\n${tree.leftovers.map((file) => file.path).join("\n")}\n\nThe worktree and other files will be kept.`,
        {
          title: "Clean up leftovers",
          kind: "warning",
          okLabel: "Delete listed files",
          cancelLabel: "Keep files",
        },
      );
      if (!confirmed) return;
      await invoke("git_cleanup_nested_leftovers", {
        cwd,
        path: tree.path,
        files: tree.leftovers,
      });
      notifyGitChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!trees.length) return null;
  return (
    <div
      role="alert"
      className="mx-3 my-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] text-content/80"
    >
      <p className="font-medium">Nested worktree inside this checkout</p>
      <p>
        Use MonoCode’s Worktrees menu to create worktrees outside the
        repository. If you keep this folder, consider an ignore rule in
        .gitignore.
      </p>
      {trees.map((tree) => (
        <div key={tree.path} className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" title={tree.path}>
            {tree.path}
          </span>
          <button
            className="shrink-0 rounded px-2 py-1 hover:bg-content/5 disabled:opacity-50"
            disabled={busy || !tree.leftovers.length}
            onClick={() => void clean(tree)}
            title={
              tree.leftovers.length
                ? "Review and delete untracked temporary files"
                : "No untracked temporary files found; worktree is preserved"
            }
          >
            Clean up leftovers
            {tree.leftovers.length ? ` (${tree.leftovers.length})` : ""}
          </button>
        </div>
      ))}
      {error && <p className="mt-1 text-red-500">{error}</p>}
    </div>
  );
}
