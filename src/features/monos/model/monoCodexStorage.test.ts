import { expect, it, vi } from "vitest";
import { isCodexStorageError, MonoCodexStorageRecovery } from "./monoCodexStorage";

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
