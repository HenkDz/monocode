import { useSyncExternalStore, type ReactNode } from "react";
import { pathKey } from "../../../shared/lib/paths";

type RemovalTask = {
  id: number;
  path: string;
  render: (review: boolean) => ReactNode;
  pending: boolean;
  review: boolean;
  error?: string;
};

let tasks: RemovalTask[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function startWorktreeRemovalTask(
  path: string,
  render: RemovalTask["render"],
): boolean {
  if (
    tasks.some((task) => pathKey(task.path) === pathKey(path) && task.pending)
  )
    return false;
  tasks = [
    ...tasks.filter((task) => pathKey(task.path) !== pathKey(path)),
    { id: ++nextId, path, render, pending: true, review: true },
  ];
  notify();
  return true;
}

export function updateWorktreeRemovalTask(
  path: string,
  update: Partial<Pick<RemovalTask, "pending" | "review" | "error">>,
) {
  tasks = tasks.map((task) =>
    pathKey(task.path) === pathKey(path) ? { ...task, ...update } : task,
  );
  notify();
}

export function finishWorktreeRemovalTask(path: string) {
  tasks = tasks.filter((task) => pathKey(task.path) !== pathKey(path));
  notify();
}

export function useWorktreeRemovalTasks() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tasks,
  );
}
