// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoDetails } from "./MonoDetails";
import { MemberDetails } from "./MonoTeamPage";
import { findMono, type Mono } from "../model/mono";
import { publishCardSessions } from "../model/monoCards";
import { RUNTIME_MODES, type HarnessId, type RuntimeMode, type Session } from "../../sessions/model/session";

vi.mock("../../../platform/tauri/platform", async original => ({ ...(await original<object>()), IS_WIN: true }));
vi.mock("../../sessions/ui/ModelPicker", () => ({ ModelPicker: () => null, ModelSettingRows: () => null }));
vi.mock("../model/monoFiles", async original => ({ ...(await original<object>()), loadMonoFiles: vi.fn(async () => ({ soul: "", memory: "", topics: [] })) }));
vi.mock("./MonoHabits", async original => ({ ...(await original<object>()), useHabits: () => [] }));
vi.mock("./MonoCodexStorageSource", () => ({ MonoCodexStorageSource: () => null }));

let root: Root;
let container: HTMLDivElement;
const noop = () => {};
const agent = { name: "Captain", mascot: "cat", color: "#6ba", projects: [] };
const manager: Mono = { id: "manager", role: "manager", projects: ["/repo"], mascot: "cat", color: "#6ba" };
const member: Mono = { ...manager, id: "member", role: "member", reportsTo: "manager", specialty: "Reviewer" };

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  publishCardSessions([], noop);
  container.remove();
  vi.unstubAllGlobals();
});

async function renderDetails(mono: Mono, conversation: { runtimeMode: RuntimeMode; runtimeModeSource?: Session["runtimeModeSource"]; windowsSandbox?: Session["windowsSandbox"]; readOnly?: boolean; busy?: boolean }, harness: HarnessId = "codex", saveEngine?: (engine: Session["windowsSandbox"]) => Promise<void>) {
  localStorage.setItem("monocode:mono-roster", JSON.stringify(mono.role === "member" ? [manager, mono] : [mono]));
  const change = vi.fn(), engineChange = vi.fn();
  function Panel() {
    const [runtimeMode, setRuntimeMode] = useState(conversation.runtimeMode);
    const [runtimeModeSource, setSource] = useState(conversation.runtimeModeSource);
    const [windowsSandbox, setEngine] = useState(conversation.windowsSandbox);
    return <MonoDetails open monoId={mono.id} sessionId="chat" cwd="/repo" agent={agent} state={{ status: "idle" }} harness={harness} model={`${harness}:test`} modelSettings={{}}
      runtimeMode={runtimeMode} runtimeModeSource={runtimeModeSource} windowsSandbox={windowsSandbox} readOnly={conversation.readOnly} busy={conversation.busy}
      onRuntimeModeChange={(mode, source) => { change(mode, source); setRuntimeMode(mode); setSource(source); }}
      onWindowsSandboxChange={async engine => { engineChange(engine); await saveEngine?.(engine); setEngine(engine); }} onModelChange={noop} onModelSettingsChange={noop} onClose={noop} />;
  }
  await act(async () => root.render(<Panel />));
  return { change, engineChange };
}

const permissions = () => container.querySelector("[data-mono-role-permissions]")!;
const engine = () => container.querySelector("[data-mono-windows-sandbox]")!;

async function clickText(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

async function pickMode(mode: RuntimeMode) {
  await act(async () => container.querySelector<HTMLButtonElement>("[data-access-picker-trigger]")!.click());
  await act(async () => document.querySelectorAll<HTMLButtonElement>('[data-access-picker] [role="option"]')[RUNTIME_MODES.indexOf(mode)].click());
}

async function pickEngine(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Windows sandbox engine:"]')!.click());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent === label)!;
  expect(option).toBeDefined();
  await act(async () => option.click());
}

it.each(["manager", "orchestrator"] as const)("keeps a legacy %s choice until reset, then allows a user override", async role => {
  const mono: Mono = { ...manager, role, userLockedFields: ["model", "runtimeMode"] };
  const { change } = await renderDetails(mono, { runtimeMode: "auto" });
  expect(permissions().textContent).toContain("Set by you");
  expect(permissions().textContent).toContain("Coordinators use full access to route and review work");
  expect(change).not.toHaveBeenCalled();
  expect(findMono(mono.id)?.runtimeModeSource).toBeUndefined();
  await clickText("Use role default (Full access)");
  expect(change).toHaveBeenLastCalledWith("full-access", "role");
  expect(findMono(mono.id)?.userLockedFields).toEqual(["model"]);
  expect(permissions().textContent).toContain("Role default");
  expect(engine().textContent).toContain("Bypassed in Chat");
  expect(engine().textContent).toContain("Plan stays restricted");
  await pickMode("auto");
  expect(change).toHaveBeenLastCalledWith("auto", "user");
  expect(findMono(mono.id)?.userLockedFields).toContain("runtimeMode");
  expect(permissions().textContent).toContain("Set by you");
});

it("retains a worker's saved full access until the user chooses the Auto role default", async () => {
  const { change } = await renderDetails({ ...member, userLockedFields: ["model", "runtimeMode"], windowsSandbox: "elevated" }, { runtimeMode: "full-access", windowsSandbox: "elevated" });
  expect(permissions().textContent).toContain("Full access");
  expect(permissions().textContent).toContain("Set by you");
  expect(change).not.toHaveBeenCalled();
  await clickText("Use role default (Auto)");
  expect(change).toHaveBeenLastCalledWith("auto", "role");
  expect(permissions().textContent).toContain("Workers use Auto with a workspace sandbox");
  expect(findMono(member.id)?.userLockedFields).toEqual(["model"]);
  expect(findMono(member.id)?.windowsSandbox).toBe("elevated");
  expect(engine().textContent).toContain("Elevated (blocked)");
});

it("marks selecting the same permission mode as a user choice", async () => {
  const { change } = await renderDetails({ ...member, runtimeModeSource: "role" }, { runtimeMode: "auto", runtimeModeSource: "role" });
  expect(permissions().textContent).toContain("Role default");
  await pickMode("auto");
  expect(change).toHaveBeenLastCalledWith("auto", "user");
  expect(permissions().textContent).toContain("Set by you");
});

it("shows the effective Auto engine and preserves explicit elevated choices and their blocker", async () => {
  const { engineChange } = await renderDetails(member, { runtimeMode: "auto", runtimeModeSource: "role" });
  expect(engine().textContent).toContain("Unelevated");
  await pickEngine("Elevated");
  expect(engineChange).toHaveBeenLastCalledWith("elevated");
  expect(findMono(member.id)?.windowsSandbox).toBe("elevated");
  expect(engine().textContent).toContain("Elevated (blocked)");
  expect(engine().textContent).toContain("Elevated restricted turns stay blocked before submission");
  await pickEngine("Default (unelevated)");
  expect(engineChange).toHaveBeenLastCalledWith(undefined);
  expect(findMono(member.id)?.windowsSandbox).toBeUndefined();
  expect(engine().textContent).toContain("Unelevated");
});

it("does not guess a Supervised account engine and keeps a full-access read-only task restricted", async () => {
  await renderDetails(manager, { runtimeMode: "supervised" });
  expect(engine().textContent).toContain("Inherited from account/project");
  expect(engine().textContent).not.toContain("Elevated (blocked)");
  expect(engine().textContent).not.toContain("Unelevated");
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderDetails(member, { runtimeMode: "full-access", readOnly: true });
  expect(permissions().textContent).toContain("This task stays read-only");
  expect(engine().textContent).toContain("Unelevated");
  expect(engine().textContent).not.toContain("Bypassed in Chat");
});

it("hides the Windows Codex engine control for other providers", async () => {
  await renderDetails(manager, { runtimeMode: "auto" }, "claude");
  expect(container.querySelector("[data-mono-windows-sandbox]")).toBeNull();
});

it("disables engine changes during an active turn and keeps save failures visible without changing the Mono", async () => {
  const { engineChange } = await renderDetails(member, { runtimeMode: "auto", busy: true });
  const picker = container.querySelector<HTMLButtonElement>('[aria-label^="Windows sandbox engine:"]')!;
  expect(picker.disabled).toBe(true);
  await act(async () => picker.click());
  expect(engineChange).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  root = createRoot(container);
  const save = vi.fn().mockRejectedValue(Error("Could not save engine"));
  await renderDetails(member, { runtimeMode: "auto" }, "codex", save);
  await pickEngine("Elevated");
  expect(save).toHaveBeenCalledWith("elevated");
  expect(engine().querySelector('[role="alert"]')?.textContent).toBe("Could not save engine");
  expect(findMono(member.id)?.windowsSandbox).toBeUndefined();
  expect(engine().textContent).toContain("Unelevated");
  expect(engine().textContent).not.toContain("Elevated (blocked)");
});

it("offers a legacy teammate without a chat the Auto role default without migrating it on read", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager, member]));
  await act(async () => root.render(<MemberDetails member={member} fallback={{ harness: "codex", model: "codex:test" }} onBack={noop} />));
  expect(permissions().textContent).toContain("Full access");
  expect(permissions().textContent).toContain("Set by you");
  expect(findMono(member.id)?.runtimeModeSource).toBeUndefined();
  await clickText("Use role default (Auto)");
  expect(findMono(member.id)?.runtimeMode).toBe("auto");
  expect(findMono(member.id)?.runtimeModeSource).toBe("role");
});

it("uses the saved member chat's source and engine in Team details and opens that chat for reset", async () => {
  const open = vi.fn();
  const resident = { ...member, sessionId: "resident", runtimeMode: "auto" as const, runtimeModeSource: "role" as const, windowsSandbox: "unelevated" as const };
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager, resident]));
  publishCardSessions([{ id: "resident", title: "", harness: "codex", busy: false, needsInput: false, runtimeMode: "supervised", windowsSandbox: "elevated" }], open);
  await act(async () => root.render(<MemberDetails member={resident} fallback={{ harness: "codex", model: "codex:test" }} onBack={noop} />));
  expect(permissions().textContent).toContain("Supervised");
  expect(permissions().textContent).toContain("Set by you");
  expect(permissions().querySelector("[data-access-picker-trigger]")).toBeNull();
  expect(engine().textContent).toContain("Elevated (blocked)");
  await clickText("Open chat to use role default");
  expect(open).toHaveBeenCalledWith("resident", undefined);
  expect(findMono(member.id)?.runtimeModeSource).toBe("role");
});

it("does not claim a member chat's effective permissions or engine before its settings are known", async () => {
  const resident = { ...member, sessionId: "resident", runtimeMode: "auto" as const, runtimeModeSource: "role" as const };
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager, resident]));
  await act(async () => root.render(<MemberDetails member={resident} fallback={{ harness: "codex", model: "codex:test" }} onBack={noop} />));
  expect(permissions().textContent).toBe("Open chat to view");
  expect(container.querySelector("[data-mono-windows-sandbox]")).toBeNull();
});

it("uses the saved chat's actual provider when showing its engine", async () => {
  const resident = { ...member, sessionId: "resident" };
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager, resident]));
  publishCardSessions([{ id: "resident", title: "", harness: "claude", busy: false, needsInput: false, runtimeMode: "auto" }], noop);
  await act(async () => root.render(<MemberDetails member={resident} fallback={{ harness: "codex", model: "codex:test" }} onBack={noop} />));
  expect(permissions().textContent).toContain("Auto");
  expect(container.querySelector("[data-mono-windows-sandbox]")).toBeNull();
});
