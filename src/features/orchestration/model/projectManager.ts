import { orchestrationPathKey } from "./orchestration";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";
import type { Session } from "../../sessions/model/session";
import type { GitPr } from "../../../platform/tauri/fs";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";

const PREFIX = "project-manager-";
export const isProjectManager = (id: string) => id.startsWith(PREFIX);

export function reviewedManagerPullRequest(task: OrchestrationTask, pr: GitPr | null): string {
  if (!pr || pr.state !== "open" || pr.isDraft || !pr.url)
    throw new Error("Could not confirm an open non-draft PR for this worker branch. If it already exists, report the lookup failure; do not republish it or inspect credentials.");
  if (task.baseBranch && pr.baseRefName !== task.baseBranch)
    throw new Error(`This PR must target the project's assignment branch: ${task.baseBranch}.`);
  return pr.url;
}

export function managerTaskMerged(
  task: OrchestrationTask,
  pr?: GitPr | null,
): boolean {
  return managerTaskFinished(task, pr) && pr?.state === "merged";
}

export function managerTaskFinished(
  task: OrchestrationTask,
  pr?: GitPr | null,
): boolean {
  return !!(
    task.status === "completed" &&
    task.accepted &&
    task.lastDispatchId &&
    task.acceptedDispatchId === task.lastDispatchId &&
    task.prUrl &&
    pr?.url === task.prUrl &&
    (pr.state === "merged" || pr.state === "closed")
  );
}

export function managerQueueRank(
  task: OrchestrationTask,
  pr?: GitPr | null,
): number {
  if (managerTaskFinished(task, pr) || task.status === "cancelled") return 3;
  if (["blocked", "failed", "interrupted"].includes(task.status)) return 0;
  if (managerPrReady(task, pr)) return 1;
  return 2;
}

export function managerPrReady(
  task: OrchestrationTask,
  pr?: GitPr | null,
): boolean {
  return !!(
    task.status === "completed" &&
    task.accepted &&
    task.prUrl &&
    task.lastDispatchId &&
    task.acceptedDispatchId === task.lastDispatchId &&
    // Unknown is not closed. A different PR on the reused branch is not this review.
    (!pr || (pr.url === task.prUrl && pr.state === "open" && !pr.isDraft))
  );
}

export const taskPrStatus = (
  task: OrchestrationTask,
  statuses: ReadonlyMap<string, GitPr | null>,
) =>
  task.workspace
    ? statuses.get(
        prStatusKey(task.workspace.checkoutCwd, task.workspace.branch),
      )
    : undefined;

export type ManagerAttention = {
  key: string;
  id: string;
  project: string;
  kind: "decision" | "reply" | "ready";
  question: string;
  notificationId?: string;
};

export function managerAttention(
  sessions: readonly Session[],
  runs: readonly OrchestrationRun[],
  unseen: ReadonlySet<string>,
  statuses: ReadonlyMap<string, GitPr | null>,
): ManagerAttention[] {
  const items: ManagerAttention[] = [];
  for (const session of sessions.filter((s) => isProjectManager(s.id))) {
    const approval = session.blocks.find(
      (block) => block.approval && !block.approval.decided,
    );
    if (session.pendingQuestion || approval || unseen.has(session.id))
      items.push({
        key: session.id,
        id: session.id,
        notificationId: `${session.blocks.filter((block) => block.role === "user").slice(-1)[0]?.id ?? ""}:${session.pendingQuestion?.requestId ?? approval?.id ?? "reply"}`,
        project: session.cwd,
        kind: session.pendingQuestion || approval ? "decision" : "reply",
        question:
          session.pendingQuestion?.title ||
          session.pendingQuestion?.questions[0]?.prompt ||
          (approval
            ? `Approve: ${approval.tool?.title || approval.text}`
            : "New reply from Manager"),
      });
  }
  for (const run of runs.filter((r) => r.projectManager)) {
    if (run.status === "paused" && !run.recovering) items.push({
      key: `${run.leadId}:continue`, id: run.leadId, project: run.cwd,
      kind: "decision", question: run.error || "Manager needs your decision to continue",
      notificationId: `continue:${run.error ?? run.lastPauseReason ?? "paused"}`,
    });
    for (const task of run.tasks) {
      // Worker problems go to Manager; only its explicit escalation needs a human.
      if (managerPrReady(task, taskPrStatus(task, statuses)))
        items.push({
          key: `${run.leadId}:${task.id}`,
          id: run.leadId,
          notificationId: `${task.lastDispatchId ?? task.id}:${task.status}`,
          project: run.cwd,
          kind: "ready",
          question: task.title,
        });
    }
  }
  return items;
}

/** Native resolution supplies the registered sidebar folder, including linked worktrees. */
export async function projectManagerId(folder: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(orchestrationPathKey(folder)),
  );
  return (
    PREFIX +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

export function managerWorktreeStatus(
  runs: readonly OrchestrationRun[],
  checkout: string,
  needsInput?: ReadonlySet<string>,
  statuses: ReadonlyMap<string, GitPr | null> = new Map(),
): string | undefined {
  const tasks = runs
    .filter((run) => run.projectManager)
    .flatMap((run) => run.tasks)
    .filter(
      (task) =>
        task.workspace &&
        orchestrationPathKey(task.workspace.checkoutCwd) ===
          orchestrationPathKey(checkout),
    );
  if (
    tasks.some(
      (task) =>
        needsInput?.has(task.sessionId) ||
        ["blocked", "failed", "interrupted"].includes(task.status),
    )
  )
    return "Blocked";
  if (tasks.some((task) => ["running", "cancelling"].includes(task.status)))
    return "Running";
  if (tasks.some((task) => managerPrReady(task, taskPrStatus(task, statuses))))
    return "PR ready";
  if (tasks.some((task) => task.status === "completed" && !task.accepted))
    return "In review";
  if (tasks.some((task) => task.status === "queued")) return "Queued";
}
