// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { runGoalNextAction, selectGoalNextAction, type GoalActionHost } from "./goalNextAction";

function fixture() {
  const manager = { id: "manager", role: "manager", managerEngineId: "engine", sessionId: "chat", projects: ["/app"] } as Mono;
  const goal = { id: "goal", managerId: "engine", projectId: "/app", state: "running", updatedAt: 1 } as MonoManagerGoal;
  const task = { id: "task", monoGoalId: "goal", status: "queued", sessionId: "worker", dependsOn: [], accepted: false } as OrchestrationTask;
  const run = { leadId: "engine", ownerMonoId: "manager", ownerSessionId: "chat", projectManager: true, cwd: "/app", status: "active", tasks: [task] } as OrchestrationRun;
  const session = { ...newSession("codex", "/app"), id: "chat" };
  const input = { goals: [goal], roster: [manager], runs: [run], sessions: [session] };
  const read = () => selectGoalNextAction(input, "goal");
  const host: GoalActionHost = { read, open: vi.fn(async () => true), continueManager: vi.fn(async () => {}), startGoal: vi.fn(async () => {}), pending: new Set(), accepted: new Set() };
  const click = new Event("click");
  const button = document.createElement("button"); button.dataset.decisionUi = "";
  // Synthetic trusted gesture for unit ports; real browser clicks remain a separate gate.
  Object.defineProperties(click, { isTrusted: { value: true }, target: { value: button } });
  return { input, manager, goal, task, run, session, read, host, click };
}

it("selects one goal-scoped Start and requires an existing goal-bound callback", async () => {
  const f = fixture();
  expect(f.read()).toMatchObject({ action: "start", sessionId: "chat", label: "Next task hasn't started — Start" });
  await runGoalNextAction(f.click, f.read()!, f.host);
  expect(f.host.startGoal).toHaveBeenCalledExactlyOnceWith("goal");
  expect(f.host.continueManager).not.toHaveBeenCalled();
});

it("uses the owning Manager chat even when its managed working folder differs from the project", () => {
  const f = fixture(); f.session.cwd = "/synthetic/manager/workspace";
  expect(f.read()?.sessionId).toBe("chat");
  f.run.ownerSessionId = "foreign-chat";
  f.input.sessions.push({ ...f.session, id: "foreign-chat" });
  expect(f.read()).toBeUndefined();
});

it("uses existing Continue for a paused Manager and opens an actual approval first", async () => {
  const f = fixture(); f.run.status = "paused";
  expect(f.read()?.label).toBe("Manager paused — Continue");
  await runGoalNextAction(f.click, f.read()!, f.host);
  expect(f.host.continueManager).toHaveBeenCalledExactlyOnceWith("engine");
  f.session.blocks.push({ id: "approval", role: "tool", text: "", approval: { requestId: 7, decided: false } } as never);
  expect(f.read()).toMatchObject({ action: "open", sessionId: "chat", label: "Waiting for your approval — Open" });
  await runGoalNextAction(f.click, f.read()!, f.host);
  expect(f.host.startGoal).not.toHaveBeenCalled();
});

it.each(["stopped", "finished", "wrong-project", "wrong-manager", "running", "manager-busy", "cancelled-goal", "recovery", "queued-message"])("does not offer Start for %s", condition => {
  const f = fixture();
  if (condition === "stopped" || condition === "finished") f.run.status = condition;
  if (condition === "wrong-project") f.run.cwd = "/other";
  if (condition === "wrong-manager") { f.run.ownerMonoId = "other"; f.manager.managerEngineId = "other"; }
  if (condition === "running") f.task.status = "running";
  if (condition === "manager-busy") f.session.busy = true;
  if (condition === "cancelled-goal") f.goal.state = "cancelled";
  if (condition === "recovery") f.run.recovering = true;
  if (condition === "queued-message") f.session.queuedMessages = [{ id: "existing", text: "Already waiting", attachments: [] }];
  expect(f.read()).toBeUndefined();
});

it("does not attribute unrelated held info to a goal or revive cancelled tasks", () => {
  const f = fixture();
  f.task.status = "cancelled";
  f.run.wakeState = { waves: [], events: [{ id: "unrelated", kind: "info", at: 1, text: "An update" }] };
  expect(f.read()).toBeUndefined();
  f.run.tasks = []; f.goal.state = "queued";
  expect(f.read()?.action).toBe("start");
});

it.each(["stop", "account", "checkout", "task", "goal"])("rechecks %s after opening the existing conversation", async changed => {
  const f = fixture(), step = f.read()!;
  f.host.open = async () => {
    if (changed === "stop") f.run.status = "stopped";
    if (changed === "account") f.session.providerAccountId = "different";
    if (changed === "checkout") f.session.worktreeCwd = "/other";
    if (changed === "task") f.task.status = "cancelled";
    if (changed === "goal") f.goal.updatedAt++;
  };
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("goal changed");
  expect(f.host.startGoal).not.toHaveBeenCalled();
});

it("shares one pending/accepted lock across surfaces and permits a refused send to retry", async () => {
  const f = fixture(), step = f.read()!;
  f.host.startGoal = vi.fn(async () => { throw Error("Refused"); });
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("Refused");
  expect(f.host.pending.size).toBe(0); expect(f.host.accepted.size).toBe(0);
  f.host.startGoal = vi.fn(async () => {});
  const first = runGoalNextAction(f.click, step, f.host);
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("already been sent");
  await first;
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("already been sent");
  expect(f.host.startGoal).toHaveBeenCalledOnce();
});

it("rejects programmatic clicks before any action port", async () => {
  const f = fixture();
  await expect(runGoalNextAction(new Event("click"), f.read()!, f.host)).rejects.toThrow("direct click");
  expect(f.host.open).not.toHaveBeenCalled(); expect(f.host.startGoal).not.toHaveBeenCalled();
});

it("does not substitute an ordinary user message when goal binding is unavailable", async () => {
  const f = fixture(); delete f.host.startGoal;
  await expect(runGoalNextAction(f.click, f.read()!, f.host)).rejects.toThrow("original Manager request");
  expect(f.host.accepted.size).toBe(0);
});
