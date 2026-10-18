import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { useWorktreeFocus } from "../model/worktreeFocus";
import { sameProjectPath } from "../../projects/model/recents";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import { GitBranch, Loader } from "../../../shared/ui/icons";

/** The sidebar title while the project rail picks worktrees: it names the
 * working copy the panel shows, without offering a second way to switch. */
export function WorkspaceHeading({
  cwd,
  pending = false,
}: {
  cwd: string;
  pending?: boolean;
}) {
  const focus = useWorktreeFocus(cwd);
  const { data } = useProjectWorktrees(cwd);
  const path = focus?.path ?? cwd;
  const tree = data?.worktrees.find((item) => sameProjectPath(item.path, path));
  const primary = !focus || !!tree?.isMain;
  const branch =
    tree?.branch ??
    (tree ? `Detached ${tree.head.slice(0, 7)}` : focus?.branch) ??
    projectName(cwd);
  const details = [
    tree?.dirty ? "uncommitted changes" : "",
    tree?.unpushed ? `${tree.unpushed} unpushed` : "",
  ].filter(Boolean);
  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      aria-busy={pending}
      title={`${prettyCwd(path)}${details.length ? `\n${details.join(" · ")}` : ""}`}
    >
      {pending ? (
        <Loader className="size-3.5 shrink-0 animate-spin text-content/50" />
      ) : (
        <GitBranch className="size-3.5 shrink-0 text-content/50" />
      )}
      <span className="min-w-0 truncate text-sm font-medium leading-tight">
        {branch}
      </span>
      <span className="shrink-0 text-[11px] text-content/45">
        {primary ? "primary" : "worktree"}
      </span>
      {tree?.dirty ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-400"
          aria-label="Uncommitted changes"
        />
      ) : null}
    </div>
  );
}
