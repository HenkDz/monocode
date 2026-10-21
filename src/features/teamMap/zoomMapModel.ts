import type { GitPr } from "../../platform/tauri/fs";
import { projectKey } from "../../shared/lib/paths";
import { selectAgentLiveState } from "../agents/model/agentLiveState";
import { activityTaskEvent, activityTaskTitle } from "../monos/model/monoTeamActivity";
import { managerPrReady, managerTaskFinished, taskPrStatus } from "../orchestration/model/projectManager";
import type { OrchestrationRun, OrchestrationTask } from "../orchestration/model/orchestrationState";
import type { Session } from "../sessions/model/session";
import { pullRequestReady } from "../source-control/model/pullRequests";
import type { OrbitProject } from "./orbit";

export const TASK_FLOW = ["planned", "working", "review", "ready", "done"] as const;
export const TASK_LABEL = { planned: "Planned", working: "Working", review: "In review", ready: "Ready to merge", done: "Done", failed: "Failed", blocked: "Blocked", interrupted: "Interrupted", cancelled: "Cancelled", closed: "Closed without merging" };
export type MapTaskState = keyof typeof TASK_LABEL;

export function mapTaskState(task: OrchestrationTask, pr?: GitPr | null): MapTaskState {
  const current = task.activeDispatchId ?? task.lastDispatchId;
  const accepted = !!current && task.accepted && task.acceptedDispatchId === current;
  if (task.status === "cancelled") return "cancelled";
  if (["failed", "blocked", "interrupted"].includes(task.status)) return task.status as "failed" | "blocked" | "interrupted";
  if (accepted && managerTaskFinished(task, pr)) return pr?.state === "closed" ? "closed" : "done";
  if (["running", "cancelling"].includes(task.status)) return "working";
  if (accepted && managerPrReady(task, pr) && pr?.reviewDecision === "APPROVED" && pullRequestReady({ cwd: "", pr, links: [], verifiedAt: 0 }) &&
    !!pr.headOid && !!pr.baseRefName && (!task.baseBranch || task.baseBranch === pr.baseRefName) &&
    (!task.delivery || task.delivery.head === pr.headOid && task.delivery.ci === "pass" && !task.delivery.conflicts && task.delivery.mergeable !== false) &&
    task.reviewedHead === pr.headOid) return "ready";
  return task.status === "completed" ? "review" : "planned";
}

/** Keep project/owner and current dispatch identity intact, including unassigned tasks. */
export function projectMapTasks(project: OrbitProject, runs: readonly OrchestrationRun[], sessions: readonly Session[], statuses: ReadonlyMap<string, GitPr | null>) {
  return runs.filter(run => (run.ownerMonoId ? run.ownerMonoId === project.manager.id :
    !!project.manager.mono.managerEngineId && run.leadId === project.manager.mono.managerEngineId) &&
    (!run.cwd || projectKey(run.cwd) === projectKey(project.project))).flatMap(run => run.tasks.map(task => {
    const dispatch = run.dispatches?.find(entry => entry.id === (task.activeDispatchId ?? task.lastDispatchId) && entry.taskId === task.id);
    const session = sessions.find(entry => entry.id === (dispatch?.sessionId ?? task.sessionId));
    const pr = taskPrStatus(task, statuses);
    return { key: JSON.stringify([run.leadId, task.id]), run, task, dispatch, session, pr, state: mapTaskState(task, pr),
      title: activityTaskTitle(task), latest: activityTaskEvent(task, session),
      live: selectAgentLiveState(session, { task, tasks: run.tasks, runStatus: run.status, pauseReason: run.lastPauseReason }) };
  }));
}
export type MapTask = ReturnType<typeof projectMapTasks>[number];

export type MapCamera = { x: number; y: number; scale: number };
export type MapSize = { width: number; height: number };
export const projectPoint = (index: number) => ({ x: 230 + index % 4 * 380, y: 500 + Math.floor(index / 4) * 310 });
export function mapCamera(size: MapSize, count: number): MapCamera {
  const width = Math.min(4, Math.max(1, count)) * 380 + 80;
  const height = 730 + Math.max(0, Math.ceil(count / 4) - 1) * 310;
  const scale = Math.min(size.width / width, Math.max(200, size.height - 70) / height, 1.2);
  return { scale, x: (size.width - width * scale) / 2, y: 25 };
}
export function projectCamera(size: MapSize, point: { x: number; y: number }) {
  const reading = Math.min(1.2, Math.max(.8, (size.height - 180) / 620));
  const width = Math.max(1000, Math.min(1800, (size.width - 80) / reading));
  // Narrow windows pan across the board instead of shrinking type below reading size.
  const scale = reading * 4;
  return { width, camera: { scale, x: size.width < 850 ? 24 - (point.x - width / 8) * scale : size.width / 2 - point.x * scale,
    y: 80 - (point.y + 12) * scale } };
}
export function zoomCamera(camera: MapCamera, x: number, y: number, scale: number): MapCamera {
  return { scale, x: x - (x - camera.x) * scale / camera.scale, y: y - (y - camera.y) * scale / camera.scale };
}
