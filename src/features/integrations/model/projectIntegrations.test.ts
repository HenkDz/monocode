import { beforeEach, expect, it, vi } from "vitest";
import { projectSkillRequest, loadProjectIntegrations } from "./projectIntegrations";
import { capabilityDecisionPayload, type InstallCapabilityRequest } from "./integrationCapabilities";
import { decisionAsk } from "../../monos/model/monoDecisions";
import type { Mono } from "../../monos/model/mono";
import { newSession } from "../../sessions/model/session";

const mocks = vi.hoisted(() => ({ list: vi.fn(), github: vi.fn(), catalog: vi.fn(), load: vi.fn(), context: vi.fn() }));
vi.mock("../../../platform/tauri/fs", async original => ({ ...await original<typeof import("../../../platform/tauri/fs")>(), listSkills: mocks.list }));
vi.mock("../../inbox/model/githubTasks", () => ({ githubStatus: mocks.github }));
vi.mock("../../../integrations/harness/core/child", async original => ({ ...await original<typeof import("../../../integrations/harness/core/child")>(), monoCodexSkillsCatalog: mocks.catalog }));
vi.mock("../../skills/model/skills", async original => ({ ...await original<typeof import("../../skills/model/skills")>(), loadSkills: mocks.load }));
vi.mock("../../../app/model/monoSkillsForSession", () => ({ monoSkillsForSession: mocks.context }));
const project = "C:/synthetic/project", path = `${project}/.agents/skills/fixture/SKILL.md`;
const request: InstallCapabilityRequest = { version: 1, type: "capability-request", kind: "install", service: "skill", name: "fixture", source: "C:/synthetic/source/fixture", reason: "Use the fixture", tools: ["project.skill.install"], scopes: ["project:synthetic"], deadline: 5000 };
const roster: Mono[] = [
  { id: "boss", role: "orchestrator", projects: [], mascot: "owl", color: "blue" },
  { id: "manager", role: "manager", reportsTo: "boss", projects: [project], mascot: "fox", color: "blue" },
  { id: "worker", name: "Atlas", role: "member", reportsTo: "manager", projects: [project], sessionId: "worker-chat", mascot: "cat", color: "blue" },
];
const session = { ...newSession("codex", project), id: "worker-chat" };
const decision = decisionAsk({ id: "ask", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "skill", kind: "question", requiresReply: true, text: JSON.stringify(capabilityDecisionPayload(request)), at: 1 }, session.id, project, roster, "high-impact-only")!;
const owned = { managerId: "manager", decision };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([{ name: "fixture", description: "fixture", path, scope: "project", source: "agents" },
    { name: "foreign", path: "C:/other/.agents/skills/foreign/SKILL.md", scope: "project", source: "agents" },
    { name: "user", path: "C:/synthetic/home/SKILL.md", scope: "user", source: "agents" }]);
  mocks.github.mockResolvedValue({ installed: true, authenticated: true });
  mocks.catalog.mockResolvedValue({ skills: [{ id: "fixture-id", name: "fixture", path }], roleDefaults: { worker: [] }, plugins: [] });
  mocks.context.mockReturnValue({ skillsRole: "worker", skillsPolicy: { mode: "custom", enabled: [] } });
  mocks.load.mockResolvedValue([{ kind: "file", name: "fixture", path }]);
});

it("projects only resolvable authenticated install Asks; missing metadata and foreign/stale actors have no target", () => {
  const view = projectSkillRequest(owned, roster, [session], [], []);
  expect(view).toMatchObject({ name: "fixture", requester: "Atlas", projectPath: project, request });
  for (const changed of [{ context: "Install fixture from C:/synthetic/source" }, { readOnly: true }, { projectId: "C:/foreign" },
    { requesterSessionId: "other" }, { requestingMonoId: "other" }, { taskId: "missing" }, { goalId: "missing" }, { noLongerNeededAt: 2 }])
    expect(projectSkillRequest({ ...owned, decision: { ...decision, ...changed } }, roster, [session], [], [])).toBeUndefined();
  expect(projectSkillRequest({ ...owned, decision: { ...decision, status: "answered", answer: "Review install" } }, roster, [session], [], [])).not.toHaveProperty("installedPath");
});

it("loads only real selected-project skills and proven CLI access, preserving Custom until exact selection/discovery agrees", async () => {
  const views = [projectSkillRequest(owned, roster, [session], [], [])!];
  let rows = await loadProjectIntegrations(project, views, [session], [owned]);
  expect(rows.map(row => row.name)).toEqual(["fixture", "GitHub"]);
  expect(rows[0].monos).toEqual([]);
  expect(mocks.load).toHaveBeenCalledWith({ harness: "codex", cwd: project, sessionId: session.id }, { refresh: true });
  const custom = { mode: "custom", enabled: ["fixture-id"] };
  mocks.context.mockReturnValue({ skillsRole: "worker", skillsPolicy: custom });
  rows = await loadProjectIntegrations(project, views, [session], [owned]);
  expect(rows[0]).toMatchObject({ skillDelivery: "discovered", monos: ["Atlas"] });
  expect(custom).toEqual({ mode: "custom", enabled: ["fixture-id"] });
  mocks.load.mockResolvedValue([{ kind: "native", name: "fixture", source: "codex", origin: "project" }]);
  rows = await loadProjectIntegrations(project, views, [session], [owned]);
  expect(rows[0].monos).toEqual([]);
});

it("keeps installed copy plain when the consumer cannot prove delivery and never invents GitHub availability", async () => {
  mocks.github.mockRejectedValue(Error("CLI unavailable")); mocks.catalog.mockRejectedValue(Error("consumer unavailable"));
  const rows = await loadProjectIntegrations(project, [projectSkillRequest(owned, roster, [session], [], [])!], [session], [owned]);
  expect(rows).toHaveLength(1); expect(rows[0].skillDelivery).toBeUndefined(); expect(rows[0].monos).toEqual([]);
});
