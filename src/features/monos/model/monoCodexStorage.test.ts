import { expect, it, vi } from "vitest";
import { codexStorageIssueTitle, isCodexStorageError, MonoCodexStorageRecovery, parseCodexStorageConflict } from "./monoCodexStorage";

const conflict = {
  entry: "hooks.json", monoPath: "C:/mono/hooks.json", sourcePath: "C:/account/hooks.json",
  monoBytes: 18, sourceBytes: 5202, monoMtime: 1, sourceMtime: 2, identical: false,
  monoFingerprint: "mono-hash", sourceFingerprint: "source-hash", canKeepMono: true,
};

it("parses native conflict details and retains fingerprints for stale-file checks", () => {
  const error = new Error(`Codex storage needs repair: ${JSON.stringify(conflict)}`);
  expect(parseCodexStorageConflict(error)).toEqual(conflict);
  expect(isCodexStorageError(error)).toBe(true);
  expect(codexStorageIssueTitle(conflict)).toBe("Codex hooks file got out of sync");
});

it("keeps legacy and malformed details out of explicit conflict resolution", () => {
  expect(parseCodexStorageConflict("Codex storage needs repair: permission denied")).toBeUndefined();
  for (const invalid of [
    { ...conflict, monoBytes: -1 }, { ...conflict, monoBytes: "18" },
    { ...conflict, monoFingerprint: undefined }, { ...conflict, canKeepMono: undefined },
    { ...conflict, sourceMtime: "today" },
  ]) expect(parseCodexStorageConflict(`Codex storage needs repair: ${JSON.stringify(invalid)}`)).toBeUndefined();
});

it("recognizes preparation and spawn storage errors without treating provider failures as repairable", () => {
  expect(isCodexStorageError(new Error("Codex storage needs repair: permission denied"))).toBe(true);
  expect(isCodexStorageError("Unexpected link in Mono Codex storage: AGENTS.md")).toBe(true);
  expect(isCodexStorageError("Provider crashed")).toBe(false);
});

it("holds one exact turn with attachments until relink succeeds, then retries only once", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const attachments = [{ name: "brief.txt", path: "/tmp/brief.txt" }];
  const submit = vi.fn();
  recovery.hold("manager", () => submit("Original goal", attachments, { managed: true }));
  recovery.hold("manager", () => submit("Duplicate turn"));
  expect(submit).not.toHaveBeenCalled();
  await expect(recovery.repair("manager", async () => { throw new Error("Real file conflict"); })).rejects.toThrow("Real file conflict");
  expect(submit).not.toHaveBeenCalled();
  const relink = vi.fn(async () => { expect(submit).not.toHaveBeenCalled(); });
  await recovery.repair("manager", relink);
  expect(submit).toHaveBeenCalledExactlyOnceWith("Original goal", attachments, { managed: true });
  await recovery.repair("manager", async () => {});
  expect(submit).toHaveBeenCalledOnce();
});

it("rejects concurrent preflight without accepting or overwriting a second prompt", async () => {
  const recovery = new MonoCodexStorageRecovery();
  let fail!: (error: Error) => void;
  const preparation = vi.fn(() => new Promise<void>((_, reject) => { fail = reject; }));
  const submit = vi.fn(() => true);
  const failed = vi.fn(() => recovery.hold("manager", submit));
  const first = recovery.prepare("manager", preparation, submit, failed);
  expect(await recovery.prepare("manager", preparation, vi.fn(() => true), failed)).toBe(false);
  fail(new Error("Codex storage needs repair: real conflict"));
  expect(await first).toBe(true);
  expect(preparation).toHaveBeenCalledOnce();
  expect(failed).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  await recovery.repair("manager", async () => {});
  expect(submit).toHaveBeenCalledOnce();
});

it("retains the original callback after successful relink when the chat cannot restart", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const submit = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  recovery.hold("manager", submit);
  await expect(recovery.repair("manager", async () => {})).rejects.toThrow("prompt was retained");
  await recovery.repair("manager", async () => {});
  expect(submit).toHaveBeenCalledTimes(2);
});

it("retains a throwing retry and ignores duplicate Repair calls while relinking", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const submit = vi.fn().mockRejectedValueOnce(new Error("Chat unavailable")).mockResolvedValueOnce(true);
  recovery.hold("manager", submit);
  let finish!: () => void;
  const relink = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = recovery.repair("manager", relink);
  await recovery.repair("manager", relink);
  expect(relink).toHaveBeenCalledOnce();
  finish();
  await expect(first).rejects.toThrow("Chat unavailable");
  await recovery.repair("manager", async () => {});
  expect(submit).toHaveBeenCalledTimes(2);
});

it("repairs an account once and coalesces duplicate requests while resuming exact held turns", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const order: string[] = [];
  const first = vi.fn(async () => { order.push("first"); return true; });
  const second = vi.fn(async () => { order.push("second"); return true; });
  recovery.hold("first", () => first());
  recovery.hold("second", () => second());
  let finish!: () => void;
  const relink = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const repair = recovery.repairAccount("account", ["first", "second", "first"], relink);
  const duplicate = recovery.repairAccount("account", ["first", "second"], relink);
  expect(duplicate).toBe(repair);
  expect(relink).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  finish();
  await repair;
  expect(order).toEqual(["first", "second"]);
  await recovery.repairAccount("account", ["first", "second"], async () => {});
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});

it("resumes other account members after one restart fails and preserves its exact callback", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const first = vi.fn().mockRejectedValueOnce(new Error("Chat unavailable")).mockResolvedValueOnce(true);
  const second = vi.fn(async () => true);
  recovery.hold("first", first);
  recovery.hold("second", second);
  await expect(recovery.repairAccount("account", ["first", "second"], async () => {})).rejects.toThrow("Chat unavailable");
  expect(second).toHaveBeenCalledOnce();
  expect(recovery.hasPending("first")).toBe(true);
  expect(recovery.hasPending("second")).toBe(false);
  await recovery.repairAccount("account", ["first", "second"], async () => {});
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledOnce();
  expect(recovery.hasPending("first")).toBe(false);
});

it("includes a newly blocked account member while the first held submission is restarting", async () => {
  const recovery = new MonoCodexStorageRecovery();
  let started!: () => void;
  const callbackStarted = new Promise<void>(resolve => { started = resolve; });
  let finish!: (accepted: boolean) => void;
  recovery.hold("first", () => {
    started();
    return new Promise<boolean>(resolve => { finish = resolve; });
  });
  const repair = recovery.repairAccount("account", ["first"], async () => {});
  await callbackStarted;
  expect(recovery.isRepairingAccount("account")).toBe(true);
  const second = vi.fn(async () => true);
  recovery.hold("second", second);
  expect(recovery.repairAccount("account", ["second"], async () => {})).toBe(repair);
  finish(true);
  await repair;
  expect(second).toHaveBeenCalledOnce();
  expect(recovery.isRepairingAccount("account")).toBe(false);
});

it("waits for an in-flight preparation to retain its failed submission before account relinking", async () => {
  const recovery = new MonoCodexStorageRecovery();
  let fail!: (error: Error) => void;
  const submit = vi.fn(async () => true);
  const preparing = recovery.prepare("member",
    () => new Promise<void>((_, reject) => { fail = reject; }),
    submit,
    () => recovery.hold("member", submit));
  const relink = vi.fn(async () => { expect(recovery.hasPending("member")).toBe(true); });
  const repair = recovery.repairAccount("account", ["member"], async () => {
    await recovery.waitForPreparations(["member"]);
    await relink();
  });
  expect(recovery.isPreparing("member")).toBe(true);
  expect(relink).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  fail(new Error("Codex storage needs repair: hooks.json"));
  expect(await preparing).toBe(true);
  await repair;
  expect(relink).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
  expect(recovery.isPreparing("member")).toBe(false);
  expect(recovery.hasPending("member")).toBe(false);
});

it("keeps every held account prompt if native resolution fails", async () => {
  const recovery = new MonoCodexStorageRecovery();
  const submit = vi.fn(async () => true);
  recovery.hold("member", submit);
  await expect(recovery.repairAccount("account", ["member"], async () => { throw new Error("File changed"); })).rejects.toThrow("File changed");
  expect(submit).not.toHaveBeenCalled();
  expect(recovery.hasPending("member")).toBe(true);
  await recovery.repairAccount("account", ["member"], async () => {});
  expect(submit).toHaveBeenCalledOnce();
  expect(recovery.hasPending("member")).toBe(false);
});
