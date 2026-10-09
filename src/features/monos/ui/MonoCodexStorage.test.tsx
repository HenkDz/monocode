// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoCodexStorageNotice } from "./MonoCodexStorageNotice";
import { MonoCodexStorageSource } from "./MonoCodexStorageSource";
import { MonoCodexStorageRecovery } from "../model/monoCodexStorage";

const native = vi.hoisted(() => ({
  info: vi.fn(),
  copy: vi.fn(),
  headless: false,
}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: native.copy }));
vi.mock("../../../integrations/harness/core/child", () => ({
  hasHeadlessChildBackend: () => native.headless,
  monoCodexStorageInfo: native.info,
}));
vi.mock("../../connections/model/remoteProjects", () => ({
  remoteProjectFor: (cwd: string) =>
    cwd.startsWith("remote:") ? {} : undefined,
}));

const container = document.createElement("div");
const root = createRoot(container);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  native.copy.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.render(null));
  native.info.mockReset();
  native.copy.mockReset();
  native.headless = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows one system notice with Repair, prevents concurrent clicks, and reports failed repair", async () => {
  let reject!: (error: Error) => void;
  const onRepair = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () =>
    root.render(
      <MonoCodexStorageNotice
        detail="Codex storage needs repair: hooks.json.bak"
        onRepair={onRepair}
      />,
    ),
  );
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("Codex storage needs repair");
  const button = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => button.click());
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("Repairing…");
  expect(
    container.querySelector('[role="status"]')?.getAttribute("aria-busy"),
  ).toBe("true");
  await act(async () => button.click());
  expect(onRepair).toHaveBeenCalledOnce();
  const failure =
    "Could not relink Codex storage C:\\mono\\hooks.json.bak: The filename, directory name, or volume label syntax is incorrect. (os error 123)";
  await act(async () => reject(new Error(failure)));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(failure);
  expect(button.disabled).toBe(false);
  const copy = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Copy details",
  )!;
  await act(async () => copy.click());
  expect(native.copy).toHaveBeenCalledExactlyOnceWith(failure);
  expect(container.textContent).toContain("Copied details");
});

it("keeps progress and success visible when relinking clears the error, and retries the held turn once", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const retry = vi.fn(async () => true);
  recovery.hold("mono", retry);
  let finish!: () => void;
  const relink = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onRepair = () =>
    recovery.repair("mono", async () => {
      await relink();
      root.render(<MonoCodexStorageNotice onRepair={onRepair} />);
    });
  await act(async () =>
    root.render(
      <MonoCodexStorageNotice
        detail="Codex storage needs repair: hooks.json"
        onRepair={onRepair}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(container.textContent).toContain("Repairing…");
  expect(retry).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(retry).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Codex storage repaired");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(container.textContent).toBe("");
  await act(async () =>
    root.render(
      <MonoCodexStorageNotice
        detail="Codex storage needs repair: skills"
        onRepair={onRepair}
      />,
    ),
  );
  expect(container.textContent).toContain("Codex storage needs repair");
});

it("shows a failed restart after clearing the storage error and retains the held prompt for Repair", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const retry = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  recovery.hold("mono", retry);
  const onRepair = () =>
    recovery.repair("mono", async () => {
      root.render(<MonoCodexStorageNotice onRepair={onRepair} />);
    });
  await act(async () =>
    root.render(
      <MonoCodexStorageNotice
        detail="Codex storage needs repair: hooks.json"
        onRepair={onRepair}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "prompt was retained",
  );
  expect(container.textContent).not.toContain("Codex storage repaired");
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(retry).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Codex storage repaired");
});

it("shows clipboard failures while retaining the exact repair details", async () => {
  native.copy.mockRejectedValue(new Error("Clipboard unavailable"));
  const detail =
    "Could not relink Codex storage C:\\mono\\auth.json: access denied";
  await act(async () =>
    root.render(
      <MonoCodexStorageNotice detail={detail} onRepair={async () => {}} />,
    ),
  );
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Copy details")!
      .click(),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(detail);
  expect(container.textContent).toContain(
    "Could not copy details: Clipboard unavailable",
  );
});

it("shows the selected Codex home and origin, refreshes account, and skips remote/headless lookups", async () => {
  native.info.mockResolvedValue({
    home: "/mono",
    sourceHome: "C:/orca/account/home",
    sourceKind: "CODEX_HOME",
  });
  await act(async () =>
    root.render(
      <dl>
        <MonoCodexStorageSource
          harness="codex"
          providerAccountId="default"
          cwd="/repo"
        />
      </dl>,
    ),
  );
  expect(native.info).toHaveBeenCalledWith("default");
  expect(container.textContent).toContain("Selected Codex home");
  expect(container.textContent).toContain("C:/orca/account/home (CODEX_HOME)");
  native.info.mockResolvedValue({
    home: "/mono/work",
    sourceHome: "C:/codex/work",
    sourceKind: "account",
  });
  await act(async () =>
    root.render(
      <dl>
        <MonoCodexStorageSource
          harness="codex"
          providerAccountId="work"
          cwd="/repo"
        />
      </dl>,
    ),
  );
  expect(container.textContent).toContain("C:/codex/work (Provider account)");
  native.info.mockClear();
  await act(async () =>
    root.render(
      <dl>
        <MonoCodexStorageSource harness="codex" cwd="remote:/repo" />
      </dl>,
    ),
  );
  native.headless = true;
  await act(async () =>
    root.render(
      <dl>
        <MonoCodexStorageSource harness="codex" cwd="/host" />
      </dl>,
    ),
  );
  expect(native.info).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
});
