import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "./sessionStore";
import { selectCodexStorageHome } from "../../monos/model/monoCodexHomes";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { getSession, sanitizeSessionForPersist, persistFingerprint } = await import("./sessionStore");

/** A saved Codex session holding the one row this PR repairs. */
function codexRecord(): SessionRecord {
  return {
    id: "s1",
    harness: "codex",
    model: "gpt-5",
    cwd: "/repo",
    providerSessionId: "01a0e6f4-13e3-7692-9250-4befceed807b",
    blocks: [
      { id: "b0", role: "user", text: "list the agents" },
      {
        id: "b1",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-1",
          title: "Shell",
          kind: "execute",
          status: "completed",
          preview: {
            kind: "shell",
            title: "rg --files -g AGENTS.md -g '!node_modules'",
          },
        },
      },
    ],
  } as unknown as SessionRecord;
}

describe("restoring a session whose repair cannot be persisted", () => {
  beforeEach(() => invoke.mockReset());

  it("restores the private source home without forwarding its marker to the provider or changing the queue", async () => {
    const queuedMessages = [{ id: "q", text: "Exact queued Plan", attachments: [], intent: "plan" }];
    invoke.mockImplementation(async (command: string) => command === "session_get" ? {
      ...codexRecord(), blocks: [], providerSessionId: null, queuedMessages,
      modelSettings: { reasoningEffort: "high", __monocodeCodexStorageHome: "C:/synthetic/separate-mono" },
    } : null);
    const session = await getSession("s1");
    expect(session?.codexStorageHome).toBe("C:/synthetic/separate-mono");
    expect(session?.providerSessionId).toBeUndefined();
    expect(session?.queuedMessages).toEqual(queuedMessages);
    expect(session?.modelSettings).toEqual({ reasoningEffort: "high" });
    expect(sanitizeSessionForPersist(session!).modelSettings.__monocodeCodexStorageHome).toBe("C:/synthetic/separate-mono");
  });

  it("reloads both per-home threads and retains an unmapped legacy thread without exposing the storage setting", async () => {
    const threads = { "C:/synthetic/original": "thread-a", "C:/synthetic/separate": "thread-b" };
    invoke.mockImplementation(async command => command === "session_get" ? { ...codexRecord(), blocks: [], providerSessionId: "thread-b", modelSettings: {
      __monocodeCodexStorageHome: "C:/synthetic/separate", __monocodeCodexHomeThreads: JSON.stringify(threads), reasoningEffort: "high",
    } } : null);
    const session = await getSession("s1");
    expect(session?.providerSessionIdByHome).toEqual(threads);
    expect(session?.providerSessionId).toBe("thread-b");
    expect(session?.modelSettings).toEqual({ reasoningEffort: "high" });
    expect(JSON.parse(sanitizeSessionForPersist(session!).modelSettings.__monocodeCodexHomeThreads)).toEqual(threads);
    invoke.mockImplementation(async command => command === "session_get" ? { ...codexRecord(), blocks: [], modelSettings: { __monocodeCodexHomeThreads: "{bad" } } : null);
    const legacy = await getSession("s1");
    expect(legacy?.providerSessionIdByHome).toBeUndefined();
    expect(legacy?.providerSessionId).toBe(codexRecord().providerSessionId);
    expect(legacy?.codexStorageHome).toBeUndefined();
  });

  it.each([
    "{bad",
    JSON.stringify({ "C:/synthetic/original": "thread-a", future: { format: 2 } }),
    JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`C:/synthetic/${i}`, `thread-${i}`]))),
    null,
    { future: 2 },
  ])("refuses metadata saves and home selection for an opaque saved thread map (%j)", async raw => {
    invoke.mockImplementation(async command => command === "session_get" ? {
      ...codexRecord(), modelSettings: { reasoningEffort: "high", __monocodeCodexHomeThreads: raw },
    } : null);
    const session = (await getSession("s1"))!;
    expect(session.codexHomeThreadsUnresolved).toBe(true);
    expect(session.providerSessionIdByHome).toBeUndefined();
    expect(session.modelSettings).toEqual({ reasoningEffort: "high" });
    expect(() => persistFingerprint(session)).not.toThrow();
    expect(() => sanitizeSessionForPersist({ ...session, title: "Later metadata save" })).toThrow("Preserve the unreadable per-home provider thread map");
    expect(() => selectCodexStorageHome(session, { home: "C:/synthetic/separate", originalHome: "C:/synthetic/original", threadId: null })).toThrow("Preserve the unreadable per-home provider thread map");
  });

  it.each(["role", "user"] as const)("restores %s permission ownership and an explicit engine without leaking markers", async runtimeModeSource => {
    invoke.mockImplementation(async (command: string) => command === "session_get" ? {
      ...codexRecord(), blocks: [], runtimeMode: "auto", modelSettings: { reasoningEffort: "high", __monocodeRuntimeModeSource: runtimeModeSource, __monocodeWindowsSandbox: "elevated" },
    } : null);
    const session = await getSession("s1");
    expect(session).toMatchObject({ runtimeMode: "auto", runtimeModeSource, windowsSandbox: "elevated", modelSettings: { reasoningEffort: "high" } });
    expect(sanitizeSessionForPersist(session!).modelSettings).toEqual({ reasoningEffort: "high", __monocodeRuntimeModeSource: runtimeModeSource, __monocodeWindowsSandbox: "elevated" });
  });

  it.each([undefined, "invalid"])("retains legacy permissions and drops malformed markers (%s)", async marker => {
    invoke.mockImplementation(async (command: string) => command === "session_get" ? {
      ...codexRecord(), blocks: [], runtimeMode: "full-access", modelSettings: { reasoningEffort: "high", ...(marker ? { __monocodeRuntimeModeSource: marker, __monocodeWindowsSandbox: marker } : {}) },
    } : null);
    const session = await getSession("s1");
    expect(session?.runtimeMode).toBe("full-access");
    expect(session?.runtimeModeSource).toBeUndefined();
    expect(session?.windowsSandbox).toBeUndefined();
    expect(session?.modelSettings).toEqual({ reasoningEffort: "high" });
  });

  it.each(["role", "user"] as const)("restores %s effort ownership and strips its storage marker from provider settings", async effortSource => {
    invoke.mockImplementation(async (command: string) => command === "session_get" ? {
      ...codexRecord(), blocks: [], modelSettings: { reasoningEffort: "high", __monocodeReadOnly: "true", __monocodeEffortSource: effortSource },
    } : null);
    const session = await getSession("s1");
    expect(session?.effortSource).toBe(effortSource);
    expect(session?.readOnly).toBe(true);
    expect(session?.modelSettings).toEqual({ reasoningEffort: "high" });
    expect(sanitizeSessionForPersist(session!).modelSettings).toEqual({ reasoningEffort: "high", __monocodeReadOnly: "true", __monocodeEffortSource: effortSource });
  });

  it.each([undefined, "invalid"])("does not infer effort ownership from a legacy or malformed marker (%s)", async effortSource => {
    invoke.mockImplementation(async (command: string) => command === "session_get" ? {
      ...codexRecord(), blocks: [], modelSettings: { reasoningEffort: "xhigh", ...(effortSource ? { __monocodeEffortSource: effortSource } : {}) },
    } : null);
    const session = await getSession("s1");
    expect(session?.effortSource).toBeUndefined();
    expect(session?.modelSettings).toEqual({ reasoningEffort: "xhigh" });
  });

  it("restores managed read-only permissions before any orchestration engine is hydrated", async () => {
    invoke.mockImplementation(async (command: string) => command === "session_get" ? {
      ...codexRecord(), blocks: [], modelSettings: { reasoningEffort: "high", __monocodeReadOnly: "true" },
    } : null);
    const session = await getSession("s1");
    expect(session?.readOnly).toBe(true);
    expect(session?.modelSettings).toEqual({ reasoningEffort: "high" });
    expect(sanitizeSessionForPersist(session!).modelSettings).toEqual({ reasoningEffort: "high", __monocodeReadOnly: "true" });
  });

  it("migrates duplicated legacy notifications out of the user outbox", async () => {
    const event = { id: "event", text: "Manager needs a decision", attachments: [],
      monoSessionCompletion: { sessionId: "manager", title: "Manager", status: "completed" } };
    invoke.mockImplementation(async (cmd: string) => cmd === "session_get" ? {
      ...codexRecord(), blocks: [], queuedMessages: [event, { ...event, id: "duplicate" },
        { id: "user", text: "My follow-up", attachments: [] }],
    } : null);
    const session = await getSession("s1");
    expect(session?.queuedMessages?.map(message => message.id)).toEqual(["user"]);
    expect(session?.pendingMonoEvents?.map(message => message.id)).toEqual(["event"]);
});

  it("restores sidebar visibility when a hidden session is opened by id", async () => {
    const record = codexRecord();
    record.sidebarHidden = true;
    invoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "session_get" ? record : null),
    );
    const session = await getSession(record.id);
    expect(session?.sidebarHidden).toBe(true);
    expect(session?.blocks[0].text).toBe("list the agents");
    const repaired = invoke.mock.calls.find(([cmd]) => cmd === "session_upsert");
    expect(repaired?.[1].session.sidebarHidden).toBe(true);
  });

  it("restores the turn's launched session links", async () => {
    const record = codexRecord();
    const launch = {
      sessionId: "app-review",
      cwd: "/repo",
      title: "Review",
      harness: "codex" as const,
      model: "gpt-6",
    };
    record.blocks[0].monoSpawnedSessions = [launch];
    invoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "session_get" ? record : null),
    );
    expect((await getSession("s1"))?.blocks[0].monoSpawnedSessions).toEqual([
      launch,
    ]);
  });

  it("still returns the repaired session when the write fails", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(codexRecord());
      if (cmd === "session_upsert") return Promise.reject(new Error("db locked"));
      return Promise.resolve(null);
    });

    // A failed persistence must not cost the reader the session: the repair
    // stays in memory and the next load retries the write.
    const session = await getSession("s1");
    expect(session).not.toBeNull();
    expect(session?.blocks[1].text).toBe("Find files");
  });

  it("persists the repair when the write succeeds", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(codexRecord());
      return Promise.resolve(null);
    });

    const session = await getSession("s1");
    expect(session?.blocks[1].text).toBe("Find files");
    expect(
      invoke.mock.calls.some(([cmd]) => cmd === "session_upsert"),
    ).toBe(true);
  });
});
