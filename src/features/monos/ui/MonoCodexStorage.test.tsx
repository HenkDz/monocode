// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoCodexStorageNotice } from "./MonoCodexStorageNotice";
import { MonoCodexStorageSource } from "./MonoCodexStorageSource";
import { MonoCodexStorageRecovery } from "../model/monoCodexStorage";
import { useCodexStorageLockRecovery } from "../../../app/hooks/useCodexStorageLockRecovery";
import { newSession } from "../../sessions/model/session";

const native = vi.hoisted(() => ({
  info: vi.fn(),
  shareHooks: vi.fn(),
  copy: vi.fn(),
  headless: false,
  selectedAccountId: "default",
  retireCredentials: vi.fn(),
}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: native.copy }));
vi.mock("../../../integrations/harness/core/child", () => ({
  hasHeadlessChildBackend: () => native.headless,
  monoCodexStorageInfo: native.info,
  setMonoCodexHooksShared: native.shareHooks,
  retireMonoCodexCredentials: native.retireCredentials,
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
  native.retireCredentials.mockReset();
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

it("copies the exact path-bearing lock envelope and automatically resumes once after release without clicking Repair", async () => {
  vi.useFakeTimers();
  const recovery = new MonoCodexStorageRecovery();
  const sent = vi.fn((_text: string, _attachments: string[], _intent: string) => true);
  recovery.hold("manager", () => sent("Exact held Plan", ["original attachment"], "plan"), "plan");
  const detail = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Codex reader holds this file", paths: ["C:/synthetic/mono/AGENTS.md"],
    io: { operation: "open storage entry with delete access", path: "C:/synthetic/mono/AGENTS.md", holder: "Codex reader (exact holder unknown)", osError: 32, retryable: true } })}`;
  let locked = true;
  const prepare = vi.fn(async () => { if (locked) throw new Error(detail); });
  function ConnectedNotice() {
    const [sessions, setSessions] = useState([{ ...newSession("codex", "C:/synthetic/repo"), id: "manager", codexStorageError: detail }]);
    useCodexStorageLockRecovery(sessions, async id => {
      await recovery.repair(id, prepare);
      setSessions(current => current.map(session => session.id === id ? { ...session, codexStorageError: "" } : session));
    });
    return <MonoCodexStorageNotice detail={sessions[0].codexStorageError} onRepair={async () => {}} />;
  }
  try {
    await act(async () => root.render(<ConnectedNotice />));
    expect(container.textContent).toContain("AGENTS.md");
    expect(container.textContent).toContain("continue automatically");
    await act(async () => buttonNamed("Copy details").click());
    expect(native.copy).toHaveBeenCalledExactlyOnceWith(detail);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(sent).not.toHaveBeenCalled();
    locked = false;
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(sent).toHaveBeenCalledExactlyOnceWith("Exact held Plan", ["original attachment"], "plan");
    expect(container.textContent).not.toContain("AGENTS.md");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(sent).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
  } finally { vi.useRealTimers(); }
});

it("keeps a preserve refusal visible across stable map notice renders and unrelated error strings", async () => {
  const homeThreads = { sessionId: "mono", identity: "row:created", fingerprint: "stored", cwd: "/synthetic/repo", providerAccountId: "account", home: "/synthetic/home" };
  const resolve = vi.fn(async () => { throw new Error("Stored record changed; keep the unsaved edits"); });
  for (let cycle = 0; cycle < 6; cycle++) {
    await act(async () => root.render(<MonoCodexStorageNotice {...{ homeThreads }} detail={`Unrelated refusal ${cycle}`} onRepair={async () => {}} onResolve={resolve} />));
    expect(container.textContent).toContain("Conversation edits are not saved");
    expect(buttonNamed("Preserve stored map aside")).toBeDefined();
    if (cycle === 0) await act(async () => buttonNamed("Preserve stored map aside").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Stored record changed");
  }
});

it("offers a quiet source row with explicit return and refusal, without a blocking notice or separate no-op", async () => {
  const detail = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Return available", paths: ["/synthetic/original"], sourceBinding: {
    resolvedSourceHome: "/synthetic/source", boundSourceHome: "/synthetic/source", canBind: false, canSeparate: true, canReturn: true, sourceIdentity: "1:9",
  } })}`;
  let finish!: () => void;
  const resolve = vi.fn(() => new Promise<void>(done => { finish = done; }));
  await act(async () => root.render(<MonoCodexStorageNotice {...{ advisory: true }} detail={detail} onRepair={async () => {}} onResolve={resolve} />));
  expect(container.querySelector('section[role="status"]')).toBeNull();
  expect(container.querySelector("details, summary, [aria-expanded]")).toBeNull();
  expect(buttonNamed("Use a separate Mono home")).toBeUndefined();
  expect(buttonNamed("Return to original home").title).toContain("Selected source: /synthetic/source\nOriginal source: /synthetic/source");
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => buttonNamed("Return to original home").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("reattach_original_source");
  expect(buttonNamed("Return to original home").disabled).toBe(true);
  await act(async () => buttonNamed("Return to original home").click());
  expect(resolve).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(container.textContent).toContain("Codex source choice applied.");
  expect(buttonNamed("Return to original home").disabled).toBe(false);
  resolve.mockImplementation(async () => { throw new Error("Source identity changed; both homes preserved"); });
  await act(async () => buttonNamed("Return to original home").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Source identity changed; both homes preserved");
  expect(buttonNamed("Return to original home").disabled).toBe(false);
  await act(async () => root.render(<MonoCodexStorageNotice advisory remote detail={detail} onRepair={async () => {}} onResolve={resolve} />));
  expect(buttonNamed("Return to original home")).toBeUndefined();
  expect(container.textContent).toContain("remote host");
  expect(resolve).toHaveBeenCalledTimes(2);
});

it("requires an explicit scoped confirmation before clearing an inactive owned credential namespace", async () => {
  const receipt = { contextId: "a".repeat(64), contextIdentity: "1:2", owners: [{ entry: ".monocode-credential-owner-cli.json", identity: "1:3", fingerprint: "hash" }] };
  const namespace = { contextId: receipt.contextId, home: "C:/synthetic/private/context", copies: 1, active: false, receipt };
  const info = { home: "C:/synthetic/private", sourceHome: "C:/synthetic/source", sourceKind: "account", shareHooks: false, credentialNamespaces: [namespace] };
  native.info.mockResolvedValue(info); native.retireCredentials.mockResolvedValue(undefined);
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" providerAccountId="account" cwd="/synthetic/repo" />));
  expect(native.retireCredentials).not.toHaveBeenCalled();
  await act(async () => buttonNamed("Private credential copies:").click());
  await act(async () => buttonNamed("Clear inactive private credentials").click());
  expect(native.retireCredentials).not.toHaveBeenCalled();
  expect(container.textContent).toContain("including any changed login");
  expect(container.textContent).toContain("Source credentials, legacy entries, sessions and config are kept");
  native.info.mockResolvedValue({ ...info, credentialNamespaces: [] });
  await act(async () => buttonNamed("Confirm clear private credentials").click());
  expect(native.retireCredentials).toHaveBeenCalledExactlyOnceWith("account", receipt);
  expect(buttonNamed("Clear inactive private credentials")).toBeUndefined();
});

it("withholds credential retirement for active contexts and preserves a failed inactive confirmation", async () => {
  const namespace = { contextId: "base", home: "C:/synthetic/private", copies: 1, active: true, receipt: { contextId: "base", contextIdentity: "1:2", owners: [] } };
  native.info.mockResolvedValue({ home: namespace.home, sourceHome: "C:/synthetic/source", sourceKind: "account", shareHooks: false, credentialNamespaces: [namespace] });
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" providerAccountId="account" cwd="/synthetic/repo" />));
  await act(async () => buttonNamed("Private credential copies:").click());
  expect(buttonNamed("Clear inactive private credentials")).toBeUndefined();
  expect(container.textContent).toContain("Close every server");
  await act(async () => root.render(null));
  native.info.mockResolvedValue({ home: namespace.home, sourceHome: "C:/synthetic/source", sourceKind: "account", shareHooks: false, credentialNamespaces: [{ ...namespace, active: false }] });
  native.retireCredentials.mockRejectedValue(new Error("This context became active; credentials preserved"));
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" providerAccountId="account" cwd="/synthetic/repo" />));
  await act(async () => buttonNamed("Private credential copies:").click());
  await act(async () => buttonNamed("Clear inactive private credentials").click());
  await act(async () => buttonNamed("Confirm clear private credentials").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("credentials preserved");
  expect(buttonNamed("Confirm clear private credentials")).toBeDefined();
});

it("summarizes copies rather than context count and opens an accessible short-label list without clearing", async () => {
  const namespaces = [
    { contextId: "base", home: "//?/C:/Users/synthetic/.codex/mono", copies: 2, active: true },
    { contextId: "a".repeat(64), home: "//?/C:/Users/synthetic/.codex/mono/.monocode-skill-contexts/" + "a".repeat(64), copies: 3, active: false },
    { contextId: "b".repeat(64), home: "//?/C:/Users/synthetic/.codex/mono/.monocode-skill-contexts/" + "b".repeat(64), copies: 2, active: false },
  ].map(namespace => ({ ...namespace, receipt: { contextId: namespace.contextId, contextIdentity: "synthetic", owners: [] } }));
  const info = { home: "/synthetic/mono", sourceHome: "//?/C:/Users/synthetic/.codex", sourceKind: "default", shareHooks: false, credentialNamespaces: namespaces };
  native.info.mockResolvedValue(info);
  const renderSource = (account = "account") => root.render(<MonoCodexStorageSource harness="codex" providerAccountId={account} cwd="/synthetic/repo" />);
  await act(async () => renderSource());
  const summary = buttonNamed("Private credential copies:");
  expect(summary.textContent).toContain("Private credential copies: 7 (2 in use)");
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  const list = container.querySelector('[aria-label="Private credential contexts"]')!;
  expect(list.closest<HTMLElement>("[hidden]")).not.toBeNull();
  expect(list.querySelectorAll("li")).toHaveLength(3);
  await act(async () => summary.click());
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  expect(summary.getAttribute("aria-controls")).toBe(list.parentElement!.id);
  expect(list.textContent).toContain("Base context");
  expect(list.textContent).toContain("Skill context 2");
  expect(list.textContent).toContain("In use");
  expect(list.textContent).not.toContain("a".repeat(64));
  expect(container.textContent).not.toContain("//?/");
  expect(native.retireCredentials).not.toHaveBeenCalled();
  await act(async () => buttonNamed("Clear inactive private credentials").click());
  await act(async () => buttonNamed("Cancel").click());
  expect(buttonNamed("Confirm clear private credentials")).toBeUndefined();
  expect(native.retireCredentials).not.toHaveBeenCalled();
  await act(async () => renderSource("another"));
  expect(buttonNamed("Private credential copies:").getAttribute("aria-expanded")).toBe("false");
});

it("copies the raw selected home and context paths and announces clipboard failure", async () => {
  const sourceHome = "\\\\?\\C:\\Users\\synthetic\\.codex";
  const home = "//?/C:/synthetic/private/context";
  native.info.mockResolvedValue({ home, sourceHome, sourceKind: "default", shareHooks: false, credentialNamespaces: [{
    contextId: "base", home, copies: 1, active: false,
    receipt: { contextId: "base", contextIdentity: "synthetic", owners: [] },
  }] });
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" cwd="/synthetic/repo" />));
  expect(container.querySelector("span[title]")?.textContent).toBe("C:/Users/synthetic/.codex");
  const copy = container.querySelector<HTMLButtonElement>('[aria-label="Copy selected Codex home path"]')!;
  expect(copy.title).toBe(sourceHome);
  await act(async () => copy.click());
  expect(native.copy).toHaveBeenCalledExactlyOnceWith(sourceHome);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Path copied");
  await act(async () => buttonNamed("Private credential copies:").click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copy base context path"]')!.click());
  expect(native.copy).toHaveBeenLastCalledWith(home);
  native.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await act(async () => copy.click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Could not copy path");
  expect(native.retireCredentials).not.toHaveBeenCalled();
});

it.each([
  ["//?/UNC/Users/share/context", "//Users/share/context"],
  ["C:/Users/Other/.codex", "C:/Users/Other/.codex"],
  ["/home/synthetic-backup/.codex", "/home/synthetic-backup/.codex"],
  ["//?/UNC/home/share/context", "//home/share/context"],
  ["//Users/share/context", "//Users/share/context"],
  ["//home/share/context", "//home/share/context"],
  ["//?/C:/Users/A/.codex", "C:/Users/A/.codex"],
  ["C:/Users/AB/.codex", "C:/Users/AB/.codex"],
  ["/home/Other/.codex", "/home/Other/.codex"],
  ["Users/Other/context", "Users/Other/context"],
  ["\\\\?\\C:\\Users\\A\\.codex", "C:/Users/A/.codex"],
  ["\\\\?\\UNC\\Users\\share\\context", "//Users/share/context"],
  ["\\\\?\\UNC\\home\\share\\context", "//home/share/context"],
])("displays and copies %s without inventing a home or losing its server/share", async (sourceHome, display) => {
  native.info.mockResolvedValue({ home: "/synthetic/mono", sourceHome, sourceKind: "account", shareHooks: false });
  await act(async () => root.render(<MonoCodexStorageSource harness="codex" cwd="/synthetic/repo" />));
  expect(container.querySelector("span[title]")?.textContent).toBe(display);
  expect(container.querySelector("span[title]")?.getAttribute("title")).toBe(sourceHome);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copy selected Codex home path"]')!.click());
  expect(native.copy).toHaveBeenCalledExactlyOnceWith(sourceHome);
});

it("gives explicit Elevated guidance and withholds ineffective Full access for restricted messages", async () => {
  const detail = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Manual setup alone cannot unlock elevated Mono turns", setupCommand: "synthetic setup" })}`;
  await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={vi.fn()} explicitElevated allowFullAccess={false} />));
  expect(container.textContent).toContain("In Permissions, change Sandbox engine");
  expect(buttonNamed("Use unelevated sandbox for Monos")).toBeUndefined();
  expect(buttonNamed("Use full access for this Mono")).toBeUndefined();
  expect(container.textContent).toContain("Full access cannot repair Plan");
});

it("offers remote-host guidance without local mutation actions", async () => {
  await act(async () => root.render(<MonoCodexStorageNotice detail="Codex storage needs repair: remote storage" onRepair={vi.fn()} onResolve={vi.fn()} remote />));
  expect(container.textContent).toContain("on the remote host");
  expect(buttonNamed("Repair")).toBeUndefined();
  expect(buttonNamed("Use full access for this Mono")).toBeUndefined();
});

it("shows the original-source confirmation only for unbound homes", async () => {
  for (const canBind of [true, false]) {
    const sourceBinding = { resolvedSourceHome: "C:/synthetic/selected", boundSourceHome: "C:/synthetic/original", canBind };
    const detail = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Choose source", paths: ["C:/synthetic/private"], sourceBinding })}`;
    await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={vi.fn()} />));
    expect(container.textContent).toContain("Selected source: C:/synthetic/selected");
    expect(container.textContent).toContain("Original source: C:/synthetic/original");
    expect(!!buttonNamed("Confirm selected source")).toBe(canBind);
  }
});

it("offers the separate-source choice with an accurate title and forwards only the selected action", async () => {
  const sourceBinding = { resolvedSourceHome: "C:/synthetic/selected", boundSourceHome: "C:/synthetic/original", canBind: false, canSeparate: true, sourceIdentity: "1:2" };
  const detail = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Choose source", paths: ["C:/synthetic/private"], sourceBinding })}`;
  const resolve = vi.fn(async () => {});
  await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={resolve} />));
  expect(container.textContent).toContain("Choose this Mono's Codex source");
  expect(container.textContent).toContain("held prompt and queue stay here");
  await act(async () => buttonNamed("Use a separate Mono home").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("separate_selected_source");
});

it("humanizes failed sandbox readiness without printing the blocker JSON", async () => {
  const reason = "Manual setup alone cannot unlock elevated Mono turns";
  const detail = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason, setupCommand: "synthetic setup" })}`;
  await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={async () => { throw new Error(detail); }} />));
  await act(async () => buttonNamed("Use unelevated sandbox for Monos").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(reason);
});

it("shows the sandbox reason and exact manual command inline without auto-changing settings", async () => {
  const sandbox = { sandbox: true, reason: "The recorded sandbox account is disabled", setupCommand: "$env:CODEX_HOME = 'C:/synthetic/account'; codex sandbox -P :workspace -- powershell.exe -Command 'echo ready'" };
  const resolve = vi.fn(async () => {}), repair = vi.fn(async () => {}), renderDetails = vi.fn();
  await act(async () => root.render(<MonoCodexStorageNotice detail={`Codex storage needs repair: ${JSON.stringify(sandbox)}`}
    onRepair={repair} onResolve={resolve} renderDetails={renderDetails} />));
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Codex sandbox needs setup");
  expect(container.textContent).toContain(sandbox.reason);
  expect(container.querySelector('[aria-label="Sandbox setup command"]')?.textContent).toBe(sandbox.setupCommand);
  expect(container.querySelector("details")).toBeNull();
  expect(renderDetails).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(repair).not.toHaveBeenCalled();
  await act(async () => buttonNamed("Copy setup command").click());
  expect(native.copy).toHaveBeenCalledWith(sandbox.setupCommand);
  expect(container.textContent).toContain("Your own Codex config stays unchanged");
  await act(async () => buttonNamed("Use unelevated sandbox for Monos").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("use_unelevated_sandbox");
  expect(container.textContent).toContain("Codex sandbox choice applied");
});

it.each(["initial", "recheck"])("offers working remedies for the elevated provisioning guard after %s detection", async detection => {
  const reason = "Codex 0.162.1 can automatically repair sandbox credentials and enter elevated setup. Read-only checks cannot exclude that path without authentication side effects. Manual setup alone cannot unlock elevated Mono turns; use unelevated sandbox or full access until Codex can forbid automatic provisioning.";
  const setupCommand = "codex sandbox -P :workspace -- echo ready";
  const blocker = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason, setupCommand })}`;
  const repair = vi.fn(async () => { throw new Error(blocker); });
  const resolve = vi.fn(async () => { throw new Error("The account is busy; config was not changed"); });
  await act(async () => root.render(<MonoCodexStorageNotice
    detail={detection === "initial" ? blocker : `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Sandbox account is missing", setupCommand })}`}
    onRepair={repair} onResolve={resolve} />));
  if (detection === "recheck") await act(async () => buttonNamed("Check setup again").click());
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Codex elevated sandbox unavailable");
  expect(container.textContent).toContain(reason);
  expect(container.textContent).not.toContain("Run setup yourself");
  expect(container.querySelector('[aria-label="Sandbox setup command"]')).toBeNull();
  expect(buttonNamed("Copy setup command")).toBeUndefined();
  expect(buttonNamed("Check setup again")).toBeUndefined();
  expect(container.textContent).toContain("Your own Codex config stays unchanged");
  expect(container.textContent).toContain("Full access applies to this Mono; Plan stays restricted");
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => buttonNamed("Use unelevated sandbox for Monos").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("use_unelevated_sandbox");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("config was not changed");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Codex elevated sandbox unavailable");
  expect(buttonNamed("Use full access for this Mono").disabled).toBe(false);
});

it("requests full access only on explicit click and disables sandbox choices while pending", async () => {
  const detail = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Sandbox password expired", setupCommand: "codex sandbox -P :workspace -- echo ready" })}`;
  let finish!: () => void;
  const resolve = vi.fn(() => new Promise<void>(done => { finish = done; }));
  await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={resolve} />));
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => { buttonNamed("Use full access for this Mono").click(); });
  expect(resolve).toHaveBeenCalledExactlyOnceWith("use_mono_full_access");
  expect(buttonNamed("Use unelevated sandbox for Monos").disabled).toBe(true);
  expect(buttonNamed("Checking").disabled).toBe(true);
  await act(async () => finish());
});

it("retains the sandbox success category after the actual repair callback clears its blocker", async () => {
  const blocker = `Codex storage needs repair: ${JSON.stringify({ sandbox:true, reason:"Manual setup alone cannot unlock elevated Mono turns", setupCommand:"synthetic setup" })}`;
  let detail: string | undefined = blocker;
  function render() { root.render(<MonoCodexStorageNotice detail={detail} onRepair={async()=>{}} onResolve={async()=>{ detail=undefined; render(); }} />); }
  await act(async()=>render());
  await act(async()=>buttonNamed("Use full access for this Mono").click());
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Codex sandbox choice applied");
  expect(container.textContent).toContain("Waiting messages can continue");
  await act(async()=>buttonNamed("Dismiss").click());
  expect(container.textContent).toBe("");
});

it("retains inline sandbox choices after a failed explicit config change", async () => {
  const detail = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Sandbox account is missing", setupCommand: "codex sandbox -P :workspace -- echo ready" })}`;
  const resolve = vi.fn(async () => { throw new Error("The account is busy; config was not changed"); });
  await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={resolve} />));
  await act(async () => buttonNamed("Use unelevated sandbox for Monos").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("config was not changed");
  expect(container.textContent).toContain("Sandbox account is missing");
  expect(buttonNamed("Use full access for this Mono").disabled).toBe(false);
  expect(container.querySelector("details")).toBeNull();
});

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

it("offers explicit account and Mono choices with a plain title, held message context, and flat diagnostics", async () => {
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
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector('[aria-label="Storage diagnostic details"] pre')?.textContent).toBe(detail);
  expect(container.textContent).toContain("Recommended");
  await act(async () => buttonNamed("Show in folder").click());
  expect(reveal).toHaveBeenCalledOnce();
  await act(async () => buttonNamed("Copy details").click());
  expect(native.copy).toHaveBeenCalledWith(detail);
  await act(async () => buttonNamed("Keep MonoCode version").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("keep_mono_version");
  expect(container.textContent).toContain("Codex storage repaired");
});

it("offers metadata archival only for incomplete recovery and keeps flat diagnostics available", async () => {
  const metadata = { path: "C:/synthetic/mono/.monocode-txn-id.json.pending", identity: "1:2", fingerprint: "receipt-hash" };
  const detail = `Codex storage needs repair: ${JSON.stringify({ recovery: true, reason: "Incomplete transaction metadata was preserved.", paths: [metadata.path], metadata })}`;
  const resolve = vi.fn(async () => { throw new Error(detail); });
  await act(async () => root.render(<MonoCodexStorageNotice detail={detail} onRepair={vi.fn()} onResolve={resolve} onReveal={vi.fn()} />));
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector('[aria-label="Storage diagnostic details"] pre')?.textContent).toBe(detail);
  expect(buttonNamed("Keep MonoCode version")).toBeUndefined();
  expect(buttonNamed("Use account version")).toBeUndefined();
  expect(buttonNamed("Compare")).toBeUndefined();
  await act(async () => buttonNamed("Copy details").click());
  expect(native.copy).toHaveBeenCalledWith(detail);
  await act(async () => buttonNamed("Archive incomplete metadata").click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("preserve_recovery_metadata");
  expect(container.textContent).not.toContain("Codex storage repaired");
  await act(async () => root.render(<MonoCodexStorageNotice detail={conflictDetail()} onRepair={vi.fn()} onResolve={resolve} />));
  expect(buttonNamed("Archive incomplete metadata")).toBeUndefined();
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
  expect(container.querySelector('[aria-label="Storage diagnostic details"] pre')?.textContent).toBe(detail);
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
