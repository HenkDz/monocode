import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { projectName } from "../../../shared/lib/paths";
import { sameProjectPath } from "../model/recents";
import {
  applyProjectAddition,
  resolveProjectAddition,
  type ProjectAddition,
} from "../model/projectAddition";

export function useProjectAddition() {
  const [pending, setPending] = useState<ProjectAddition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const respond = useRef<((separate: boolean | null) => void) | null>(null);
  useEffect(() => () => respond.current?.(null), []);
  const choose = useCallback(
    async (
      path: string,
      projects: string[],
      separate = false,
      offerChoice = true,
      isCurrent: () => boolean = () => true,
    ) => {
      let addition;
      try {
        addition = await resolveProjectAddition(path, projects);
      } catch (error) {
        if (isCurrent()) setError(String(error));
        return null;
      }
      if (!isCurrent()) return null;
      if (
        !separate &&
        offerChoice &&
        !sameProjectPath(addition.path, addition.project)
      ) {
        respond.current?.(null);
        const choice = await new Promise<boolean | null>((resolve) => {
          respond.current = resolve;
          setPending(addition);
        });
        if (choice === null || !isCurrent()) return null;
        separate = choice;
      }
      return { ...addition, project: applyProjectAddition(addition, separate) };
    },
    [],
  );
  const finish = (separate: boolean | null) => {
    respond.current?.(separate);
    respond.current = null;
    setPending(null);
  };
  return {
    chooseProjectAddition: choose,
    projectAdditionDialog: error ? (
      <Modal
        title="Could not add folder"
        size="sm"
        onClose={() => setError(null)}
      >
        <p className="px-4 pb-4 text-[13px] text-content/70">{error}</p>
      </Modal>
    ) : pending ? (
      <Modal title="Add linked worktree" size="sm" onClose={() => finish(null)}>
        <div className="space-y-3 px-4 pb-4 text-[13px]">
          <p>
            {projectName(pending.path)} is a worktree of{" "}
            {projectName(pending.project)}. Add it under that project?
          </p>
          <p className="break-all text-[11px] text-content/50">
            {pending.path}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => finish(null)}
              className="rounded-md px-3 py-1.5 hover:bg-content/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => finish(true)}
              className="rounded-md px-3 py-1.5 hover:bg-content/5"
            >
              Add as separate project
            </button>
            <button
              type="button"
              onClick={() => finish(false)}
              className="rounded-md bg-selection px-3 py-1.5"
            >
              Add under project
            </button>
          </div>
        </div>
      </Modal>
    ) : null,
  };
}
