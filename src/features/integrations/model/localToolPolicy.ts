import type { managerRequestBinding } from "../../monos/model/managerAuthorizedWork";

/** Captured by the authenticated host, never accepted from tool arguments. */
export type IntegrationBinding = {
  projectId: string; projectPath: string; projectIdentity: string; ownerMonoId: string; managerId: string; monoId: string;
  goalId: string; goalRequestId: string; userMessageId: string;
  requestSessionId: string; requesterSessionId: string; generation: number;
  requestBinding: ReturnType<typeof managerRequestBinding>;
  requesterBinding: ReturnType<typeof managerRequestBinding>;
  taskId: string | null; dispatchId: string | null; deadline: number;
  /** Native-verified executable, config revision and actual service account, not a display label. */
  executionIdentity: string;
};

export type LocalToolCall = {
  requestId: string; tool: string; revision: number;
  args: Record<string, unknown>; binding: IntegrationBinding;
};
export type IntegrationGrant = {
  id: string; binding: IntegrationBinding; expiresAt: number; revoked: boolean;
  tools: { id: string; revision: number; scopes: string[] }[];
};
export type IntegrationContext = { binding: IntegrationBinding; active: boolean; held: boolean };
export type ToolSemantic = "read" | "routine-write" | "merge" | "spend" | "delete" | "message-people" | "system-settings" | "install" | "connect";
export const ALWAYS_ASK: readonly ToolSemantic[] = ["merge", "spend", "delete", "message-people", "system-settings", "install", "connect"];

// New tools require trusted source validators and a reviewed adapter, never MCP annotations or agent labels.
export const LOCAL_TOOLS = [
  { id: "github.pr.read", revision: 1, label: "Read pull request", provider: "gh CLI", semantic: "read" },
  { id: "github.pr.merge", revision: 1, label: "Merge pull request", provider: "gh CLI", semantic: "merge" },
  { id: "github.pr.squash", revision: 1, label: "Squash and merge", provider: "gh CLI", semantic: "merge" },
  { id: "github.pr.rebase", revision: 1, label: "Rebase and merge", provider: "gh CLI", semantic: "merge" },
  { id: "local-mcp.project.read", revision: 1, label: "Read approved project text file", provider: "local MCP", semantic: "read" },
  { id: "project.skill.install", revision: 1, label: "Install inspected local project skill", provider: "skill", semantic: "install" },
  { id: "project.skill.archive", revision: 1, label: "Archive installed project skill", provider: "skill", semantic: "delete" },
] as const;
export type LocalToolId = typeof LOCAL_TOOLS[number]["id"];

export function isProtectedProjectFile(path: string): boolean {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  return [".pem", ".key", ".p12", ".pfx", ".keystore", ".ppk", ".jks", ".p8", ".kdbx", ".env"].some(suffix => name.endsWith(suffix)) ||
    ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", ".env", "secrets."].some(prefix => name.startsWith(prefix)) ||
    name.includes("credentials") && name.endsWith(".json") || name.includes(".tfstate") || name.includes(".tfvars") ||
    name.startsWith("service-account") && name.endsWith(".json") || name.endsWith("-sa.json") ||
    [".npmrc", ".pypirc", ".netrc", ".git-credentials", "hosts.yml"].includes(name);
}

export function validateProjectReadPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || path.length > 512 || path.split("/").some(part => !part || part.startsWith(".") ||
      /[. ]$/.test(part) || /[\x00-\x1f\x7f<>:"\\|?*~]/.test(part))) throw Error("Choose an exact non-hidden project-relative text file without traversal");
  if (isProtectedProjectFile(path)) throw Error("Protected credential or token file");
}

/** Bounded plain JSON only: preserve arguments exactly, including array order. */
export function exactIntegrationJson(value: unknown, depth = 0): string {
  if (depth > 24) throw Error("Integration payload is too deep");
  if (value === null || typeof value === "boolean" || typeof value === "string" ||
      typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, item => exactIntegrationJson(item, depth + 1)).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    throw Error("Integration payload must be plain JSON");
  const fields = Object.keys(value).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) throw Error("Integration payload cannot contain accessors");
    return `${JSON.stringify(key)}:${exactIntegrationJson(descriptor.value, depth + 1)}`;
  });
  const result = `{${fields.join(",")}}`;
  if (result.length > 32_768) throw Error("Integration payload is too large");
  return result;
}

export function githubPrScope(args: Record<string, unknown>): string {
  if (typeof args.url !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(args.url))
    throw Error("Choose an exact GitHub pull request URL");
  const url = new URL(args.url);
  const [, owner, repo, , number] = url.pathname.split("/");
  if ([".", ".."].includes(repo) || !Number.isSafeInteger(Number(number))) throw Error("Invalid GitHub target");
  return `repo:github.com/${owner}/${repo}`.toLowerCase();
}

export function validateLocalToolCall(call: LocalToolCall) {
  if (!call || Object.keys(call).some(key => !["requestId", "tool", "revision", "args", "binding"].includes(key)) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(call.requestId)) throw Error("Invalid integration request");
  const tool = LOCAL_TOOLS.find(tool => tool.id === call.tool && tool.revision === call.revision);
  if (!tool) throw Error("Unknown or unsupported integration tool");
  const args = call.args;
  if (!args || Object.getPrototypeOf(args) !== Object.prototype) throw Error("Invalid tool arguments");
  const github = tool.id.startsWith("github.");
  const fields = github ? tool.semantic === "read" ? ["url"] : ["url", "expectedHead", "expectedBase"]
    : tool.id === "local-mcp.project.read" ? ["path", "pin"]
    : tool.id === "project.skill.install" ? ["source", "name", "projectIdentity", "fingerprint"] : ["name", "projectIdentity", "fingerprint"];
  if (Object.keys(args).length !== fields.length || Object.keys(args).some(key => !fields.includes(key))) throw Error("Unexpected tool arguments");
  let scope: string;
  if (github) scope = githubPrScope(args);
  else if (tool.id === "local-mcp.project.read") {
    validateProjectReadPath(args.path);
    const pin = args.pin as Record<string, unknown>;
    if (!pin || Object.getPrototypeOf(pin) !== Object.prototype || Object.keys(pin).length !== 3 ||
        Object.keys(pin).some(key => !["projectIdentity", "executionIdentity", "schemaHash"].includes(key)) ||
        pin.projectIdentity !== call.binding.projectIdentity || pin.executionIdentity !== call.binding.executionIdentity ||
        typeof pin.schemaHash !== "string" || !/^[0-9a-f]{64}$/.test(pin.schemaHash)) throw Error("Project MCP pin changed or is incomplete");
    scope = `file:${args.path}`;
  } else {
    if (typeof args.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name) || args.name.length > 64 ||
        typeof args.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(args.fingerprint) || args.projectIdentity !== call.binding.projectIdentity)
      throw Error("Skill inspection or project identity changed");
    if (tool.id === "project.skill.install" && (typeof args.source !== "string" || args.source.length > 2048 ||
        !/^[A-Za-z]:[/\\]/.test(args.source) || /[\x00-\x1f\x7f]/.test(args.source) || args.source.replace(/\\/g, "/").split("/").includes("..")))
      throw Error("Choose an already-present absolute local skill source");
    scope = `project:${call.binding.projectId}`;
  }
  if (tool.semantic === "merge" && (typeof args.expectedHead !== "string" || !/^[0-9a-f]{40}$/.test(args.expectedHead) ||
      typeof args.expectedBase !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,254}$/.test(args.expectedBase)))
    throw Error("Merge requires the displayed exact head and base");
  exactIntegrationJson(call);
  return { tool, scope };
}

export type LocalPolicyReason = "unknown-tool" | "invalid-request" | "scope" | "expired" | "stale" | "protected" | "protected-file";
export type LocalPolicyResult = { action: "deny"; code: LocalPolicyReason; reason: string } |
  { action: "allow" | "ask"; code?: "protected"; reason?: string; semantic: ToolSemantic; scope: string; fingerprint: string };

export function evaluateLocalToolCall(call: LocalToolCall, context: IntegrationContext, grant: IntegrationGrant, now: number): LocalPolicyResult {
  try {
    if (!LOCAL_TOOLS.some(tool => tool.id === call?.tool && tool.revision === call?.revision))
      return { action: "deny", code: "unknown-tool", reason: "Unknown tool or revision. Request an approved exact capability; do not retry this call." };
    if (call.tool === "local-mcp.project.read" && typeof call.args?.path === "string" && isProtectedProjectFile(call.args.path))
      return { action: "deny", code: "protected-file", reason: "Project read refuses known credential and token filenames. Choose a non-secret project file." };
    const { tool, scope } = validateLocalToolCall(call);
    const binding = call.binding;
    const ids = ["projectId", "projectPath", "projectIdentity", "ownerMonoId", "managerId", "monoId", "goalId", "goalRequestId", "userMessageId", "requestSessionId", "requesterSessionId", "executionIdentity"] as const;
    if (!binding || ids.some(key => typeof binding[key] !== "string" || !binding[key].trim() || binding[key].length > 2048) ||
        ![binding.taskId, binding.dispatchId].every(id => id === null || typeof id === "string" && !!id.trim()) ||
        (binding.taskId === null) !== (binding.dispatchId === null)) throw Error("Incomplete integration identity");
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(binding.deadline) || binding.deadline <= now ||
        !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt < binding.deadline)
      return { action: "deny", code: "expired", reason: "Capability deadline expired or changed. Request fresh access for the current goal." };
    if (!context.active || context.held ||
        grant.revoked !== false || !grant.id || !binding.executionIdentity || !binding.projectPath ||
        !binding.projectId || !binding.ownerMonoId || !binding.managerId || !binding.monoId || !binding.goalId ||
        !binding.goalRequestId || !binding.userMessageId || !binding.requestSessionId || !binding.requesterSessionId ||
        !Number.isSafeInteger(binding.generation) || binding.generation < 0 ||
        !binding.requestBinding || !binding.requesterBinding ||
        exactIntegrationJson(binding) !== exactIntegrationJson(context.binding) ||
        exactIntegrationJson(binding) !== exactIntegrationJson(grant.binding))
      return { action: "deny", code: "stale", reason: "Goal, account, home or session authority changed or is held. Request fresh access from the current context." };
    if (!grant.tools.some(entry => entry.id === tool.id && entry.revision === tool.revision && entry.scopes.includes(scope)))
      return { action: "deny", code: "scope", reason: "Tool or target is outside the approved capability. Request access to this exact target." };
    const protectedTool = ALWAYS_ASK.includes(tool.semantic);
    return { action: protectedTool ? "ask" : "allow", ...(protectedTool ? { code: "protected" as const,
      reason: "This operation needs the user's direct explicit approval; a decision answer is not execution permission." } : {}), semantic: tool.semantic, scope,
      fingerprint: exactIntegrationJson({ call, grantId: grant.id }) };
  } catch (error) {
    return { action: "deny", code: "invalid-request", reason: error instanceof Error ? error.message : "Invalid integration authority" };
  }
}
