// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Integrations } from "./Integrations";
import { IntegrationRequestCard, type IntegrationRequestView } from "./IntegrationRequestCard";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../skills/model/skills", () => ({ invalidateSkills: vi.fn() }));
vi.mock("../../files/model/fileIndex", () => ({ invalidateProjectFiles: vi.fn() }));
let container: HTMLDivElement, root: Root;
const request = (): IntegrationRequestView => ({ id: "request", name: "fixture", requester: "Manager", project: "Synthetic project", projectPath: "C:/synthetic/project", mono: "Atlas", goal: "Read project text",
  provider: "skill", available: true, status: "pending", request: { version: 1, type: "capability-request", kind: "install", service: "skill", source: "C:/synthetic/local", reason: "<script>untrusted reason</script>", tools: ["project.skill.install"], scopes: ["skill:fixture"], deadline: 5000 } });
const inspection = { name: "fixture", declaredName: "fixture", description: "Synthetic description", project: "C:/synthetic/project", projectIdentity: "windows:1:2", source: "C:/synthetic/local", fingerprint: "a".repeat(64), totalBytes: 12,
  files: [{ path: "SKILL.md", bytes: 8 }, { path: "scripts/helper.ps1", bytes: 4 }] };
beforeEach(() => { vi.clearAllMocks(); mocks.invoke.mockResolvedValue(inspection); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;

it("shows only supplied installed skills and proven GitHub CLI access with plain installed copy", async () => {
  const access = request(); access.provider = "local MCP"; access.request = { ...access.request, kind: "access", service: "local-mcp" };
  await act(async () => root.render(<Integrations connected={[
    { id: "skill", name: "fixture", provider: "skill", scope: "Synthetic project", projectPath: "C:/synthetic/project", monos: ["Atlas"], available: true },
    { id: "mcp", name: "Hidden MCP", provider: "local MCP", scope: "project", monos: [], available: true },
    { id: "gh", name: "GitHub", provider: "gh CLI", scope: "project", monos: [], available: true },
  ]} requests={[access]} onRequest={vi.fn()} />));
  expect(container.textContent).toContain("Installed in Synthetic project");
  expect(container.textContent).toContain("Uses your GitHub login on this PC");
  for (const text of ["Available to Atlas", "delivery unverified", "Hidden MCP", "Access request", "Connect", "Call count", "Rules"]) expect(container.textContent).not.toContain(text);
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("explains the empty project list without probing or offering an install", async () => {
  await act(async () => root.render(<Integrations connected={[]} requests={[]} onRequest={vi.fn()} />));
  expect(container.textContent).toContain("When a Manager needs a skill, it'll ask you here. Installed skills show up in this list.");
  expect(container.querySelector("button")).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("inspects exact files without installing, refuses a synthetic Install, and sends Not now as an ordinary answer", async () => {
  const item = request(), onAction = vi.fn(async () => {});
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  expect(container.querySelector("script")).toBeNull();
  expect(button("Install").disabled).toBe(true);
  await act(async () => button("Inspect files").click());
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("inspect_project_skill", { project: item.projectPath, source: item.request.source, name: "fixture" });
  expect(container.textContent).toContain("Synthetic description");
  expect(container.textContent).toContain("scripts/helper.ps1");
  expect(container.textContent).toContain("12 bytes");
  await act(async () => button("Install").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("button yourself");
  await act(async () => button("Not now").click());
  expect(onAction).toHaveBeenCalledExactlyOnceWith(expect.any(Event), item, "later");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  item.status = "completed";
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  expect(container.textContent).not.toContain("Installed in");
});

it("re-inspects installed bytes before enabling Remove and never archives on a synthetic click", async () => {
  await act(async () => root.render(<Integrations connected={[{ id: "skill", name: "fixture", provider: "skill", scope: "Synthetic project", projectPath: "C:/synthetic/project", skillPath: "C:/synthetic/project/.agents/skills/fixture/SKILL.md", monos: ["Atlas"], available: true, skillDelivery: "discovered" }]} requests={[]} onRequest={vi.fn()} />));
  expect(container.textContent).toContain("Available to Atlas");
  expect(button("Remove")).toBeUndefined();
  await act(async () => button("Inspect to remove").click());
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("inspect_project_skill", { project: "C:/synthetic/project", source: "C:/synthetic/project/.agents/skills/fixture", name: "fixture" });
  expect(button("Remove").disabled).toBe(false);
  await act(async () => button("Remove").click());
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("button yourself");
});
