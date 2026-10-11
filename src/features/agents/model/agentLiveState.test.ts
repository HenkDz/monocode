import { describe, expect, it } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { agentLiveStateLabel, agentLiveStateTooltip, selectAgentLiveState, type AgentLiveStatus } from "./agentLiveState";

const session = (patch: Partial<Session> = {}) => ({ ...newSession("codex", "/app"), ...patch });
const queued = { id: "q", text: "next", attachments: [] };
const task = (status: OrchestrationTask["status"], patch: Partial<OrchestrationTask> = {}) => ({
  id: "t", sessionId: "worker", dependsOn: [], accepted: false, status, ...patch,
}) as OrchestrationTask;

describe("selectAgentLiveState", () => {
  it.each([
    [{}, "idle"],
    [{ busy: true }, "thinking"],
    [{ busy: true, compacting: true }, "compacting"],
    [{ busy: true, queuedMessages: [queued] }, "thinking"],
    [{ busy: true, blocks: [{ id: "tool", role: "tool", text: "", tool: { title: "git status", status: "running" } }] }, "running-tool"],
    [{ backgroundTasks: ["npm test"] }, "running-tool"],
    [{ queuedMessages: [queued] }, "queued"],
    [{ pendingMonoEvents: [queued] }, "queued"],
    [{ codexStorageError: "disk unavailable", queuedMessages: [queued] }, "blocked"],
    [{ usageLimit: {}, queuedMessages: [queued] }, "blocked"],
    [{ pendingQuestion: { requestId: 1, title: "Choose", questions: [] } }, "needs-you"],
    [{ blocks: [{ id: "a", role: "tool", text: "", approval: { requestId: 1 } }] }, "needs-you"],
    [{ blocks: [{ id: "error", role: "system", text: "Provider stopped", notice: "error" }] }, "failed"],
  ] as [Partial<Session> & { compacting?: boolean }, AgentLiveStatus][])("derives %s as %s", (patch, status) => {
    expect(selectAgentLiveState(session(patch)).status).toBe(status);
  });

  it("never hides a blocked outbox behind idle or an active task", () => {
    for (const busy of [false, true]) {
      const state = selectAgentLiveState(session({ busy, codexStorageError: "Codex storage needs repair: AGENTS.md", queuedMessages: [queued] }), { task: task("running") });
      expect(state).toEqual({ status: "blocked", reason: "storage", detail: "Codex storage needs repair: AGENTS.md" });
      expect(agentLiveStateLabel(state)).toBe("Blocked · storage");
      expect(agentLiveStateTooltip(state)).toContain("AGENTS.md");
    }
  });

  it.each([
    [{ codexStoragePreparing: true }, "preparing-storage"],
    [{ queueStatus: "paused" }, "paused"],
    [{ queueStatus: "resuming" }, "paused"],
    [{ editingQueuedMessageId: "q" }, "editing"],
    [{ pendingSwitch: { from: "codex", fromModel: "codex:gpt", fromSettings: {} } }, "handoff"],
    [{ worktreePreparing: true }, "worktree"],
    [{ queuedMessages: [{ ...queued, error: "Disconnected" }] }, "error"],
  ] as [Partial<Session>, string][])("names the queue blocker %s", (patch, reason) => {
    expect(selectAgentLiveState(session({ queuedMessages: [queued], ...patch })).reason).toBe(reason);
  });

  it("gives approvals and decisions actionable details", () => {
    expect(selectAgentLiveState(session({ busy: true, blocks: [{ id: "a", role: "tool", text: "", tool: { title: "`git push`" }, approval: { requestId: 1 } }] })))
      .toEqual({ status: "needs-you", reason: "approval", detail: "Approve git push" });
    expect(selectAgentLiveState(session({ pendingQuestion: { requestId: 1, questions: [{ id: "choice", prompt: "Which branch?", options: [] }] } })).detail).toBe("Which branch?");
    expect(selectAgentLiveState(session({ worktreeRemoved: true, pendingQuestion: { requestId: 1, questions: [] } })).detail).toContain("working copy");
  });

  it("ignores stale steps, settled tool calls, decided approvals and earlier turn failures", () => {
    expect(selectAgentLiveState(session({ busy: true, blocks: [
      { id: "old", role: "tool", text: "", tool: { title: "old tool", status: "running" } },
      { id: "u", role: "user", text: "new task" },
      { id: "new", role: "tool", text: "", tool: { title: "new tool", status: "done" }, approval: { requestId: 1, decided: "allow" } },
    ] })).status).toBe("thinking");
    expect(selectAgentLiveState(session({ blocks: [
      { id: "e", role: "system", text: "old failure", notice: "error" },
      { id: "u", role: "user", text: "retry" },
      { id: "a", role: "assistant", text: "Finished" },
    ] })).status).toBe("idle");
    expect(selectAgentLiveState(session({ compacting: true })).status).toBe("idle");
  });

  it.each([
    ["queued", "queued"], ["running", "thinking"], ["cancelling", "thinking"],
    ["blocked", "blocked"], ["interrupted", "blocked"], ["failed", "failed"],
    ["completed", "waiting-review"], ["cancelled", "done"],
  ] as [OrchestrationTask["status"], AgentLiveStatus][])("derives worker task %s as %s", (status, expected) => {
    expect(selectAgentLiveState(undefined, { task: task(status) }).status).toBe(expected);
  });

  it("names unsatisfied dependencies and settles accepted tasks", () => {
    const dependency = task("completed", { id: "first", accepted: false });
    const next = task("queued", { dependsOn: ["first"] });
    expect(selectAgentLiveState(undefined, { task: next, tasks: [dependency, next] }).reason).toBe("dependency");
    expect(selectAgentLiveState(undefined, { task: next, tasks: [{ ...dependency, accepted: true }, next] }).reason).toBeUndefined();
    expect(selectAgentLiveState(undefined, { task: task("completed", { accepted: true }) })).toEqual({ status: "done" });
    expect(selectAgentLiveState(undefined, { task: next, runStatus: "paused", pauseReason: "Review before continuing" })).toEqual({ status: "queued", reason: "paused", detail: "Review before continuing" });
  });

  it("identifies manager review and member waits without claiming it is busy", () => {
    const worker = task("running", { memberName: "Backend" });
    const reviewer = task("queued", { id: "review", memberName: "Reviewer", reviewOf: { taskId: "t", dispatchId: "d" } });
    expect(selectAgentLiveState(session(), { tasks: [worker] })).toEqual({ status: "waiting-on-member", waitingOn: "Backend", detail: "Waiting on Backend" });
    expect(selectAgentLiveState(session(), { tasks: [worker, reviewer] })).toEqual({ status: "waiting-review", waitingOn: "Reviewer", detail: "Waiting on Reviewer" });
    expect(selectAgentLiveState(session({ busy: true }), { tasks: [reviewer] }).status).toBe("thinking");
    expect(selectAgentLiveState(session(), { tasks: [worker], runStatus: "paused", pauseReason: "Choose the next step" })).toEqual({ status: "needs-you", reason: "decision", detail: "Choose the next step" });
    expect(selectAgentLiveState(session(), { runStatus: "finished" })).toEqual({ status: "done" });
  });
});

it("labels every canonical state", () => {
  const labels: Record<AgentLiveStatus, string> = {
    thinking: "Thinking", "running-tool": "Running tool", compacting: "Compacting",
    "waiting-review": "Waiting review", "waiting-on-member": "Waiting on member",
    queued: "Queued", blocked: "Blocked · error", "needs-you": "Needs you",
    idle: "Idle", done: "Done", failed: "Failed",
  };
  for (const [status, label] of Object.entries(labels))
    expect(agentLiveStateLabel({ status: status as AgentLiveStatus })).toBe(label);
  expect(agentLiveStateLabel({ status: "queued", reason: "preparing-storage" })).toBe("Queued · waiting for storage");
  expect(agentLiveStateLabel({ status: "blocked", reason: "usage-limit" })).toBe("Blocked · usage limit");
  expect(agentLiveStateLabel({ status: "waiting-review", waitingOn: "Reviewer" })).toBe("Waiting on Reviewer");
});
