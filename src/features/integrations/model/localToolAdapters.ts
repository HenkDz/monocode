import { invoke } from "@tauri-apps/api/core";
import { invalidateSkills } from "../../skills/model/skills";
import { invalidateProjectFiles } from "../../files/model/fileIndex";
import { validateLocalToolCall, type LocalToolCall } from "./localToolPolicy";

export type ProjectMcpPin = { projectIdentity: string; executionIdentity: string; schemaHash: string };
export type ProjectSkillInspection = { name: string; declaredName: string; description: string; project: string; projectIdentity: string; source: string; fingerprint: string;
  files: { path: string; bytes: number }[]; totalBytes: number };

/** Explicit UI inspection only; mounting an integration page never scans profiles. */
export function inspectLocalProjectSkill(project: string, source: string, name: string): Promise<ProjectSkillInspection> {
  return invoke<ProjectSkillInspection>("inspect_project_skill", { project, source, name });
}
export function inspectLocalProjectMcp(project: string): Promise<ProjectMcpPin> {
  return invoke<ProjectMcpPin>("inspect_project_mcp", { project });
}

export async function executeLocalNativeTool(call: LocalToolCall, validate: () => void, signal: AbortSignal): Promise<unknown> {
  const captured = structuredClone(call);
  const { tool } = validateLocalToolCall(captured);
  // shortcut: gh stays existing local CLI access until atomic native account custody is implemented.
  if (tool.id.startsWith("github.")) throw Error("Existing local CLI access · account not pinned. Governed GitHub execution is unavailable.");
  const check = () => { validate(); if (signal.aborted) throw Error("Local operation cancelled"); };
  check();
  if (tool.id === "local-mcp.project.read") {
    let cancellation: Promise<{ error?: unknown }> | undefined;
    const cancel = () => { cancellation = invoke("cancel_project_mcp", { operationId: captured.requestId }).then(() => ({}), error => ({ error })); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      check();
      const result = await invoke("read_project_mcp", { request: { operationId: captured.requestId, project: captured.binding.projectPath,
        path: captured.args.path, pin: captured.args.pin, deadline: Math.min(captured.binding.deadline, Date.now() + 30_000) } });
      check(); return result;
    } finally {
      signal.removeEventListener("abort", cancel);
      const cancelled = await cancellation;
      if (cancelled?.error) throw Error(`Native MCP cancellation failed: ${String(cancelled.error)}`);
    }
  }
  const args = captured.args as { name: string; source?: string; projectIdentity: string; fingerprint: string };
  check();
  const result = await invoke(tool.id === "project.skill.install" ? "install_project_skill" : "archive_project_skill", {
    project: captured.binding.projectPath, name: args.name, ...(args.source ? { source: args.source } : {}),
    expectedProjectIdentity: args.projectIdentity, expectedFingerprint: args.fingerprint,
  });
  check();
  invalidateSkills({ cwd: captured.binding.projectPath }); invalidateProjectFiles(captured.binding.projectPath);
  return result;
}
