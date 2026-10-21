// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { runGoalNextAction, selectGoalNextAction, type GoalActionHost } from "./goalNextAction";
import { appendManagerRecovery, managerRequestBinding } from "../../monos/model/managerAuthorizedWork";
import type { MonoDecision } from "../../monos/model/monoDecisions";

function fixture() {
  const manager = { id: "manager", role: "manager", managerEngineId: "engine", sessionId: "chat", projects: ["/app"] } as Mono;
  const goal = { id: "goal", monoId: "manager", userMessageId: "original", requestId: "manager-original", managerId: "engine", projectId: "/app", state: "running", updatedAt: 1 } as MonoManagerGoal;
  const task = { id: "task", monoGoalId: "goal", status: "queued", sessionId: "worker", dependsOn: [], accepted: false } as OrchestrationTask;
  const run = { leadId: "engine", ownerMonoId: "manager", ownerSessionId: "chat", projectManager: true, cwd: "/app", status: "active", tasks: [task] } as OrchestrationRun;
  const source = { ...newSession("codex", "/app"), id: "chat", codexStorageHome: "/synthetic/home", blocks: [{ id: "original", role: "user" as const, text: "Original goal" }] };
  const session = appendManagerRecovery(source, { monoId: "manager", sessionId: "chat", managerId: "engine", projectId: "/app", userMessageId: "original", state: "pending", binding: managerRequestBinding(source) });
  const input = { goals: [goal], roster: [manager], runs: [run], sessions: [session] };
  const read = () => selectGoalNextAction(input, "goal");
  const host: GoalActionHost = { read, open: vi.fn(async () => true), continueManager: vi.fn(async () => {}), continueRequest: vi.fn(async () => {}), pending: new Set(), accepted: new Set() };
  const click = new Event("click");
  const button = document.createElement("button"); button.dataset.decisionUi = "";
  // Synthetic trusted gesture for unit ports; real browser clicks remain a separate gate.
  Object.defineProperties(click, { isTrusted: { value: true }, target: { value: button } });
  return { input, manager, goal, task, run, session, read, host, click };
}

it("selects Start only for the exact retained original request and passes that record unchanged", async () => {
  const f = fixture();
  expect(f.read()).toMatchObject({ action: "start", sessionId: "chat", label: "Next task hasn't started — Start" });
  await runGoalNextAction(f.click, f.read()!, f.host);
  expect(f.host.continueRequest).toHaveBeenCalledExactlyOnceWith(f.read()!.request);
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
  expect(f.host.continueRequest).not.toHaveBeenCalled();
});

it.each(["approval", "question"])("keeps a worker %s ahead of a waiting ledger decision, including its navigation identity", async kind => {
  const f = fixture();
  const worker = { ...newSession("codex", "/app"), id: "worker" };
  if (kind === "approval") worker.blocks.push({ id: "approval", role: "tool", text: "", approval: { requestId: 7 } } as never);
  else worker.pendingQuestion = { requestId: 7, questions: [] };
  f.input.sessions.push(worker);
  const decisions = [{ id: "waiting", projectId: "/app", goalId: f.goal.id, status: "waiting", answererId: "user" } as MonoDecision];
  f.host.read = () => selectGoalNextAction(f.input, f.goal.id, decisions);
  f.host.openDecision = vi.fn();
  const step = f.host.read()!;
  expect(step).toMatchObject({ action: "open", sessionId: "worker", key: `worker:${kind}:7` });
  expect(step.decisionId).toBeUndefined();
  await runGoalNextAction(f.click, step, f.host);
  expect(f.host.open).toHaveBeenCalledExactlyOnceWith("worker");
  expect(f.host.openDecision).not.toHaveBeenCalled();

  worker.blocks = []; worker.pendingQuestion = undefined;
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("goal changed");
  const ledgerStep = f.host.read()!;
  expect(ledgerStep).toMatchObject({ action: "open", sessionId: "chat", key: "decision:manager:waiting", decisionId: "waiting" });
  await runGoalNextAction(f.click, ledgerStep, f.host);
  expect(f.host.openDecision).toHaveBeenCalledExactlyOnceWith("waiting");
  expect(f.host.continueRequest).not.toHaveBeenCalled();
  expect(f.host.continueManager).not.toHaveBeenCalled();
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
  if (condition === "queued-message") expect(f.read()?.action).toBe("chat");
  else expect(f.read()).toBeUndefined();
});

it("does not attribute unrelated held info to a goal or revive cancelled tasks", () => {
  const f = fixture();
  f.task.status = "cancelled";
  f.run.wakeState = { waves: [], events: [{ id: "unrelated", kind: "info", at: 1, text: "An update" }] };
  expect(f.read()).toBeUndefined();
  f.run.tasks = []; f.goal.state = "queued";
  expect(f.read()?.action).toBe("start");
});

it("keeps the existing paused Manager Continue path when its queue is paused", () => {
  const f = fixture(); f.run.status = "paused";
  f.session.queueStatus = "paused";
  f.session.queuedMessages = [{ id: "held", text: "Original queued work", attachments: [] }];
  expect(f.read()?.action).toBe("continue");
});

it("does not resume the same Manager twice from different goal surfaces while Continue is pending", async () => {
  const f = fixture(); f.run.status = "paused";
  f.input.goals.push({ ...f.goal, id: "second" });
  const first = runGoalNextAction(f.click, f.read()!, f.host);
  const second = selectGoalNextAction(f.input, "second")!;
  await expect(runGoalNextAction(f.click, second, { ...f.host, read: () => selectGoalNextAction(f.input, "second") })).rejects.toThrow("already been sent");
  await first;
  expect(f.host.continueManager).toHaveBeenCalledOnce();
});

it.each(["stop", "account", "checkout", "task", "goal", "manager"])("rejects stale %s before calling the existing continuation", async changed => {
  const f = fixture(), step = f.read()!;
    if (changed === "stop") f.run.status = "stopped";
    if (changed === "account") f.session.providerAccountId = "different";
    if (changed === "checkout") f.session.worktreeCwd = "/other";
    if (changed === "task") f.task.status = "cancelled";
    if (changed === "goal") f.goal.updatedAt++;
    if (changed === "manager") { f.manager.id = "replacement"; f.run.ownerMonoId = "replacement"; }
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("goal changed");
  expect(f.host.continueRequest).not.toHaveBeenCalled();
});

it("shares one pending/accepted lock across surfaces and permits a refused send to retry", async () => {
  const f = fixture(), step = f.read()!;
  f.host.continueRequest = vi.fn(async () => { throw Error("Refused"); });
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("Refused");
  expect(f.host.pending.size).toBe(0); expect(f.host.accepted.size).toBe(0);
  f.host.continueRequest = vi.fn(async () => {});
  const first = runGoalNextAction(f.click, step, f.host);
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("already been sent");
  await first;
  await expect(runGoalNextAction(f.click, step, f.host)).rejects.toThrow("already been sent");
  expect(f.host.continueRequest).toHaveBeenCalledOnce();
});

it("rejects programmatic clicks before any action port", async () => {
  const f = fixture();
  await expect(runGoalNextAction(new Event("click"), f.read()!, f.host)).rejects.toThrow("direct click");
  expect(f.host.open).not.toHaveBeenCalled(); expect(f.host.continueRequest).not.toHaveBeenCalled();
});

it("does not substitute an ordinary user message when goal binding is unavailable", async () => {
  const f = fixture(); f.session.blocks = f.session.blocks.filter(block => !block.managerRequestRecovery);
  expect(f.read()).toMatchObject({ action: "chat", label: "Open Manager chat", message: "Next task hasn't started. Ask the Manager to continue." });
  await runGoalNextAction(f.click, f.read()!, f.host);
  expect(f.host.continueRequest).not.toHaveBeenCalled();
  expect(f.host.accepted.size).toBe(0);
});
