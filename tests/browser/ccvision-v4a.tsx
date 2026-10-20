import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { Integrations, type ConnectedIntegration } from "../../src/features/integrations/ui/Integrations";
import type { IntegrationRequestView } from "../../src/features/integrations/ui/IntegrationRequestCard";
import "../../src/features/integrations/ui/integrations.css";

const project = "C:/synthetic/v4a-project";
const fixture = { calls: [] as { command: string; args: Record<string, unknown> }[], logs: [] as string[], answers: [] as string[], changed: false, pending: false, finish: () => {} };
Object.assign(window, { v4a: fixture });
const inspection = { name: "fixture", declaredName: "fixture", description: "Synthetic skill package", project, projectIdentity: "windows:1:2", source: "C:/synthetic/local/fixture", fingerprint: "a".repeat(64), files: [{ path: "SKILL.md", bytes: 12 }], totalBytes: 12 };
mockIPC(async (command, args) => {
  if (!["inspect_project_skill", "install_project_skill", "archive_project_skill"].includes(command)) throw Error(`Unexpected native command: ${command}`);
  fixture.calls.push({ command, args: args as Record<string, unknown> });
  if (command === "inspect_project_skill") return { ...inspection, name: args?.name, declaredName: args?.name, source: args?.source };
  if (command === "install_project_skill") {
    if (fixture.changed) throw Error("Project or skill source changed; inspect it again before approving");
    if (fixture.pending) await new Promise<void>(resolve => { fixture.finish = resolve; });
    return inspection;
  }
  return `${project}/.agents/skill-archive/fixture-synthetic`;
});

const suggestion: IntegrationRequestView = { id: "install", name: "fixture", requester: "Manager", project: "Synthetic project", projectPath: project, mono: "Atlas", goal: "Read fixture", provider: "skill", available: true, status: "pending",
  request: { version: 1, type: "capability-request", kind: "install", service: "skill", reason: "Read a synthetic package", source: inspection.source, tools: ["project.skill.install"], scopes: ["skill:fixture"], deadline: Date.now() + 60_000 } };
function Fixture() {
  const [requests, setRequests] = useState([suggestion, { ...suggestion, id: "duplicate" }]);
  const connected: ConnectedIntegration[] = [{ id: "installed", name: "installed-fixture", provider: "skill", scope: "Synthetic project", projectPath: project, skillPath: `${project}/.agents/skills/installed-fixture/SKILL.md`, monos: [], available: true },
    { id: "gh", name: "GitHub", provider: "gh CLI", scope: "project", monos: [], available: true },
    { id: "mcp", name: "Hidden MCP", provider: "local MCP", scope: "project", monos: [], available: true }];
  return <Integrations connected={connected} requests={requests} onRequest={async (_event, item) => {
      fixture.answers.push("Not now"); setRequests(items => items.map(request => request.id === item.id ? { ...request, status: "declined" } : request));
    }} onLog={async line => { fixture.logs.push(line); if (new URLSearchParams(location.search).has("log-fails")) throw Error("synthetic log failure"); }} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
