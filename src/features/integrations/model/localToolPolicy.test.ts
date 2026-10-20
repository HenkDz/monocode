import { describe, expect, it } from "vitest";
import { ALWAYS_ASK, evaluateLocalToolCall, exactIntegrationJson, type LocalToolCall } from "./localToolPolicy";
import { integrationFixture } from "./localToolFixtures.test-support";

describe("trusted local tool policy", () => {
  it("permits only the exact approved read scope and revision", () => {
    const { call, grant, context } = integrationFixture();
    expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("allow");
    call.args.url = "https://github.com/acme/other/pull/1";
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "scope" });
    call.revision = 2;
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "unknown-tool" });
  });
  it.each(["shell", "proxy", "execute_code", "github.api", "mcp__unknown__read", "delete", "spend", "message-people", "system-settings"])("fails closed for unsupported %s despite an agent-supplied grant", tool => {
    const { call, context, grant } = integrationFixture(); call.tool = tool; grant.tools[0].id = tool;
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "unknown-tool" });
  });
  it("requires user approval for every protected semantic class", () => {
    for (const semantic of ["merge", "spend", "delete", "message-people", "system-settings", "install", "connect"] as const)
      expect(ALWAYS_ASK).toContain(semantic);
    const { call, context, grant } = integrationFixture();
    for (const method of ["merge", "squash", "rebase"]) {
      call.tool = `github.pr.${method}`; grant.tools[0].id = call.tool;
      call.args = { ...call.args, expectedHead: "a".repeat(40), expectedBase: "main" };
      expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "ask", code: "protected", semantic: "merge" });
    }
  });
  it.each(["projectId", "projectPath", "projectIdentity", "monoId", "ownerMonoId", "managerId", "goalId", "goalRequestId", "userMessageId", "requestSessionId", "requesterSessionId", "executionIdentity", "taskId", "dispatchId"] as const)("rejects changed %s", key => {
    const { call, context, grant } = integrationFixture(); context.binding[key] = "changed";
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "stale" });
  });
  it.each(["providerAccountId", "codexStorageHome", "cwd", "worktreeCwd"] as const)("rejects changed session %s", key => {
    const { call, context, grant } = integrationFixture(); context.binding.requesterBinding[key] = "changed";
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "stale" });
  });
  it("rejects Stop, holds, revocation, goal completion, generation and deadlines", () => {
    for (const alter of [
      (fixture: ReturnType<typeof integrationFixture>) => { fixture.context.active = false; },
      (fixture: ReturnType<typeof integrationFixture>) => { fixture.context.held = true; },
      (fixture: ReturnType<typeof integrationFixture>) => { fixture.grant.revoked = true; },
      (fixture: ReturnType<typeof integrationFixture>) => { fixture.context.binding.generation++; },
    ]) { const fixture = integrationFixture(); alter(fixture); expect(evaluateLocalToolCall(fixture.call, fixture.context, fixture.grant, 1000).action).toBe("deny"); }
    const { call, context, grant } = integrationFixture();
    expect(evaluateLocalToolCall(call, context, grant, 5000)).toMatchObject({ action: "deny", code: "expired" });
  });
  it.each(["https://evil.example/acme/project/pull/1", "https://github.com/acme/project/pull/1?next=shell", "https://github.com/acme/../pull/1", "https://github.com/acme/project/pull/0", "https://github.com/acme/project/pull/9007199254740999"])("rejects ambiguous target %s", url => {
    const { call, context, grant } = integrationFixture(); call.args.url = url;
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "invalid-request" });
  });
  it("rejects extra args, agent semantic labels and incomplete identities", () => {
    const { call, context, grant } = integrationFixture();
    call.args.command = "gh api";
    expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("deny");
    delete call.args.command;
    expect(evaluateLocalToolCall({ ...call, semantic: "read" } as LocalToolCall, context, grant, 1000).action).toBe("deny");
    call.binding.taskId = null;
    expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("deny");
  });
  it("binds argument bytes and property order consistently without accepting non-JSON values", () => {
    expect(exactIntegrationJson({ b: [2, 1], a: "value" })).toBe(exactIntegrationJson({ a: "value", b: [2, 1] }));
    for (const value of [undefined, NaN, new Date(), { a: undefined }, { get value() { throw Error("getter ran"); } }]) expect(() => exactIntegrationJson(value)).toThrow();
  });
  it("permits one pinned project read and refuses changed pins or file scope", () => {
    const { call, context, grant, binding } = integrationFixture();
    call.tool = "local-mcp.project.read"; grant.tools[0] = { id: call.tool, revision: 1, scopes: ["file:readme.txt"] };
    call.args = { path: "readme.txt", pin: { projectIdentity: binding.projectIdentity, executionIdentity: binding.executionIdentity, schemaHash: "a".repeat(64) } };
    expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("allow");
    call.args.path = "other.txt"; expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "scope" });
    call.args.path = "../readme.txt"; expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("deny");
    call.args.path = "readme.txt"; (call.args.pin as { projectIdentity: string }).projectIdentity = "other";
    expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("deny");
  });
  it.each(["secret.pem", "SECRET.PEM", "client.key", "STORE.P12", "vault.pfx", "id_rsa.pub", "id_ed25519_backup", "serviceCredentials.JSON", "vault.keystore", ".npmrc", ".pypirc", ".netrc",
    "id_ecdsa.pub", "ID_DSA_BACKUP", "server.ppk", "store.JKS", "key.p8", "vault.kdbx", "terraform.tfstate.backup", "terraform.tfvars.json", ".env.production", "local.env", ".git-credentials", "hosts.yml", "service-account-demo.json", "project-sa.json", "secrets.yaml"])("returns protected-file refusal for %s", path => {
    const { call, context, grant } = integrationFixture(); call.tool = "local-mcp.project.read"; call.args = { path };
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "protected-file" });
  });
  it.each(["CREDEN~1.JSON", "ENV~1", "folder~1/readme.txt"])("refuses filesystem short-name alias %s", path => {
    const { call, context, grant } = integrationFixture(); call.tool = "local-mcp.project.read"; call.args = { path };
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "deny", code: "invalid-request" });
  });
  it.each(["project.skill.install", "project.skill.archive"])("requires explicit approval for %s with exact inspected package and project identity", tool => {
    const { call, context, grant, binding } = integrationFixture(); call.tool = tool;
    grant.tools[0] = { id: tool, revision: 1, scopes: ["project:project"] };
    call.args = { name: "fixture", projectIdentity: binding.projectIdentity, fingerprint: "a".repeat(64), ...(tool.endsWith("install") ? { source: "C:/synthetic/skills/fixture" } : {}) };
    expect(evaluateLocalToolCall(call, context, grant, 1000)).toMatchObject({ action: "ask", code: "protected" });
    call.args.projectIdentity = "other"; expect(evaluateLocalToolCall(call, context, grant, 1000).action).toBe("deny");
  });
});
