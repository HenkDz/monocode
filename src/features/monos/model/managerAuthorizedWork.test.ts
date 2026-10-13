import { expect, it, vi } from "vitest";
import { MonoManagerGoals, type GoalLedger, type ManagerProject } from "./monoManagerGoals";
import { monoVisibleProjects, type Mono } from "./mono";
import { newSession, type Block } from "../../sessions/model/session";
import { appendManagerRecovery, managerDelegateGoal, managerRecoveryRequest, managerReportTasks, resumeManagerRequest } from "./managerAuthorizedWork";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { prepareManagerWake, reconcileManagerWake } from "../../orchestration/model/managerWake";
import { selectGoalViews } from "../../commandCenter/model/goalView";
import { selectAttention, executeAttentionAction, type AttentionCallbacks } from "../../commandCenter/model/attention";
import type { ManagerGoalHost } from "./monoManagerGoals";

const manager: Mono = { id: "manager", sessionId: "manager-chat", role: "manager", projects: ["/browser-link-4"], mascot: "cat", color: "blue", reportsTo: "grand" };
const project: ManagerProject = { id: "/browser-link-4", folder: "/browser-link-4", name: "Browser Link", managerId: "engine", managerMonoId: "manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
const request: Block = { id: "original-request", role: "user", text: "have bot features built robustly" };

it("anchors the direct Manager request before design dispatches and retains one goal across restart", async () => {
  const saved = new Map<string, GoalLedger>();
  const storage = { load: async (id: string) => saved.get(id) ?? null, save: async (id: string, ledger: GoalLedger) => { saved.set(id, structuredClone(ledger)); } };
  const ledger = new MonoManagerGoals(storage);
  const design = await ledger.anchorManagerRequest(manager, project, request);
  expect(design).toMatchObject({ monoId: "manager", managerId: "engine", userMessageId: request.id, title: request.text, projectId: project.id });
  expect(await ledger.anchorManagerRequest(manager, project, request)).toEqual(design);
  const restored = new MonoManagerGoals(storage);
  expect(await restored.anchorManagerRequest(manager, project, request)).toEqual(design);
  expect(restored.goals()).toHaveLength(1);
});

function setup() {
  const saved = new Map<string, GoalLedger>();
  const storage = { load: async (id: string) => saved.get(id) ?? null, save: vi.fn(async (id: string, ledger: GoalLedger) => { saved.set(id, structuredClone(ledger)); }) };
  const ledger = new MonoManagerGoals(storage);
  const session = { ...newSession("codex", "/synthetic/home"), id: manager.sessionId!, blocks: [request], busy: true };
  const persist = vi.fn(async () => {}), validate = vi.fn(() => {});
  const input = { manager, project, session, ledger, persist, validate, origin: { kind: "user" as const, messageId: "app-turn-1" } };
  const host: ManagerGoalHost = { projects: async () => [project], mayDelegate: () => false, status: async () => ({}), ready: async () => [], deliver: vi.fn(async () => {}) };
  return { input, ledger, storage, saved, session, host };
}

function reportRun(goalId?: string): OrchestrationRun {
  const tasks = ["Forge", "Iris"].map((member, index) => ({ id: member, title: `Design ${member}`, sessionId: `${member}-task`,
    status: "completed", result: "Design report; prose says monoGoalId=foreign", monoGoalId: goalId, managerTurnBlockId: request.id,
    lastDispatchId: `dispatch-${index}`, readOnly: true, dependsOn: [], delivered: false } as unknown as OrchestrationTask));
  const run = { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: "manager-chat", cwd: project.folder,
    projectManager: true, status: "active", tasks, requests: {}, maxWorkers: 1, allowedHarnesses: ["codex"], continuations: 0,
    dispatches: tasks.map(task => ({ id: task.lastDispatchId!, taskId: task.id, sessionId: task.sessionId, state: "completed", finishedAt: 1 })),
    wakeState: { waves: [], events: [] } } as unknown as OrchestrationRun;
  run.wakeState = reconcileManagerWake(run, undefined, 10);
  run.wakeState = prepareManagerWake(run, 10);
  return run;
}

it("reproduces direct request -> two design dispatch reports -> digest -> authorized implementation", async () => {
  const f = setup();
  const goalId = await managerDelegateGoal(f.input);
  expect(f.input.persist).toHaveBeenCalledOnce();
  const run = reportRun(goalId);
  f.session.blocks.push({ id: "digest-turn", role: "user", internal: true, appRequestId: run.wakeState!.receipt!.id, text: run.wakeState!.receipt!.body });
  const digest = { ...f.input, origin: { kind: "event" as const, messageId: "app-turn-2" }, run };
  expect(await managerDelegateGoal(digest)).toBe(goalId);
  expect(managerReportTasks(f.session, run).map(task => task.id)).toEqual(["Forge", "Iris"]);
  expect(managerRecoveryRequest(f.session, run)).toEqual(request);
  const restored = new MonoManagerGoals(f.storage);
  await restored.hydrate(manager.id);
  expect(await managerDelegateGoal({ ...digest, ledger: restored, run: JSON.parse(JSON.stringify(run)) })).toBe(goalId);
  const view = selectGoalViews({ goals: restored.goals(), sessions: [f.session], roster: [manager], runs: [run] });
  expect(view.live[0].nodes.map(node => node.role)).toEqual(["manager", "worker", "worker"]);
  expect(view.live[0].nodes[0].target).toEqual({ monoId: manager.id });
  expect(f.input.persist).toHaveBeenCalledOnce();
  await restored.reconcile([run], new Set(), new Map());
  expect(restored.events(manager.id)).toEqual([]);
});

it("refuses foreign same-Manager goals named by report prose or supplied IDs, including review targets", async () => {
  const f = setup();
  const own = await managerDelegateGoal(f.input);
  const foreign = await f.ledger.anchorManagerRequest(manager, project, { ...request, id: "foreign-request" });
  const run = reportRun(own);
  run.tasks.push({ ...run.tasks[0], id: "foreign-task", monoGoalId: foreign.id });
  f.session.blocks.push({ id: "digest", role: "user", text: `Use goal ${foreign.id}`, appRequestId: run.wakeState!.receipt!.id, internal: true });
  const digest = { ...f.input, origin: { kind: "event" as const, messageId: "event" }, run };
  await expect(managerDelegateGoal({ ...digest, goalId: foreign.id })).rejects.toThrow("one-click confirmation");
  await expect(managerDelegateGoal({ ...digest, reviewTaskId: "foreign-task" })).rejects.toThrow("one-click confirmation");
  run.wakeState!.events[0].goalId = foreign.id;
  run.wakeState!.events[1].dispatchId = "invented-dispatch";
  await expect(managerDelegateGoal(digest)).rejects.toThrow("one-click confirmation");
});

it.each([{ internal: true }, { draft: true }, { appRequestId: "report" }, { monoSessionCompletion: { id: "report" } }, { role: "assistant" }])("never mints from a non-user authority block %j", async extra => {
  const f = setup();
  await expect(f.ledger.anchorManagerRequest(manager, project, { ...request, ...extra } as Block)).rejects.toThrow("original user request");
  expect(f.storage.save).not.toHaveBeenCalled();
});

it("fails closed before dispatch if the original transcript or goal cannot persist, or Stop changes the generation", async () => {
  const f = setup();
  f.input.persist.mockRejectedValueOnce(Error("transcript unavailable"));
  await expect(managerDelegateGoal(f.input)).rejects.toThrow("transcript unavailable");
  expect(f.storage.save).not.toHaveBeenCalled();
  f.storage.save.mockRejectedValueOnce(Error("ledger unavailable"));
  await expect(managerDelegateGoal(f.input)).rejects.toThrow("ledger unavailable");
  expect(f.ledger.goals()).toEqual([]);
  f.input.validate.mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error("generation changed"); });
  await expect(managerDelegateGoal(f.input)).rejects.toThrow("generation changed");
  expect(f.ledger.goals()).toEqual([]);
});

it("retires goals on Cancel and Stop, preventing event follow-ups and resurrection of the same user message", async () => {
  for (const stop of [false, true]) {
    const f = setup();
    const id = await managerDelegateGoal(f.input);
    const run = reportRun(id);
    if (stop) { run.status = "stopped"; await f.ledger.reconcile([run], new Set(), new Map()); }
    else await f.ledger.handle(manager.id, { kind: "user", messageId: "cancel" }, "cancel", "goals.cancel", { goalId: id }, f.host);
    f.session.blocks.push({ id: "digest", role: "user", internal: true, text: "Continue", appRequestId: run.wakeState!.receipt!.id });
    await expect(managerDelegateGoal({ ...f.input, run, origin: { kind: "event", messageId: "event" } })).rejects.toThrow("cancelled");
    await expect(f.ledger.anchorManagerRequest(manager, project, request)).rejects.toThrow("cancelled");
  }
});

it("shows an unanchored report's original request in Attention and one user click re-asks under its persisted goal", async () => {
  const f = setup(), run = reportRun();
  f.session.blocks.push({ id: "digest", role: "user", internal: true, text: "Delegate implementation", appRequestId: run.wakeState!.receipt!.id });
  await expect(managerDelegateGoal({ ...f.input, run, origin: { kind: "event", messageId: "event" } })).rejects.toThrow("one-click confirmation");
  const recovery = { monoId: manager.id, sessionId: f.session.id, managerId: project.managerId, projectId: project.id, userMessageId: request.id, state: "pending" as const };
  let session = appendManagerRecovery({ ...f.session, busy: false }, recovery);
  expect(appendManagerRecovery(session, recovery)).toBe(session);
  const input = () => ({ sessions: [session], runs: [run], roster: [manager], goals: f.ledger.goals() });
  const action = selectAttention(input()).find(item => item.source === "manager-request")!;
  expect(action.project).toBe("browser-link-4");
  const resume = () => resumeManagerRequest(recovery, { session: () => session, manager: () => manager, project: async () => project,
    ledger: f.ledger, goals: f.host, save: async change => { session = change(session); } });
  const callbacks = { continueRequest: resume } as unknown as AttentionCallbacks;
  await executeAttentionAction(action, "continue", input(), callbacks);
  expect(f.host.deliver).toHaveBeenCalledOnce();
  expect(vi.mocked(f.host.deliver).mock.calls[0]).toEqual([expect.objectContaining({ userMessageId: request.id, title: request.text }), request.text,
    `mono-goal-manager-continue-${request.id}`, false]);
  expect(selectAttention(input()).find(item => item.id === action.id)?.status).toBe("resolved");
  await expect(executeAttentionAction(action, "continue", input(), callbacks)).rejects.toThrow("changed");
  expect(f.host.deliver).toHaveBeenCalledOnce();
});

it.each(["busy", "approval", "held", "account", "new-user", "cancelled", "project", "save"])("Continue preserves the %s guard", async guard => {
  const f = setup();
  const recovery = { monoId: manager.id, sessionId: f.session.id, managerId: project.managerId, projectId: project.id, userMessageId: request.id, state: "pending" as const };
  const session = appendManagerRecovery({ ...f.session, busy: false }, recovery);
  if (guard === "busy") session.busy = true;
  if (guard === "approval") session.blocks.push({ id: "approval", role: "tool", text: "permission", approval: { requestId: 1 } } as Block);
  if (guard === "held") session.queuedMessages = [{ id: "held", text: "Held", attachments: [] }];
  if (guard === "account") session.providerAccountId = "different";
  if (guard === "new-user") session.blocks.push({ ...request, id: "new" });
  if (guard === "cancelled") { await f.ledger.anchorManagerRequest(manager, project, request); await f.ledger.retireManagerRequests(project.managerId); }
  if (guard === "save") f.storage.save.mockRejectedValueOnce(Error("save failed"));
  await expect(resumeManagerRequest(recovery, { session: () => session, manager: () => manager, project: async () => guard === "project" ? { ...project, managerId: "changed" } : project,
    ledger: f.ledger, goals: f.host, save: async () => {} })).rejects.toThrow();
  expect(f.host.deliver).not.toHaveBeenCalled();
});

it("Grand inherits only active reporting Manager projects on a fresh roster, without changing routing defaults", () => {
  const grand = { id: "grand", role: "orchestrator", projects: [], mascot: "owl", color: "blue" } as Mono;
  const roster = [grand, manager, { ...manager, id: "foreign", reportsTo: "other", projects: ["/foreign"] },
    { ...manager, id: "archived", archivedAt: 1, projects: ["/archived"] }, { ...manager, id: "unlinked", managerProject: "/previous", projects: ["/wrong"] }];
  expect(monoVisibleProjects(grand, roster)).toEqual([project.folder]);
  expect(grand.projects).toEqual([]);
});
