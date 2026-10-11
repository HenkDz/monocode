// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Mono } from "./mono";
import { newSession } from "../../sessions/model/session";
import { loadMonoFiles, planAgentContext, planOrgContext, recordAgentContext, recordOrgContext } from "./monoFiles";
import { rotateProviderContext } from "./monoRotation";
import { monoWorkingDirectoryNeedsResume } from "./monoWorkingDirectoryMigration";
import { changeMonoWorkingDirectory, defaultMonoWorkingDirectory, ensureMonoWorkingDirectory, isMonoHomeDirectory, migrateMonoWorkingDirectory } from "./monoWorkingDirectory";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "/data/monos/mono/workspace") }));
vi.mock("./monoFiles", async original => ({ ...await original<object>(), loadMonoFiles: vi.fn(async () => ({})) }));

beforeEach(() => localStorage.clear());
const mono = (role?: Mono["role"], projects = ["/project"]): Mono => ({ id: "mono", role, projects, mascot: "cat", color: "#abc" });
const host = () => ({ home: vi.fn(async () => "C:/Users/me"), workspace: vi.fn(async () => "/data/monos/mono/workspace") });

it.each([undefined, "manager", "member"] as const)("uses the project for %s and never a home assignment", async role => {
  const directories = host();
  expect(await defaultMonoWorkingDirectory(mono(role), directories)).toBe("/project");
  expect(await defaultMonoWorkingDirectory(mono(role, ["c:\\Users\\ME\\", "/other"]), directories)).toBe("/other");
  expect(directories.workspace).not.toHaveBeenCalled();
});

it("prefers the Manager's retained project and gives Grand Orch a neutral folder despite assignments", async () => {
  expect(await defaultMonoWorkingDirectory({ ...mono("manager"), managerProject: "/original" }, host())).toBe("/original");
  expect(await defaultMonoWorkingDirectory(mono("orchestrator"), host())).toBe("/data/monos/mono/workspace");
});

it.each([undefined, "orchestrator", "manager", "member"] as const)("gives project-less %s a scratch folder", async role => {
  expect(await defaultMonoWorkingDirectory(mono(role, []), host())).toBe("/data/monos/mono/workspace");
});

it.each(["C:/Users/me", "c:\\users\\ME\\", "~", ""])("recognizes legacy home cwd %s", cwd => {
  expect(isMonoHomeDirectory(cwd, "C:/Users/me")).toBe(true);
  expect(isMonoHomeDirectory("C:/Users/me/project", "C:/Users/me")).toBe(false);
});

it("migrates on the next turn with the same provider, transcript, queue, permissions and fresh context receipts", async () => {
  const session = { ...newSession("codex", "C:/Users/me"), providerSessionId: "saved-native-thread", providerAccountId: "account", blocks: [{ id: "user", role: "user" as const, text: "Keep this constraint" }], queuedMessages: [{ id: "queued", text: "Next", attachments: [] }] };
  const files = { soulHash: "soul", memoryHash: "memory" };
  recordAgentContext(session.id, session.providerSessionId, files);
  recordOrgContext(session.id, session.providerSessionId, await planOrgContext(session.id, session.providerSessionId, session.model, "org"));
  const save = vi.fn(async () => ({}));
  const migrated = await migrateMonoWorkingDirectory(mono("orchestrator"), session, save, host());
  expect(migrated).toEqual({ ...session, cwd: "/data/monos/mono/workspace" });
  expect(migrated.blocks).toBe(session.blocks);
  expect(migrated.queuedMessages).toBe(session.queuedMessages);
  expect(save).toHaveBeenCalledExactlyOnceWith(migrated);
  expect(planAgentContext(session.id, session.providerSessionId, files)).toEqual({ soul: true, memory: true });
  expect((await planOrgContext(session.id, session.providerSessionId, session.model, "org")).text).toBe("org");
  expect(session.cwd).toBe("C:/Users/me");
  expect(monoWorkingDirectoryNeedsResume(session.id, session.providerSessionId)).toBe(true);
});

it("leaves an existing project cwd and its assigned worktree unchanged", async () => {
  const session = { ...newSession("codex", "/chosen-project"), worktreeCwd: "/assigned-worktree" };
  const directories = host();
  const save = vi.fn();
  expect(await migrateMonoWorkingDirectory(mono("manager"), session, save, directories)).toBe(session);
  expect(save).not.toHaveBeenCalled();
  expect(directories.workspace).not.toHaveBeenCalled();
});

it("retains an assigned worktree when a legacy project cwd migrates, including across rotation", async () => {
  const session = { ...newSession("codex", "C:/Users/me"), providerSessionId: "saved-thread", worktreeCwd: "/assigned-worktree" };
  const migrated = await migrateMonoWorkingDirectory(mono("member"), session, async () => ({}), host());
  expect(migrated.cwd).toBe("/project");
  expect((await rotateProviderContext(migrated, async () => {})).worktreeCwd).toBe("/assigned-worktree");
  expect((await rotateProviderContext({ ...migrated, worktreeCwd: undefined }, async () => {})).cwd).toBe("/project");
});

it("keeps the original folder and receipt if persistence fails, then retries", async () => {
  const session = { ...newSession("codex", "C:/Users/me"), providerSessionId: "saved-thread" };
  const files = { soulHash: "soul", memoryHash: "memory" };
  recordAgentContext(session.id, session.providerSessionId, files);
  const save = vi.fn().mockRejectedValueOnce(Error("Disk full")).mockResolvedValue({});
  await expect(migrateMonoWorkingDirectory(mono(), session, save, host())).rejects.toThrow("Disk full");
  expect(session.cwd).toBe("C:/Users/me");
  expect(planAgentContext(session.id, session.providerSessionId, files)).toEqual({ soul: false, memory: false });
  expect((await migrateMonoWorkingDirectory(mono(), session, save, host())).cwd).toBe("/project");
});

it("refuses an unpersisted saved conversation and preserves its native thread on a user folder change", async () => {
  const session = { ...newSession("codex", "/old"), providerSessionId: "saved-thread" };
  await expect(changeMonoWorkingDirectory(session, "/chosen", async () => null)).rejects.toThrow("could not be saved");
  expect((await changeMonoWorkingDirectory(session, "/chosen", async () => ({}))).providerSessionId).toBe("saved-thread");
});

it("adopts identity files before creating the separate scratch folder", async () => {
  expect(await ensureMonoWorkingDirectory("mono")).toBe("/data/monos/mono/workspace");
  expect(loadMonoFiles).toHaveBeenCalledWith("mono");
  expect(invoke).toHaveBeenCalledWith("mono_workspace_ensure", { id: "mono" });
  expect(vi.mocked(loadMonoFiles).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(invoke).mock.invocationCallOrder.at(-1)!);
});
