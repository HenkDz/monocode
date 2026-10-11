import { createPortal } from "react-dom";
import { prettyCwd } from "../../../shared/lib/paths";
import { LAYER } from "../../../shared/lib/layers";
import { Loader } from "../../../shared/ui/icons";
import {
  finishWorktreeRemovalTask,
  updateWorktreeRemovalTask,
  useWorktreeRemovalTasks,
} from "../model/worktreeRemovalTasks";

/** Keep confirmed deletions and their recovery alive while the user navigates. */
export function WorktreeRemovalTasks() {
  const tasks = useWorktreeRemovalTasks();
  return (
    <>
      {tasks.map((task) => (
        <div key={task.id}>{task.render(task.review)}</div>
      ))}
      {tasks.length > 0 &&
        createPortal(
          <div
            className="fixed bottom-4 right-4 flex max-h-[40vh] w-[min(400px,calc(100vw-32px))] flex-col gap-2 overflow-y-auto"
            style={{ zIndex: LAYER.toast }}
          >
            {tasks
              .filter((task) => !task.pending || !task.review)
              .map((task) => (
                <div
                  key={task.id}
                  role={task.pending ? "status" : "alert"}
                  className="rounded-lg border border-stroke bg-background-base p-3 text-xs text-content shadow-lg"
                >
                  <p className="flex items-center gap-2 font-medium">
                    {task.pending && (
                      <Loader className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
                    )}
                    {task.pending
                      ? "Deleting worktree…"
                      : "Worktree deletion needs attention"}
                  </p>
                  <p
                    title={task.path}
                    className="mt-1 truncate text-content/60"
                  >
                    {prettyCwd(task.path)}
                  </p>
                  {task.pending && (
                    <button
                      type="button"
                      className="mt-2 underline focus-visible:outline-accent"
                      onClick={() =>
                        updateWorktreeRemovalTask(task.path, { review: true })
                      }
                    >
                      Show progress
                    </button>
                  )}
                  {task.error && (
                    <>
                      <p className="mt-2 break-words text-red-400">
                        {task.error}
                      </p>
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          className="underline focus-visible:outline-accent"
                          onClick={() =>
                            updateWorktreeRemovalTask(task.path, {
                              review: true,
                            })
                          }
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          className="text-content/60 underline focus-visible:outline-accent"
                          onClick={() => finishWorktreeRemovalTask(task.path)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}
