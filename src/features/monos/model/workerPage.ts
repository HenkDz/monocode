import { listMonos, monoForSession } from "./mono";
import { savedDispatchTask } from "./monoNavigation";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { leafIds, removePane, type WorkspaceTab } from "../../workspace/model/layout";

export type WorkerTaskTarget = { taskId: string; sessionId?: string };
export type WorkerPageSelection = {
  target: WorkerTaskTarget | null;
  status: "loading" | "ready" | "unavailable";
  error?: string;
  opened: string[];
  explicit?: boolean;
};

/** Presentation identity only; never substitutes the owner home for a task session. */
export function workerTaskView(runs: readonly OrchestrationRun[], target: WorkerTaskTarget) {
  if (runs.filter(run => run.tasks.some(task => task.id === target.taskId)).length > 1) return undefined;
  for (const run of runs) {
    const task = run.tasks.find(task => task.id === target.taskId);
    if (!task) continue;
    if (!task.memberId && !run.projectManager && !run.ownerMonoId && !monoForSession(run.ownerSessionId ?? run.leadId)?.role) continue;
    const current = run.dispatches?.find(dispatch => dispatch.taskId === task.id && dispatch.id === (task.activeDispatchId ?? task.lastDispatchId));
    const sessionId = target.sessionId ?? current?.sessionId ?? task.sessionId;
    const dispatch = run.dispatches?.find(dispatch => dispatch.taskId === task.id && dispatch.sessionId === sessionId);
    if (sessionId && sessionId !== task.sessionId && !dispatch) return undefined;
    const ownerId = task.memberId ?? run.ownerMonoId ?? monoForSession(run.ownerSessionId ?? run.leadId)?.id
      ?? listMonos().find(mono => mono.role === "manager" && mono.managerEngineId === run.leadId)?.id;
    const historical = dispatch && (current ? dispatch.id !== current.id : sessionId !== task.sessionId);
    return { run, task, dispatch, sessionId, ownerId, conversationTask: historical && dispatch ? savedDispatchTask(task, dispatch) : task };
  }
}

export function workerTaskForSession(runs: readonly OrchestrationRun[], sessionId: string) {
  if (!sessionId) return undefined;
  for (const run of runs) {
    const task = run.tasks.find(task => task.sessionId === sessionId)
      ?? run.tasks.find(task => run.dispatches?.some(dispatch => dispatch.taskId === task.id && dispatch.sessionId === sessionId));
    if (task) return workerTaskView([run], { taskId: task.id, sessionId });
  }
}

export function workerPageTasks(runs: readonly OrchestrationRun[], ownerId: string) {
  return runs.flatMap(run => run.tasks.flatMap(task => {
    const view = workerTaskView([run], { taskId: task.id });
    return view?.ownerId === ownerId ? [view] : [];
  })).sort((a, b) => Math.max(0, ...(b.run.dispatches ?? []).filter(d => d.taskId === b.task.id).map(d => d.startedAt))
    - Math.max(0, ...(a.run.dispatches ?? []).filter(d => d.taskId === a.task.id).map(d => d.startedAt)));
}

/** Detach view leaves, without closing conversations, editors, terminals or streams. */
export function migrateWorkerTaskTabs(tabs: readonly WorkspaceTab[], activeTabId: string, runs: readonly OrchestrationRun[]) {
  const recognized = new Map(tabs.flatMap(tab => leafIds(tab.layout)).flatMap(id => {
    const view = workerTaskForSession(runs, id);
    return view ? [[id, view] as const] : [];
  }));
  const active = tabs.find(tab => tab.id === activeTabId);
  const selected = active && recognized.get(active.focusedId);
  const next = tabs.flatMap(tab => {
    let layout: WorkspaceTab["layout"] | null = tab.layout;
    for (const id of leafIds(tab.layout)) if (recognized.has(id) && layout) layout = removePane(layout, id);
    if (!layout) return [];
    if (layout === tab.layout) return [tab];
    const ids = leafIds(layout);
    return [{ ...tab, layout, focusedId: ids.includes(tab.focusedId) ? tab.focusedId : ids[0] }];
  });
  return { tabs: recognized.size ? next : tabs, selected, recognized };
}
