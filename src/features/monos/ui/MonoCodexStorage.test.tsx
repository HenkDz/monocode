// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoCodexStorageNotice } from "./MonoCodexStorageNotice";
import { MonoCodexStorageSource } from "./MonoCodexStorageSource";

const native = vi.hoisted(() => ({ info: vi.fn(), headless: false }));
vi.mock("../../../integrations/harness/core/child", () => ({
  hasHeadlessChildBackend: () => native.headless,
  monoCodexStorageInfo: native.info,
}));
vi.mock("../../connections/model/remoteProjects", () => ({ remoteProjectFor: (cwd: string) => cwd.startsWith("remote:") ? {} : undefined }));

const container = document.createElement("div");
const root = createRoot(container);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.render(null));
  native.info.mockReset();
  native.headless = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows one system notice with Repair, prevents concurrent clicks, and reports failed repair", async () => {
  let reject!: (error: Error) => void;
  const onRepair = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => root.render(<MonoCodexStorageNotice onRepair={onRepair} />));
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("Codex storage needs repair");
  const button = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => button.click());
  expect(button.disabled).toBe(true);
  expect(onRepair).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Real folder retained")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Real folder retained");
  expect(button.disabled).toBe(false);
});

it("shows the selected Codex home and origin, refreshes account, and skips remote/headless lookups", async () => {
  native.info.mockResolvedValue({ home: "/mono", sourceHome: "C:/orca/account/home", sourceKind: "CODEX_HOME" });
  await act(async () => root.render(<dl><MonoCodexStorageSource harness="codex" providerAccountId="default" cwd="/repo" /></dl>));
  expect(native.info).toHaveBeenCalledWith("default");
  expect(container.textContent).toContain("Selected Codex home");
  expect(container.textContent).toContain("C:/orca/account/home (CODEX_HOME)");
  native.info.mockResolvedValue({ home: "/mono/work", sourceHome: "C:/codex/work", sourceKind: "account" });
  await act(async () => root.render(<dl><MonoCodexStorageSource harness="codex" providerAccountId="work" cwd="/repo" /></dl>));
  expect(container.textContent).toContain("C:/codex/work (Provider account)");
  native.info.mockClear();
  await act(async () => root.render(<dl><MonoCodexStorageSource harness="codex" cwd="remote:/repo" /></dl>));
  native.headless = true;
  await act(async () => root.render(<dl><MonoCodexStorageSource harness="codex" cwd="/host" /></dl>));
  expect(native.info).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
});
