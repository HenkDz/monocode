import { expect, it } from "vitest";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import type { Worktree } from "./worktrees";
import { worktreeProgress, worktreeSessionGroups } from "./worktreeSessions";
import { pathKey } from "../../../shared/lib/paths";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

it("keeps team workers and earlier dispatch sessions out of user worktrees and badges", () => {
  const runs = [{ ownerMonoId: "manager", tasks: [{ sessionId: "reviewer" }], dispatches: [{ sessionId: "old-reviewer" }] }] as OrchestrationRun[];
  const grouped = worktreeSessionGroups("C:/repo", [tree("C:/repo")], [session("reviewer"), session("old-reviewer"), session("user")], [], runs);
  const rows = grouped.get(pathKey("C:/repo"))!;
  expect(rows.map(row => row.id)).toEqual(["user"]);
  expect(worktreeProgress(rows, new Set(["reviewer", "old-reviewer"]), new Set(), new Set())).toBe("1 session");
});

const tree = (path: string): Worktree => ({
  path,
  branch: "feature",
  head: "abc",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
});
const session = (id: string, worktreeCwd?: string): SessionSummary => ({
  id,
  cwd: "C:/repo",
  worktreeCwd,
  title: id,
  harness: "pi",
  model: "",
  runtimeMode: "supervised",
  createdAt: 1,
  updatedAt: 1,
});

it("groups unlimited sessions by checkout and prefers live bindings over saved history", () => {
  const trees = [
    tree("C:/repo"),
    tree("C:/trees/a"),
    tree("C:/trees/a/nested"),
  ];
  const saved = [
    session("moved", "C:/trees/a"),
    session("main"),
    session("archived", "C:/trees/a"),
    session("removed", "C:/trees/a"),
    session("worker", "C:/trees/a"),
    { ...session("other", "C:/trees/a"), cwd: "C:/other" },
  ];
  saved[2].archived = true;
  saved[3].worktreeRemoved = true;
  saved[4].orchestrationLeadId = "lead";
  const blanks = Array.from({ length: 100 }, (_, i) =>
    session(`blank-${i}`, "c:\\trees\\a"),
  );
  const groups = worktreeSessionGroups("c:\\repo", trees, saved, [
    session("moved", "C:/trees/a/nested/src"),
    ...blanks,
  ]);
  expect(groups.get(pathKey("C:/repo"))?.map((s) => s.id)).toEqual(["main"]);
  expect(groups.get(pathKey("C:/trees/a/nested"))?.map((s) => s.id)).toEqual([
    "moved",
  ]);
  expect(groups.get(pathKey("C:/trees/a"))).toHaveLength(100);
  expect(blanks[0].worktreeCwd).toBe("c:\\trees\\a");
});

it("preserves saved archive flags on live rows and never groups prefix siblings", () => {
  const archived = { ...session("saved", "C:/trees/a"), archived: true };
  const groups = worktreeSessionGroups(
    "C:/repo",
    [tree("C:/trees/a")],
    [archived, session("sibling", "C:/trees/ab")],
    [session("saved", "C:/trees/a")],
  );
  expect(groups.get(pathKey("C:/trees/a"))).toEqual([]);
});

it("summarizes all progress with input taking priority over working and done", () => {
  const rows = [
    session("waiting"),
    session("working"),
    session("done"),
    session("idle"),
  ];
  expect(
    worktreeProgress(
      rows,
      new Set(["waiting", "working"]),
      new Set(["waiting"]),
      new Set(["waiting", "working", "done"]),
    ),
  ).toBe("1 needs input · 1 working · 1 done");
  expect(worktreeProgress(rows, new Set(), new Set(), new Set())).toBe(
    "4 sessions",
  );
  expect(worktreeProgress([], new Set(), new Set(), new Set())).toBe(
    "0 sessions",
  );
});
