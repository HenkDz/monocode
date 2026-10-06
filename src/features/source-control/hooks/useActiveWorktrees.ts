import { useSyncExternalStore } from "react";
import { pathKey } from "../../../shared/lib/paths";

const event = "monocode-active-worktrees-changed";
const fallback = new Map<string, boolean>();
const subscribe = (notify: () => void) => {
  window.addEventListener(event, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(event, notify);
    window.removeEventListener("storage", notify);
  };
};

/** Shared by the project-row control and its worktree list; keeps existing preferences. */
export function useActiveWorktrees(project: string) {
  const key = `monocode.activeWorktrees:${pathKey(project)}`;
  const active = useSyncExternalStore(subscribe, () => {
    if (fallback.has(key)) return fallback.get(key)!;
    try { return localStorage.getItem(key) === "1"; }
    catch { return fallback.get(key) ?? false; }
  }, () => false);
  const setActive = (value: boolean) => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
      fallback.delete(key);
    } catch { fallback.set(key, value); }
    window.dispatchEvent(new Event(event));
  };
  return [active, setActive] as const;
}
