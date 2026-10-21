import type { GitPr } from "../../platform/tauri/fs";
import { projectKey } from "../../shared/lib/paths";
import { selectAgentLiveState } from "../agents/model/agentLiveState";
import { activityTaskEvent, activityTaskTitle } from "../monos/model/monoTeamActivity";
import { managerPrReady, managerTaskFinished, taskPrStatus } from "../orchestration/model/projectManager";
import type { OrchestrationRun, OrchestrationTask } from "../orchestration/model/orchestrationState";
import { canReplaceSessionTitle, sessionDisplayTitle, titleFromPrompt, type Session } from "../sessions/model/session";
import { pullRequestReady } from "../source-control/model/pullRequests";
import type { OrbitProject } from "./orbit";
import { monoLook, type Mono } from "../monos/model/mono";
import { coordinationSummary } from "../sessions/model/transcriptPresentation";
import type { TeamMapEvent } from "./model";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";

export function mapGoalTitle(goal: MonoManagerGoal, sessions: readonly Session[]) {
  const session = goal.userMessageId ? sessions.find(session => session.blocks.find(block => block.role === "user")?.id === goal.userMessageId) : undefined;
  const title = session?.title?.trim();
  if (session && title && title.length <= 120 && title !== goal.title.trim() && !canReplaceSessionTitle(title, session.harness, titleFromPrompt(goal.title, session.harness)) && !/^(new (chat|session)|untitled|chat|session)$/i.test(title))
    return coordinationSummary(sessionDisplayTitle(title, session.harness));
  return "Goal";
}

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
    const dispatchId = task.activeDispatchId ?? task.lastDispatchId;
    const dispatch = run.dispatches?.find(entry => entry.id === dispatchId && entry.taskId === task.id);
    const session = sessions.find(entry => entry.id === (dispatch?.sessionId ?? (!dispatchId ? task.sessionId : undefined)));
    const pr = taskPrStatus(task, statuses);
    const member = project.members.find(node => node.id === task.memberId);
    return { key: JSON.stringify([run.leadId, task.id]), run, task, dispatch, session, pr, state: mapTaskState(task, pr),
      title: activityTaskTitle(task), latest: activityTaskEvent(task, session),
      memberName: member ? monoLook(member.mono).name : task.memberName,
      live: selectAgentLiveState(session, { task, tasks: run.tasks, runStatus: run.status, pauseReason: run.lastPauseReason }) };
  }));
}
export type MapTask = ReturnType<typeof projectMapTasks>[number];

export function mapTodaySentence(event: TeamMapEvent, roster: readonly Mono[]) {
  const mono = roster.find(mono => mono.id === event.source);
  const actor = mono ? monoLook(mono).name : "The team";
  const title = coordinationSummary(event.label, 120);
  const verbs = { dispatch: "assigned", report: "reported on", review: event.changes ? "requested changes to" : "approved", pr: "reported a PR ready for review for", escalation: "asked for help with", message: "shared", closed: "closed", accepted: "finished" };
  return title.startsWith(`${actor} `) ? title : `${actor} ${verbs[event.kind]} ${title}`;
}

export type MapCamera = { x: number; y: number; scale: number };
export type MapSize = { width: number; height: number };
export const projectPoint = (index: number) => ({ x: 230 + index % 4 * 380, y: 500 + Math.floor(index / 4) * 310 });
export function mapCamera(size: MapSize, count: number): MapCamera {
  const width = Math.min(4, Math.max(1, count)) * 380 + 80;
  const height = 730 + Math.max(0, Math.ceil(count / 4) - 1) * 310;
  const scale = Math.min(size.width / width, Math.max(200, size.height - 70) / height);
  return { scale, x: (size.width - width * scale) / 2, y: 25 };
}
export function projectCamera(size: MapSize, point: { x: number; y: number }, content?: MapSize) {
  const reading = Math.min(1.2, Math.max(.8, (size.height - 180) / 620));
  const width = size.width < 848 ? Math.max(280, (size.width - 48) / reading) : Math.max(1000, Math.min(1800, (size.width - 80) / reading));
  const actual = content?.width || width;
  // Fit the rendered width; tall boards retain reading size and scroll vertically.
  const scale = Math.min(reading, Math.max(1, size.width - 48) / actual) * 4;
  return { width, camera: { scale, x: (size.width - actual * scale / 4) / 2 - (point.x - width / 8) * scale,
    y: 80 - (point.y + 12) * scale } };
}
export function zoomCamera(camera: MapCamera, x: number, y: number, scale: number): MapCamera {
  return { scale, x: x - (x - camera.x) * scale / camera.scale, y: y - (y - camera.y) * scale / camera.scale };
}
