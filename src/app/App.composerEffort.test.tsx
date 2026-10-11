// @vitest-environment happy-dom
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findMono, monoForSession, updateMono } from "../features/monos/model/mono";
import { switchMonoRoleEffort } from "../features/monos/model/monoRoleEffort";
import { lockMonoField } from "../features/monos/model/monoTeam";
import {
  modelEffortSetting,
  resetHarnessModelOverlays,
  resolveModel,
  setHarnessModels,
  type AgentModel,
} from "../features/sessions/model/models";
import type { Session } from "../features/sessions/model/session";
import { Composer } from "../features/sessions/ui/Composer";
import { clearMcpSettingsCache } from "../features/settings/model/mcpSettingsCache";
import { saveModelControls } from "../features/settings/model/settings";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => []),
}));
vi.mock("../features/sessions/hooks/useFileDrop", () => ({
  useFileDrop: () => false,
}));
vi.mock("../features/source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({ branches: null, settled: true }),
}));
vi.mock("../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => {},
}));
vi.mock("../integrations/harness/core/registry", () => ({
  getHarness: () => undefined,
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

type Resident = Pick<
  Session,
  "id" | "harness" | "model" | "modelSettings" | "effortSource"
>;
let syntheticHome: string;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  syntheticHome = mkdtempSync(join(tmpdir(), "monocode-composer-effort-"));
  for (const name of ["HOME", "USERPROFILE", "CODEX_HOME"])
    vi.stubEnv(name, syntheticHome);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearMcpSettingsCache();
  resetHarnessModelOverlays();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMcpSettingsCache();
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(syntheticHome, { recursive: true, force: true });
});

async function renderResident(model: AgentModel, modelSettings: Record<string, string>) {
  setHarnessModels(model.harness, [model]);
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "leader", role: "orchestrator", projects: [], mascot: "cat", color: "#abcdef" },
    {
      id: "manager", role: "manager", reportsTo: "leader", sessionId: "resident",
      projects: ["/synthetic"], mascot: "cat", color: "#abcdef", effortSource: "role",
      workerProfile: { harness: model.harness, model: model.id, modelSettings },
    },
  ]));
  const sessionsRef = { current: [{
    id: "resident", harness: model.harness, model: model.id, modelSettings, effortSource: "role",
  }] as Resident[] };
  let state = sessionsRef.current;
  const source = readFileSync("src/app/App.tsx", "utf8");
  const start = source.indexOf("  const onModelSettingsChange = useCallback(");
  const end = source.indexOf("  const onRuntimeModeChange = useCallback(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // Exercise the private App callback without exporting it or booting the workspace.
  const compiled = ts.transpile(source.slice(start, end), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  });
  const handler = new Function(
    "useCallback", "sessionsRef", "monoForSession", "modelEffortSetting", "resolveModel",
    "updateMono", "lockMonoField", "saveLastModelSettings", "setSessions",
    `${compiled}\nreturn onModelSettingsChange;`,
  )(
    (callback: unknown) => callback, sessionsRef, monoForSession, modelEffortSetting,
    resolveModel, updateMono, lockMonoField, vi.fn(),
    (update: (previous: Resident[]) => Resident[]) => { state = update(state); },
  ) as (sessionId: string, settings: Record<string, string>, settingId?: string) => void;
  const picked = vi.fn((settings: Record<string, string>, settingId?: string) =>
    handler("resident", settings, settingId),
  );
  await act(async () => root.render(createElement(Composer, {
    focused: true, harness: model.harness, model: model.id, modelSettings,
    runtimeMode: "supervised", executionCwd: "/synthetic", sessionId: "resident",
    remoteSession: true, hideProjectPicker: true, hideBranchPicker: true,
    onFocus: vi.fn(), onCwdChange: vi.fn(), onModelChange: vi.fn(),
    onModelSettingsChange: picked, onRuntimeModeChange: vi.fn(), onSubmit: vi.fn(),
  })));
  return { picked, sessionsRef, state: () => state };
}

it.each(["menu", "beside"] as const)(
  "locks a same-value Composer effort selection before a model switch (%s controls)",
  async (controls) => {
    saveModelControls(controls);
    const limited: AgentModel = {
      harness: "codex", id: "codex:limited", name: "Limited",
      settings: [{ id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high",
        options: ["high", "xhigh"].map(value => ({ value, label: value })) }],
    };
    const supported: AgentModel = {
      ...limited, id: "codex:supported", name: "Supported",
      settings: [{ ...limited.settings![0],
        options: ["low", "medium", "high", "xhigh"].map(value => ({ value, label: value })) }],
    };
    const resident = await renderResident(limited, { reasoningEffort: "high" });
    const trigger = container.querySelector<HTMLButtonElement>(
      controls === "beside" ? '[aria-label="Reasoning: high"]' : 'button[aria-haspopup="menu"]',
    )!;
    await act(async () => trigger.click());
    if (controls === "menu") {
      const reasoning = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find(button => button.textContent?.startsWith("Reasoning"))!;
      act(() => reasoning.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    }
    const currentOption = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find(button => button.textContent === "high")!;
    expect(currentOption.getAttribute("aria-checked")).toBe("true");
    await act(async () => currentOption.click());

    expect(resident.picked).toHaveBeenCalledWith({ reasoningEffort: "high" }, "reasoningEffort");
    expect(resident.sessionsRef.current[0].effortSource).toBe("user");
    expect(resident.state()[0].effortSource).toBe("user");
    const mono = findMono("manager")!;
    expect(mono.effortSource).toBe("user");
    expect(mono.userLockedFields).toContain("modelSettings");
    expect(mono.workerProfile?.modelSettings).toEqual({ reasoningEffort: "high" });
    expect(switchMonoRoleEffort(mono, limited, supported, resident.sessionsRef.current[0].modelSettings))
      .toEqual({ effortSource: "user", modelSettings: { reasoningEffort: "high" } });
  },
);

it.each([
  { harness: "codex" as const, effortId: "reasoningEffort", otherId: "serviceTier", otherValue: "default", selected: "fast", label: "Service Tier", choice: "Fast" },
  { harness: "claude" as const, effortId: "effort", otherId: "fast", otherValue: "false", selected: "true", label: "Fast", choice: "On" },
])("keeps effort role-owned when selecting grouped $otherId in Composer", async (test) => {
  saveModelControls("beside");
  const model: AgentModel = {
    harness: test.harness, id: `${test.harness}:grouped`, name: "Grouped",
    settings: [
      { id: test.effortId, label: "Reasoning", kind: "select", value: "high",
        options: ["high", "xhigh"].map(value => ({ value, label: value })) },
      { id: test.otherId, label: test.label, kind: test.otherId === "fast" ? "toggle" : "select", value: test.otherValue,
        options: [{ value: test.otherValue, label: "Default" }, { value: test.selected, label: test.choice }] },
    ],
  };
  const resident = await renderResident(model, { [test.effortId]: "high", [test.otherId]: test.otherValue });
  const trigger = container.querySelector<HTMLButtonElement>(
    `[aria-label="${test.harness === "codex" ? "Reasoning" : "Effort"}: high"]`,
  )!;
  await act(async () => trigger.click());
  const group = document.querySelector(`[role="group"][aria-label="${test.label}"]`)!;
  const option = [...group.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === test.choice)!;
  await act(async () => option.click());

  const settings = { [test.effortId]: "high", [test.otherId]: test.selected };
  expect(resident.picked).toHaveBeenCalledWith(settings, test.otherId);
  expect(resident.sessionsRef.current[0]).toMatchObject({ modelSettings: settings, effortSource: "role" });
  expect(resident.state()[0].effortSource).toBe("role");
  const mono = findMono("manager")!;
  expect(mono.effortSource).toBe("role");
  expect(mono.userLockedFields ?? []).not.toContain("modelSettings");
  expect(mono.workerProfile?.modelSettings).toEqual(settings);
});
