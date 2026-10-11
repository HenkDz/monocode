// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation } from "../../automations/model/automations";
import type { TrackedCiRepair } from "../../inbox/model/ciRepairTracking";
import { MissionControl } from "./MissionControl";
import { listAutomations } from "../../automations/model/automations";

let repairs: TrackedCiRepair[] = [];
let automations: Automation[] = [];
const repairListeners = new Set<() => void>();
const automationListeners = new Set<() => void>();
vi.mock("../../monos/model/mono", async importOriginal => ({ ...await importOriginal<object>(), listMonos: () => [], monosSnapshot: () => "", subscribeMonos: () => () => {} }));
vi.mock("../../monos/model/monoManagerGoals", () => ({ monoManagerGoals: { goals: () => [], snapshot: () => "", subscribe: () => () => {} } }));
vi.mock("../../inbox/model/ciRepairTracking", () => ({ getCiRepairs: () => repairs, subscribeCiRepairs: (listener: () => void) => { repairListeners.add(listener); return () => repairListeners.delete(listener); } }));
vi.mock("../../automations/model/automations", () => ({ peekAutomations: () => automations, listAutomations: vi.fn(async () => automations), subscribeAutomations: (listener: () => void) => { automationListeners.add(listener); return () => automationListeners.delete(listener); } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
const automation: Automation = { id: "synthetic-automation", name: "Release checks", prompt: "Fixture", harness: "codex", model: "fixture", cwd: "C:/synthetic/Atlas", workspaceMode: "current", reuseSession: false,
  runtimeMode: "supervised", triggerKind: "time", triggerEvent: "", scheduleKind: "hourly", minute: 0, time: "00:00", dayOfWeek: 0, missedRunGraceMinutes: 0,
  enabled: true, nextRunAt: 0, lastRunAt: 1000, lastRunStatus: "failed", lastRunError: "Synthetic failure", createdAt: 0, updatedAt: 1000 };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear(); repairs = []; automations = []; repairListeners.clear(); automationListeners.clear(); vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (open = true, onOpenTarget = vi.fn()) => root.render(<MissionControl sessions={[]} runs={[]} open={open} onClose={() => {}} onOpenTarget={onOpenTarget} renderAttention={() => <p>Existing queue hosted here</p>} />);

describe("Cockpit existing attention sources", () => {
  it("shows automation-only failures and opens the panel when there is no conversation", async () => {
    automations = [automation]; const target = vi.fn();
    await act(async () => render(true, target));
    expect(host.querySelector(".mc-attention")?.textContent).toContain("Release checks · automation failed");
    await act(async () => host.querySelector<HTMLButtonElement>(".mc-attention button")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Existing queue hosted here"); expect(target).not.toHaveBeenCalled();
  });
  it("subscribes to tracked CI failures even when the team has zero goals", async () => {
    await act(async () => render());
    expect(host.querySelector(".mc-attention")).toBeNull();
    await act(async () => {
      repairs = [{ id: "synthetic-repair", cwd: "C:/synthetic/Atlas", sessionId: "repair-chat", repo: "fixture/atlas", number: 7, headOid: "fixture-head", checks: [], startedAt: 1000, phase: "failed" }];
      repairListeners.forEach(listener => listener());
    });
    expect(host.querySelector(".mc-attention")?.textContent).toContain("CI repair failed");
    expect(host.querySelector(".mc-flight-strip")?.textContent).toContain("No live goals");
  });
  it("refreshes automation changes, reports real refresh failures, and releases listeners", async () => {
    await act(async () => render(false)); expect(listAutomations).not.toHaveBeenCalled();
    await act(async () => render()); expect(listAutomations).toHaveBeenCalledOnce();
    await act(async () => { automations = [automation]; automationListeners.forEach(listener => listener()); });
    expect(host.querySelector(".mc-attention")?.textContent).toContain("automation failed");
    vi.mocked(listAutomations).mockRejectedValueOnce(Error("Synthetic load failure"));
    await act(async () => automationListeners.forEach(listener => listener()));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Synthetic load failure");
    await act(async () => render(false)); expect(automationListeners.size).toBe(0);
  });
});
