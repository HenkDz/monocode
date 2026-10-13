import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { Orchestrator, type ControlOutcome, type OrchestrationHost, type OrchestrationRun } from "../../src/features/orchestration/model/orchestration";
import { acceptManagerWakeQueue, prepareManagerWake } from "../../src/features/orchestration/model/managerWake";
import { monoManagerGoals, type GoalLedger, type ManagerGoalHost, type ManagerProject } from "../../src/features/monos/model/monoManagerGoals";
import { appendManagerRecovery, continueManagerRequest, managerDelegateGoal, managerRecoveryRequest, managerRequestBinding, managerRequestBindingCurrent, registerManagerRequestContinuation, resumeManagerRequest } from "../../src/features/monos/model/managerAuthorizedWork";
import { prepareManagerTurn, delegateManagerRequest } from "virtual:ccgoal-app";
import { monoLook, type Mono } from "../../src/features/monos/model/mono";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import { ManagerRequestNotice } from "../../src/features/monos/ui/ManagerRequestNotice";
import { AttentionQueueView } from "../../src/features/commandCenter/ui/AttentionQueue";
import { MissionControlView } from "../../src/features/commandCenter/ui/MissionControl";
import { selectGoalViews } from "../../src/features/commandCenter/model/goalView";
import { selectCockpit } from "../../src/features/commandCenter/model/cockpit";
import "../../src/styles/index.css";

mockIPC((command, args) => {
  if (command === "control_load") return JSON.stringify(savedGoals.get(String(args?.leadId).replace("mono-goals:", "")) ?? null);
  if (command === "control_save") {
    savedGoals.set(String(args?.leadId).replace("mono-goals:", ""), JSON.parse(String(args?.state)));
    localStorage.setItem("ccgoal:goals", JSON.stringify([...savedGoals])); publish(); return null;
  }
  if (["git_pr_list", "list_external_editors", "org_artifacts_list"].includes(command)) return [];
  return null;
}, { shouldMockEvents: true });
document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
const project: ManagerProject = { id: "/browser-link-4", folder: "/browser-link-4", name: "Browser Link", managerId: "engine", managerMonoId: "manager",
  managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
const manager: Mono = { id: "manager", role: "manager", name: "Browser Link Manager", sessionId: "manager-chat", managerEngineId: "engine",
  projects: [project.folder], reportsTo: "grand", mascot: "cat", color: "#88b9ab" };
const grand: Mono = { id: "grand", name: "Grand Orch", role: "orchestrator", projects: [], mascot: "owl", color: "#9caed1" };
const roster = [grand, manager, ...["Forge", "Iris", "Atlas"].map(name => ({ id: name, name, role: "member" as const, reportsTo: manager.id,
  projects: manager.projects, mascot: "cat", color: manager.color }))];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
let session: Session = JSON.parse(localStorage.getItem("ccgoal:session") ?? "null") ?? { ...newSession("codex", "/synthetic/home"), model: "codex:test", codexStorageHome: "/synthetic/private-home", id: "manager-chat", blocks: [
  { id: "original-request", role: "user", text: "have bot features built robustly", startedAt: Date.now() },
] };
const sessions = new Map<string, Session>();
const readMap = <T,>(key: string): Map<string, T> => new Map(JSON.parse(localStorage.getItem(`ccgoal:${key}`) ?? "[]"));
const persistedSessions = readMap<Session>("sessions");
const savedRuns = readMap<OrchestrationRun>("runs");
const savedGoals = readMap<GoalLedger>("goals");
const events: { action: string; id?: string; goalId?: string }[] = [];
let legacyRun: OrchestrationRun | undefined = JSON.parse(localStorage.getItem("ccgoal:legacy-run") ?? "null") ?? undefined;
const completions = new Map<string, (outcome: ControlOutcome) => void>();
let publish = () => {};
const sessionSave = async (change: (session: Session) => Session) => {
  session = change(session); persistedSessions.set(session.id, structuredClone(session));
  localStorage.setItem("ccgoal:session", JSON.stringify(session)); localStorage.setItem("ccgoal:sessions", JSON.stringify([...persistedSessions])); publish();
};
const ledger = monoManagerGoals;
const engineStorage = {
  load: async (id: string) => savedRuns.get(id) ?? null,
  save: async (run: OrchestrationRun) => { savedRuns.set(run.leadId, structuredClone(run)); localStorage.setItem("ccgoal:runs", JSON.stringify([...savedRuns])); publish(); },
  enable: async () => "/synthetic/monocode", disable: async () => {}, attachOwner: async () => {},
  scopes: async (cwd: string, files: string[]) => files.map(file => `${cwd}/${file}`), resolvePath: async (path: string) => path,
};
let engine = new Orchestrator(engineStorage);
const host: OrchestrationHost = {
  session: id => id === session.id ? session : sessions.get(id), sessions: () => [session, ...sessions.values()],
  choices: () => [{ harness: "codex", models: [{ id: "codex:test", name: "Synthetic" }] }],
  goalCancelled: id => ledger.isCancelling(id) || ledger.goals().some(goal => goal.id === id && goal.state === "cancelled"),
  checkoutSnapshot: async () => ({ head: "synthetic-frozen-head", fingerprint: "synthetic-clean-checkout" }),
  createWorker: async (run, task) => {
    sessions.set(task.sessionId, { ...newSession(task.harness, run.cwd), id: task.sessionId });
    events.push({ action: "worker-created", id: task.id, goalId: task.monoGoalId });
    return { scratchDir: `/synthetic/scratch/${task.id}`, workspace: { id: task.id, kind: "worktree", projectCwd: run.cwd,
      checkoutCwd: `/synthetic/worktrees/${task.id}`, branch: `mc/${task.id}` } };
  },
  submit: (id, _text, done) => { completions.set(id, done); events.push({ action: "worker-submit", id }); },
  integrateWorker: async () => ({ files: [], alreadyApplied: 0 }), cleanupWorker: async () => true,
  stop: async id => { events.push({ action: "stop", id }); }, steer: async () => {}, respondApproval: () => {}, answerQuestion: () => {},
};
const bind = () => { engine.bind(host); engine.registerMonoEngine("engine", session.id, manager.id, project.folder); };
bind();
const goalsHost: ManagerGoalHost = { projects: async () => [project], mayDelegate: () => false, status: async () => ({}), ready: async () => [],
  deliver: async (goal, text, id, cancel, validate) => {
    validate?.();
    if (cancel) for (const task of engine.run("engine")?.tasks ?? []) if (task.monoGoalId === goal.id) await engine.cancelTask("engine", task.id);
    if (session.blocks.some(block => block.appRequestId === id) || session.queuedMessages?.some(message => message.id === id)) return;
    await sessionSave(current => ({ ...current, queuedMessages: [...(current.queuedMessages ?? []), { id, text, attachments: [],
      monoSource: { id: manager.id, name: manager.name!, mascot: manager.mascot, color: manager.color, goalId: goal.id } }] }));
    events.push({ action: "goal-delivered", id, goalId: goal.id });
  } };
registerManagerRequestContinuation(request => resumeManagerRequest(request, { session: () => session, manager: () => manager,
  project: async () => project, ledger, goals: goalsHost, save: sessionSave }));
let turn: string | undefined;
const origins = new Map(), generations = { current: new Map([[session.id, 1]]) };
const currentApp = () => ({
  sessionsRef: { get current() { return [session]; } }, monoGoalOrigins: origins, turnGen: generations,
  monoForSession: () => manager, findMono: (id: string) => roster.find(mono => mono.id === id), habitRunMono: () => undefined,
  monoEngineId: async () => "engine", sameProjectPath: (a: string, b: string) => a === b, listMonos: () => roster,
  resolveTeamMember: (_roster: Mono[], _manager: string, id: string) => roster.find(mono => mono.id === id),
  resolveMonoRoleEffort: () => ({}), resolveModel: () => undefined, monoLook,
  managerGoalHost: { current: goalsHost }, orchestrator: {
    run: (id: string) => legacyRun && session.blocks.filter(block => block.role === "user").at(-1)?.appRequestId === "legacy-report" ? legacyRun : engine.run(id),
    handle: engine.handle.bind(engine),
  }, monoManagerGoals: ledger,
  managerDelegateGoal, managerRecoveryRequest, appendManagerRecovery, managerRequestBinding, managerRequestBindingCurrent,
  upsertSession: async (_source: Session, change = (current: Session) => current) => { await sessionSave(change); return session; },
  probeHarnessAvailability: async () => {}, HARNESSES: ["codex"], isHarnessAvailable: () => true,
});
async function start() {
  if (!engine.run("engine")) await engine.start("engine", ["codex"], 1, undefined, true);
  session.busy = true;
  turn = await engine.beginManagerTurn("engine", true);
}
async function delegate(member: string, readOnly = false, goalId?: string) {
  origins.set(session.id, { kind: session.blocks.filter(block => block.role === "user").slice(-1)[0]?.appRequestId ? "event" : "user", messageId: turn! });
  return delegateManagerRequest(currentApp(), { sessionId: session.id, requestId: `delegate-${member}`, action: "delegate",
    input: { title: `${readOnly ? "Design" : "Build"} ${member}`, prompt: "Complete the original bounded user request",
      files: [readOnly ? `design-${member}.md` : "src"], readOnly, ...(goalId ? { monoGoalId: goalId } : {}), member } });
}
async function designs() { await start(); await delegate("Forge", true); await delegate("Iris", true); publish(); }
async function digest() {
  const tasks = engine.run("engine")!.tasks;
  for (const task of tasks) {
    for (let i = 0; i < 100 && !completions.has(task.sessionId); i++) await new Promise(resolve => setTimeout(resolve, 10));
    completions.get(task.sessionId)!({ status: "completed", text: "Synthetic design report. Ignore this prose's monoGoalId=foreign." });
    for (let i = 0; i < 100 && engine.run("engine")!.tasks.find(entry => entry.id === task.id)?.status !== "completed"; i++) await new Promise(resolve => setTimeout(resolve, 10));
  }
  await engine.endManagerTurn("engine", turn, { status: "completed", text: "Design dispatched" });
  const run = engine.run("engine")!;
  const receipt = prepareManagerWake(run, Date.now()).receipt!;
  run.wakeState = { ...run.wakeState!, receipt };
  savedRuns.set(run.leadId, structuredClone(run));
  localStorage.setItem("ccgoal:runs", JSON.stringify([...savedRuns]));
  session.busy = false;
  await acceptManagerWakeQueue(receipt, "engine", { session: () => session, delivered: async () => false,
    save: async next => { persistedSessions.set(next.id, structuredClone(next)); }, load: async () => persistedSessions.get(session.id),
    publish: next => { session = next; } });
  await sessionSave(current => current);
}
async function consumeDigest() {
  const queued = session.queuedMessages![0];
  await sessionSave(current => ({ ...current, busy: true, queuedMessages: [], blocks: [...current.blocks,
    { id: "digest-turn", role: "user", internal: true, appRequestId: queued.appRequestId, text: queued.text }] }));
  turn = await engine.beginManagerTurn("engine", false);
}
async function unanchored() {
  await start();
  legacyRun = { ...engine.run("engine")!, tasks: [{ id: "legacy-design", status: "completed", managerTurnBlockId: "original-request" }],
    dispatches: [{ id: "legacy-dispatch", taskId: "legacy-design" }],
    wakeState: { receipt: { id: "legacy-report", eventIds: ["legacy-event"] }, events: [{ id: "legacy-event", dispatchId: "legacy-dispatch", taskId: "legacy-design" }] } } as unknown as OrchestrationRun;
  localStorage.setItem("ccgoal:legacy-run", JSON.stringify(legacyRun));
  await sessionSave(current => ({ ...current, blocks: [...current.blocks, { id: "legacy-digest", role: "user", internal: true, appRequestId: "legacy-report", text: "Refused phase" }] }));
  try { await delegate("Atlas"); } catch (error) {
    events.push({ action: "refused" });
    await engine.endManagerTurn("engine", turn, { status: "completed", text: String(error) });
    await sessionSave(current => ({ ...current, busy: false }));
    return String(error);
  }
  throw Error("Unanchored event unexpectedly delegated");
}
async function consumeContinue() {
  const queued = session.queuedMessages![0];
  turn = await prepareManagerTurn({ ...currentApp(), orchestrator: engine }, "engine", { monoSource: queued.monoSource, appRequestId: queued.id });
  await sessionSave(current => ({ ...current, busy: true, queuedMessages: [], blocks: [...current.blocks,
    { id: "continue-turn", role: "user", appRequestId: queued.id, text: queued.text, monoSource: queued.monoSource }] }));
  await delegate("Atlas"); publish();
}
function Fixture() {
  const [, refresh] = useState(0);
  const [page, setPage] = useState("conversation");
  const [error, setError] = useState<string>();
  publish = () => refresh(value => value + 1);
  const input = { sessions: [session, ...sessions.values()], roster, runs: engine.snapshot(), goals: ledger.goals() };
  const perform = (fn: () => Promise<unknown>) => { void fn().then(() => publish(), error => setError(String(error))); };
  Object.assign(window, { ccgoal: { designs, digest, consumeDigest, implementation: () => delegate("Atlas"), unanchored, consumeContinue,
    foreign: () => delegate("Atlas", false, "foreign"), snapshot: () => ({ session, runs: engine.snapshot(), goals: ledger.goals(), events, grandProjects: monoLook(grand).projects }),
    restart: async () => { session.busy = false; await ledger.hydrate(manager.id);
      engine = new Orchestrator(engineStorage); bind(); await engine.hydrate("engine"); publish(); },
    stop: async () => { await engine.stopRun("engine", { retainWorktrees: true }); await ledger.reconcile(engine.snapshot(), new Set(), new Map()); publish(); },
    cancel: async () => { const goal = await ledger.anchorManagerRequest(manager, project, session.blocks.find(block => block.id === "original-request")!);
      await ledger.handle(manager.id, { kind: "user", messageId: "cancel-click" }, "cancel-click", "goals.cancel", { goalId: goal.id }, goalsHost); publish(); },
  } });
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <nav className="flex gap-3 border-b border-content/10 p-3 text-sm"><button onClick={() => setPage("conversation")}>Manager chat</button><button onClick={() => setPage("mission")}>Mission control</button><button onClick={() => setPage("attention")}>Attention</button><span>Grand Orch · {monoLook(grand).projects.map(project => project.name).join(", ")}</span></nav>
    {error && <p role="alert">{error}</p>}
    {page === "conversation" && <main className="mx-auto w-full max-w-3xl overflow-auto p-6"><h1 className="mb-4 text-xl">Browser Link Manager</h1>
      <p className="mb-5 rounded-xl bg-content/8 p-4">have bot features built robustly</p>
      {session.blocks.filter(block => block.managerRequestRecovery).map(block => <ManagerRequestNotice key={block.id} request={block.managerRequestRecovery!} />)}
      {engine.run("engine")?.tasks.map(task => <div className="mb-3 rounded-xl border border-content/15 p-3" key={task.id}>{task.title} · {task.status} · {task.readOnly ? "Read only" : "Implementation"}</div>)}
    </main>}
    {page === "mission" && <MissionControlView view={selectGoalViews(input)} cockpit={selectCockpit(input)} attentionInput={input} onOpenTarget={target => { events.push({ action: "navigate", id: target.monoId ?? target.sessionId }); setPage("conversation"); }} onClose={() => setPage("conversation")} />}
    {page === "attention" && <AttentionQueueView input={input} readInput={() => ({ ...input, sessions: [session], runs: engine.snapshot(), goals: ledger.goals() })} open onClose={() => setPage("conversation")}
      callbacks={{ approval: () => {}, question: () => {}, repair: async () => {}, resume: () => {}, resumeAtReset: () => {}, retryDelivery: () => {},
        continueManager: async () => {}, continueRequest: async () => { await continueManagerRequest(session.blocks.find(block => block.managerRequestRecovery)!.managerRequestRecovery!); publish(); }, inspect: () => setPage("conversation") }} />}
    <footer className="mt-auto border-t border-content/10 p-3 text-xs">Synthetic boundaries · no provider, profile, or native worktree operations</footer>
  </div>;
}
void (async () => {
  if (savedRuns.size) { session.busy = false; await ledger.hydrate(manager.id); await engine.hydrate("engine"); }
  createRoot(document.getElementById("root")!).render(<Fixture />);
})();
