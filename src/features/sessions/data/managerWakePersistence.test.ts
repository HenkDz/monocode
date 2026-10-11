import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { appendUser } from "../../../integrations/harness/core/apply";
import { canDispatchQueuedHead, canSteerQueuedHead, queuedMessageForSubmit } from "../model/messageQueue";
import { newSession, type Session } from "../model/session";
import { acceptManagerWakeQueue, type ManagerWakeReceipt } from "../../orchestration/model/managerWake";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../monos/model/mono", () => ({ isMonoSession: (id: string) => id.startsWith("mono-") }));

let persisted: Record<string, unknown> | undefined;
let store: typeof import("./sessionStore");
const receipt = (id = "manager-digest-11111111-1111-1111-1111-111111111111"): ManagerWakeReceipt => ({
  id, body: "Action-required Manager digest", eventIds: ["question-1"], completedWaveIds: [], timeoutWaveIds: [],
});

beforeEach(async () => {
  persisted = undefined;
  vi.resetModules();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "mono_session_upsert" || command === "session_upsert") {
      persisted = JSON.parse(JSON.stringify({ ...(args as { session: Record<string, unknown> }).session,
        createdAt: 0, updatedAt: 0 }));
      return persisted;
    }
    if (command === "mono_session_get" || command === "session_get") return JSON.parse(JSON.stringify(persisted));
    throw Error(`Unexpected invocation ${command}`);
  });
  store = await import("./sessionStore");
});

async function accept(mono: boolean, id?: string) {
  let current: Session = { ...newSession("codex", "C:/synthetic/cc5df-queue-review"),
    id: `${mono ? "mono" : "ordinary"}-cc5df-queue-review-chat`,
    ...(mono ? { monoTranscript: { before: null, firstBlockId: "user-1" } } : {}),
    blocks: [{ id: "user-1", role: "user", text: "Existing user request" }] };
  const digest = receipt(id);
  const accepted = await acceptManagerWakeQueue(digest, current.id, {
    session: () => current, delivered: async () => false,
    save: async next => { const saved = await store.upsertSession(next); if (!saved) throw Error("Save unavailable"); },
    load: () => store.getSession(current.id),
    publish: next => { current = next; },
  });
  return { accepted, current, digest, restored: await store.getSession(current.id) };
}

describe.each([
  { mono: true, id: receipt().id }, { mono: false, id: receipt().id },
  { mono: true, id: "manager-digest:11111111-1111-1111-1111-111111111111" },
  { mono: false, id: "manager-digest:11111111-1111-1111-1111-111111111111" },
])("Manager digest durable session-store boundary (Mono: $mono, receipt: $id)", ({ mono, id }) => {
  it("retains a successfully accepted real digest ID in the persisted target queue", async () => {
    const result = await accept(mono, id);
    expect(result.accepted).toBe(true);
    expect(result.current.queuedMessages?.[0].id).toBe(result.digest.id);
    expect(persisted?.queuedMessages).toEqual(result.current.queuedMessages);
    expect(result.restored?.queuedMessages?.[0].id).toBe(result.digest.id);
  });

  it("retains the Manager marker and receipt identity after hydration", async () => {
    const result = await accept(mono, id);
    expect(result.restored?.queuedMessages?.[0]).toMatchObject({
      id: result.digest.id, appRequestId: result.digest.id,
      managerWake: { leadId: result.current.id, receiptId: result.digest.id },
    });
  });

  it("holds a reloaded digest behind pending questions and refuses steering", async () => {
    const result = await accept(mono, id);
    const restored = { ...result.restored!, queueStatus: "active" as const };
    expect({
      dispatchWithQuestion: canDispatchQueuedHead({ ...restored, pendingQuestion: { requestId: 1, questions: [] } }),
      dispatchWithApproval: canDispatchQueuedHead({ ...restored, blocks: [{ id: "approval-1", role: "tool", text: "Approve", approval: { requestId: 1 } }] }),
      steer: canSteerQueuedHead({ ...restored, busy: true, turnReady: true }),
    }).toEqual({ dispatchWithQuestion: false, dispatchWithApproval: false, steer: false });
  });

  it.each(["queue", "marker"])("rejects successful storage that drops the persisted %s before source acknowledgment", async dropped => {
    const current: Session = { ...newSession("codex", "C:/synthetic/cc5df-storage-loss"),
      id: `${mono ? "mono" : "ordinary"}-cc5df-storage-loss`,
      blocks: [{ id: "user-1", role: "user", text: "Existing request" }] };
    const digest = receipt(id);
    const publish = vi.fn();
    const acknowledge = vi.fn();
    const acceptance = acceptManagerWakeQueue(digest, current.id, {
      session: () => current, delivered: async () => false,
      save: async next => {
        expect(await store.upsertSession(next)).not.toBeNull();
        if (dropped === "queue") delete persisted!.queuedMessages;
        else for (const message of persisted!.queuedMessages as Record<string, unknown>[]) delete message.managerWake;
      },
      load: () => store.getSession(current.id), publish,
    }).then(accepted => { if (accepted) acknowledge(); });
    await expect(acceptance).rejects.toThrow("Manager digest is missing from the persisted queue");
    expect(publish).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(current.queuedMessages).toBeUndefined();
    expect(digest.acknowledgedAt).toBeUndefined();
    expect(digest.eventIds).toEqual(["question-1"]);
  });

  it("replays one managed digest after a fresh-store restart without adding another queue entry", async () => {
    const { current, digest } = await accept(mono, id);
    const saved = JSON.stringify(persisted);
    vi.resetModules();
    const restartedStore = await import("./sessionStore");
    persisted = JSON.parse(saved);
    let restarted = (await restartedStore.getSession(current.id))!;
    expect(restarted.queueStatus).toBe("paused");
    expect(canDispatchQueuedHead(restarted)).toBe(false);
    restarted = { ...restarted, queueStatus: "active" };
    const head = queuedMessageForSubmit(restarted, digest.id, "dispatch");
    expect(head?.managerWake).toEqual({ leadId: current.id, receiptId: digest.id });
    expect(head?.appRequestId).toBe(digest.id);
    const save = vi.fn(async (next: Session) => restartedStore.upsertSession(next));
    expect(await acceptManagerWakeQueue(digest, current.id, {
      session: () => restarted, delivered: async () => false,
      save, load: () => restartedStore.getSession(current.id), publish: next => { restarted = next; },
    })).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(restarted.queuedMessages).toHaveLength(1);
    expect(JSON.stringify(persisted)).toBe(saved);
    const submitted = appendUser({ ...restarted, queuedMessages: undefined }, head!.text, [], {
      internal: !!head!.managerWake, appRequestId: head!.appRequestId,
    });
    await restartedStore.upsertSession(submitted);
    vi.resetModules();
    const submittedStore = await import("./sessionStore");
    const restoredTurn = (await submittedStore.getSession(current.id))!.blocks.at(-1);
    expect(restoredTurn).toMatchObject({ role: "user", internal: true, appRequestId: digest.id });
  });
});

it("preserves valid ordinary queued request IDs through the shared serializer", () => {
  const session = { ...newSession("codex", "/tmp"), queuedMessages: [
    { id: "queued-1", appRequestId: "app-request-1", text: "Follow up", attachments: [] },
    { id: "queued-2", appRequestId: "invalid/request", text: "Ordinary message", attachments: [] },
  ] };
  const messages = store.sanitizeSessionForPersist(session).queuedMessages!;
  expect(messages[0].appRequestId).toBe("app-request-1");
  expect(messages[1].appRequestId).toBeUndefined();
});

it.each([
  { leadId: "invalid/lead", receiptId: "digest-1" },
  { leadId: "lead-1", receiptId: "invalid/receipt" },
  { leadId: "lead-1", receiptId: "different-receipt" },
  { leadId: "x".repeat(513), receiptId: "digest-1" },
  {},
  null,
])("rejects malformed managed queue metadata instead of restoring a user message: %j", managerWake => {
  const session = { ...newSession("codex", "/tmp"), queuedMessages: [
    { id: "digest-1", appRequestId: "digest-1", text: "Managed evidence", attachments: [], managerWake },
  ] } as Session;
  expect(store.sanitizeSessionForPersist(session).queuedMessages).toBeUndefined();
});

it("rejects a managed entry with a mismatched request receipt", () => {
  const session = { ...newSession("codex", "/tmp"), queuedMessages: [
    { id: "digest-1", appRequestId: "other-request", text: "Managed evidence", attachments: [],
      managerWake: { leadId: "lead-1", receiptId: "digest-1" } },
  ] };
  expect(store.sanitizeSessionForPersist(session).queuedMessages).toBeUndefined();
});

it("keeps the legacy colon exception limited to managed digests and internal receipt blocks", () => {
  const legacyId = "manager-digest:11111111-1111-1111-1111-111111111111";
  const session = { ...newSession("codex", "/tmp"), blocks: [
    { id: "user-1", role: "user" as const, text: "User turn", appRequestId: legacyId },
    { id: "managed-1", role: "user" as const, text: "Other event", internal: true, appRequestId: "other:receipt" },
  ], queuedMessages: [
    { id: legacyId, appRequestId: legacyId, text: "Ordinary message", attachments: [] },
    { id: "other:receipt", appRequestId: "other:receipt", text: "Other event", attachments: [],
      managerWake: { leadId: "lead-1", receiptId: "other:receipt" } },
  ] };
  const saved = store.sanitizeSessionForPersist(session);
  expect(saved.queuedMessages).toBeUndefined();
  expect(saved.blocks.every(block => !block.appRequestId)).toBe(true);
  expect(store.isPersistableId(legacyId)).toBe(false);
});
