// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useDeliveryWatch } from "./useDeliveryWatch";
import type { OrchestrationRun } from "./orchestrationState";

const { gitPrStatus, gitBranches, fetchGithubPrChecks, maintainDelivery, discoverDeliveryPr } = vi.hoisted(() => ({
  gitPrStatus: vi.fn(), gitBranches: vi.fn(), fetchGithubPrChecks: vi.fn(), maintainDelivery: vi.fn(async () => {}), discoverDeliveryPr: vi.fn(async () => true),
}));
vi.mock("../../../platform/tauri/fs", () => ({ gitPrStatus, gitBranches, gitPrStatusByUrl: gitPrStatus }));
vi.mock("./orchestration", () => ({ orchestrator: { maintainDelivery, discoverDeliveryPr } }));
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

it("maintains delivery from the cached PR summary without fetching detailed checks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const run = { leadId: "manager", projectManager: true, tasks: [{ id: "task", prUrl: "https://github.com/acme/app/pull/7", workspace: { checkoutCwd: "/worker" } }] } as OrchestrationRun;
  gitPrStatus.mockResolvedValue({ url: run.tasks[0].prUrl, state: "open", headOid: "head", checksStatus: "success", mergeable: "MERGEABLE" });
  function Consumer() { useDeliveryWatch([run]); return null; }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Consumer)));
  expect(fetchGithubPrChecks).not.toHaveBeenCalled();
  expect(maintainDelivery).toHaveBeenCalledWith("manager", "task", { head: "head", ci: "pass", conflicts: false, mergeable: true });
});

it("discovers the completed worker's open PR before Manager review", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const run = { leadId: "manager", projectManager: true, tasks: [{ id: "task", status: "completed", accepted: false, workspace: { checkoutCwd: "/worker", branch: "work" } }] } as OrchestrationRun;
  const pr = { url: "https://github.com/acme/app/pull/7", state: "open", headOid: "head", mergeable: "MERGEABLE" };
  gitPrStatus.mockResolvedValue(pr);
  gitBranches.mockResolvedValue({ current: "work", detached: false });
  fetchGithubPrChecks.mockResolvedValue({ headOid: "head", checks: [{ state: "pass" }] });
  function Consumer() { useDeliveryWatch([run]); return null; }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Consumer)));
  expect(discoverDeliveryPr).toHaveBeenCalledWith("manager", "task", pr, "work");
  expect(maintainDelivery).toHaveBeenCalledWith("manager", "task", { head: "head", ci: "pass", conflicts: false, mergeable: true });
});

it("ignores terminal check responses when the parallel PR fetch still reports open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const run = { leadId: "manager", projectManager: true, tasks: [{ id: "task", prUrl: "https://github.com/acme/app/pull/7", workspace: { checkoutCwd: "/worker" } }] } as OrchestrationRun;
  gitPrStatus.mockResolvedValue({ url: run.tasks[0].prUrl, state: "open", headOid: "head" });
  for (const state of ["merged", "closed"]) {
    fetchGithubPrChecks.mockResolvedValue({ state, headOid: "head", checks: [{ state: "fail" }] });
    function Consumer() { useDeliveryWatch([run]); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Consumer)));
    expect(maintainDelivery).not.toHaveBeenCalled();
    act(() => root.unmount());
  }
});
