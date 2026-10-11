import { describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { agentLiveStateLabel, agentLiveStateTooltip, selectAgentLiveState, type AgentLiveStatus } from "./agentLiveState";
import { appendUser, applyHarnessEvent, stopStreaming } from "../../../integrations/harness/core/apply";
import { acknowledgeMonoMessage, enqueueMonoMessage } from "../../monos/model/monoMessaging";

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
      { id: "u", role: "user", text: "new task", startedAt: 1000 },
      { id: "new", role: "tool", text: "", tool: { title: "new tool", status: "done" }, approval: { requestId: 1, decided: "allow" } },
    ] })).status).toBe("thinking");
    expect(selectAgentLiveState(session({ blocks: [
      { id: "e", role: "system", text: "old failure", notice: "error" },
      { id: "u", role: "user", text: "retry", startedAt: 1000 },
      { id: "a", role: "assistant", text: "Finished" },
    ] })).status).toBe("idle");
    expect(selectAgentLiveState(session({ compacting: true })).status).toBe("idle");
  });

  it("keeps the submitted turn's running tool visible behind queued and steering bubbles", () => {
    const active = session({ busy: true, blocks: [
      { id: "old", role: "tool", text: "", tool: { title: "old tool", status: "running" } },
      { id: "owner", role: "user", text: "build", startedAt: 1000 },
      { id: "tool", role: "tool", text: "", tool: { title: "npm test", status: "in_progress" } },
      { id: "steer", role: "user", text: "check tests too", sentAt: 1500 },
    ] });
    const pending = enqueueMonoMessage(active, queued);
    expect(selectAgentLiveState(pending)).toEqual({ status: "running-tool", detail: "npm test" });
    const settled = { ...pending, blocks: pending.blocks.map(block => block.id === "tool" ? { ...block, tool: { ...block.tool!, status: "done" } } : block) };
    expect(selectAgentLiveState(settled).status).toBe("thinking");
  });

  it("retains the current provider failure ahead of a paused outbox", () => {
    const active = enqueueMonoMessage(session({ busy: true, blocks: [
      { id: "old-error", role: "system", text: "Old failure", notice: "error" },
      { id: "owner", role: "user", text: "build", startedAt: 1000 },
    ] }), queued);
    const failed = applyHarnessEvent(active, { type: "session.error", message: "Connection lost; reconnect to retry" });
    expect(failed.queueStatus).toBe("paused");
    expect(failed.queuedMessages?.[0].error).toBeUndefined();
    expect(selectAgentLiveState(failed)).toEqual({ status: "failed", reason: "error", detail: "Connection lost; reconnect to retry" });
    const retry = { ...failed, blocks: [...failed.blocks, { id: "retry", role: "user" as const, text: "retry", startedAt: 3000 }] };
    expect(selectAgentLiveState(retry)).toEqual({ status: "queued", reason: "paused", detail: "Queue paused" });
  });

  it("drops the earlier failure after a queued bubble becomes a recovered new turn", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      let pending = enqueueMonoMessage(appendUser(session(), "First"), queued);
      pending = applyHarnessEvent(pending, { type: "session.error", message: "Old connection lost" });
      clock.mockReturnValue(3000);
      const retry = acknowledgeMonoMessage(pending, pending.queuedMessages![0], { mode: "new-turn" });
      const replied = applyHarnessEvent(retry, { type: "message.delta", text: "Recovered" });
      expect(selectAgentLiveState(stopStreaming(replied, 4000))).toEqual({ status: "idle" });
      expect(retry.blocks.at(-1)?.id).toBe(queued.id);
      expect(retry.blocks.some(block => block.text === "Old connection lost" && block.notice === "error")).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it("uses the last untimed historical turn when restored timestamps are missing", () => {
    expect(selectAgentLiveState(session({ blocks: [
      { id: "old", role: "system", text: "Old failure", notice: "error" },
      { id: "untimed", role: "user", text: "Later successful turn" },
      { id: "done", role: "assistant", text: "Finished" },
    ] }))).toEqual({ status: "idle" });
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
