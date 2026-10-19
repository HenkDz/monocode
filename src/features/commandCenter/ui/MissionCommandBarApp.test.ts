import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

// Exercise the small App hook without mounting the native/provider shell.
function adapter() {
  const source = readFileSync(new URL("../../../app/App.tsx", import.meta.url), "utf8");
  const marker = source.indexOf("CC7N shell hook");
  const start = source.indexOf("onSubmit={async (text, submission, event) => {", marker) + "onSubmit={".length;
  const end = source.indexOf("}} />}", start) + 1;
  expect(marker).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  let grand: { id: string; role: string; archivedAt?: number } | undefined = { id: "grand", role: "orchestrator" };
  const session = { id: "grand-session" };
  const dependencies = {
    findMono: vi.fn((id: string) => id === grand?.id ? grand : undefined),
    listMonos: vi.fn(() => grand ? [grand] : []),
    ensureMonoSession: vi.fn(async (_id: string, _options: { add: (session: unknown) => void }) => session),
    homeDir: "synthetic-home", ensureOpenSession: vi.fn(), saveMonoPermissions: vi.fn(), newDefaultSession: vi.fn(),
    sessionsRef: { current: [] as unknown[] }, setSessions: vi.fn(),
    submitMonoGoalRef: { current: vi.fn(async () => true) },
    submitSession: vi.fn(async () => true),
  };
  const submit = Function(...Object.keys(dependencies), `return (${source.slice(start, end)});`)(...Object.values(dependencies)) as
    (text: string, submission?: { ownerId: string }) => Promise<boolean>;
  return { submit, dependencies, replace: (value: typeof grand) => { grand = value; } };
}

it("opens the existing Grand session and sends Chat through its normal submit adapter", async () => {
  const f = adapter();
  expect(await f.submit("What is happening?")).toBe(true);
  expect(f.dependencies.ensureMonoSession).toHaveBeenCalledWith("grand", expect.objectContaining({ home: "synthetic-home" }));
  expect(f.dependencies.submitSession).toHaveBeenCalledWith("grand-session", "What is happening?", [], { composerEvent: undefined });
  expect(f.dependencies.submitMonoGoalRef.current).not.toHaveBeenCalled();
});

it("passes the unchanged goal envelope to CC5-C and adds sessions to the existing store", async () => {
  const f = adapter();
  const submission = { ownerId: "grand", requestId: "stable-request", userMessageId: "stable-origin" };
  expect(await f.submit("Fix Atlas", submission)).toBe(true);
  expect(f.dependencies.submitMonoGoalRef.current).toHaveBeenCalledWith("grand-session", "Fix Atlas", [], submission, false, undefined);
  expect(f.dependencies.submitSession).not.toHaveBeenCalled();
  const options = f.dependencies.ensureMonoSession.mock.calls[0][1];
  options.add({ id: "created" });
  expect(f.dependencies.sessionsRef.current).toEqual([{ id: "created" }]);
  expect(f.dependencies.setSessions).toHaveBeenCalledWith([{ id: "created" }]);
});

it("rejects a stale or archived goal owner before any session or model submission", async () => {
  const f = adapter();
  await expect(f.submit("Fix Atlas", { ownerId: "replaced-grand" })).rejects.toThrow("no longer available");
  f.replace({ id: "grand", role: "orchestrator", archivedAt: 1 });
  await expect(f.submit("Fix Atlas", { ownerId: "grand" })).rejects.toThrow("no longer available");
  expect(f.dependencies.ensureMonoSession).not.toHaveBeenCalled();
  expect(f.dependencies.submitSession).not.toHaveBeenCalled();
  expect(f.dependencies.submitMonoGoalRef.current).not.toHaveBeenCalled();
});
