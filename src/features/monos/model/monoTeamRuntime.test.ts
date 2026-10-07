import { expect, it, vi } from "vitest";
import { monoTeamHost } from "./monoTeamRuntime";
import { discoverOrchestrationSettings } from "../../orchestration/model/orchestrationCatalog";
import { orchestrator } from "../../orchestration/model/orchestration";

vi.mock("../../orchestration/model/orchestrationCatalog", () => ({ discoverOrchestrationSettings: vi.fn(async () => { throw Error("No installed providers"); }) }));
vi.mock("../../orchestration/model/orchestration", () => ({ orchestrator: { snapshot: () => [
  { leadId: "own", ownerMonoId: "manager", tasks: [{ id: "active", memberId: "member", status: "running", title: "Work" }, { id: "done", memberId: "member", status: "completed" }] },
  { leadId: "other", ownerMonoId: "other", tasks: [{ id: "foreign", memberId: "member", status: "queued" }] },
], cancelTask: vi.fn(async () => {}) } }));

it("allows maintenance and cancellation without providers while hiring still requires them", async () => {
  const host = await monoTeamHost("manager");
  expect(discoverOrchestrationSettings).not.toHaveBeenCalled();
  expect(host.currentTasks?.("member")).toEqual([{ id: "active", title: "Work", status: "running" }]);
  await host.cancelMemberTasks("member");
  expect(orchestrator.cancelTask).toHaveBeenCalledExactlyOnceWith("own", "active");
  await expect(monoTeamHost("manager", true)).rejects.toThrow("No installed providers");
});
