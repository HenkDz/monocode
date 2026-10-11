import type { Session } from "../../sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";

export type AgentLiveStatus =
  | "thinking" | "running-tool" | "compacting"
  | "waiting-review" | "waiting-on-member" | "queued"
  | "blocked" | "needs-you" | "idle" | "done" | "failed";

export type AgentLiveState = {
  status: AgentLiveStatus;
  reason?: "storage" | "usage-limit" | "approval" | "decision" | "error"
    | "preparing-storage" | "paused" | "editing" | "handoff" | "worktree" | "dependency";
  detail?: string;
  waitingOn?: string;
};

export type AgentLiveSession = Pick<Session,
  "blocks" | "busy" | "pendingQuestion" | "usageLimit" | "codexStorageError"
  | "codexStoragePreparing" | "queuedMessages" | "pendingMonoEvents" | "queueStatus"
  | "worktreePreparing" | "worktreeRemoved" | "editingQueuedMessageId" | "pendingSwitch"
  | "backgroundTasks"
> & { compacting?: boolean };

export type AgentLiveContext = {
  task?: OrchestrationTask;
  tasks?: readonly OrchestrationTask[];
  runStatus?: OrchestrationRun["status"];
  pauseReason?: string;
};

function plainLine(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>)\s*/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/^\s*[-\d.]+\s+/gm, "")
    .replace(/\s+/g, " ").trim();
}

/** Current blockers and work outrank queued work and historical task outcomes. */
export function selectAgentLiveState(session?: AgentLiveSession, context: AgentLiveContext = {}): AgentLiveState {
  const blocks = session?.blocks ?? [];
  const queued = session?.queuedMessages?.[0] ?? session?.pendingMonoEvents?.[0];
  if (session?.codexStorageError)
    return { status: "blocked", reason: "storage", detail: session.codexStorageError };
  if (session?.worktreeRemoved)
    return { status: "needs-you", reason: "decision", detail: "Select a working copy to continue" };
  if (session?.pendingQuestion)
    return { status: "needs-you", reason: "decision", detail: session.pendingQuestion.title?.trim() || session.pendingQuestion.questions[0]?.prompt.trim() };
  let approval;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].approval && !blocks[i].approval?.decided) { approval = blocks[i]; break; }
  }
  if (approval)
    return { status: "needs-you", reason: "approval", detail: approval.tool?.title ? `Approve ${plainLine(approval.tool.title)}` : "Waiting for approval" };
  if (session?.usageLimit)
    return { status: "blocked", reason: "usage-limit", detail: "Usage limit reached" };
  if (session?.codexStoragePreparing)
    return { status: "queued", reason: "preparing-storage", detail: "Waiting for storage preparation" };
  if (session?.busy) {
    if (session.compacting) return { status: "compacting", detail: "Compacting context" };
    const last = blocks[blocks.length - 1];
    if (last?.role === "assistant" && !last.tool && last.streaming)
      return { status: "thinking", detail: "Writing a reply" };
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      if (block.role === "user") break;
      if (block.tool?.title && (!block.tool.status || ["running", "pending", "in_progress"].includes(block.tool.status)))
        return { status: "running-tool", detail: plainLine(block.tool.title) };
    }
    return { status: "thinking", detail: "Thinking" };
  }
  if (queued?.error) return { status: "blocked", reason: "error", detail: queued.error };
  if (queued) {
    if (session?.queueStatus === "paused" || session?.queueStatus === "resuming")
      return { status: "queued", reason: "paused", detail: session.queueStatus === "paused" ? "Queue paused" : "Waiting for the resumed turn" };
    if (session?.editingQueuedMessageId === queued.id)
      return { status: "queued", reason: "editing", detail: "Queued message is being edited" };
    if (session?.pendingSwitch || blocks.some(block => block.handoff?.status === "preparing"))
      return { status: "queued", reason: "handoff", detail: "Waiting for provider handoff" };
    if (session?.worktreePreparing)
      return { status: "queued", reason: "worktree", detail: "Preparing working copy" };
    return { status: "queued", detail: "Waiting to start the next turn" };
  }
  if (session?.backgroundTasks?.length)
    return { status: "running-tool", detail: session.backgroundTasks.join(", ") };
  const task = context.task;
  if (task?.status === "blocked" || task?.status === "interrupted")
    return { status: "blocked", reason: "error", detail: task.error || (task.status === "interrupted" ? "Worker interrupted" : "Worker blocked") };
  if (task?.status === "failed") return { status: "failed", reason: "error", detail: task.error || "Worker failed" };
  if (task?.status === "queued") {
    if (context.runStatus === "paused") return { status: "queued", reason: "paused", detail: context.pauseReason || "Orchestration paused" };
    const dependency = task.dependsOn?.find(id => !context.tasks?.find(candidate => candidate.id === id)?.accepted);
    return dependency ? { status: "queued", reason: "dependency", detail: `Waiting for task ${dependency}` }
      : { status: "queued", detail: "Waiting for an available worker" };
  }
  if (task?.status === "running" || task?.status === "cancelling")
    return { status: "thinking", detail: task.status === "cancelling" ? "Stopping worker" : "Waiting for worker activity" };
  if (task?.status === "completed")
    return task.accepted ? { status: "done" } : { status: "waiting-review", detail: "Waiting for task review" };
  if (task?.status === "cancelled") return { status: "done", detail: "Cancelled" };
  if (context.runStatus === "paused")
    return { status: "needs-you", reason: "decision", detail: context.pauseReason || "Orchestration paused" };
  const active = context.tasks?.filter(candidate => ["queued", "running", "cancelling"].includes(candidate.status)) ?? [];
  const review = active.find(candidate => candidate.reviewOf);
  if (review) return { status: "waiting-review", waitingOn: review.memberName, detail: `Waiting on ${review.memberName || "Reviewer"}` };
  if (active.length) return { status: "waiting-on-member", waitingOn: active[0].memberName, detail: `Waiting on ${active[0].memberName || "member"}` };
  if (context.tasks?.some(candidate => candidate.status === "completed" && !candidate.accepted))
    return { status: "waiting-review", detail: "Waiting for task review" };
  if (context.runStatus === "finished") return { status: "done" };
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") break;
    if (blocks[i].notice === "error") return { status: "failed", reason: "error", detail: blocks[i].text };
  }
  return { status: "idle" };
}

export function agentLiveStateLabel(state: AgentLiveState): string {
  switch (state.status) {
    case "thinking": return "Thinking";
    case "running-tool": return "Running tool";
    case "compacting": return "Compacting";
    case "waiting-review": return state.waitingOn ? `Waiting on ${state.waitingOn}` : "Waiting review";
    case "waiting-on-member": return state.waitingOn ? `Waiting on ${state.waitingOn}` : "Waiting on member";
    case "queued": return state.reason === "preparing-storage" ? "Queued · waiting for storage" : "Queued";
    case "blocked": return `Blocked · ${state.reason === "usage-limit" ? "usage limit" : state.reason || "error"}`;
    case "needs-you": return "Needs you";
    case "idle": return "Idle";
    case "done": return "Done";
    case "failed": return "Failed";
  }
}

export const agentLiveStateTooltip = (state: AgentLiveState) => state.detail || agentLiveStateLabel(state);
