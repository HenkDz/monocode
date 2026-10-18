import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dragPointToClient } from "../../../shared/lib/dragPoint";

/** A sidebar drop opens folders; composer and explorer drops keep their own behavior. */
export function useProjectFolderDrop(
  open: (paths: readonly string[]) => unknown,
) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve()
      .then(() =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (cancelled || payload.type !== "drop") return;
          const { x, y } = dragPointToClient(
            payload.position.x,
            payload.position.y,
          );
          const target = document.elementFromPoint(x, y);
          if (
            target?.closest(
              'nav[aria-label="Projects"],[data-compact-project-rail]',
            )
          ) {
            void latest.current(payload.paths);
          }
        }),
      )
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
