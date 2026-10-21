import { expect, it } from "vitest";
import { selectNeedsUser, decisionCountsByProject, type DecisionView } from "./decisionView";
import { distinctGoalNextActions, type GoalNextStep } from "./goalNextAction";
import { newSession, type Block } from "../../sessions/model/session";
import { coordinationSummary, presentationText } from "../../sessions/model/transcriptPresentation";
import { sessionActivityAt } from "../../sessions/model/sessionActivity";

const view: DecisionView = { pending: [], log: [], teamPending: 0, handledToday: 0, pruned: 0, skipped: 0 };
const step = (key: string, action: GoalNextStep["action"] = "chat"): GoalNextStep => ({ key, action, goalId: key, projectId: "C:/repo", managerMonoId: "manager", managerId: "engine", sessionId: "worker", label: "Open", revision: key });

it("counts real approvals separately and dedupes goal projections without treating stalled chat nudges as decisions", () => {
  const command = "git reset --hard 0123456789abcdef0123456789abcdef01234567";
  const blocks: Block[] = [1, 2].map(requestId => ({ id: `approval-${requestId}`, role: "tool", text: command, approval: { requestId } }));
  const session = { ...newSession("codex", "C:/repo"), id: "worker", blocks };
  const steps = [step("nudge-one"), step("nudge-two"), step("worker:approval:1", "open"), step("start", "start"), step("start", "start")];
  const selected = selectNeedsUser([], [session, session], [], view, steps);
  expect(selected.count).toBe(3);
  expect(selected.goals.map(row => row.key)).toEqual(["start"]);
  expect(selected.attention.filter(row => row.status === "open")).toHaveLength(2);
  expect(selected.attention.filter(row => row.source === "approval").map(row => row.detail)).toEqual([command, command]);
  expect(decisionCountsByProject([], [session], [], view, steps).get("c:/repo")).toBe(selected.count);
  expect(distinctGoalNextActions(steps).some(row => row.action === "chat")).toBe(false);
  expect(blocks[0].text).toBe(command);
});

it("uses recorded activity clocks and saved order instead of the time a session is read", () => {
  const session = { ...newSession("codex", "C:/repo"), blocks: [{ id: "u", role: "user" as const, text: "hello", startedAt: 10, durationMs: 20 }] };
  expect(sessionActivityAt(session)).toBe(30);
  expect(sessionActivityAt(session, 40)).toBe(40);
  expect(sessionActivityAt(newSession("codex", "C:/repo"), 7)).toBe(7);
});

it("bounds coordination copy while keeping original source and command text intact", () => {
  const raw = "Implement the approved sign-in change " + "x".repeat(150) + " 0123456789abcdef0123456789abcdef01234567 11111111-2222-3333-4444-555555555555";
  expect(coordinationSummary(raw, 60)).toHaveLength(60);
  expect(coordinationSummary("Commit 0123456789abcdef0123456789abcdef01234567")).toBe("Commit 0123456");
  expect(coordinationSummary("task/session state mismatch")).toContain("Open the Manager");
  expect(presentationText(raw)).toBe(raw);
});
