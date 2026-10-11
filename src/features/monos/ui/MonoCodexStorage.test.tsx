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

const hooksConflict = {
  entry: "hooks.json", monoPath: "C:/synthetic/mono/hooks.json", sourcePath: "C:/synthetic/.codex/hooks.json",
  monoBytes: 18, sourceBytes: 5202, monoMtime: 1, sourceMtime: 2, identical: false,
  monoFingerprint: "mono-hash", sourceFingerprint: "account-hash", canKeepMono: true,
};
const conflictDetail = (value = hooksConflict) => `Codex storage needs repair: ${JSON.stringify(value)}`;
const buttonNamed = (name: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
  .find(button => button.textContent?.startsWith(name))!;

it("offers explicit account and Mono choices with a plain title, held message context, and collapsed diagnostics", async () => {
  const resolve = vi.fn(async () => {});
  const reveal = vi.fn(async () => {});
  const detail = conflictDetail();
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={detail} blockedContext="1 queued message on Reviewer is waiting"
      onRepair={vi.fn()} onResolve={resolve} onReveal={reveal} />,
  ));
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("Codex hooks file got out of sync");
  expect(container.textContent).toContain("1 queued message on Reviewer is waiting");
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.textContent).toContain("Recommended");
  await act(async () => buttonNamed("Show in folder").click());
  expect(reveal).toHaveBeenCalledOnce();
  await act(async () => buttonNamed("Copy details").click());
  expect(native.copy).toHaveBeenCalledWith(detail);
  await act(async () => buttonNamed("Keep MonoCode version").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("keep_mono_version");
  expect(container.textContent).toContain("Codex storage repaired");
});

it("uses the recommended account version and prevents other actions until resolution finishes", async () => {
  let finish!: () => void;
  const resolve = vi.fn(() => new Promise<void>(done => { finish = done; }));
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={conflictDetail()} onRepair={vi.fn()} onResolve={resolve}
      onCompare={vi.fn()} onReveal={vi.fn()} />,
  ));
  await act(async () => buttonNamed("Use ~/.codex version").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("use_account_version");
  for (const name of ["Repairing", "Keep MonoCode version", "Compare", "Show in folder"])
    expect(buttonNamed(name).disabled).toBe(true);
  await act(async () => buttonNamed("Keep MonoCode version").click());
  expect(resolve).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(container.textContent).toContain("Codex storage repaired");
});

it("compares bounded plain text versions and never interprets hooks as markup", async () => {
  const compare = vi.fn(async () => ({
    sourceContent: "<script>run_hook()</script>", monoContent: "x".repeat(70000),
  }));
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={conflictDetail()} onRepair={vi.fn()} onCompare={compare} />,
  ));
  await act(async () => buttonNamed("Compare").click());
  expect(compare).toHaveBeenCalledOnce();
  expect(container.querySelector('[aria-label="Account version"] pre')?.textContent).toBe("<script>run_hook()</script>");
  expect(container.querySelector('[aria-label="MonoCode version"] pre')?.textContent).toHaveLength(65536);
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain("Preview truncated");
  await act(async () => buttonNamed("Close comparison").click());
  expect(container.querySelector('[aria-label="Account version"]')).toBeNull();
});

it("disables private credential overrides and hides unavailable comparison content", async () => {
  const resolve = vi.fn(async () => {});
  const compare = vi.fn(async () => ({ unavailable: "Credential content cannot be compared", sourceContent: "do-not-show", monoContent: "do-not-show" }));
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={conflictDetail({ ...hooksConflict, entry: "auth.json", canKeepMono: false })}
      onRepair={vi.fn()} onResolve={resolve} onCompare={compare} />,
  ));
  expect(buttonNamed("Keep MonoCode version").disabled).toBe(true);
  await act(async () => buttonNamed("Keep MonoCode version").click());
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => buttonNamed("Compare").click());
  expect(container.textContent).toContain("Credential content cannot be compared");
  expect(container.textContent).not.toContain("do-not-show");
});

it("offers preparation refresh when a stale conflict is already linked", async () => {
  const resolve = vi.fn(async () => { throw new Error("The file is already linked. Refresh the issue."); });
  const repair = vi.fn(async () => {});
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={conflictDetail()} onRepair={repair} onResolve={resolve} />,
  ));
  expect(buttonNamed("Refresh issue")).toBeUndefined();
  await act(async () => buttonNamed("Use ~/.codex version").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("already linked");
  await act(async () => buttonNamed("Refresh issue").click());
  expect(repair).toHaveBeenCalledOnce();
  expect(resolve).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Codex storage repaired");
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
  expect(container.querySelector("details pre")?.textContent).toBe(detail);
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
