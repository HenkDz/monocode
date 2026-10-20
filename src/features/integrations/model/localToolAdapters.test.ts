import { beforeEach, expect, it, vi } from "vitest";
import { integrationFixture } from "./localToolFixtures.test-support";
import { executeLocalNativeTool } from "./localToolAdapters";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), skills: vi.fn(), files: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../skills/model/skills", () => ({ invalidateSkills: mocks.skills }));
vi.mock("../../files/model/fileIndex", () => ({ invalidateProjectFiles: mocks.files }));
beforeEach(() => { vi.clearAllMocks(); mocks.invoke.mockResolvedValue({ content: "synthetic" }); });

it("refuses governed gh execution without an atomic native account path", async () => {
  const { call } = integrationFixture();
  call.tool = "github.pr.merge"; call.args = { url: "https://github.com/acme/project/pull/1", expectedHead: "a".repeat(40), expectedBase: "main" };
  await expect(executeLocalNativeTool(call, vi.fn(), new AbortController().signal)).rejects.toThrow("account not pinned");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("keeps agent and durable broker paths unbound for skill installation", async () => {
  const { call } = integrationFixture(); call.tool = "project.skill.install";
  call.args = { source: "C:/synthetic/local/fixture", name: "fixture", projectIdentity: call.binding.projectIdentity, fingerprint: "a".repeat(64) };
  await expect(executeLocalNativeTool(call, vi.fn(), new AbortController().signal)).rejects.toThrow("button yourself");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("keeps archive unbound from the agent path, including stopped calls", async () => {
  const { call } = integrationFixture(); call.tool = "project.skill.archive";
  call.args = { name: "fixture", projectIdentity: call.binding.projectIdentity, fingerprint: "a".repeat(64) };
  const controller = new AbortController(); controller.abort();
  await expect(executeLocalNativeTool(call, vi.fn(), controller.signal)).rejects.toThrow("button yourself");
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("cancels the original owned MCP request and suppresses late result egress", async () => {
  const { call } = integrationFixture(); call.tool = "local-mcp.project.read";
  call.args = { path: "readme.txt", pin: { projectIdentity: call.binding.projectIdentity, executionIdentity: call.binding.executionIdentity, schemaHash: "a".repeat(64) } };
  let finish!: (result: unknown) => void;
  mocks.invoke.mockImplementation(command => command === "read_project_mcp" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
  const controller = new AbortController(); const pending = executeLocalNativeTool(call, vi.fn(), controller.signal);
  controller.abort(); finish({ content: "late local data" });
  await expect(pending).rejects.toThrow("cancelled");
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_project_mcp", { operationId: call.requestId });
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "read_project_mcp")).toHaveLength(1);
});
it("surfaces native cancellation failure while keeping the late result suppressed", async () => {
  const { call } = integrationFixture(); call.tool = "local-mcp.project.read";
  call.args = { path: "readme.txt", pin: { projectIdentity: call.binding.projectIdentity, executionIdentity: call.binding.executionIdentity, schemaHash: "a".repeat(64) } };
  let finish!: (result: unknown) => void;
  mocks.invoke.mockImplementation(command => command === "read_project_mcp" ? new Promise(resolve => { finish = resolve; }) : Promise.reject(Error("cancel transport failed")));
  const controller = new AbortController(); const pending = executeLocalNativeTool(call, vi.fn(), controller.signal);
  controller.abort(); finish({ content: "late local data" });
  await expect(pending).rejects.toThrow("cancel transport failed");
});
