// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoCodexStorageNotice } from "./MonoCodexStorageNotice";
import { MonoCodexStorageSource } from "./MonoCodexStorageSource";
import { MonoCodexStorageRecovery } from "../model/monoCodexStorage";

const native = vi.hoisted(() => ({
  info: vi.fn(),
  shareHooks: vi.fn(),
  copy: vi.fn(),
  headless: false,
  selectedAccountId: "default",
}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: native.copy }));
vi.mock("../../../integrations/harness/core/child", () => ({
  hasHeadlessChildBackend: () => native.headless,
  monoCodexStorageInfo: native.info,
  setMonoCodexHooksShared: native.shareHooks,
}));
vi.mock("../../providers/model/providerAccounts", () => ({ selectedProviderAccountId: () => native.selectedAccountId }));
vi.mock("../../settings/model/sounds", () => ({ playCue: vi.fn() }));
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
  native.shareHooks.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.render(null));
  native.info.mockReset();
  native.shareHooks.mockReset();
  native.copy.mockReset();
  native.headless = false;
  native.selectedAccountId = "default";
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

it("shows preserved recovery paths with refresh and reveal while withholding version choices", async () => {
  const recovery = { recovery: true, reason: "A new file appeared during an interrupted repair; both files are preserved.", paths: ["C:/synthetic/mono/AGENTS.md", "C:/synthetic/mono/.monocode-claim-id"] };
  const detail = `Codex storage needs repair: ${JSON.stringify(recovery)}`;
  const repair = vi.fn(async () => { throw new Error(detail); });
  const resolve = vi.fn();
  const compare = vi.fn();
  const reveal = vi.fn(async () => {});
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={detail} onRepair={repair} onResolve={resolve} onCompare={compare} onReveal={reveal} />,
  ));
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Codex recovery files preserved");
  expect(container.textContent).toContain(recovery.reason);
  expect(Array.from(container.querySelectorAll('[aria-label="Preserved recovery paths"] li')).map(path => path.textContent)).toEqual(recovery.paths);
  for (const name of ["Use ~/.codex version", "Keep MonoCode version", "Compare"])
    expect(buttonNamed(name)).toBeUndefined();
  await act(async () => buttonNamed("Show in folder").click());
  expect(reveal).toHaveBeenCalledOnce();
  await act(async () => buttonNamed("Refresh issue").click());
  expect(repair).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(recovery.reason);
  expect(container.textContent).not.toContain("Codex storage repaired");
  expect(resolve).not.toHaveBeenCalled();
  expect(compare).not.toHaveBeenCalled();
});

it("switches between ordinary and recovery conflicts when refresh reports preserved files", async () => {
  const recovery = { recovery: true, reason: "The interrupted claim is preserved.", paths: ["C:/synthetic/mono/.monocode-claim-id"] };
  const repair = vi.fn(async () => { throw new Error(conflictDetail()); });
  const resolve = vi.fn(async () => { throw new Error(`Codex storage needs repair: ${JSON.stringify(recovery)}`); });
  await act(async () => root.render(
    <MonoCodexStorageNotice detail={conflictDetail()} onRepair={repair} onResolve={resolve} onCompare={vi.fn()} onReveal={vi.fn()} />,
  ));
  await act(async () => buttonNamed("Use ~/.codex version").click());
  expect(container.textContent).toContain("Codex recovery files preserved");
  expect(buttonNamed("Keep MonoCode version")).toBeUndefined();
  expect(buttonNamed("Compare")).toBeUndefined();
  await act(async () => buttonNamed("Refresh issue").click());
  expect(container.textContent).toContain("Codex hooks file got out of sync");
  expect(container.querySelector('[aria-label="Preserved recovery paths"]')).toBeNull();
  expect(buttonNamed("Keep MonoCode version")).toBeDefined();
});

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

it.each(["use_account_version", "keep_mono_version"] as const)("unlocks a fresh conflict after corrupt metadata and keeps actions usable until %s", async resolution => {
  const repair = vi.fn(async () => { throw new Error(conflictDetail()); });
  const resolve = vi.fn(async () => {});
  const compare = vi.fn(async () => ({ sourceContent: "account hooks", monoContent: "private hooks" }));
  const reveal = vi.fn(async () => {});
  await act(async () => root.render(
    <MonoCodexStorageNotice detail="Invalid Codex link metadata C:/synthetic/mono/.monocode-links/hooks.json.json"
      onRepair={repair} onResolve={resolve} onCompare={compare} onReveal={reveal} />,
  ));
  expect(buttonNamed("Compare")).toBeUndefined();
  await act(async () => buttonNamed("Repair").click());
  expect(repair).toHaveBeenCalledOnce();
  for (const name of ["Use ~/.codex version", "Keep MonoCode version", "Compare", "Show in folder"])
    expect(buttonNamed(name).disabled).toBe(false);
  await act(async () => buttonNamed("Compare").click());
  expect(compare).toHaveBeenCalledOnce();
  expect(container.querySelector('[aria-label="Account version"] pre')?.textContent).toBe("account hooks");
  expect(container.querySelector('[aria-label="MonoCode version"] pre')?.textContent).toBe("private hooks");
  await act(async () => buttonNamed("Show in folder").click());
  expect(reveal).toHaveBeenCalledOnce();
  await act(async () => buttonNamed(resolution === "use_account_version" ? "Use ~/.codex version" : "Keep MonoCode version").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith(resolution);
  expect(container.textContent).toContain("Codex storage repaired");
});

it("updates stale conflicts from native errors and clears choices when the parent issue changes or resolves", async () => {
  const changed = { ...hooksConflict, entry: "config.toml", sourcePath: "C:/synthetic/.codex/config.toml", monoPath: "C:/synthetic/mono/config.toml" };
  let detail: string | undefined = conflictDetail();
  const resolve = vi.fn(async () => { detail = undefined; renderNotice(); })
    .mockRejectedValueOnce(new Error(conflictDetail(changed)));
  const compare = vi.fn(async () => ({ sourceContent: "account config", monoContent: "private config" }));
  function renderNotice() {
    root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={resolve} onCompare={compare} />);
  }
  await act(async () => renderNotice());
  await act(async () => buttonNamed("Use ~/.codex version").click());
  expect(container.textContent).toContain("Codex config file got out of sync");
  expect(buttonNamed("Use ~/.codex version").title).toBe(changed.sourcePath);
  await act(async () => buttonNamed("Compare").click());
  expect(container.querySelector('[aria-label="Account version"] pre')?.textContent).toBe("account config");
  detail = conflictDetail({ ...hooksConflict, entry: "AGENTS.md" });
  await act(async () => renderNotice());
  expect(container.textContent).toContain("Codex instructions file got out of sync");
  expect(container.querySelector('[aria-label="Account version"]')).toBeNull();
  await act(async () => buttonNamed("Use ~/.codex version").click());
  expect(container.textContent).toContain("Codex storage repaired");
  await act(async () => buttonNamed("Dismiss").click());
  expect(container.textContent).toBe("");
  detail = "Codex storage needs repair: another issue";
  await act(async () => renderNotice());
  expect(buttonNamed("Repair").disabled).toBe(false);
  expect(buttonNamed("Use ~/.codex version")).toBeUndefined();
  expect(buttonNamed("Keep MonoCode version")).toBeUndefined();
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
    shareHooks: false,
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
    shareHooks: false,
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

it.each(["default", "account", "CODEX_HOME"] as const)("keeps %s hooks isolated by default and persists opt-in for only the selected account", async sourceKind => {
  const flags = new Map([["selected", false], ["other", false]]);
  native.selectedAccountId = "selected";
  native.info.mockImplementation(async (accountId: string) => ({
    home: `/synthetic/mono/${accountId}`, sourceHome: "C:/synthetic/account", sourceKind,
    shareHooks: flags.get(accountId) ?? false,
  }));
  native.shareHooks.mockImplementation(async (accountId: string, shared: boolean) => { flags.set(accountId, shared); });
  const renderSource = () => root.render(<dl><MonoCodexStorageSource harness="codex" cwd="/synthetic/repo" /></dl>);
  await act(async () => renderSource());
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(toggle.getAttribute("aria-label")).toBe(sourceKind === "default" ? "Share hooks from ~/.codex" : "Share account hooks");
  expect(container.textContent).toContain("all Monos using this account on their next turn");
  expect(container.querySelector("span[title]")?.getAttribute("title")).toBe("C:/synthetic/account");
  await act(async () => toggle.click());
  expect(native.shareHooks).toHaveBeenCalledExactlyOnceWith("selected", true);
  expect(native.info.mock.calls.map(([accountId]) => accountId)).toEqual(["selected", "selected"]);
  expect(flags.get("other")).toBe(false);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  await act(async () => root.render(null));
  await act(async () => renderSource());
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(native.shareHooks).toHaveBeenLastCalledWith("selected", false);
  expect(flags.get("selected")).toBe(false);
});

it("reports a hooks-policy save failure without enabling sharing or preparing storage", async () => {
  native.info.mockResolvedValue({ home: "/synthetic/mono/work", sourceHome: "/synthetic/account/work", sourceKind: "account", shareHooks: false });
  native.shareHooks.mockRejectedValue(new Error("Could not save account hooks policy"));
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" providerAccountId="work" cwd="/synthetic/repo" />));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(native.shareHooks).toHaveBeenCalledExactlyOnceWith("work", true);
  expect(native.info).toHaveBeenCalledExactlyOnceWith("work");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not save account hooks policy");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false);
});

it("retains the confirmed saved hooks preference when refreshing account information fails", async () => {
  native.info.mockResolvedValueOnce({ home: "/synthetic/mono/work", sourceHome: "/synthetic/account/work", sourceKind: "account", shareHooks: false })
    .mockRejectedValueOnce(new Error("Could not refresh account information"));
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" providerAccountId="work" cwd="/synthetic/repo" />));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(native.shareHooks).toHaveBeenCalledExactlyOnceWith("work", true);
  expect(native.info).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not refresh account information");
});

it("reloads the selected account and ignores an old save completion after the account changes", async () => {
  const flags = new Map<string, boolean>();
  native.selectedAccountId = "first";
  native.info.mockImplementation(async (accountId: string) => ({
    home: `/synthetic/mono/${accountId}`, sourceHome: `/synthetic/account/${accountId}`,
    sourceKind: "account", shareHooks: flags.get(accountId) ?? false,
  }));
  let release!: () => void;
  native.shareHooks.mockImplementationOnce(async (accountId: string, shared: boolean) => {
    await new Promise<void>(resolve => { release = resolve; });
    flags.set(accountId, shared);
  }).mockImplementation(async (accountId: string, shared: boolean) => { flags.set(accountId, shared); });
  const renderSource = () => root.render(<MonoCodexStorageSource harness="codex" cwd="/synthetic/repo" />);
  await act(async () => renderSource());
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
  native.selectedAccountId = "second";
  await act(async () => renderSource());
  expect(container.querySelector("span[title]")?.getAttribute("title")).toBe("/synthetic/account/second");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(native.shareHooks).toHaveBeenLastCalledWith("second", true);
  await act(async () => release());
  expect(native.info.mock.calls.map(([accountId]) => accountId)).toEqual(["first", "second", "second"]);
  expect(container.querySelector("span[title]")?.getAttribute("title")).toBe("/synthetic/account/second");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  native.selectedAccountId = "first";
  await act(async () => renderSource());
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(flags.get("first")).toBe(true);
  expect(flags.get("second")).toBe(true);
});
