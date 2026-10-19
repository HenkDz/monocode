import { parseDecisionPayload, type DecisionPayload } from "../../monos/model/monoDecisions";
import { LOCAL_TOOLS, exactIntegrationJson } from "./localToolPolicy";

export type CapabilityRequest = {
  version: 1; type: "capability-request";
  kind: "access" | "install" | "merge";
  service: "github" | "local-mcp" | "skill";
  reason: string; tools: string[]; scopes: string[]; deadline: number;
  /** Local source references are evidence for inspection, never permission to copy. */
  name?: string; source?: string;
};
export type InstallCapabilityRequest = CapabilityRequest & { kind: "install"; service: "skill"; name: string; source: string };

export function parseCapabilityRequest(value: unknown): CapabilityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid capability request");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["version", "type", "kind", "service", "reason", "tools", "scopes", "deadline", "name", "source"].includes(key)) ||
      raw.version !== 1 || raw.type !== "capability-request" || !["access", "install", "merge"].includes(String(raw.kind)) ||
      !["github", "local-mcp", "skill"].includes(String(raw.service))) throw Error("Unsupported capability request");
  if (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 2000 ||
      !Number.isSafeInteger(raw.deadline) || Number(raw.deadline) <= 0) throw Error("A reason and exact deadline are required");
  for (const field of ["tools", "scopes"]) {
    const entries = raw[field];
    if (!Array.isArray(entries) || !entries.length || entries.length > 16 || new Set(entries).size !== entries.length ||
        entries.some(entry => typeof entry !== "string" || !entry.trim() || entry.length > 300 || /[\x00-\x1f\x7f]/.test(entry)))
      throw Error(`Choose one to sixteen exact ${field}`);
  }
  if (raw.source !== undefined && (typeof raw.source !== "string" || !raw.source.trim() || raw.source.length > 1000)) throw Error("Invalid local source");
  if (raw.kind === "install" ? raw.service !== "skill" || !raw.source : raw.service === "skill") throw Error("Only local skills can be installed");
  if (raw.kind === "install") {
    if (typeof raw.name !== "string" || raw.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.name)) throw Error("Choose an explicit skill name");
    const source = raw.source as string;
    if (!/^[A-Za-z]:[/\\]/.test(source) || /[\x00-\x1f\x7f]/.test(source) || source.replace(/\\/g, "/").split("/").includes(".."))
      throw Error("Choose an already-present absolute local skill source");
  } else if (raw.name !== undefined) throw Error("Only install requests carry a skill name");
  if (raw.kind === "merge" && raw.service !== "github") throw Error("Merge requests require an exact GitHub target");
  exactIntegrationJson(raw);
  return structuredClone(raw) as CapabilityRequest;
}

/** The actual reporting chain and identity are added by the existing authenticated decision host. */
export function capabilityDecisionPayload(request: CapabilityRequest): DecisionPayload {
  const parsed = parseCapabilityRequest(request);
  const install = parsed.kind === "install", merge = parsed.kind === "merge";
  return parseDecisionPayload({ version: 1, type: "decision", question: `${install ? "Install" : merge ? "Review merge access for" : "Connect"} ${install ? parsed.name : parsed.service}?`,
    impact: "high", context: install ? JSON.stringify(parsed) : parsed.reason, operation: install ? "install" : merge ? "merge" : "sign-in",
    options: [{ id: "review", label: install ? "Review install" : merge ? "Review pull request" : "Review connection" },
      { id: "later", label: "Not now" }] });
}

/** Evidence for an Inspect card only; requester/project identity comes from the authenticated Ask. */
export function installCapabilityRequest(decision: Pick<DecisionPayload, "operation" | "context">): InstallCapabilityRequest | undefined {
  if (decision.operation !== "install" || typeof decision.context !== "string" || decision.context.length > 2000) return;
  try {
    const request = parseCapabilityRequest(JSON.parse(decision.context));
    if (request.kind === "install") return request as InstallCapabilityRequest;
  } catch { /* Legacy prose or malformed metadata never supplies an install target. */ }
}

export function capabilityDecisionReason(decision: Pick<DecisionPayload, "operation" | "context">): string {
  return installCapabilityRequest(decision)?.reason ?? decision.context;
}

export function capabilityToolLabel(id: string): string {
  return LOCAL_TOOLS.find(tool => tool.id === id)?.label ?? `${id} (unavailable until approved)`;
}

export const LOCAL_RESULT_NOTICE = "Runs locally. Selected results may be sent to the AI provider.";
export const BROKER_SCOPE_NOTICE = "These rules apply to tools MonoCode runs for your team. Agents' own terminals, MCP and CLI tools follow their permission mode.";
export const TOKEN_CUSTODY_NOTICE = "Existing CLI and local MCP credentials stay in their current storage. Same-user shell or network access can bypass this broker; it is not a machine sandbox.";

/** Feed its signature through the existing retained request receipt/digest, not a new notification store. */
export function integrationWorkLine(tool: string, result: { action: "deny" | "ask"; code?: string }): string {
  return `${tool.replace(/[\r\n\t]/g, " ").slice(0, 100)} · ${result.action === "ask" ? "needs your approval" : `blocked (${result.code ?? "invalid-request"})`}`;
}
