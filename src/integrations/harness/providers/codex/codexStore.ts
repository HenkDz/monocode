import {
  checkMonoCodexSandbox,
  acquireHarnessBridge,
  copyMonoCodexThreads,
  killChild,
  prepareMonoCodexStore,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import { JsonRpcClient } from "../../core/jsonRpc";
import { asRecord, isRecoverableThreadResumeError } from "./codexProtocol";
import type { MonoSkillsContext } from "../../../../features/monos/model/monoSkills";

type Thread = { id: string; path?: string | null };
type PreparedContext = { config: Record<string, unknown>; hasThread: boolean; skillArgs?: string[]; skillsContextId?: string; threadPath?: string };
/** config/read includes unset options at every depth. Codex converts JSON null
 * overrides to empty TOML strings, which breaks typed tables and arrays. */
export function codexConfigOverrides(
  config: Record<string, unknown>,
  home: string,
  skillsConfig?: Record<string, unknown>,
): Record<string, unknown> {
  const withoutUnset = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.filter((item) => item !== null).map(withoutUnset);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== null)
          .map(([key, item]) => [key, withoutUnset(item)]),
      );
    }
    return value;
  };
  const table = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const resolved = withoutUnset(config) as Record<string, unknown>;
  const curated = table(withoutUnset(skillsConfig));
  return {
    ...resolved,
    ...curated,
    ...(curated.skills ? { skills: { ...table(resolved.skills), ...table(curated.skills) } } : {}),
    ...(curated.plugins ? { plugins: { ...table(resolved.plugins), ...Object.fromEntries(Object.entries(table(curated.plugins)).map(([id, flags]) => [id, { ...table(table(resolved.plugins)[id]), ...table(flags) }])) } } : {}),
    sqlite_home: home,
  };
}
const inFlight = new Map<
  string,
  { threadId?: string; migrationOnly?: boolean; skills: string; task: Promise<PreparedContext> }
>();

/** Read account configuration in its original home, then retain exact native
 * rollouts privately. No inference or transcript summarization is involved. */
export function prepareCodexMonoContext(input: MonoSkillsContext & {
  sessionId: string;
  path: string;
  cwd: string;
  providerAccountId?: string;
  threadId?: string;
  migrationOnly?: boolean;
  sandboxRequired?: boolean;
  windowsSandbox?: "unelevated";
  sandboxNetworkAccess?: boolean;
}): Promise<PreparedContext> {
  const key = `${input.providerAccountId ?? "default"}:${input.sessionId}`;
  const pending = inFlight.get(key);
  const skills = JSON.stringify([input.cwd, input.skillsRole, input.skillsPolicy, input.sandboxRequired, input.windowsSandbox, input.sandboxNetworkAccess]);
  if (pending) {
    if (
      pending.threadId === input.threadId &&
      pending.migrationOnly === input.migrationOnly && pending.skills === skills
    )
      return pending.task;
    return pending.task.then(() => prepareCodexMonoContext(input));
  }
  const task = prepare(input).finally(() => {
    if (inFlight.get(key)?.task === task) inFlight.delete(key);
  });
  inFlight.set(key, {
    threadId: input.threadId,
    migrationOnly: input.migrationOnly,
    skills,
    task,
  });
  return task;
}

async function prepare(
  input: Parameters<typeof prepareCodexMonoContext>[0],
): Promise<PreparedContext> {
  const store = await prepareMonoCodexStore(
    input.providerAccountId,
    input.threadId,
    // config/read supplies the effective project settings before any thread or turn RPC.
    { skillsRole: input.skillsRole, skillsPolicy: input.skillsPolicy, projectPath: input.cwd, sandboxRequired: false, windowsSandbox: input.windowsSandbox, sandboxNetworkAccess: input.sandboxNetworkAccess },
  );
  if (input.migrationOnly && store.hasThread)
    return { config: {}, hasThread: true, ...(store.threadPath ? { threadPath: store.threadPath } : {}) };
  if (input.threadId && store.hasThread && store.threadPath?.replace(/\\/g, "/").split("/").includes("archived_sessions")) {
    store.threadPath = await restoreMonoThread(input, store);
  }
  const release = await acquireHarnessBridge();
  const id = `${input.sessionId}:codex-store:${input.providerAccountId ?? "default"}`;
  const rpc: JsonRpcClient = new JsonRpcClient(
    id,
    {
      onRequest: (requestId, method) => {
        if (method === "currentTime/read")
          return rpc.respond(requestId, {
            currentTimeAt: Math.floor(Date.now() / 1000),
          });
        return rpc.respondError(requestId, {
          code: -32601,
          message: `Unsupported storage request: ${method}`,
        });
      },
    },
    { includeJsonrpc: false, label: "codex-store" },
  );
  let failedMethod: string | undefined;
  const request = <T = unknown>(method: string, params: unknown) => {
    failedMethod = undefined;
    return rpc.request<T>(method, params, 30_000).catch(error => {
      failedMethod = method;
      throw error;
    });
  };
  watchChild(
    id,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex storage connection exited")),
  );
  let archivedByUs = false;
  try {
    await spawnChild(
      id,
      input.path,
      ["app-server"],
      input.cwd,
      { provider: "codex", id: input.providerAccountId ?? "default" },
      "codex",
    );
    await request("initialize", {
      clientInfo: { name: "monocode", title: "MonoCode", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    await rpc.notify("initialized", undefined);
    // Codex resolves relative configuration paths against the original home.
    // Passing these resolved values preserves profiles, agents and MCP paths.
    const settings = await request<{ config: Record<string, unknown> }>(
      "config/read",
      { cwd: input.cwd },
    );
    const config = codexConfigOverrides(settings.config, store.home, store.skillsConfig);
    if (input.windowsSandbox) {
      config.windows = { ...asRecord(config.windows), sandbox: input.windowsSandbox };
    }
    if (input.sandboxRequired) {
      await checkMonoCodexSandbox({
        providerAccountId: input.providerAccountId,
        sandboxRequired: true,
        windowsSandbox: input.windowsSandbox,
        sandboxNetworkAccess: input.sandboxNetworkAccess ?? false,
        skillsContextId: store.skillsContextId,
        sandboxConfig: config,
      });
    }
    const skillArgs = {
      ...(store.skillArgs ? { skillArgs: store.skillArgs } : {}),
      ...(store.skillsContextId ? { skillsContextId: store.skillsContextId } : {}),
      ...(store.threadPath ? { threadPath: store.threadPath } : {}),
    };

    if (input.threadId && !store.hasThread) {
      let root: Thread;
      try {
        root = (
          await request<{ thread: Thread }>("thread/read", {
            threadId: input.threadId,
            includeTurns: false,
          })
        ).thread;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === `thread not loaded: ${input.threadId}`) {
          await request("thread/resume", { threadId: input.threadId });
          root = (await request<{ thread: Thread }>("thread/read", {
            threadId: input.threadId,
            includeTurns: false,
          })).thread;
        } else {
          // Match normal Codex recovery for a thread that was already deleted.
          if (isRecoverableThreadResumeError(error))
            return { config, hasThread: false, ...skillArgs };
          throw error;
        }
      }
      if (!root.path)
        throw new Error("Codex did not return the saved Mono context");
      const descendants = new Map<string, Thread>();
      for (const archived of [false, true]) {
        let cursor: string | undefined;
        do {
          const page = await request<{
            data: Thread[];
            nextCursor?: string | null;
          }>("thread/list", {
            ancestorThreadId: root.id,
            sourceKinds: [
              "cli",
              "vscode",
              "exec",
              "appServer",
              "subAgent",
              "unknown",
            ],
            modelProviders: [],
            archived,
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          for (const child of page.data) descendants.set(child.id, child);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      if (
        !root.path.replace(/\\/g, "/").split("/").includes("archived_sessions")
      ) {
        await request("thread/archive", { threadId: root.id });
        archivedByUs = true;
      }
      // Archive closes/flushed writers and moves root + descendants. Read the
      // final paths after that operation, then copy their unmodified files.
      const paths: string[] = [];
      for (const thread of [root, ...descendants.values()]) {
        const retained = await request<{ thread: Thread }>("thread/read", {
          threadId: thread.id,
          includeTurns: false,
        });
        if (!retained.thread.path)
          throw new Error("Codex did not retain a Mono thread file");
        paths.push(retained.thread.path);
      }
      const threadPath = await copyMonoCodexThreads(
        input.providerAccountId,
        root.id,
        paths,
        typeof settings.config.sqlite_home === "string"
          ? settings.config.sqlite_home
          : undefined,
      );
      return { config, hasThread: true, ...skillArgs, ...(threadPath ? { threadPath } : {}) };
    }
    return { config, hasThread: store.hasThread, ...skillArgs };
  } catch (error) {
    // Keep recovery checks on the provider message before adding the RPC method.
    const method = failedMethod;
    if (archivedByUs && input.threadId) {
      // A failed copy leaves the original intact and restores its visibility.
      await request("thread/unarchive", { threadId: input.threadId }).catch(
        () => undefined,
      );
    }
    if (method) throw new Error(`Codex storage ${method}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    rpc.close();
    unwatchChild(id);
    await killChild(id).catch(() => undefined);
    release();
  }
}

/** Native unarchive restores the indexed rollout before the selected home resumes it. */
async function restoreMonoThread(
  input: Parameters<typeof prepareCodexMonoContext>[0],
  store: Awaited<ReturnType<typeof prepareMonoCodexStore>>,
): Promise<string> {
  const release = await acquireHarnessBridge();
  const id = `${input.sessionId}:codex-restore:${input.providerAccountId ?? "default"}`;
  const rpc = new JsonRpcClient(id, {}, { includeJsonrpc: false, label: "codex-restore" });
  watchChild(id, line => rpc.pushLine(line), () => rpc.close(new Error("Codex restore connection exited")));
  try {
    await spawnChild(id, input.path, ["app-server", ...(store.skillArgs ?? [])], input.cwd,
      { provider: "codex", id: input.providerAccountId ?? "default" }, "codex", "mono", undefined, store.skillsContextId);
    await rpc.request("initialize", {
      clientInfo: { name: "monocode", title: "MonoCode", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    }, 30_000);
    await rpc.notify("initialized", undefined);
    const restored = await rpc.request<{ thread: Thread }>("thread/unarchive", { threadId: input.threadId }, 30_000);
    if (restored.thread.id !== input.threadId || !restored.thread.path || restored.thread.path.replace(/\\/g, "/").split("/").includes("archived_sessions"))
      throw new Error("Codex did not restore the saved Mono context");
    return restored.thread.path;
  } catch (error) {
    throw new Error(`Codex storage restore: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rpc.close();
    unwatchChild(id);
    await killChild(id).catch(() => undefined);
    release();
  }
}
