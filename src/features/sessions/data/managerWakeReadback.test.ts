import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { appendUser } from "../../../integrations/harness/core/apply";
import { newSession, type Session } from "../model/session";
import { acceptManagerWakeQueue, type ManagerWakeReceipt } from "../../orchestration/model/managerWake";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../monos/model/mono", () => ({ isMonoSession: (id: string) => id.startsWith("mono-") }));

type Write = {
  session: Record<string, unknown> & { blocks: Session["blocks"] };
  afterBlockId: string | null;
  fromBlockId: string | null;
  blocksChanged: boolean;
  appendOnly: boolean;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let store: typeof import("./sessionStore");
let stored: Session["blocks"];
let header: Record<string, unknown>;
let writes: Write[];

beforeEach(async () => {
  vi.resetModules();
  stored = [];
  header = {};
  writes = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "mono_session_upsert") {
      const write = clone(args as Write);
      writes.push(write);
      let next = clone(stored);
      if (write.blocksChanged) {
        const anchor = write.appendOnly ? next.length
          : write.afterBlockId ? next.findIndex(block => block.id === write.afterBlockId) + 1
          : write.fromBlockId ? next.findIndex(block => block.id === write.fromBlockId) : 0;
        expect(anchor).toBeGreaterThanOrEqual(0);
        next = next.slice(0, anchor);
        const seen = new Set(next.map(block => block.id));
        for (const block of write.session.blocks) {
          if (seen.has(block.id)) throw Error("UNIQUE constraint failed: mono_blocks.session_id, mono_blocks.block_id");
          seen.add(block.id);
          next.push(block);
        }
      }
      // Match native transaction rollback if an insertion fails.
      header = { ...clone(write.session), blocks: [], createdAt: 0, updatedAt: 0 };
      stored = next;
      return clone(header);
    }
    if (command === "mono_session_get") {
      const turns = stored.flatMap((block, index) => block.role === "user" && !block.internal ? [index] : []);
      const start = turns.length > 10 ? turns.at(-10)! : 0;
      const page = stored.slice(start);
      return clone({ ...header, blocks: page, monoTranscript: { before: start || null, firstBlockId: page[0]?.id ?? null } });
    }
    throw Error(`Unexpected invocation ${command}`);
  });
  store = await import("./sessionStore");
});

describe("Manager digest persisted read-back", () => {
  it.each([10, 11, 25])("preserves the live write anchor through queue verification and later turns (%i user turns)", async turns => {
    const blocks: Session["blocks"] = Array.from({ length: turns }, (_, i) => [
      { id: `user-${i + 1}`, role: "user" as const, text: `User ${i + 1}` },
      { id: `assistant-${i + 1}`, role: "assistant" as const, text: `Answer ${i + 1}` },
    ]).flat();
    let current: Session = { ...newSession("codex", "C:/synthetic/cc5dg-readback"), id: `mono-paged-${turns}`,
      blocks, monoTranscript: { before: null, firstBlockId: null } };
    await store.upsertSession(current);
    const receipt: ManagerWakeReceipt = { id: "manager-digest-11111111-1111-1111-1111-111111111111", body: "Managed digest",
      eventIds: ["question-1"], completedWaveIds: [], timeoutWaveIds: [] };
    const host = {
      session: () => current, delivered: async () => false,
      save: (next: Session) => store.upsertSession(next), load: () => store.readPersistedSession(current.id),
      publish: (next: Session) => { current = next; },
    };
    expect(await acceptManagerWakeQueue(receipt, current.id, host)).toBe(true);
    expect(writes.at(-1)?.blocksChanged).toBe(false);
    expect(current.blocks).toHaveLength(turns * 2);
    expect((await host.load())?.blocks).toHaveLength(Math.min(turns, 10) * 2);
    expect(header.queuedMessages).toHaveLength(1);
    expect(await acceptManagerWakeQueue(receipt, current.id, host)).toBe(true);
    expect(writes).toHaveLength(2);

    current = appendUser({ ...current, queuedMessages: [] }, receipt.body, [], { internal: true, appRequestId: receipt.id });
    await store.upsertSession(current);
    expect(writes.at(-1)).toMatchObject({ afterBlockId: `assistant-${turns}`, fromBlockId: null,
      session: { blocks: [expect.objectContaining({ internal: true, appRequestId: receipt.id, text: receipt.body })] } });
    expect(header.queuedMessages).toBeUndefined();
    expect(await acceptManagerWakeQueue(receipt, current.id, host)).toBe(true);
    expect(writes).toHaveLength(3);

    const next = appendUser(current, "Next user turn", []);
    await store.upsertSession(next);
    expect(writes.at(-1)).toMatchObject({ afterBlockId: current.blocks.at(-1)!.id, fromBlockId: null,
      session: { blocks: [expect.objectContaining({ text: "Next user turn" })] } });
    expect(stored.slice(0, turns * 2)).toEqual(blocks);
    expect(stored).toHaveLength(turns * 2 + 2);
    expect(stored.filter(block => block.appRequestId === receipt.id)).toHaveLength(1);
  });

  it.each(["codex", "claude", "omp", "cursor"] as const)("reads durable %s evidence without provider repair or writes", async harness => {
    const session: Session = { ...newSession(harness, "C:/synthetic/cc5dg-readback"), id: `mono-repair-${harness}`,
      providerSessionId: "provider-fixture", blocks: [{ id: "user-1", role: "user", text: "Request" },
        { id: "tool-1", role: "tool", text: "Shell", tool: { callId: "call-1", kind: "execute", title: "Shell",
          preview: { title: "echo fixture" } } }] };
    await store.upsertSession(session);
    vi.mocked(invoke).mockClear();
    const persisted = await store.readPersistedSession(session.id);
    expect(persisted?.blocks.at(-1)?.text).toBe("Shell");
    expect(vi.mocked(invoke).mock.calls).toEqual([["mono_session_get", { sessionId: session.id }]]);
    expect(writes).toHaveLength(1);
  });

  it("returns null for a missing persisted session", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(store.readPersistedSession("missing-session")).resolves.toBeNull();
    expect(vi.mocked(invoke).mock.calls).toEqual([["session_get", { sessionId: "missing-session" }]]);
  });
});
