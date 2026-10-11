import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (line: string) => void>(),
  sent: [] as { method: string; params?: Record<string, unknown> }[],
  archived: false,
  missing: false,
  unloadedThread: undefined as string | undefined,
  loaded: false,
  failure: undefined as { method: string; message: string } | undefined,
  restoredPath: "/mono/default/sessions/rollout-root.jsonl",
  release: vi.fn(),
  spawn: vi.fn(async (..._args: unknown[]) => undefined),
  kill: vi.fn(async (_id: string) => undefined),
  prepare: vi.fn(async (..._args: unknown[]): Promise<{ home: string; hasThread: boolean; skillsContextId?: string; threadPath?: string }> => ({
    home: "/mono/default",
    hasThread: false,
  })),
  copy: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
}));

vi.mock("../../core/child", () => ({
  acquireHarnessBridge: async () => mock.release,
  prepareMonoCodexStore: mock.prepare,
  copyMonoCodexThreads: mock.copy,
  spawnChild: mock.spawn,
  killChild: mock.kill,
  watchChild: (id: string, line: (line: string) => void) =>
    mock.handlers.set(id, line),
  unwatchChild: (id: string) => mock.handlers.delete(id),
  writeChild: async (childId: string, line: string) => {
    const request = JSON.parse(line);
    mock.sent.push(request);
    if (request.id === undefined) return;
    if (request.method === mock.failure?.method) {
      mock.handlers.get(childId)?.(JSON.stringify({ id: request.id, error: { message: mock.failure.message } }));
      return;
    }
    let result: unknown = {};
    if (request.method === "config/read") {
      result = {
        config: {
          model: null,
          instructions: "Shared account instructions",
          sqlite_home: "/ordinary",
          model_instructions_file: "/ordinary/instructions.md",
        },
      };
    } else if (request.method === "thread/read") {
      if (request.params.threadId === mock.unloadedThread && !mock.loaded) {
        mock.handlers.get(childId)?.(JSON.stringify({ id: request.id, error: { message: `thread not loaded: ${request.params.threadId}` } }));
        return;
      }
      if (mock.missing) {
        mock.handlers.get(childId)?.(
          JSON.stringify({
            id: request.id,
            error: { message: "thread not found" },
          }),
        );
        return;
      }
      const id = request.params.threadId;
      result = {
        thread: {
          id,
          path: `/ordinary/${mock.archived ? "archived_sessions" : "sessions"}/rollout-${id}.jsonl`,
        },
      };
    } else if (request.method === "thread/resume") {
      mock.loaded = true;
      result = { thread: { id: request.params.threadId } };
    } else if (request.method === "thread/list") {
      const id = request.params.archived
        ? "archived-child"
        : request.params.cursor
          ? "second-child"
          : "child";
      result = {
        data: [{ id }],
        nextCursor:
          !request.params.archived && !request.params.cursor ? "page-2" : null,
      };
    } else if (request.method === "thread/archive") {
      mock.archived = true;
    } else if (request.method === "thread/unarchive") {
      mock.archived = false;
      result = { thread: { id: request.params.threadId, path: mock.restoredPath } };
    }
    mock.handlers.get(childId)?.(JSON.stringify({ id: request.id, result }));
  },
}));

import { codexConfigOverrides, prepareCodexMonoContext } from "./codexStore";
const input = {
  sessionId: "mono-chat",
  path: "/codex",
  cwd: "/project",
  providerAccountId: "account",
};

beforeEach(() => {
  mock.handlers.clear();
  mock.sent.length = 0;
  mock.archived = false;
  mock.missing = false;
  mock.unloadedThread = undefined;
  mock.loaded = false;
  mock.failure = undefined;
  mock.restoredPath = "/mono/default/sessions/rollout-root.jsonl";
  vi.clearAllMocks();
  mock.prepare.mockResolvedValue({ home: "/mono/default", hasThread: false });
  mock.copy.mockResolvedValue(undefined);
});

it("omits nested unset settings while preserving typed account configuration", () => {
  expect(
    codexConfigOverrides(
      {
        model: null,
        shell_environment_policy: {
          inherit: null,
          include_only: null,
          exclude: ["TOKEN"],
          set: { MONO: "yes" },
        },
        agents: {
          helper: { config_file: "/account/helper.toml", description: null },
        },
        enabled: false,
      },
      "/mono",
    ),
  ).toEqual({
    shell_environment_policy: { exclude: ["TOKEN"], set: { MONO: "yes" } },
    agents: { helper: { config_file: "/account/helper.toml" } },
    enabled: false,
    sqlite_home: "/mono",
  });
});

it("uses the account's resolved settings with an isolated SQLite home", async () => {
  const prepared = await prepareCodexMonoContext(input);
  expect(prepared).toEqual({
    config: {
      instructions: "Shared account instructions",
      model_instructions_file: "/ordinary/instructions.md",
      sqlite_home: "/mono/default",
    },
    hasThread: false,
  });
  expect(mock.spawn).toHaveBeenCalledWith(
    expect.any(String),
    "/codex",
    ["app-server"],
    "/project",
    { provider: "codex", id: "account" },
    "codex",
  );
  expect(mock.sent.map((r) => r.method)).toEqual([
    "initialize",
    "initialized",
    "config/read",
  ]);
  expect(mock.release).toHaveBeenCalledOnce();
  expect(mock.kill).toHaveBeenCalledOnce();
  expect(mock.handlers.size).toBe(0);
});

it("passes the runtime discovery context separately while SQLite remains in the base Mono home", async () => {
  const skillsContextId = "b".repeat(64);
  mock.prepare.mockResolvedValueOnce({ home: "/mono/default", hasThread: false, skillsContextId });
  expect(await prepareCodexMonoContext(input)).toMatchObject({ config: { sqlite_home: "/mono/default" }, skillsContextId });
  expect(mock.spawn.mock.calls[0]).toHaveLength(6);
});

it.each(["base", "prior-context"])("retains the native validated %s rollout path independently from SQLite", async location => {
  const threadPath = `/mono/${location}/sessions/rollout-root.jsonl`;
  mock.prepare.mockResolvedValueOnce({ home: "/mono/default", hasThread: true, threadPath });
  expect(await prepareCodexMonoContext({ ...input, threadId: "root" })).toMatchObject({ config: { sqlite_home: "/mono/default" }, hasThread: true, threadPath });
});

it("retains the rooted copied rollout path after the initial account migration", async () => {
  const threadPath = "/mono/default/archived_sessions/rollout-root.jsonl";
  mock.copy.mockResolvedValueOnce(threadPath);
  expect(await prepareCodexMonoContext({ ...input, threadId: "root" })).toMatchObject({ hasThread: true, threadPath });
});

it("restores an archived saved thread through the selected Mono home before resume", async () => {
  const skillsContextId = "b".repeat(64);
  mock.archived = true;
  mock.prepare.mockResolvedValueOnce({ home: "/mono/default", hasThread: true, skillsContextId,
    threadPath: "/mono/default/archived_sessions/rollout-root.jsonl" });
  const prepared = await prepareCodexMonoContext({ ...input, threadId: "root" });
  expect(prepared).toMatchObject({ hasThread: true, skillsContextId, threadPath: mock.restoredPath });
  expect(mock.spawn.mock.calls[0]).toEqual([expect.any(String), "/codex", ["app-server"], "/project",
    { provider: "codex", id: "account" }, "codex", "mono", undefined, skillsContextId]);
  expect(mock.sent.map(r => r.method)).toEqual(["initialize", "initialized", "thread/unarchive", "initialize", "initialized", "config/read"]);
  expect(mock.sent.some(r => ["thread/start", "thread/resume", "turn/start"].includes(r.method))).toBe(false);
  expect(mock.kill).toHaveBeenCalledTimes(2);
  expect(mock.release).toHaveBeenCalledTimes(2);
});

it.each(["/mono/default/archived_sessions/rollout-root.jsonl", ""])("fails closed if native restore returns an unusable path %s", async restoredPath => {
  mock.restoredPath = restoredPath;
  mock.prepare.mockResolvedValueOnce({ home: "/mono/default", hasThread: true,
    threadPath: "/mono/default/archived_sessions/rollout-root.jsonl" });
  await expect(prepareCodexMonoContext({ ...input, threadId: "root" })).rejects.toThrow("did not restore the saved Mono context");
  expect(mock.sent.some(r => ["thread/start", "thread/resume", "turn/start"].includes(r.method))).toBe(false);
  expect(mock.handlers.size).toBe(0);
  expect(mock.kill).toHaveBeenCalledOnce();
});

it("keeps the saved context intact when native unarchive fails", async () => {
  mock.prepare.mockResolvedValueOnce({ home: "/mono/default", hasThread: true,
    threadPath: "/mono/default/archived_sessions/rollout-root.jsonl" });
  mock.failure = { method: "thread/unarchive", message: "archive unavailable" };
  await expect(prepareCodexMonoContext({ ...input, threadId: "root" })).rejects.toThrow("Codex storage restore: archive unavailable");
  expect(mock.copy).not.toHaveBeenCalled();
  expect(mock.sent.some(r => ["thread/start", "thread/resume", "turn/start"].includes(r.method))).toBe(false);
  expect(mock.handlers.size).toBe(0);
});

it("forwards sandbox continuity requirements without coalescing full-access preparation", async () => {
  let accept: (() => void) | undefined;
  mock.prepare.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { accept = resolve; });
    return { home: "/mono/default", hasThread: false };
  });
  const fullAccess = prepareCodexMonoContext({ ...input, sandboxRequired: false });
  const sandboxed = prepareCodexMonoContext({ ...input, sandboxRequired: true });
  expect(mock.prepare).toHaveBeenCalledTimes(1);
  accept?.();
  await Promise.all([fullAccess, sandboxed]);
  expect(mock.prepare).toHaveBeenCalledTimes(2);
  expect(mock.prepare.mock.calls.map(call => call[2])).toEqual([
    expect.objectContaining({ sandboxRequired: false }), expect.objectContaining({ sandboxRequired: true }),
  ]);
});

it("replaces inherited skill and plugin enablement while preserving account paths and other settings", () => {
  expect(codexConfigOverrides({
    model: "account-model", skills: { config: [{ path: "/account/global", enabled: true }], extra: "retained" },
    plugins: { "ponytail@test": { enabled: true, cache_path: "/account/plugins/ponytail" }, "other@test": { enabled: false } },
  }, "/mono", { skills: { config: [{ path: "/account/global", enabled: false }], bundled: { enabled: false } }, plugins: { "ponytail@test": { enabled: false } } })).toEqual({
    model: "account-model", sqlite_home: "/mono",
    skills: { config: [{ path: "/account/global", enabled: false }], extra: "retained", bundled: { enabled: false } },
    plugins: { "ponytail@test": { enabled: false, cache_path: "/account/plugins/ponytail" }, "other@test": { enabled: false } },
  });
});

it("archives the old root and retains all native descendants before resuming privately", async () => {
  const prepared = await prepareCodexMonoContext({
    ...input,
    threadId: "root",
  });
  expect(prepared.hasThread).toBe(true);
  expect(mock.sent.filter((r) => r.method === "thread/list")).toHaveLength(3);
  expect(mock.sent.filter((r) => r.method === "thread/archive")).toEqual([
    {
      id: expect.any(Number),
      method: "thread/archive",
      params: { threadId: "root" },
    },
  ]);
  expect(mock.copy).toHaveBeenCalledWith(
    "account",
    "root",
    [
      "/ordinary/archived_sessions/rollout-root.jsonl",
      "/ordinary/archived_sessions/rollout-child.jsonl",
      "/ordinary/archived_sessions/rollout-second-child.jsonl",
      "/ordinary/archived_sessions/rollout-archived-child.jsonl",
    ],
    "/ordinary",
  );
  expect(
    mock.sent.some((r) =>
      ["thread/start", "turn/start", "thread/resume"].includes(r.method),
    ),
  ).toBe(false);
});

it("does not reopen the ordinary home for an already migrated startup thread", async () => {
  mock.prepare.mockResolvedValue({ home: "/mono/default", hasThread: true });
  await expect(
    prepareCodexMonoContext({
      ...input,
      threadId: "root",
      migrationOnly: true,
    }),
  ).resolves.toEqual({ config: {}, hasThread: true });
  expect(mock.spawn).not.toHaveBeenCalled();
  expect(mock.copy).not.toHaveBeenCalled();
});

it("can migrate an archived legacy root without archiving it twice", async () => {
  mock.archived = true;
  await prepareCodexMonoContext({ ...input, threadId: "root" });
  expect(mock.copy).toHaveBeenCalledOnce();
  expect(mock.sent.some((r) => r.method === "thread/archive")).toBe(false);
});

it("restores the original root if retaining its context fails", async () => {
  mock.copy.mockRejectedValueOnce(new Error("Disk full"));
  await expect(
    prepareCodexMonoContext({ ...input, threadId: "root" }),
  ).rejects.toThrow("Disk full");
  expect(mock.sent.at(-1)).toMatchObject({
    method: "thread/unarchive",
    params: { threadId: "root" },
  });
  expect(mock.archived).toBe(false);
  expect(mock.release).toHaveBeenCalledOnce();
  expect(mock.handlers.size).toBe(0);
  // Failed work releases the lock and can be retried.
  await expect(
    prepareCodexMonoContext({ ...input, threadId: "root" }),
  ).resolves.toMatchObject({ hasThread: true });
});

it("keeps normal recovery available when an old thread was already removed", async () => {
  mock.missing = true;
  await expect(
    prepareCodexMonoContext({ ...input, threadId: "deleted" }),
  ).resolves.toMatchObject({ hasThread: false });
  expect(mock.copy).not.toHaveBeenCalled();
  expect(mock.sent.some((r) => r.method === "thread/archive")).toBe(false);
});

it.each(["thread not loaded: another-thread", "database file not found"])("labels a thread/read failure without discarding saved context: %s", async message => {
  mock.failure = { method: "thread/read", message };
  await expect(prepareCodexMonoContext({ ...input, threadId: "root" })).rejects.toThrow(`Codex storage thread/read: ${message}`);
  expect(mock.copy).not.toHaveBeenCalled();
  expect(mock.sent.some(request => ["thread/start", "thread/resume", "thread/archive", "turn/start"].includes(request.method))).toBe(false);
  expect(mock.kill).toHaveBeenCalledOnce();
  expect(mock.release).toHaveBeenCalledOnce();
  expect(mock.handlers.size).toBe(0);
});

it("loads the same saved thread once before rereading and migrating its exact context", async () => {
  mock.unloadedThread = "root";
  await expect(prepareCodexMonoContext({ ...input, threadId: "root" })).resolves.toMatchObject({ hasThread: true });
  expect(mock.sent.slice(3, 6)).toEqual([
    { id: expect.any(Number), method: "thread/read", params: { threadId: "root", includeTurns: false } },
    { id: expect.any(Number), method: "thread/resume", params: { threadId: "root" } },
    { id: expect.any(Number), method: "thread/read", params: { threadId: "root", includeTurns: false } },
  ]);
  expect(mock.sent.filter(request => request.method === "thread/resume")).toHaveLength(1);
  expect(mock.sent.some(request => ["thread/start", "turn/start"].includes(request.method))).toBe(false);
  expect(mock.copy).toHaveBeenCalledWith("account", "root", ["/ordinary/archived_sessions/rollout-root.jsonl", "/ordinary/archived_sessions/rollout-child.jsonl", "/ordinary/archived_sessions/rollout-second-child.jsonl", "/ordinary/archived_sessions/rollout-archived-child.jsonl"], "/ordinary");
});

it.each(["thread/resume", "thread/read"])("retains context if the same-thread loading recovery fails at %s", async method => {
  mock.unloadedThread = "root";
  mock.failure = { method, message: "thread not loaded: root" };
  await expect(prepareCodexMonoContext({ ...input, threadId: "root" })).rejects.toThrow(`Codex storage ${method}: thread not loaded: root`);
  expect(mock.sent.filter(request => request.method === "thread/resume")).toHaveLength(1);
  expect(mock.sent.filter(request => request.method === "thread/read")).toHaveLength(method === "thread/read" ? 2 : 1);
  expect(mock.copy).not.toHaveBeenCalled();
  expect(mock.sent.some(request => ["thread/start", "turn/start", "thread/archive"].includes(request.method))).toBe(false);
  expect(mock.kill).toHaveBeenCalledOnce();
  expect(mock.release).toHaveBeenCalledOnce();
  expect(mock.handlers.size).toBe(0);
});

it("does not label a later copy failure with the successfully recovered read method", async () => {
  mock.unloadedThread = "root";
  mock.copy.mockRejectedValueOnce(new Error("Disk full"));
  await expect(prepareCodexMonoContext({ ...input, threadId: "root" })).rejects.toThrow(/^Disk full$/);
  expect(mock.sent.at(-1)?.method).toBe("thread/unarchive");
  expect(mock.archived).toBe(false);
});

it("coalesces an overlapping startup migration and send preparation", async () => {
  const first = prepareCodexMonoContext({ ...input, threadId: "root" });
  const second = prepareCodexMonoContext({ ...input, threadId: "root" });
  expect(second).toBe(first);
  await Promise.all([first, second]);
  expect(mock.copy).toHaveBeenCalledOnce();
  expect(mock.spawn).toHaveBeenCalledOnce();
});
