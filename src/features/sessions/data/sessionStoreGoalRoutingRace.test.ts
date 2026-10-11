import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { newSession, type Session } from "../model/session";
import { appendMonoGoalOrigin, type MonoGoalSubmission } from "../../monos/model/monoGoalRouting";
import { serializeMonoGoalUpdate } from "../../monos/model/monoGoalUpdates";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { upsertSession } = await import("./sessionStore");

it("retains both durable user origins when embedded and floating submissions overlap", async () => {
  const source = newSession("codex", "C:/synthetic/Atlas");
  source.monoTranscript = { before: null, firstBlockId: null };
  const sessionsRef = { current: [source] };
  let saved: Session["blocks"] = [];
  const writes: Record<string, unknown>[] = [];
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
  invoke.mockImplementation(async (command, args) => {
    if (command !== "mono_session_upsert") throw Error(`Unexpected native call ${command}`);
    writes.push(structuredClone(args));
    if (writes.length === 1) await firstWrite;
    if (args.blocksChanged) {
      if (args.afterBlockId) {
        saved = saved.slice(0, saved.findIndex(block => block.id === args.afterBlockId) + 1);
      } else if (args.fromBlockId) {
        saved = saved.slice(0, saved.findIndex(block => block.id === args.fromBlockId));
      } else if (!args.appendOnly) saved = [];
      saved.push(...structuredClone(args.session.blocks));
    }
    return { ...args.session, updatedAt: Date.now() };
  });

  // Evaluate the exact new App callback, with the real serialized session store.
  const app = readFileSync("src/app/App.tsx", "utf8");
  const start = app.indexOf("    const update = async (change: (session: Session) => Session) => {");
  expect(start).toBeGreaterThan(0);
  const end = app.indexOf("    return submitMonoGoal(", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nreturn update;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const update = new Function("sessionsRef", "upsertSession", "setSessions", "sessionId", "serializeMonoGoalUpdate", "history", code)(
    sessionsRef, upsertSession, () => {}, source.id, serializeMonoGoalUpdate, undefined,
  ) as (change: (session: Session) => Session) => Promise<void>;
  const submission = (suffix: string): MonoGoalSubmission => ({
    ownerId: "grand", requestId: `request-${suffix}`, userMessageId: `user-${suffix}`,
    choice: { mode: "goal", override: "auto" }, projectId: "c:/synthetic/atlas",
    managerMonoId: "atlas-manager", reason: "Exact project name",
  });
  const embedded = update(session => appendMonoGoalOrigin(session, submission("embedded"), "Fix Atlas login"));
  const floating = update(session => appendMonoGoalOrigin(session, submission("floating"), "Fix Atlas logout"));
  releaseFirst();
  await Promise.all([embedded, floating]);
  expect(sessionsRef.current[0].blocks.map(block => block.id)).toEqual(["user-embedded", "user-floating"]);
  console.log("CC5CR durable snapshot", JSON.stringify({
    memory: sessionsRef.current[0].blocks.map(block => block.id),
    disk: saved.map(block => block.id),
    writes: writes.map((write: any) => ({ fromBlockId: write.fromBlockId,
      afterBlockId: write.afterBlockId, blocks: write.session.blocks.map((block: any) => block.id) })),
  }));
  expect(saved.map(block => block.id)).toEqual(["user-embedded", "user-floating"]);
});
