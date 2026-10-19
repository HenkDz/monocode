import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
// @ts-expect-error supplied from actual App.tsx by the fixture plugin
import source from "virtual:ccvision-v2-app";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../../src/features/commandCenter/ui/Decisions";
import { selectDecisionView } from "../../src/features/commandCenter/model/decisionView";
import { MonoManagerGoals } from "../../src/features/monos/model/monoManagerGoals";
import { type Mono, listMonos, findMono, monoForSession, isMonoSession } from "../../src/features/monos/model/mono";
import { type DecisionRuntimeHost, handleDecisionTeamMessage, runtimeDecisionHost, executeDecisionUi, reraiseUnreadableDecision } from "../../src/features/monos/model/monoDecisionRuntime";
import { retainedDecisionDelivery, StaleDecision, assertDecisionCurrent, isMonoDecisionEventId } from "../../src/features/monos/model/monoDecisions";
import { managerRequestBinding, managerRequestBindingCurrent } from "../../src/features/monos/model/managerAuthorizedWork";
import { assertDecisionDigestConsumer, assertDecisionQueueConsumer, queueDecisionEvidence, decisionQueueId, decisionEvidenceText } from "../../src/features/monos/model/monoDecisionDelivery";
import { teamMessageKind, teamMessageRequiresReply } from "../../src/features/monos/model/monoCrewEvents";
import { teamMessageRoute } from "../../src/features/monos/model/monoOrg";
import { acceptManagerWakeQueue, acknowledgeManagerWake, addManagerWakeEvent, prepareManagerWake } from "../../src/features/orchestration/model/managerWake";
import type { OrchestrationRun } from "../../src/features/orchestration/model/orchestrationState";
import { SessionStateStore } from "../../src/features/sessions/model/sessionStateStore";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import { writeSession, readPersistedSession, upsertSession } from "../../src/features/sessions/data/sessionStore";
import { canDispatchQueuedHead, canSteerQueuedHead, queuedHead, dequeueQueuedMessage } from "../../src/features/sessions/model/messageQueue";
import { appendUser } from "../../src/integrations/harness/core/apply";
import "../../src/styles/index.css";

// Only the native disk/provider boundary and retained dispatch are synthetic; no provider is launched.
const diskKey = "v2-browser-disk";
const disk: Record<string, unknown> = JSON.parse(localStorage.getItem(diskKey) ?? "{}");
const persist = () => localStorage.setItem(diskKey, JSON.stringify(disk));
if (new URLSearchParams(location.search).has("quarantine") && !disk["mono-goals:manager"]) {
  disk["mono-goals:manager"] = { version: 1, goals: [], receipts: {}, decisions: [{ id: "unreadable-original", status: "pending", question: "Old unreadable question" }] };
  persist();
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
mockIPC((command, raw) => {
  const args = raw as Record<string, unknown>;
  if (command === "control_load") return disk[String(args.leadId)] ? JSON.stringify(disk[String(args.leadId)]) : null;
  if (command === "control_save") { disk[String(args.leadId)] = JSON.parse(String(args.state)); persist(); return; }
  if (command === "mono_session_upsert" || command === "session_upsert") {
    const next = copy(args.session as Session), prior = disk[next.id] as Session | undefined;
    if (command === "mono_session_upsert") {
      let blocks = prior?.blocks ?? [];
      if (args.blocksChanged) {
        const start = args.appendOnly ? blocks.length : args.afterBlockId ? blocks.findIndex(block => block.id === args.afterBlockId) + 1
          : args.fromBlockId ? blocks.findIndex(block => block.id === args.fromBlockId) : 0;
        if (start < 0) throw Error("Missing retained transcript anchor");
        blocks = [...blocks.slice(0, start), ...next.blocks];
      }
      next.blocks = blocks;
    }
    disk[next.id] = next; persist(); return { ...next, createdAt: 1, updatedAt: 1 };
  }
  if (command === "mono_session_get" || command === "session_get") return copy(disk[String(args.sessionId)] ?? null);
  if (command === "mono_session_event_delivered") return (disk[String(args.sessionId)] as Session | undefined)?.blocks.some(block => block.internal && block.appRequestId === args.eventId && block.text === args.text) ?? false;
  throw Error(`Unexpected native command: ${command}`);
});
const roster: Mono[] = [
  { id: "boss", name: "Boss", role: "orchestrator", projects: [], sessionId: "boss-browser", mascot: "owl", color: "blue" },
  { id: "manager", name: "Manager", role: "manager", projects: ["C:/Project"], reportsTo: "boss", sessionId: "manager-browser", mascot: "cat", color: "blue" },
  { id: "worker", name: "Worker", role: "member", projects: ["C:/Project"], reportsTo: "manager", mascot: "cat", color: "blue" },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
const state = new SessionStateStore(["manager-browser", "worker-browser", "boss-browser"].map(id => disk[id] as Session ?? { ...newSession("claude", "C:/Project"), id }));
const ledger = new MonoManagerGoals();
let run = disk.engine as OrchestrationRun | undefined;
const engine = {
  snapshot: () => run ? [run] : [], run: (id: string) => id === "engine" ? run : undefined,
  queueManagerMessage: async (_id: string, event: Parameters<typeof addManagerWakeEvent>[1]) => {
    if (!run) throw Error("No retained Manager work");
    run = { ...run, wakeState: addManagerWakeEvent(run.wakeState, event) }; disk.engine = copy(run); persist();
  },
};
const turnGen = { current: new Map(state.ref.current.map(session => [session.id, 1])) };
const decisionRuntime = { current: null! as DecisionRuntimeHost };
const evaluate = <T,>(code: string, scope: Record<string, unknown>): T => new Function(...Object.keys(scope), code)(...Object.values(scope));
const scope = { decisionRuntime, monoManagerGoals: ledger, listMonos, findMono, sessionsRef: state.ref, setSessions: state.setState,
  turnGen, decisionOriginalBlocks: { current: new Map() }, setDecisionUnavailable: () => {}, habitRunMono: () => undefined,
  orchestrator: engine, invoke, writeSession, readPersistedSession, managerRequestBinding, managerRequestBindingCurrent,
  queueDecisionEvidence, retainedDecisionDelivery, decisionQueueId, decisionEvidenceText, isMonoSession,
  runtimeDecisionHost, assertDecisionDigestConsumer, assertDecisionQueueConsumer, StaleDecision, assertDecisionCurrent, isMonoDecisionEventId, dequeueQueuedMessage,
  getMonoGoalRecoveryBlocks: async (id: string) => (disk[id] as Session | undefined)?.blocks ?? [],
  acceptManagerWakeQueue, flushSync: (fn: () => void) => fn(),
};
evaluate(source.host, scope);
const actions = evaluate<DecisionUiActions>(source.actions, { ...scope, executeDecisionUi, reraiseUnreadableDecision,
  teamMap: { close: () => {} }, onSelectProject: () => {} });
const accept = evaluate<(id: string, receipt: NonNullable<NonNullable<OrchestrationRun["wakeState"]>["receipt"]>) => Promise<boolean>>(source.accept, scope);
async function message(actor: "worker" | "manager" | "boss", requestId: string, input: object) {
  const id = `${actor}-browser`;
  state.setState(sessions => sessions.map(session => session.id === id ? { ...session, busy: true } : session));
  return evaluate<Promise<unknown>>(`return (async () => { ${source.team} })();`, { ...scope, source: state.session(id),
    payload: { sessionId: id, requestId, action: "team.message", input: { memberId: actor === "worker" ? "manager" : actor === "manager" ? "boss" : "manager", kind: actor === "worker" ? "question" : "decision", text: JSON.stringify(input) } },
    workerMember: actor === "worker" ? roster[2] : undefined, peerRecipient: undefined, goalProgress: undefined, memberRun: run,
    monoForSession, teamMessageKind, teamMessageRequiresReply, teamMessageRoute, crewMessages: () => [], handleDecisionTeamMessage });
}
async function flushDigest() {
  if (!run?.wakeState) throw Error("No pending team event");
  // Production coalescing interval is retained; this fixture advances the clock only for preparation.
  run = { ...run, wakeState: prepareManagerWake(run, Date.now() + 1000) }; disk.engine = copy(run); persist();
  state.setState(sessions => sessions.map(session => session.id === "manager-browser" ? { ...session, busy: false } : session));
  await accept("manager-browser", run.wakeState!.receipt!);
  run = { ...run, wakeState: acknowledgeManagerWake(run.wakeState!, run.wakeState!.receipt!.id, Date.now()) };
  disk.engine = copy(run); persist();
}
const raisedQuestion = { version: 1, type: "decision", question: "Which parser approach?", context: "Choose within the original bounded parser task.", impact: "low", operation: "work", options: [{ id: "reuse", label: "Reuse the parser" }, { id: "change", label: "Change the parser" }] };
async function startRequest(text: string) {
  if (!text.trim()) throw Error("Enter the original user request");
  const manager = appendUser(state.session("manager-browser")!, text, []);
  state.setState(sessions => sessions.map(session => session.id === manager.id ? manager : session)); await upsertSession(manager);
  const goal = await ledger.anchorManagerRequest(roster[1], { id: "C:/Project", folder: "C:/Project", name: "Project", managerId: "engine", managerMonoId: "manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] }, manager.blocks.at(-1)!);
  const worker = appendUser({ ...state.session("worker-browser")!, busy: true }, "Existing Manager dispatch assigned the parser task", [], { internal: true, appRequestId: "dispatch" });
  state.setState(sessions => sessions.map(session => session.id === worker.id ? worker : session)); await upsertSession(worker);
  run = { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: manager.id, cwd: "C:/Project", status: "active", projectManager: true, allowedHarnesses: ["claude"], maxWorkers: 1, cli: "synthetic", requests: {}, continuations: 0,
    tasks: [{ id: "task", memberId: "worker", sessionId: worker.id, monoGoalId: goal.id, activeDispatchId: "dispatch", status: "running", title: "Parser", prompt: "Parser", harness: "claude", model: "synthetic", files: ["src"], scopes: [], dependsOn: [], accepted: false, delivered: false, result: "" }],
    dispatches: [{ id: "dispatch", taskId: "task", sessionId: worker.id, state: "running", stage: "turn_submitted", startedAt: 42, updatedAt: 42, workspace: { id: "worker-checkout", kind: "worktree", projectCwd: "C:/Project", checkoutCwd: "C:/Project/worker" } }] };
  disk.engine = copy(run); persist();
}
async function raise() {
  try { await message("worker", "question", raisedQuestion); } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Manager digest waits")) throw error;
  }
  await flushDigest(); await message("worker", "question", raisedQuestion);
  for (const actor of ["manager", "boss"] as const) {
    const decision = ledger.decisions("manager")[0];
    await message(actor, `escalate-${actor}`, { version: 1, type: "decision-action", action: "escalate", decisionId: decision.id, expectedVersion: decision.resolutionVersion });
  }
}
let submissions = 0;
async function consume() {
  state.setState(sessions => sessions.map(session => session.id === "worker-browser" ? { ...session, busy: false } : session));
  const session = state.session("worker-browser")!, head = queuedHead(session);
  if (!head) return;
  const callback = evaluate<() => Promise<void>>(source.consumer, { ...scope, session, next: head,
    scheduled: new Set([session.id]), queueDispatchingRef: { current: new Set([session.id]) }, codexStorageRecovery: { current: {} },
    canDispatchQueuedHead, canSteerQueuedHead, queuedHead, canSteerHarness: () => false, monoForSession, setQueueDispatchVersion: () => {},
    submitSession: async (id: string, text: string, _attachments: unknown, options: { appRequestId: string; validateDecisionDelivery(): void }) => {
      options.validateDecisionDelivery(); submissions++;
      const next = appendUser(dequeueQueuedMessage(state.session(id)!, head.id), text, [], { internal: true, appRequestId: options.appRequestId, monoDecision: head.monoDecision });
      await upsertSession(next); state.setState(sessions => sessions.map(session => session.id === id ? next : session)); return true;
    } });
  await callback();
}
await decisionRuntime.current.hydrate();
document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
function Fixture() {
  useSyncExternalStore(ledger.subscribe, ledger.snapshot, ledger.snapshot);
  const sessions = useSyncExternalStore(state.subscribeShell, state.snapshot, state.snapshot);
  const [text, setText] = useState("Implement the bounded parser change"), [notice, setNotice] = useState("Ready");
  const runAction = (fn: () => Promise<unknown>) => { void fn().then(() => setNotice("Saved"), error => setNotice(String(error))); };
  const view = selectDecisionView(ledger, roster, Date.now());
  const notifications = evaluate<{ id: string; question: string }[]>(source.notifications, { decisionView: view, retainedDecisionDelivery });
  Object.assign(window, { decisionProof: { ledger: ledger.decisions("manager"), goals: ledger.goals(), sessions, submissions, notifications, disk } });
  return <main style={{ maxWidth: 1000, margin: "auto", padding: 16 }}>
    <p>Source-bound App decisions · synthetic native disk and provider boundary</p>
    <label>Original user request<textarea aria-label="Original user request" value={text} onChange={event => setText(event.target.value)} /></label>
    <button onClick={() => runAction(() => startRequest(text))}>Send original request</button>
    <button disabled={!run} onClick={() => runAction(raise)}>Receive authenticated team question</button>
    <button onClick={() => runAction(consume)}>Consume retained answer</button>
    <button onClick={() => runAction(async () => {
      await flushDigest();
      evaluate<() => () => void>(source.recovery, scope)();
    })}>Flush retained delivery</button>
    <output role="status">{notice}</output>
    <ProjectAutonomyControl managerId="manager" projectId="c:/PROJECT/" value={ledger.autonomy("manager", "C:/Project")} actions={actions} />
    <aside aria-label="Decision notifications">{notifications.map(item => <p key={item.id} data-event-id={item.id}>{item.question}</p>)}</aside>
    <Decisions view={view} roster={roster} actions={actions} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
