import type { AttentionInput } from "../../model/attention";
import type { Block, Session } from "../../../sessions/model/session";

export const now = Date.UTC(2026, 9, 11, 12);
const project = "C:/synthetic/Atlas";
const session = (id: string, title: string, extra: Partial<Session> = {}): Session => ({
  id, title, cwd: project, harness: "codex", model: "synthetic-model", modelSettings: {}, runtimeMode: "supervised",
  blocks: [{ id: `turn-${id}`, role: "user", text: "Synthetic fixture turn", startedAt: now - 240_000 }], ...extra,
});
export const approval = (requestId = 71, title = "Allow the release verification command"): Block => ({
  id: `approval-${requestId}`, role: "approval", text: "Run the local release verification command in the Atlas checkout. This request is owned by the Manager.",
  startedAt: now - 180_000, tool: { title, status: "waiting" }, approval: { requestId },
});
const conflict = "Codex storage needs repair: " + JSON.stringify({
  entry: "AGENTS.md", monoPath: "C:/synthetic/mono/AGENTS.md", sourcePath: "C:/synthetic/account/AGENTS.md",
  monoBytes: 184, sourceBytes: 212, monoMtime: now - 80_000, sourceMtime: now - 40_000,
  identical: false, monoFingerprint: "synthetic-mono-v1", sourceFingerprint: "synthetic-account-v2", canKeepMono: true,
});
export function syntheticAttention(): AttentionInput {
  return {
    sessions: [
      session("manager", "Atlas Manager", { blocks: [approval()] }),
      session("worker", "Builder", { orchestrationLeadId: "engine", blocks: [approval(72, "Worker permission stays with the lead")] }),
      session("decision", "Release Manager", { pendingQuestion: { requestId: 81, title: "Choose the release verification scope", questions: [{
        id: "scope", header: "Verification scope", prompt: "Which verification should the Manager run before handoff?", multiSelect: false, allowCustom: true,
        options: [{ id: "focused", label: "Focused checks", description: "Run the release and recovery checks." },
          { id: "full", label: "Full suite", description: "Run the complete existing test suite." }],
      }] } }),
      session("storage", "Reviewer", { codexStorageError: conflict, codexStorageAccountId: "synthetic-account",
        queuedMessages: [{ id: "review-message", text: "Review release verification", attachments: [] }] }),
      session("storage-peer", "Atlas Manager held queue", { codexStorageError: conflict, codexStorageAccountId: "synthetic-account" }),
      session("usage", "Search Manager", { usageLimit: {} }),
      session("delivery", "Delivery Manager", { queueStatus: "paused", queuedMessages: [{ id: "delivery-91", text: "Deliver the saved review evidence to the Manager.",
        error: "Synthetic transport refused the delivery. The saved message is retained.", attachments: [] }] }),
      session("failed-worker", "Release Builder", { orchestrationLeadId: "engine" }),
    ],
    roster: [{ id: "mono-manager", role: "manager", name: "Atlas Manager", mascot: "fox", color: "#d6a3ff", projects: [project], sessionId: "manager", managerEngineId: "engine" },
      { id: "mono-worker", role: "member", reportsTo: "mono-manager", name: "Builder", mascot: "bear", color: "#9dd8bb", projects: [project], sessionId: "worker" }],
    goals: [{ id: "release-goal", monoId: "mono-manager", projectId: project, managerId: "engine", userMessageId: "origin", requestId: "release-request",
      title: "Prepare the Atlas release with a complete review and recovery handoff", state: "blocked", prUrls: [], createdAt: now - 1_200_000, updatedAt: now - 60_000 }],
    runs: [{ version: 2, leadId: "engine", ownerSessionId: "manager", ownerMonoId: "mono-manager", cwd: project, status: "active", allowedHarnesses: ["codex"],
      maxWorkers: 2, projectManager: true, cli: "synthetic", continuations: 0, requests: {}, tasks: [{ id: "failed-task", monoGoalId: "release-goal", memberId: "mono-worker",
        memberName: "Builder", sessionId: "failed-worker", title: "Release verification failed; review the preserved attempt", harness: "codex", model: "synthetic-model",
        prompt: "Synthetic fixture only", files: [], scopes: [], dependsOn: [], status: "failed", accepted: false, result: "", delivered: false,
        error: "Synthetic verification failed. The working copy and failed attempt are preserved.", lastDispatchId: "dispatch-failed-task" }],
      dispatches: [{ id: "dispatch-failed-task", taskId: "failed-task", sessionId: "failed-worker", state: "failed", stage: "turn_submitted", startedAt: now - 600_000,
        finishedAt: now - 120_000, updatedAt: now - 120_000, workspace: { id: "synthetic-workspace", projectCwd: project, checkoutCwd: project, kind: "main" } }] }],
  };
}
