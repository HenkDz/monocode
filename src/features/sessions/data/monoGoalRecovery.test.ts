import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { newSession, type Block, type Session } from "../model/session";
import { appendMonoGoalCard, appendMonoGoalOrigin, type MonoGoalSubmission } from "../../monos/model/monoGoalRouting";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import { getMonoGoalRecoveryBlocks, mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession } from "./monoGoalRecovery";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { getSession, upsertSession, writeSession } = await import("./sessionStore");

const submission: MonoGoalSubmission = {
  ownerId: "grand", requestId: "pending-request", userMessageId: "pending-user",
  choice: { mode: "goal", override: "auto" }, projectId: "c:/code/atlas",
  managerMonoId: "atlas-manager", reason: "Exact project name",
};
const goal: MonoManagerGoal = {
  id: "goal-1", monoId: "grand", projectId: "c:/code/atlas", managerId: "atlas-engine",
  userMessageId: submission.userMessageId, requestId: submission.requestId,
  title: "Fix Atlas login", state: "queued", prUrls: [], createdAt: 1, updatedAt: 1,
};

beforeEach(() => { invoke.mockReset(); });

function fixture(pendingCard = true) {
  const session = newSession("codex", "C:/synthetic/Atlas");
  let disk: Block[] = [
    { id: submission.userMessageId, role: "user", text: goal.title, monoGoalSubmission: submission },
    ...(pendingCard ? [{ id: `route-${submission.userMessageId}`, role: "assistant" as const,
      text: "Goal retained for its selected Manager. Delivery blocked." }] : []),
    ...Array.from({ length: 10 }, (_, turn): Block[] => [
      { id: `chat-user-${turn}`, role: "user", text: `Ordinary chat ${turn}` },
      { id: `chat-answer-${turn}`, role: "assistant", text: `Synthetic answer ${turn}` },
    ]).flat(),
  ];
  const writes: Record<string, any>[] = [];
  function page(before: number | null = null) {
    const end = before == null ? disk.length : before - 1;
    const starts = disk.flatMap((block, index) => index < end && block.role === "user" ? [index] : []);
    const start = starts.slice(-10)[0] ?? end;
    return { blocks: structuredClone(disk.slice(start, end)),
      before: starts.length > 10 ? start + 1 : null, hasNewer: end < disk.length };
  }
  invoke.mockImplementation(async (command, args) => {
    if (command === "session_get") {
      const latest = page();
      return { ...session, blocks: latest.blocks,
        monoTranscript: { before: latest.before, firstBlockId: latest.blocks[0]?.id ?? null } };
    }
    if (command === "mono_session_page") return page(args.before);
    if (command !== "mono_session_upsert") throw Error(`Unexpected native call ${command}`);
    writes.push(structuredClone(args));
    if (args.blocksChanged) {
      const index = args.afterBlockId ? disk.findIndex(block => block.id === args.afterBlockId) + 1
        : args.fromBlockId ? disk.findIndex(block => block.id === args.fromBlockId)
        : args.appendOnly ? disk.length : 0;
      if (index < 0) throw Error("Native transcript anchor missing");
      const next = [...disk.slice(0, index), ...structuredClone(args.session.blocks)];
      if (new Set(next.map(block => block.id)).size !== next.length)
        throw Error("UNIQUE constraint failed: mono_blocks.session_id, mono_blocks.block_id");
      disk = next;
    }
    return { ...args.session, createdAt: 1, updatedAt: 2 };
  });
  return { session, disk: () => disk, writes };
}

it.each([true, false])("recovers an older %s pending card without duplicating or moving its origin", async pendingCard => {
  const f = fixture(pendingCard);
  let live = (await getSession(f.session.id))!;
  expect(live.blocks).toHaveLength(20);
  expect(live.blocks.some(block => block.monoGoalSubmission)).toBe(false);
  const baseline = await getMonoGoalRecoveryBlocks(live.id);
  const origin = baseline.find(block => block.monoGoalSubmission)!;
  expect(origin.id).toBe(submission.userMessageId);

  // Chat can advance while the durable pages are being read.
  live = { ...live, blocks: [...live.blocks, { id: "new-chat", role: "user", text: "Newer chat" }] };
  const full = mergeMonoGoalRecoverySession(live, baseline);
  expect(appendMonoGoalOrigin(full, submission, goal.title)).toBe(full);
  const repaired = appendMonoGoalCard(full, submission, goal);
  live = monoGoalRecoveryLiveSession(live, repaired, baseline);
  await upsertSession(repaired, { monoBaseline: baseline, monoLiveBlocks: live.blocks });
  expect(f.disk()[0].id).toBe(submission.userMessageId);
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.disk().find(block => block.id === `route-${submission.userMessageId}`)?.monoCard)
    .toEqual({ type: "dispatch", goalIds: [goal.id] });
  if (pendingCard) expect(live.blocks.some(block => block.id === `route-${submission.userMessageId}`)).toBe(false);

  // The next ordinary save must still use the live page, not the full-history cache.
  const previousLastId = live.blocks.at(-1)!.id;
  live = { ...live, blocks: [...live.blocks, { id: "new-answer", role: "assistant", text: "Latest answer" }] };
  await upsertSession(live);
  expect(f.disk()[0].id).toBe(submission.userMessageId);
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.disk().slice(-2).map(block => block.id)).toEqual([previousLastId, "new-answer"]);
  expect(f.disk().some(block => block.id === "new-chat")).toBe(true);
  expect(f.writes.at(-1)).toMatchObject({ afterBlockId: previousLastId, fromBlockId: null });
});

it.each([true, false])("the App recovery updater repairs an older %s pending card while preserving its displayed page", async pendingCard => {
  const f = fixture(pendingCard);
  const sessionsRef = { current: [(await getSession(f.session.id))!] };
  const history = await getMonoGoalRecoveryBlocks(f.session.id);
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("    const update = async (change: (session: Session) => Session) => {");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("    return submitMonoGoal(", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn update;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const update = new Function("sessionsRef", "setSessions", "sessionId", "writeSession",
    "history", "getMonoGoalRecoveryBlocks", "mergeMonoGoalRecoverySession", "monoGoalRecoveryLiveSession", code)(
    sessionsRef, () => {}, f.session.id, writeSession,
    history, getMonoGoalRecoveryBlocks, mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession,
  ) as (change: (session: Session) => Session) => Promise<void>;

  await update(session => appendMonoGoalOrigin(session, submission, goal.title));
  expect(f.writes).toHaveLength(0);
  await update(session => appendMonoGoalCard(session, submission, goal));
  expect(f.disk()[0].id).toBe(submission.userMessageId);
  expect(f.disk().filter(block => block.id === submission.userMessageId)).toHaveLength(1);
  expect(f.disk().filter(block => block.id === `route-${submission.userMessageId}`)).toHaveLength(1);
  expect(sessionsRef.current[0].blocks).toHaveLength(pendingCard ? 20 : 21);
  expect(sessionsRef.current[0].blocks.some(block => block.id === submission.userMessageId)).toBe(false);
  expect(sessionsRef.current[0].monoTranscript?.firstBlockId).toBe("chat-user-0");
  const live = { ...sessionsRef.current[0], blocks: [...sessionsRef.current[0].blocks,
    { id: "subsequent-chat", role: "user" as const, text: "Ordinary chat after recovery" }] };
  await upsertSession(live);
  expect(f.disk()[0].id).toBe(submission.userMessageId);
  expect(f.disk().at(-1)?.id).toBe("subsequent-chat");
  console.log("CC5CF pending-origin recovery", JSON.stringify({ pendingCard,
    durableOriginCount: f.disk().filter(block => block.id === submission.userMessageId).length,
    durableCardCount: f.disk().filter(block => block.id === `route-${submission.userMessageId}`).length,
    firstDurableId: f.disk()[0].id, displayedBlocks: sessionsRef.current[0].blocks.length }));
});

it("checks historical origin identities and cards against the entire transcript", async () => {
  const f = fixture();
  const live = (await getSession(f.session.id))!;
  const history = await getMonoGoalRecoveryBlocks(live.id);
  const full = mergeMonoGoalRecoverySession(live, history);
  expect(() => appendMonoGoalOrigin(full, { ...submission, requestId: "different-request" }, goal.title))
    .toThrow("identity already used");
  const accepted = appendMonoGoalCard(full, submission, goal);
  expect(appendMonoGoalCard(accepted, submission, goal)).toBe(accepted);
  expect(accepted.blocks[0].id).toBe(submission.userMessageId);
  expect(accepted.blocks[1].monoCard).toEqual({ type: "dispatch", goalIds: [goal.id] });
  expect(f.writes).toHaveLength(0);
});

it("rejects missing history anchors and duplicate historical IDs before writing", () => {
  const live = { ...newSession("codex", "C:/synthetic/Atlas"), blocks: [
    { id: "tail", role: "user", text: "Current" },
  ], monoTranscript: { before: 2, firstBlockId: "tail" } } as Session;
  expect(() => mergeMonoGoalRecoverySession(live, [{ id: "other", role: "user", text: "Older" }]))
    .toThrow("changed during recovery");
  expect(() => mergeMonoGoalRecoverySession({ ...live, blocks: [...live.blocks,
    { id: "old", role: "user", text: "Duplicate old origin" }] }, [
    { id: "old", role: "user", text: "Original" }, ...live.blocks,
  ])).toThrow("duplicate a historical message identity");
});

it("fails closed when a history page does not advance", async () => {
  invoke.mockResolvedValue({ blocks: [], before: 3, hasNewer: true });
  await expect(getMonoGoalRecoveryBlocks("synthetic-grand-session"))
    .rejects.toThrow("history cursor did not advance");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("publishes newly added cards into an empty page without exposing historical messages", () => {
  const live = { ...newSession("codex", "C:/synthetic/Atlas"),
    monoTranscript: { before: null, firstBlockId: null } };
  const history: Block[] = [
    { id: "old-user", role: "user", text: "Historical origin" },
    { id: "old-card", role: "assistant", text: "Historical pending card" },
  ];
  const next = { ...live, blocks: [history[0], { ...history[1], text: "Historical repaired card" },
    { id: "new-card", role: "assistant" as const, text: "Newly appended card" }] };
  expect(monoGoalRecoveryLiveSession(live, next, history)).toMatchObject({
    monoTranscript: live.monoTranscript, blocks: [{ id: "new-card" }],
  });
});

it("merges saved and unsaved tails when an initially empty Mono still has a null anchor", async () => {
  const f = fixture();
  const loaded = (await getSession(f.session.id))!;
  const live = { ...loaded, monoTranscript: { before: null, firstBlockId: null } };
  const history = await getMonoGoalRecoveryBlocks(live.id);
  const full = mergeMonoGoalRecoverySession(live, history);
  expect(full.blocks.map(block => block.id)).toEqual(history.map(block => block.id));
  const blank = { ...live, blocks: [{ id: "unsaved", role: "user" as const, text: "New chat" }] };
  expect(mergeMonoGoalRecoverySession(blank, []).blocks).toEqual(blank.blocks);
});

it("retains every unpublished durable goal in the writable tail while keeping older origins off the live page", () => {
  const older: Block = { id: "older-origin", role: "user", text: "Older goal", monoGoalSubmission: {
    ...submission, requestId: "older-request", userMessageId: "older-origin",
  } };
  const tail: Block = { id: "tail", role: "user", text: "Current chat" };
  const unpublished: Block[] = ["unpublished-one", "unpublished-two"].map(id => ({
    id, role: "user", text: "Unacknowledged goal", monoGoalSubmission: {
      ...submission, requestId: id, userMessageId: id,
    },
  }));
  const history = [older, tail, ...unpublished];
  const live = { ...newSession("codex", "C:/synthetic/Atlas"), blocks: [tail],
    monoTranscript: { before: 2, firstBlockId: tail.id } };
  const full = mergeMonoGoalRecoverySession(live, history);
  expect(full.blocks).toEqual(history);
  expect(monoGoalRecoveryLiveSession(live, full, history).blocks).toEqual([tail, ...unpublished]);
  expect(mergeMonoGoalRecoverySession({ ...live, blocks: [tail, unpublished[0]] }, history).blocks).toEqual(history);
});
