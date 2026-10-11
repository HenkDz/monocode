// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../features/sessions/model/session";
import { migrateMonoWorkingDirectory } from "../features/monos/model/monoWorkingDirectory";

beforeEach(() => localStorage.clear());
const source = readFileSync(resolve("src/app/App.tsx"), "utf8");

/** Exercise App's actual preflight before its storage/Manager/provider paths. */
function preparation() {
  const start = source.indexOf("const workingMono =", source.indexOf("CC8W: saved chats"));
  const end = source.indexOf('if (remote?.harness === "codex"', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const mono = { id: "grand", role: "orchestrator" as const, projects: ["/project"], mascot: "cat", color: "#abc" };
  let present = true;
  let session: Session = { ...newSession("codex", "/home"), id: "chat", providerSessionId: "saved-thread" };
  const directories = { home: vi.fn(async () => "/home"), workspace: vi.fn(async () => "/scratch/grand") };
  const dependencies = {
    monoForSession: () => present ? mono : undefined,
    findMono: () => present ? mono : undefined,
    habitRunMono: () => undefined,
    monoWorkingDirectoryPreparing: { current: new Set<string>() },
    turnGen: { current: new Map<string, number>() },
    migrateMonoWorkingDirectory: (owner: typeof mono, current: Session, save: (next: Session) => Promise<unknown>) => migrateMonoWorkingDirectory(owner, current, save, directories),
    saveMonoWorkingDirectory: vi.fn(async (next: Session) => { session = next; return {}; }),
    submitSessionRef: { current: vi.fn(async () => true) },
    saveDraftRef: { current: vi.fn() },
    enqueueHarnessEvent: vi.fn(), flushHarnessEvents: vi.fn(),
  };
  const execute = Function(...Object.keys(dependencies),
    `return (remote, sessionId, text, attachments, options) => { ${source.slice(start, end)} return false; };`,
  )(...Object.values(dependencies)) as (session: Session, id: string, text: string, attachments: unknown[], options?: { monoWorkingDirectoryPrepared?: boolean; managed?: boolean; onSettled?: (value: unknown) => void }) => boolean | Promise<boolean>;
  return { dependencies, directories, session: () => session, removeMono: () => { present = false; }, submit: (options?: Parameters<typeof execute>[4]) => execute(session, session.id, "Keep the request", [], options) };
}

it("persists the migrated folder before retrying the same submission and native thread", async () => {
  const f = preparation();
  f.dependencies.submitSessionRef.current.mockImplementation(async () => {
    expect(f.session().cwd).toBe("/scratch/grand");
    expect(f.session().providerSessionId).toBe("saved-thread");
    return true;
  });
  expect(await f.submit()).toBe(true);
  expect(f.dependencies.submitSessionRef.current).toHaveBeenCalledWith("chat", "Keep the request", [], { monoWorkingDirectoryPrepared: true });
});

it("rejects a duplicate while directory creation is pending and releases the preparation lock", async () => {
  const f = preparation();
  let ready!: (cwd: string) => void;
  f.directories.workspace.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  const first = f.submit();
  await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
  expect(f.submit()).toBe(false);
  ready("/scratch/grand");
  expect(await first).toBe(true);
  expect(f.dependencies.submitSessionRef.current).toHaveBeenCalledOnce();
  expect(f.dependencies.monoWorkingDirectoryPreparing.current.size).toBe(0);
});

it.each(["stop", "remove"])("does not submit after %s during folder preparation", async action => {
  const f = preparation();
  let ready!: (cwd: string) => void;
  f.directories.workspace.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  const pending = f.submit();
  await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
  if (action === "stop") f.dependencies.turnGen.current.set("chat", 1);
  else f.removeMono();
  ready("/scratch/grand");
  expect(await pending).toBe(false);
  expect(f.dependencies.submitSessionRef.current).not.toHaveBeenCalled();
  expect(f.dependencies.saveDraftRef.current).toHaveBeenCalledWith("chat", "Keep the request", []);
});

it("retains an interactive prompt and shows persistence failure without starting a turn", async () => {
  const f = preparation();
  f.dependencies.saveMonoWorkingDirectory.mockRejectedValueOnce(Error("Disk full"));
  expect(await f.submit()).toBe(false);
  expect(f.session().cwd).toBe("/home");
  expect(f.dependencies.saveDraftRef.current).toHaveBeenCalledWith("chat", "Keep the request", []);
  expect(f.dependencies.enqueueHarnessEvent).toHaveBeenCalledWith("chat", { type: "session.error", message: "Error: Disk full" });
  expect(f.dependencies.submitSessionRef.current).not.toHaveBeenCalled();
});

it("settles managed preparation failures and lets a later attempt retry", async () => {
  const f = preparation();
  const settled = vi.fn();
  f.dependencies.saveMonoWorkingDirectory.mockRejectedValueOnce(Error("Disk full"));
  expect(await f.submit({ managed: true, onSettled: settled })).toBe(false);
  expect(settled).toHaveBeenCalledWith({ status: "failed", text: "", error: "Error: Disk full" });
  expect(f.dependencies.saveDraftRef.current).not.toHaveBeenCalled();
  expect(await f.submit()).toBe(true);
});

it("restores an interactive prompt when the later storage or routing stage rejects it", async () => {
  const f = preparation();
  f.dependencies.submitSessionRef.current.mockResolvedValueOnce(false);
  expect(await f.submit()).toBe(false);
  expect(f.dependencies.saveDraftRef.current).toHaveBeenCalledWith("chat", "Keep the request", []);
});

function persistence(saved: unknown) {
  const start = source.indexOf("async (next: Session, previousCwd: string) =>", source.indexOf("const saveMonoWorkingDirectory"));
  const end = source.indexOf(", [upsertSession]);", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const original = { ...newSession("codex", "/home"), providerSessionId: "saved-thread" };
  const sessionsRef: { current: Session[] } = { current: [{ ...original, model: "codex:new-user-choice" }] };
  const snapshots: Session[] = [];
  const upsertSession = vi.fn(async (_next: Session, change: (current: Session) => Session) => {
    snapshots.push(change(sessionsRef.current[0]));
    if (saved) sessionsRef.current = [change(sessionsRef.current[0])];
    return saved;
  });
  const setSessions = vi.fn((sessions: Session[]) => { sessionsRef.current = sessions; });
  const code = source.slice(start, end).replace("next: Session, previousCwd: string", "next, previousCwd");
  const save = Function("upsertSession", "sessionsRef", "flushSync", "setSessions", `return (${code});`)(upsertSession, sessionsRef, (callback: () => void) => callback(), setSessions) as
    (next: Session, previousCwd: string) => Promise<unknown>;
  return { save, original, snapshots, sessionsRef, setSessions };
}

it("saves through App's writer with the latest profile and publishes the new folder", async () => {
  const f = persistence({ id: "saved" });
  await f.save({ ...f.original, cwd: "/scratch" }, "/home");
  expect(f.snapshots[0].model).toBe("codex:new-user-choice");
  expect(f.sessionsRef.current[0]).toMatchObject({ cwd: "/scratch", model: "codex:new-user-choice", providerSessionId: "saved-thread" });
});

it("does not publish an unsaved provider conversation and rejects a changed source folder", async () => {
  const f = persistence(null);
  await expect(f.save({ ...f.original, cwd: "/scratch" }, "/home")).rejects.toThrow("could not be saved");
  expect(f.sessionsRef.current[0].cwd).toBe("/home");
  expect(f.setSessions).not.toHaveBeenCalled();
  f.sessionsRef.current[0].cwd = "/user-choice";
  await expect(f.save({ ...f.original, cwd: "/scratch" }, "/home")).rejects.toThrow("conversation changed");
  expect(f.sessionsRef.current[0].cwd).toBe("/user-choice");
});
