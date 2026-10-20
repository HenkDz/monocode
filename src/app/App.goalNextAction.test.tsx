// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { MonoManagerGoals, type ManagerGoalHost, type ManagerProject } from "../features/monos/model/monoManagerGoals";
import { appendManagerRecovery, assertManagerContinuation, assertManagerDelivery, continueManagerRequest, managerDelegateGoal, managerRequestBinding, registerManagerRequestContinuation, resumeManagerRequest } from "../features/monos/model/managerAuthorizedWork";
import { selectGoalNextAction, runGoalNextAction, type GoalNextStep } from "../features/commandCenter/model/goalNextAction";
import { newSession, type Session } from "../features/sessions/model/session";
import type { Mono } from "../features/monos/model/mono";
import type { OrchestrationRun } from "../features/orchestration/model/orchestrationState";
import { pathKey } from "../shared/lib/paths";
import { decisionCountsByProject } from "../features/commandCenter/model/decisionView";
import { renderToStaticMarkup } from "react-dom/server";
import { commandMapDecisions } from "../features/teamMap/commandMapDecisions";

const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
function declaration(name: string) {
  const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration;
  if (!node) throw Error(`Missing actual App declaration ${name}`);
  return (node.initializer as ts.CallExpression).arguments[0].getText(ast);
}
function evaluate<T>(text: string, scope: Record<string, unknown>): T {
  return new Function(...Object.keys(scope), ts.transpile(`return ${text}`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(...Object.values(scope));
}
const hostAssignment = nodes.find(node => ts.isBinaryExpression(node) && node.left.getText(ast) === "managerGoalHost.current") as ts.BinaryExpression;
const delivery = (hostAssignment.right as ts.ObjectLiteralExpression).properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(ast) === "deliver") as ts.PropertyAssignment;
const registration = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).startsWith("() => registerManagerRequestContinuation")) as ts.CallExpression;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });

async function fixture() {
  const manager: Mono = { id: "manager", sessionId: "chat", managerEngineId: "engine", role: "manager", projects: ["/repo"], mascot: "cat", color: "blue" };
  const roster = [manager];
  const project: ManagerProject = { id: "/repo", folder: "/repo", name: "Project", managerId: "engine", managerMonoId: manager.id, managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
  const original = { id: "original", role: "user" as const, text: "Implement the existing routing goal" };
  const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
  const goal = await ledger.anchorManagerRequest(manager, project, original);
  const source = { ...newSession("codex", "/synthetic/manager/workspace"), id: "chat", codexStorageHome: "/synthetic/home", blocks: [original] };
  const request = { monoId: manager.id, sessionId: source.id, managerId: project.managerId, projectId: project.id, userMessageId: original.id, state: "pending" as const, binding: managerRequestBinding(source) };
  const sessionsRef = { current: [appendManagerRecovery(source, request)] };
  const run = { leadId: "engine", ownerMonoId: manager.id, ownerSessionId: "chat", projectManager: true, cwd: "/repo", status: "active", tasks: [] } as unknown as OrchestrationRun;
  let afterOpen: (() => Promise<void> | void) | undefined;
  const ensureOpenSession = async (id: string) => { await afterOpen?.(); return sessionsRef.current.find(session => session.id === id); };
  const upsertSession = vi.fn(async (session: Session, change: (session: Session) => Session) => {
    const next = change(sessionsRef.current.find(current => current.id === session.id)!);
    sessionsRef.current = sessionsRef.current.map(current => current.id === session.id ? next : current);
    return next;
  });
  const orchestrator = { snapshot: () => [run], run: () => run, hydrate: async () => {}, registerMonoEngine: vi.fn(), continueManager: vi.fn(async () => {}) };
  const managerGoalHost = { current: { projects: async () => [project], mayDelegate: () => false, status: async () => ({}), ready: async () => [] } as unknown as ManagerGoalHost };
  const findMono = (id: string) => id === manager.id ? manager : undefined;
  const scope = { monoManagerGoals: ledger, sessionsRef, findMono, managerGoalHost, assertManagerContinuation, assertManagerDelivery,
    orchestrator, dedicatedMono: () => manager, monoEngineId: async () => "engine", ensureMonoSession: async () => sessionsRef.current[0],
    homeDir: async () => "/synthetic/home", ensureOpenSession, saveMonoPermissions: async () => {}, newDefaultSession: newSession,
    upsertSession, setSessions: () => {}, monoLook: () => ({ name: "Manager", mascot: "cat", color: "blue" }), pathKey,
    assertDirectReport: () => { throw Error("Unexpected different owner"); }, resumeManagerRequest, registerManagerRequestContinuation,
    getMonoGoalRecoveryBlocks: () => { throw Error("Unexpected history read"); } };
  managerGoalHost.current.deliver = evaluate(delivery.initializer.getText(ast), scope);
  dispose = evaluate<() => (() => void)>(registration.arguments[0].getText(ast), scope)();
  const read = evaluate<(goalId: string) => GoalNextStep | undefined>(declaration("readGoalNextAction"), { selectGoalNextAction, monoManagerGoals: ledger, listMonos: () => roster, orchestrator, sessionsRef });
  const opened = vi.fn(async () => {}), openedPage = vi.fn(), close = vi.fn();
  const action = evaluate<(event: Event, step: GoalNextStep) => Promise<void>>(declaration("onGoalNextAction"), {
    runGoalNextAction, readGoalNextAction: read, teamMap: { close }, onOpenApprovalSession: opened, onOpenTeamMap: openedPage, DECISIONS_SCOPE: "decisions", orchestrator,
    continueManagerRequest, decisionPending: { current: new Set<string>() }, decisionAccepted: { current: new Set<string>() },
  });
  const click = new Event("click"), button = document.createElement("button"); button.dataset.decisionUi = "";
  Object.defineProperties(click, { isTrusted: { value: true }, target: { value: button } });
  return { ledger, goal, manager, roster, project, original, request, sessionsRef, run, read, action, click, opened, openedPage, orchestrator, upsertSession,
    afterOpen: (callback: typeof afterOpen) => { afterOpen = callback; } };
}

it("actual App opens the worker approval ahead of a ledger ask while retaining that ask and deduplicating its counts", async () => {
  const f = await fixture();
  const worker = { ...newSession("codex", "/repo"), id: "worker", blocks: [{ id: "approval", role: "tool" as const, text: "", approval: { requestId: 7 } }] };
  f.sessionsRef.current.push(worker);
  f.roster.push({ ...f.manager, id: "worker-mono", sessionId: worker.id, role: "member", reportsTo: f.manager.id });
  f.run.tasks.push({ id: "task", monoGoalId: f.goal.id, status: "queued", sessionId: worker.id, memberId: "worker-mono", dependsOn: [], accepted: false } as OrchestrationRun["tasks"][number]);
  await f.ledger.recordDecision(f.manager.id, { version: 1, type: "decision", id: "waiting", projectId: f.project.id, goalId: f.goal.id,
    requestingMonoId: "worker-mono", requesterSessionId: worker.id, escalationChain: [{ id: f.manager.id, level: "manager" }, { id: "user", level: "user" }],
    status: "waiting", answererId: "user", createdAt: 1, question: "Which unrelated next step?", impact: "high", context: "Still needs an answer", operation: "work",
    options: [{ id: "a", label: "First" }, { id: "b", label: "Second" }] });
  const step = f.read(f.goal.id)!;
  await f.action(f.click, step);
  expect(f.opened).toHaveBeenCalledExactlyOnceWith(worker.id);
  expect(f.openedPage).not.toHaveBeenCalled();
  expect(step).toMatchObject({ key: "worker:approval:7", sessionId: worker.id });
  expect(step.decisionId).toBeUndefined();
  const actions = { answer: vi.fn(async () => ({ logFailed: false })), autonomy: vi.fn(async () => {}), openProject: vi.fn() };
  const map = commandMapDecisions(f.ledger, f.roster, actions, 1, { steps: [step, step], render: value => <button key={value.key}>{value.label}</button> });
  const view = { pending: [{ managerId: f.manager.id, decision: f.ledger.decisions(f.manager.id)[0] }], log: [], teamPending: 0, handledToday: 0, pruned: 0, skipped: 0 };
  expect(decisionCountsByProject(f.roster, f.sessionsRef.current, [f.run], view, [step, step]).get("/repo")).toBe(2);
  expect(map.needYou).toBe(2);
  const markup = renderToStaticMarkup(map.rail);
  expect(markup).toContain("Which unrelated next step?");
  expect(markup).toContain(step.label);
  expect(markup).toContain("2 need you");

  worker.blocks = [];
  await expect(f.action(f.click, step)).rejects.toThrow("goal changed");
  const ledgerStep = f.read(f.goal.id)!;
  expect(ledgerStep).toMatchObject({ key: "decision:manager:waiting", decisionId: "waiting" });
  await f.action(f.click, ledgerStep);
  expect(f.openedPage).toHaveBeenCalledExactlyOnceWith("decisions");
  expect(f.opened).toHaveBeenCalledOnce();
  expect(decisionCountsByProject(f.roster, f.sessionsRef.current, [f.run], view, [ledgerStep]).get("/repo")).toBe(1);
  expect(f.ledger.goals()).toHaveLength(1);
  expect(f.ledger.decisions(f.manager.id)[0].status).toBe("waiting");
  expect(f.sessionsRef.current[0].queuedMessages ?? []).toHaveLength(0);
  expect(f.orchestrator.continueManager).not.toHaveBeenCalled();
  expect(actions.answer).not.toHaveBeenCalled();
});

it("runs actual App Start -> existing registered recovery -> actual App delivery -> delegate with the same goal and no second ledger entry", async () => {
  const f = await fixture(), step = f.read(f.goal.id)!;
  expect(step.action).toBe("start");
  await f.action(f.click, step);
  const queued = f.sessionsRef.current[0].queuedMessages![0];
  expect(queued.monoSource?.goalId).toBe(f.goal.id);
  expect(queued.monoSource?.request).toEqual(f.request);
  expect(queued.id).toBe("mono-goal-manager-continue-original");
  expect(f.ledger.goals()).toHaveLength(1);
  expect(f.sessionsRef.current[0].blocks.find(block => block.managerRequestRecovery)?.managerRequestRecovery?.state).toBe("continued");
  const session = { ...f.sessionsRef.current[0], busy: true, queuedMessages: [], blocks: [...f.sessionsRef.current[0].blocks, {
    id: "accepted", role: "user" as const, text: queued.text, appRequestId: queued.id, monoSource: queued.monoSource,
  }] };
  const persist = vi.fn(async () => {});
  expect(await managerDelegateGoal({ manager: f.manager, project: f.project, session, run: f.run, ledger: f.ledger,
    origin: { kind: "event", messageId: queued.id }, goalId: f.goal.id, persist, validate: () => {} })).toBe(f.goal.id);
  expect(f.ledger.goals()).toHaveLength(1); expect(persist).not.toHaveBeenCalled();
  await expect(f.action(f.click, step)).rejects.toThrow("goal changed");
  expect(f.sessionsRef.current[0].queuedMessages).toHaveLength(1);
});

it.each(["missing", "wrong-user", "wrong-goal"])("renders no Start for a %s retained record and only opens the owning chat", async condition => {
  const f = await fixture();
  if (condition === "missing") f.sessionsRef.current[0].blocks = [f.original];
  if (condition === "wrong-user") f.sessionsRef.current[0].blocks.find(block => block.managerRequestRecovery)!.managerRequestRecovery!.userMessageId = "other";
  if (condition === "wrong-goal") f.goal.userMessageId = "different";
  // The real ledger returns its retained object; replace only the selector's candidate for the wrong-goal case.
  const step = condition === "wrong-goal" ? selectGoalNextAction({ goals: [{ ...f.ledger.goals()[0], userMessageId: "different" }], roster: [f.manager], runs: [f.run], sessions: f.sessionsRef.current }, f.goal.id) : f.read(f.goal.id);
  expect(step?.action).toBe("chat");
  if (condition !== "wrong-goal") await f.action(f.click, step!);
  expect(f.sessionsRef.current[0].queuedMessages ?? []).toHaveLength(0);
  expect(f.ledger.goals()).toHaveLength(1);
});

it.each(["account", "checkout", "hold", "Stop"])("the existing App recovery refuses %s drift after its awaited source load", async guard => {
  const f = await fixture(), step = f.read(f.goal.id)!;
  f.afterOpen(async () => {
    if (guard === "account") f.sessionsRef.current[0].providerAccountId = "changed";
    if (guard === "checkout") f.sessionsRef.current[0].worktreeCwd = "/different";
    if (guard === "hold") f.sessionsRef.current[0].queueStatus = "paused";
    if (guard === "Stop") await f.ledger.retireManagerRequests(f.run.leadId);
  });
  await expect(f.action(f.click, step)).rejects.toThrow();
  expect(f.sessionsRef.current[0].queuedMessages ?? []).toHaveLength(0);
  expect(f.ledger.goals()).toHaveLength(1);
});

it("deduplicates the same paused Manager across multiple goals and an existing native approval", async () => {
  const f = await fixture();
  const other = await f.ledger.anchorManagerRequest(f.manager, f.project, { ...f.original, id: "other" });
  f.run.status = "paused";
  const view = { pending: [], log: [], teamPending: 0, handledToday: 0, pruned: 0, skipped: 0 };
  expect(decisionCountsByProject([f.manager], f.sessionsRef.current, [f.run], view, [f.read(f.goal.id)!, f.read(other.id)!]).get("/repo")).toBe(1);
  f.run.status = "active";
  f.sessionsRef.current[0].blocks.push({ id: "approval", role: "tool", text: "", approval: { requestId: 42 } } as never);
  expect(decisionCountsByProject([f.manager], f.sessionsRef.current, [f.run], view, [f.read(f.goal.id)!, f.read(other.id)!]).get("/repo")).toBe(1);
});
