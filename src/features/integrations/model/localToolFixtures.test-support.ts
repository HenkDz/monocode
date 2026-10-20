import type { IntegrationBinding, IntegrationGrant, LocalToolCall } from "./localToolPolicy";

export function integrationFixture() {
  const session = { harness: "claude" as const, cwd: "C:/synthetic/project", worktreeCwd: null, providerAccountId: "account",
    codexStorageHome: null, codexStorageAccountId: null, runtimeMode: "supervised" as const, readOnly: false, windowsSandbox: null };
  const binding: IntegrationBinding = { projectId: "project", projectPath: session.cwd, projectIdentity: "windows:1:2", ownerMonoId: "boss", managerId: "manager", monoId: "worker",
    goalId: "goal", goalRequestId: "original-request", userMessageId: "user-message", requestSessionId: "user-session", requesterSessionId: "worker-session",
    requestBinding: { ...session }, requesterBinding: { ...session }, generation: 1, taskId: "task", dispatchId: "dispatch", deadline: 5000, executionIdentity: "native-executable-config-service-account" };
  const call: LocalToolCall = { requestId: "call-1", tool: "github.pr.read", revision: 1, args: { url: "https://github.com/acme/project/pull/1" }, binding };
  const grant: IntegrationGrant = { id: "grant", binding: structuredClone(binding), expiresAt: 5000, revoked: false,
    tools: [{ id: call.tool, revision: 1, scopes: ["repo:github.com/acme/project"] }] };
  const context = { binding: structuredClone(binding), active: true, held: false };
  return { binding, call, grant, context };
}
