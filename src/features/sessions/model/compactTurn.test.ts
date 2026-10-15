import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { compactTurn } from "./compactTurn";
import { INTERRUPT_MESSAGE } from "./inFlight";

const user: Block = { id: "user", role: "user", text: "Fix the transcript" };
const narration: Block = { id: "narration", role: "assistant", text: "I found the rendering path." };
const final: Block = { id: "final", role: "assistant", text: "The transcript now folds its work.\n\n**Tests passed.**" };
const command: Block = { id: "command", role: "tool", text: "cargo check", tool: { kind: "shell", status: "completed" } };
const ids = (blocks: Iterable<Block>) => [...blocks].map(block => block.id);

describe("compact turn classification", () => {
  it("leaves the user and full final answer outside while folding all intermediate narration", () => {
    const result = compactTurn([user, narration, command, final], true);
    expect(ids(result.outside)).toEqual(["user", "final"]);
    expect(ids(result.work)).toEqual(["narration", "command"]);
    expect([...result.outside][1]).toBe(final);
    expect(final.text).toContain("**Tests passed.**");
  });

  it("keeps all assistant prose folded while a turn is running", () => {
    const streaming: Block = { ...final, streaming: true };
    const result = compactTurn([user, narration, command, streaming], false);
    expect(ids(result.outside)).toEqual(["user"]);
    expect(ids(result.work)).toEqual(["narration", "command", "final"]);
  });

  it("exposes the latest question while a running turn awaits a user decision", () => {
    const question: Block = { id: "question", role: "assistant", text: "Which checkout should I use?" };
    const result = compactTurn([user, narration, command, question], false, true);
    expect(ids(result.outside)).toEqual(["user", "question"]);
    expect(ids(result.work)).toEqual(["narration", "command"]);
  });

  it("keeps progress narration folded while a structured question form waits", () => {
    const result = compactTurn([user, command, narration], false, true);
    expect(ids(result.outside)).toEqual(["user"]);
    expect(ids(result.work)).toEqual(["command", "narration"]);
  });

  it.each([true, false])("keeps pending generic and tasks approvals reachable when settled=%s", settled => {
    const generic: Block = { id: "generic-approval", role: "approval", text: "Tool call", tool: { kind: "other", status: "pending" }, approval: { requestId: 11 } };
    const tasks: Block = { id: "tasks-approval", role: "tool", text: "Update tasks", tool: { kind: "tasks", status: "pending" }, approval: { requestId: 12 } };
    const hiddenTasks: Block = { id: "hidden-tasks", role: "tool", text: "Update tasks", tool: { kind: "tasks", status: "completed" } };
    const result = compactTurn([user, generic, tasks, hiddenTasks, final], settled);
    expect(ids(result.outside)).toContain("generic-approval");
    expect(ids(result.outside)).toContain("tasks-approval");
    expect(ids(result.work)).not.toContain("generic-approval");
    expect(ids(result.work)).not.toContain("tasks-approval");
    expect(ids(result.visible)).not.toContain("hidden-tasks");
    expect(generic.approval?.requestId).toBe(11);
    expect(tasks.approval?.requestId).toBe(12);
  });

  it("shows a terminal error as the result instead of stale assistant prose", () => {
    const failure: Block = { id: "terminal", role: "system", notice: "error", text: "Provider disconnected. Retry the turn." };
    const result = compactTurn([user, narration, command, failure], true);
    expect(ids(result.outside)).toEqual(["user", "terminal"]);
    expect(ids(result.work)).toEqual(["narration", "command"]);
    expect([...result.outside][1].text).toBe(failure.text);
  });

  it("retains the final answer when an earlier error was recovered", () => {
    const recovered: Block = { id: "recovered", role: "system", notice: "error", text: "Temporary connection failure" };
    const result = compactTurn([user, recovered, command, final], true);
    expect(ids(result.outside)).toEqual(["user", "final"]);
    expect(ids(result.work)).toEqual(["recovered", "command"]);
  });

  it.each([
    { id: "interrupt", role: "system", notice: "interrupt", text: "Stopped by the user" },
    { id: "legacy-interrupt", role: "system", text: INTERRUPT_MESSAGE },
  ] satisfies Block[])("keeps terminal interruption $id visible after stale prose", interrupt => {
    const result = compactTurn([user, narration, command, interrupt], true);
    expect(ids(result.outside)).toEqual(["user", interrupt.id]);
    expect(ids(result.work)).toEqual(["narration", "command"]);
  });

  it("retains summary parts and exact raw reasoning in the folded work", () => {
    const summary: Block = { id: "summary", role: "reasoning", text: "**Inspecting the renderer**\n\nThe summary appears once.", reasoning: { itemId: "reasoning-item", partIndex: 0, channel: "summary" } };
    const raw: Block = { id: "raw", role: "reasoning", text: "Raw provider diagnostic\n<team_sender>literal reasoning</team_sender>", reasoning: { itemId: "reasoning-item", partIndex: 0, channel: "raw" } };
    const result = compactTurn([user, summary, raw, command, final], true);
    expect(ids(result.work)).toEqual(["summary", "raw", "command"]);
    expect(result.work[0]).toBe(summary);
    expect(result.work[1]).toBe(raw);
    expect(result.work[1].text).toBe(raw.text);
    expect(ids(result.outside)).toEqual(["user", "final"]);
  });

  it("counts each edited file once and keeps nonfatal failures inside work", () => {
    const firstEdit: Block = { id: "edit-a", role: "tool", text: "Edited src/a.ts", tool: { kind: "edit", status: "completed", paths: ["src/a.ts", "src/b.ts"], preview: { kind: "write", path: "src/a.ts", additions: 3, deletions: 1 } } };
    const repeatedEdit: Block = { id: "edit-b", role: "tool", text: "Edited src/a.ts", tool: { kind: "edit", status: "completed", preview: { kind: "write", path: "src/a.ts" } } };
    const failedCommand: Block = { ...command, id: "failed-command", tool: { kind: "shell", status: "failed", detail: "exit code 1: type error" } };
    const result = compactTurn([user, firstEdit, failedCommand, repeatedEdit, command, final], true);
    expect(result.edits).toBe(2);
    expect(result.failures).toBe(1);
    expect(ids(result.outside)).toEqual(["user", "final"]);
    expect(ids(result.work)).toEqual(["edit-a", "failed-command", "edit-b", "command"]);
    expect(result.work[1].tool?.detail).toBe("exit code 1: type error");
    expect(result.work[0].tool?.preview).toMatchObject({ additions: 3, deletions: 1 });
  });

  it("keeps structured plan and team decisions outside the fold", () => {
    const plan: Block = { id: "plan", role: "plan", text: "Approve this plan", plan: { status: "ready", originalText: "Approve this plan" } };
    const teamChange: Block = { id: "team-change", role: "system", text: "Review team change", monoTeamChange: { managerId: "manager", changeId: "change" } };
    const result = compactTurn([user, narration, plan, teamChange, final], true);
    expect(ids(result.outside)).toEqual(["user", "plan", "team-change", "final"]);
    expect(ids(result.work)).toEqual(["narration"]);
  });

  it.each([true, false])("applies internal visibility consistently for running and settled=%s", settled => {
    const internal: Block = { id: "internal", role: "assistant", text: "Internal coordinator note", internal: true };
    const blocks = [user, internal, command, final];
    const ordinary = compactTurn(blocks, settled, false, false);
    const managed = compactTurn(blocks, settled, false, true);
    expect(ids(ordinary.visible)).toEqual(["user", "command", "final"]);
    expect(ids(ordinary.work)).not.toContain("internal");
    expect(ids(managed.visible)).toEqual(["user", "internal", "command", "final"]);
    expect(ids(managed.work)).toContain("internal");
  });
});
