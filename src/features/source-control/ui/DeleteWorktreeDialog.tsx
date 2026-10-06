import {
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { prettyCwd } from "../../../shared/lib/paths";
import { type Worktree } from "../model/worktrees";
import { Modal } from "../../../shared/ui/Modal";
import {
  CircleAlert,
  CloudUpload,
  FileDiff,
  Folder,
  GitBranch,
  Loader,
  MessageSquare,
} from "../../../shared/ui/icons";

const TONE = {
  danger: "text-red-400",
  warn: "text-amber-400",
  muted: "text-content/35",
};

function Consequence({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={`mt-px size-3.5 shrink-0 ${TONE[tone]}`} />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function DeleteWorktreeDialog({
  cwd,
  tree,
  sessionCount = 0,
  onRemove,
  onClose,
  onDeleted,
  onDeleteBranch,
  allowDeleteSessions = true,
}: {
  cwd: string;
  tree: Worktree;
  sessionCount?: number;
  onRemove: (
    cwd: string,
    path: string,
    force: boolean,
    deleteSessions: boolean,
  ) => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
  onDeleteBranch?: (force: boolean) => Promise<void>;
  allowDeleteSessions?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [deleteSessions, setDeleteSessions] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [forceBranch, setForceBranch] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // Confirmation covers the complete destructive action, including any
      // local changes that appeared after the last status refresh.
      if (!removed) {
        await onRemove(cwd, tree.path, true, deleteSessions);
        setRemoved(true);
      }
      if (deleteBranch) await onDeleteBranch?.(forceBranch);
      onDeleted();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Delete worktree?"
      size="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="flex flex-col gap-3.5 p-4 text-[13px] leading-[1.5]"
        onSubmit={(e) => void submit(e)}
      >
        <p className="text-content/75">
          This permanently deletes the working copy and everything inside it.
        </p>
        <div className="rounded-lg border border-content/10 bg-content/5 p-3">
          <p className="flex items-start gap-2.5 text-[12px] text-content/55">
            <Folder className="mt-px size-3.5 shrink-0 text-content/35" />
            <span className="min-w-0 flex-1 break-all font-mono">
              {prettyCwd(tree.path)}
            </span>
          </p>
          <ul className="mt-2.5 flex flex-col gap-2 border-t border-content/8 pt-2.5 text-[12.5px] text-content/75">
            {sessionCount > 0 && (
              <Consequence
                icon={MessageSquare}
                tone={deleteSessions ? "danger" : "muted"}
              >
                {sessionCount} session{sessionCount === 1 ? "" : "s"} using this
                worktree {sessionCount === 1 ? "is" : "are"}{" "}
                {deleteSessions
                  ? "permanently deleted."
                  : "kept. Select a branch or worktree to continue them."}
              </Consequence>
            )}
            {tree.dirty && (
              <Consequence icon={FileDiff} tone="warn">
                All uncommitted and untracked changes here are discarded.
              </Consequence>
            )}
            {tree.dirty == null && (
              <Consequence icon={CircleAlert} tone="warn">
                Changes could not be checked. Anything uncommitted here is
                discarded.
              </Consequence>
            )}
            <Consequence icon={GitBranch}>
              {tree.branch ? (
                <>
                  The{" "}
                  <span className="font-medium text-content">
                    {tree.branch}
                  </span>{" "}
                  {deleteBranch
                    ? forceBranch
                      ? "local branch will be force-deleted, even if unmerged. Commits not saved elsewhere may be lost. Remote branches are untouched."
                      : "local branch will also be deleted if Git confirms it is merged. Remote branches are untouched."
                    : "branch and its commits are kept."}
                </>
              ) : (
                "The branch is kept."
              )}
            </Consequence>
            {!!tree.unpushed && (
              <Consequence icon={CloudUpload}>
                {tree.unpushed} commit{tree.unpushed === 1 ? " is" : "s are"}{" "}
                not on a remote.{" "}
                {deleteBranch
                  ? "Branch deletion may lose access to these commits."
                  : "They stay on the branch."}
              </Consequence>
            )}
          </ul>
        </div>
        {onDeleteBranch && tree.branch && (
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={deleteBranch}
              disabled={busy || removed}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            Also delete local branch
          </label>
        )}
        {onDeleteBranch && deleteBranch && (
          <label className="flex gap-2 text-red-400">
            <input
              type="checkbox"
              checked={forceBranch}
              disabled={busy}
              onChange={(e) => setForceBranch(e.target.checked)}
            />
            Force delete unmerged branch — commits may be lost
          </label>
        )}
        {removed && (
          <p role="status">
            Worktree removed; branch cleanup failed. Retry cleanup or close this
            dialog. Sessions were {deleteSessions ? "deleted" : "retained"}.
          </p>
        )}
        {sessionCount > 0 && allowDeleteSessions && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-content/10 p-3">
            <span
              id="delete-worktree-sessions-label"
              className="text-[12.5px] text-content/75"
            >
              Also delete associated sessions
            </span>
            <button
              type="button"
              role="switch"
              aria-labelledby="delete-worktree-sessions-label"
              aria-checked={deleteSessions}
              disabled={busy || removed}
              onClick={() => setDeleteSessions(!deleteSessions)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${deleteSessions ? "bg-red-500" : "bg-content/20"}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${deleteSessions ? "left-4.5" : "left-0.5"}`}
              />
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="break-words text-[12.5px] text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-3 py-1.5 hover:bg-content/8 active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:hover:bg-red-500/20 active:scale-[0.97]"
          >
            {busy && <Loader className="size-3.5 animate-spin" />}
            {removed
              ? forceBranch ? "Force delete branch" : "Retry branch cleanup"
              : forceBranch && deleteBranch
                ? "Delete worktree and force delete branch"
                : sessionCount && deleteSessions
              ? `Delete worktree and session${sessionCount === 1 ? "" : "s"}`
              : "Delete worktree"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
