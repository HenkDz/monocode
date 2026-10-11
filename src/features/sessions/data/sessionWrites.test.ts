import { expect, it, vi } from "vitest";
import { newSession } from "../model/session";
import { upsertSession, writeSession, flushSessionWrites, getSession, retainSessionWrite, sessionWriteNeedsReconciliation, deleteSession } from "./sessionStore";

const { invoke, claudeShellCommands } = vi.hoisted(() => ({ invoke: vi.fn(), claudeShellCommands: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../../platform/tauri/fs", () => ({ claudeShellCommands }));

it("continues a session after a failed update", async () => {
  const read = vi.fn(async () => "saved");
  const failed = writeSession("failed-origin", async () => { throw Error("Disk unavailable"); });
  const next = writeSession("failed-origin", read);
  await expect(failed).rejects.toThrow("Disk unavailable");
  await expect(next).resolves.toBe("saved");
  expect(read).toHaveBeenCalledOnce();
});

it("does not block an unrelated originating session", async () => {
  let release!: () => void;
  const pending = writeSession("busy-origin", () => new Promise<void>(resolve => { release = resolve; }));
  await expect(writeSession("other-origin", async () => "saved")).resolves.toBe("saved");
  release();
  await pending;
});

it("holds writers until reconciliation publishes, and retains the guard after a failed read", async () => {
  const sessionId = "uncertain-origin";
  let current = "unpublished";
  const reconcile = vi.fn(async (): Promise<void> => { throw Error("History unavailable"); });
  retainSessionWrite(sessionId, reconcile);
  const writer = vi.fn(async () => current);
  await expect(writeSession(sessionId, writer)).rejects.toThrow("History unavailable");
  expect(writer).not.toHaveBeenCalled();
  expect(sessionWriteNeedsReconciliation(sessionId)).toBe(true);
  await expect(writeSession("unrelated-chat", async () => "saved")).resolves.toBe("saved");
  let release!: () => void;
  reconcile.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    current = "published";
  });
  const saving = writeSession(sessionId, writer);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(writer).not.toHaveBeenCalled();
  release();
  await expect(saving).resolves.toBe("published");
  expect(sessionWriteNeedsReconciliation(sessionId)).toBe(false);
});

it("drops a retained reconciliation only after a session deletion succeeds", async () => {
  const sessionId = "deleted-uncertain-origin";
  retainSessionWrite(sessionId, async () => { throw Error("Unpublished origin"); });
  invoke.mockRejectedValueOnce(Error("Delete failed"));
  await expect(deleteSession(sessionId)).rejects.toThrow("Delete failed");
  expect(sessionWriteNeedsReconciliation(sessionId)).toBe(true);
  invoke.mockResolvedValueOnce(undefined);
  await deleteSession(sessionId);
  expect(sessionWriteNeedsReconciliation(sessionId)).toBe(false);
});

it("reads an upsert source after the previous write and publication, and flush waits for both", async () => {
  let current = { ...newSession("codex", "C:/synthetic/Atlas"), id: "lazy-source", blocks: [
    { id: "user", role: "user" as const, text: "Before" },
  ] };
  invoke.mockImplementation(async (_, args) => ({ ...args.session, createdAt: 1, updatedAt: 2 }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = writeSession(current.id, async () => {
    await gate;
    current = { ...current, blocks: [...current.blocks, { id: "goal-origin", role: "user", text: "Goal" }] };
  });
  const saving = upsertSession(() => current);
  let flushed = false;
  const flushing = flushSessionWrites().then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  release();
  await Promise.all([pending, saving, flushing]);
  expect(invoke.mock.calls.at(-1)?.[1].session.blocks.map((block: { id: string }) => block.id))
    .toEqual(["user", "goal-origin"]);
  expect(flushed).toBe(true);
});

it("rejects a source whose identity changes while waiting", async () => {
  const original = { ...newSession("codex", "C:/synthetic/Atlas"), id: "identity-source" };
  let current = original;
  const saving = upsertSession(() => current);
  current = { ...original, id: "different-source" };
  await expect(saving).rejects.toThrow("session identity changed");
});

it("keeps a load repair inside the session boundary before a concurrent save selects its snapshot", async () => {
  const record = { ...newSession("claude", "C:/synthetic/Atlas"), id: "repair-source", providerSessionId: "synthetic-provider",
    createdAt: 1, updatedAt: 2, blocks: [
      { id: "user", role: "user", text: "Chat" },
      { id: "tool", role: "tool", text: "Shell", tool: { kind: "execute", callId: "call", title: "Shell" } },
    ] };
  let release!: () => void;
  claudeShellCommands.mockReturnValue(new Promise(resolve => { release = () => resolve({ call: "echo repair" }); }));
  invoke.mockImplementation(async (command, args) => command === "session_get"
    ? record : { ...args.session, createdAt: 1, updatedAt: 2 });
  const loading = getSession(record.id);
  await vi.waitFor(() => expect(claudeShellCommands).toHaveBeenCalledOnce());
  const snapshot = vi.fn(() => ({ ...newSession("claude", "C:/synthetic/Atlas"), id: record.id, blocks: [
    { id: "goal-origin", role: "user" as const, text: "New goal" },
  ] }));
  const saving = upsertSession(snapshot);
  expect(snapshot).toHaveBeenCalledTimes(1); // Only the queue identity is read before waiting.
  release();
  await Promise.all([loading, saving]);
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls.slice(-2).map(([, args]) => args.session.blocks.map((block: { id: string }) => block.id)))
    .toEqual([["user", "tool"], ["goal-origin"]]);
});
