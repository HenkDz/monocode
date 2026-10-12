// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assertMonoRotationCurrent, loadMonoRotation, saveMonoRotation, type MonoRotation } from "../features/monos/model/monoRotation";
import { applyHarnessEvents } from "../integrations/harness/core/apply";
import { TurnNotReadyError, type HarnessEvent } from "../integrations/harness/core/types";
import { selectAgentLiveState } from "../features/agents/model/agentLiveState";
import { newSession } from "../features/sessions/model/session";

const app = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(app);
  if (!found) throw Error("App dispatch callback not found");
  return found;
}
const dispatch = findNode(node => ts.isPropertyAssignment(node) && node.name.getText(app) === "validateDispatch" && node.getText(app).includes("rotationReceipt")) as ts.PropertyAssignment;
const direct = findNode(node => ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.statements.some(statement =>
  ts.isTryStatement(statement) && statement.getText(app).includes("await steerHarnessTurn") && statement.getText(app).includes("initialWorkCwd")));
const id = "synthetic-dispatch";
const key = "monocode:mono-rotations";
const receipt: MonoRotation = { at: 1, reason: "context", earlier: [], userRequests: [{ id: "scope", text: "Parser only." }] };
const newer = { ...receipt, userRequests: [...receipt.userRequests!, { id: "restriction", text: "Never publish." }] };

beforeEach(() => { localStorage.clear(); expect(saveMonoRotation(id, receipt)).toBe(true); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it.each(["newer", "deleted", "unreadable", "stopped"])("the actual App dispatch closure refuses %s after preparation", change => {
  const turnGen = { current: new Map([[id, 1]]) };
  const validate = new Function("sessionId", "rotationReceipt", "turnGen", "gen", "assertMonoRotationCurrent", "TurnNotReadyError",
    ts.transpile(`return ${dispatch.initializer.getText(app)};`, { target: ts.ScriptTarget.ES2022 }))(id, receipt, turnGen, 1, assertMonoRotationCurrent, TurnNotReadyError);
  expect(validate).not.toThrow();
  if (change === "newer") expect(saveMonoRotation(id, newer)).toBe(true);
  else if (change === "deleted") localStorage.clear();
  else if (change === "unreadable") localStorage.setItem(key, "{unknown");
  else turnGen.current.set(id, 2);
  const bytes = localStorage.getItem(key);
  expect(validate).toThrow();
  expect(localStorage.getItem(key)).toBe(bytes);
});

it.each(["attachments", "prompt", "transport"])("rejected direct follow-up during %s preserves the original active turn and tool", async boundary => {
  const active = { ...newSession("codex", "/synthetic"), id, busy: true, turnReady: true, providerSessionId: "original-provider",
    blocks: [
      { id: "user", role: "user" as const, text: "Run parser tests.", startedAt: 1 },
      { id: "answer", role: "assistant" as const, text: "Running tests.", streaming: true },
      { id: "tool", role: "tool" as const, text: "npm test", streaming: true, tool: { callId: "tool", title: "npm test", status: "running" } },
    ] };
  const events: HarnessEvent[] = [];
  const at = async (label: string) => { await Promise.resolve(); if (label === boundary) expect(saveMonoRotation(id, newer)).toBe(true); };
  const steerHarnessTurn = vi.fn(async (input: { validateDispatch: () => void }) => { await at("transport"); input.validateDispatch(); });
  const scope = {
    sessionId: id, current: active, initialWorkCwd: active.cwd, savedRotation: receipt, assertMonoRotationCurrent, TurnNotReadyError,
    turnGen: { current: new Map([[id, 1]]) }, gen: 1,
    prepareAttachments: async () => { await at("attachments"); return []; }, attachments: [],
    preparePrompt: async () => { await at("prompt"); return "Follow up"; }, harnessText: "Follow up", rawCommand: false,
    inboxAskPrompt: (_ask: unknown, text: string) => text, steerHarnessTurn,
    enqueueHarnessEvent: (_id: string, event: HarnessEvent) => events.push(event), flushHarnessEvents: vi.fn(),
  };
  const send = new Function(...Object.keys(scope), ts.transpile(`return ${direct.getText(app)};`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
  await send();
  expect(events).toEqual([{ type: "session.error", message: "The saved context carry changed. Retry to include its latest constraints.", followUp: true }]);
  const retained = applyHarnessEvents(active, events);
  expect(retained.busy).toBe(true);
  expect(retained.turnReady).toBe(true);
  expect(retained.providerSessionId).toBe(active.providerSessionId);
  expect(retained.blocks.slice(0, 3)).toEqual(active.blocks);
  expect(selectAgentLiveState(retained).status).toBe("running-tool");
  expect(loadMonoRotation(id)).toEqual(newer);
  const failed = applyHarnessEvents(active, [{ type: "session.error", message: "Provider exited." }]);
  expect(failed.busy).toBe(false);
  expect(failed.blocks[2].tool?.status).toBe("failed");
});
