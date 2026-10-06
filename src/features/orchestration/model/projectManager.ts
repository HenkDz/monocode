import { orchestrationPathKey } from "./orchestration";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";
import type { Session } from "../../sessions/model/session";
import type { GitPr } from "../../../platform/tauri/fs";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";

const PREFIX = "project-manager-";
export const isProjectManager = (id: string) => id.startsWith(PREFIX);

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
    for (const task of run.tasks) {
      const blocked = ["blocked", "failed", "interrupted"].includes(
        task.status,
      );
      if (blocked || managerPrReady(task, taskPrStatus(task, statuses)))
        items.push({
          key: `${run.leadId}:${task.id}`,
          id: run.leadId,
          notificationId: `${task.lastDispatchId ?? task.id}:${task.status}`,
          project: run.cwd,
          kind: blocked ? "decision" : "ready",
          question: blocked
            ? `${task.title}: ${task.error || task.status}`
            : task.title,
        });
    }
  }
  return items;
}

/** Native resolution supplies the repository root, never the selected worktree. */
export async function projectManagerId(root: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(orchestrationPathKey(root)),
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
