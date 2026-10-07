// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useDeliveryWatch } from "./useDeliveryWatch";
import type { OrchestrationRun } from "./orchestrationState";

const { gitPrStatus, fetchGithubPrChecks, maintainDelivery } = vi.hoisted(() => ({
  gitPrStatus: vi.fn(), fetchGithubPrChecks: vi.fn(), maintainDelivery: vi.fn(async () => {}),
}));
vi.mock("../../../platform/tauri/fs", () => ({ gitPrStatus }));
vi.mock("./orchestration", () => ({ orchestrator: { maintainDelivery } }));
vi.mock("../../inbox/model/githubPrChecks", async importOriginal => ({
  ...await importOriginal<object>(), fetchGithubPrChecks,
}));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("watches a PR outside Activity, ignores mixed heads, and stops after unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const run = { leadId: "manager", projectManager: true, tasks: [{ id: "task", prUrl: "https://github.com/acme/app/pull/7", workspace: { checkoutCwd: "/worker" } }] } as OrchestrationRun;
  gitPrStatus.mockResolvedValue({ url: run.tasks[0].prUrl, state: "open", headOid: "head", mergeable: "CONFLICTING" });
  fetchGithubPrChecks.mockResolvedValue({ headOid: "head", checks: [{ state: "fail" }] });
  function Consumer() { useDeliveryWatch([run]); return null; }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Consumer)));
  expect(maintainDelivery).toHaveBeenCalledWith("manager", "task", { head: "head", ci: "fail", conflicts: true, mergeable: false });
  act(() => root.unmount());
  roots.pop();
  maintainDelivery.mockClear();
  fetchGithubPrChecks.mockResolvedValue({ headOid: "other", checks: [{ state: "pass" }] });
  const second = createRoot(document.createElement("div"));
  roots.push(second);
  await act(async () => second.render(createElement(Consumer)));
  expect(maintainDelivery).not.toHaveBeenCalled();
});
