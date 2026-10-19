import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
// @ts-expect-error actual App seams supplied by the fixture plugin
import source from "virtual:ccvision-v2-app";
import { orchestrator as engine, type OrchestrationHost } from "../../src/features/orchestration/model/orchestration";
import { ProjectManagerReview } from "../../src/features/orchestration/ui/ProjectManagerReview";
import { MonoComposer } from "../../src/features/monos/ui/MonoComposer";
import { MonoManagerGoals } from "../../src/features/monos/model/monoManagerGoals";
import { listMonos, findMono, monoForSession, isMonoSession, type Mono } from "../../src/features/monos/model/mono";
import * as runtime from "../../src/features/monos/model/monoDecisionRuntime";
import * as delivery from "../../src/features/monos/model/monoDecisionDelivery";
import * as decisions from "../../src/features/monos/model/monoDecisions";
import * as authority from "../../src/features/monos/model/managerAuthorizedWork";
import { teamMessageKind, teamMessageRequiresReply } from "../../src/features/monos/model/monoCrewEvents";
import { teamMessageRoute } from "../../src/features/monos/model/monoOrg";
import { mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession } from "../../src/features/sessions/data/monoGoalRecovery";
import { acceptManagerWakeQueue } from "../../src/features/orchestration/model/managerWake";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import { SessionStateStore } from "../../src/features/sessions/model/sessionStateStore";
import { writeSession, readPersistedSession, upsertSession, resetMonoSessionWriteBaseline, shouldPersistSession } from "../../src/features/sessions/data/sessionStore";
import { dequeueQueuedMessage, queuedHead } from "../../src/features/sessions/model/messageQueue";
import { appendUser } from "../../src/integrations/harness/core/apply";
import "../../src/styles/index.css";

// Actual App/engine/ledger/writer/UI; only native disk and provider publication are synthetic.
const key = "v2-continuation-disk";
const disk: Record<string, unknown> = JSON.parse(localStorage.getItem(key) ?? "{}");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const persist = () => localStorage.setItem(key, JSON.stringify(disk));
let mode = "normal", releaseProbe: (() => void) | undefined, releaseRead: (() => void) | undefined;
let stageSaves = 0, activeSaves = 0, reads = 0;
const publications: { id: string; text: string }[] = [];
mockIPC(async (command, raw) => {
  const args = raw as Record<string, unknown>;
  if (command === "control_load") {
    if (args.leadId === "engine") {
      reads++;
      const retained = disk.engine as { decisionContinuedAt?: number; decisionContinuePendingAt?: number } | undefined;
      if (retained?.decisionContinuedAt && retained.decisionContinuePendingAt === undefined && mode === "activation-read")
        await new Promise<void>(resolve => { releaseRead = resolve; });
      if (retained?.decisionContinuePendingAt && mode === "stage-read-fail") throw Error("Synthetic staging readback unavailable");
    }
    return disk[String(args.leadId)] ? JSON.stringify(disk[String(args.leadId)]) : null;
  }
  if (command === "control_save") {
    const next = JSON.parse(String(args.state));
    if (args.leadId === "engine" && next.decisionContinuePendingAt) stageSaves++;
    if (args.leadId === "engine" && next.decisionContinuedAt && !next.decisionContinuePendingAt && next.status === "paused") activeSaves++;
    if (mode === "stage-save-fail" && next.decisionContinuePendingAt) throw Error("Synthetic staging save unavailable");
    disk[String(args.leadId)] = next; persist(); return;
  }
  if (command === "control_enable") return "synthetic-boundary";
  if (command === "control_disable" || command === "control_attach_worker") return;
  if (command === "control_scopes") return [args.cwd];
  if (command === "project_root") return args.project;
  if (command === "mono_session_upsert" || command === "session_upsert") {
    const next = clone(args.session as Session), prior = disk[next.id] as Session | undefined;
    if (command === "mono_session_upsert") {
      let blocks = prior?.blocks ?? [];
      if (args.blocksChanged) {
        const start = args.appendOnly ? blocks.length : args.afterBlockId ? blocks.findIndex(block => block.id === args.afterBlockId) + 1 : args.fromBlockId ? blocks.findIndex(block => block.id === args.fromBlockId) : 0;
        blocks = [...blocks.slice(0, start), ...next.blocks];
      }
      next.blocks = blocks;
    }
    disk[next.id] = next; persist(); return { ...next, createdAt: 1, updatedAt: 1 };
  }
  if (command === "mono_session_get" || command === "session_get") return clone(disk[String(args.sessionId)] ?? null);
  if (command === "mono_session_event_delivered") return false;
  throw Error(`Unexpected native boundary ${command}`);
});
const roster: Mono[] = [
  { id: "boss", role: "orchestrator", projects: [], sessionId: "boss-continuation", mascot: "owl", color: "blue" },
  { id: "manager", role: "manager", reportsTo: "boss", projects: ["C:/Project"], sessionId: "manager-continuation", mascot: "cat", color: "blue" },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
const state = new SessionStateStore(roster.map(mono => disk[mono.sessionId!] as Session ?? { ...newSession("claude", "C:/Project"), id: mono.sessionId! }));
const ledger = new MonoManagerGoals();
const turnGen = { current: new Map(state.ref.current.map(session => [session.id, 1])) };
const monoGoalOrigins = new Map<string, { kind: "user"; messageId: string }>();
const decisionRuntime = { current: null! as runtime.DecisionRuntimeHost };
const evaluate = <T,>(code: string, scope: Record<string, unknown>): T => new Function(...Object.keys(scope), code)(...Object.values(scope));
const scope: Record<string, unknown> = { ...runtime, ...delivery, ...decisions, ...authority,
  decisionRuntime, monoManagerGoals: ledger, listMonos, findMono, monoForSession, isMonoSession,
  sessionsRef: state.ref, setSessions: state.setState, turnGen, monoGoalOrigins,
  decisionOriginalBlocks: { current: new Map() }, setDecisionUnavailable: () => {}, habitRunMono: () => undefined,
  orchestrator: engine, invoke, writeSession, readPersistedSession, upsertSession, resetMonoSessionWriteBaseline, shouldPersistSession,
  mergeMonoGoalRecoverySession, monoGoalRecoveryLiveSession, getMonoGoalRecoveryBlocks: async (id: string) => clone((disk[id] as Session | undefined)?.blocks ?? []),
  acceptManagerWakeQueue, dequeueQueuedMessage, queuedHead, flushSync: (fn: () => void) => fn(),
};
evaluate(source.host, scope);
const stop = evaluate<(id: string, managed?: boolean, preserve?: boolean) => Promise<unknown>>(source.stop, { ...scope,
  remoteProjectFor: () => undefined, flushHarnessEvents: () => {}, usageRecoveryStopped: { current: new Set() }, sessionChildHarnesses: () => [],
  cancelHarnessTurn: async () => {}, stopHarnessSession: async () => {}, finishSessionTurn: async () => {},
  sessionWorkCwd: (session: Session) => session.cwd, stopStreaming: (session: Session) => ({ ...session, busy: false }), isPreparingHandoff: () => false,
  notifyReviewChanged: () => {}, nudgeWorkspace: () => {}, notifyGitChanged: () => {}, nudgeWatchedFiles: () => {},
});
engine.bind({
  session: id => state.session(id), sessions: () => state.ref.current, choices: () => [{ harness: "claude", models: [] }],
  stop: async (id, reason) => { await stop(id, true, reason === "refresh"); },
  beforeContinue: evaluate(source.beforeContinue, scope),
  decisionStopAt: id => decisions.decisionStopAt(decisionRuntime.current.sessions().find(session => session.id === id) ?? { blocks: [] }),
  decisionGeneration: id => turnGen.current.get(id) ?? 0,
  decisionAuthority: evaluate(source.continuationAuthority, scope),
  verifyDecisionAuthority: evaluate(source.verifyContinuationAuthority, scope),
  probeProviders: async () => { if (mode === "probe") await new Promise<void>(resolve => { releaseProbe = resolve; }); },
  submit: (id, text) => { publications.push({ id, text }); }, resumeQueue: () => false,
  createWorker: async () => { throw Error("This fixture never launches a worker"); }, integrateWorker: async () => ({ files: [], alreadyApplied: 0 }),
  cleanupWorker: async () => true, steer: async () => {}, respondApproval: () => {}, answerQuestion: () => {},
} satisfies OrchestrationHost);
engine.registerMonoEngine("engine", "manager-continuation", "manager", "C:/Project");
if (!disk.engine) {
  const manager = { ...appendUser(state.session("manager-continuation")!, "Implement the bounded parser change", []), busy: false };
  state.setState(sessions => sessions.map(session => session.id === manager.id ? manager : session)); await upsertSession(manager);
  await upsertSession(state.session("boss-continuation")!);
  await ledger.anchorManagerRequest(roster[1], { id: "C:/Project", folder: "C:/Project", name: "Project", managerId: "engine", managerMonoId: "manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] }, manager.blocks[0]);
  disk.engine = { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: manager.id, cwd: "C:/Project", status: "paused", projectManager: true,
    allowedHarnesses: ["claude"], maxWorkers: 1, cli: "synthetic", tasks: [], dispatches: [], requests: {}, continuations: 0, error: "Stopped" }; persist();
}
await engine.hydrate("engine"); await decisionRuntime.current.hydrate();
let question = 0, lastEvent: Event | undefined;
async function raise() {
  state.setState(sessions => sessions.map(session => session.id === "manager-continuation" ? { ...session, busy: true } : session));
  const current = state.session("manager-continuation")!;
  const requestId = `question-${++question}`;
  return evaluate<Promise<unknown>>(`return (async () => { ${source.team} })();`, { ...scope, source: current,
    payload: { sessionId: current.id, requestId, action: "team.message", input: { memberId: "boss", kind: "question", text: JSON.stringify({ version: 1, type: "decision", question: "New parser question", impact: "med", context: "Current original goal", operation: "work", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] }) } },
    workerMember: undefined, peerRecipient: undefined, goalProgress: undefined, memberRun: engine.run("engine"), teamMessageKind, teamMessageRequiresReply, teamMessageRoute, crewMessages: () => [],
  });
}
async function send(text: string, event?: Event) {
  lastEvent = event;
  const submit = evaluate<(id: string, text: string, files: unknown[], options: object) => Promise<boolean>>(source.submit, { ...scope,
    sessionWriteNeedsReconciliation: () => false, editedResends: { isActive: () => false }, loadMonoRotation: () => undefined, sendDraftOnce: () => undefined,
    isHabitRun: () => false, isProjectManager: () => false, isMonoSession, isHarnessAvailable: () => true, HARNESSES: ["claude"],
    automationSessionReservations: { current: new Set() }, displayAttachments: (files: unknown[]) => files, appendUser,
    monoEngineId: async () => "engine", ensureOpenSession: async () => state.session("manager-continuation"), sameProjectPath: (a: string, b: string) => a === b,
    updateMono: () => {}, remoteProjectFor: () => undefined, probeHarnessAvailability: async () => {},
    submitSessionRef: { current: async (id: string, body: string, _files: unknown[], options: { validateManagerContinuation?: () => void; onSettled?: (outcome: object) => void }) => {
      options.validateManagerContinuation?.();
      const current = state.session(id)!;
      evaluate<() => void>(source.commit, { ...scope, sessionId: id, text: body, options, validateManagerDelivery: () => options.validateManagerContinuation?.(),
        current, isFirstTurn: false, titleSeed: current.title, providerAccountId: current.providerAccountId, createDraftWorktree: false,
        rawCommand: false, draftBlock: undefined, editedResend: undefined, approvedPlan: undefined, intent: "default",
      })();
      publications.push({ id, text: body }); options.onSettled?.({ status: "completed", text: "Synthetic provider boundary settled" });
      state.setState(sessions => sessions.map(session => session.id === id ? { ...session, busy: false } : session));
      return true;
    } }, saveDraftRef: { current: () => {} }, enqueueHarnessEvent: (_id: string, event: { text: string }) => { throw Error(event.text); }, flushHarnessEvents: () => {},
  });
  return submit("manager-continuation", text, [], { composerEvent: event, monoWorkingDirectoryPrepared: true });
}
function Fixture() {
  useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  useSyncExternalStore(ledger.subscribe, ledger.snapshot, ledger.snapshot);
  useSyncExternalStore(state.subscribeShell, state.snapshot, state.snapshot);
  const [notice, setNotice] = useState("Ready");
  const action = (work: () => Promise<unknown>) => { void work().then(() => setNotice("Saved"), error => setNotice(String(error))); };
  const run = engine.run("engine")!;
  Object.assign(window, { continuationProof: {
    run, disk, decisions: ledger.decisions("manager"), sessions: state.ref.current, publications, stageSaves, activeSaves, reads,
    get probeWaiting() { return !!releaseProbe; }, get readWaiting() { return !!releaseRead; },
    mode: (value: string) => { mode = value; }, releaseProbe: () => { releaseProbe?.(); releaseProbe = undefined; }, releaseRead: () => { releaseRead?.(); releaseRead = undefined; },
    raise, stop: () => stop("manager-continuation"), replay: () => authority.captureManagerContinuationGesture(lastEvent, "manager-continuation"),
    forged: () => engine.continueManager("engine", new MouseEvent("click")), programmatic: () => engine.continueManager("engine"),
    peerSend: () => send("Peer user-role bubble"),
    mutate: (kind: string) => {
      if (kind === "generation") turnGen.current.set("manager-continuation", (turnGen.current.get("manager-continuation") ?? 0) + 1);
      else if (["account", "home", "original"].includes(kind)) state.setState(sessions => sessions.map(session => session.id !== "manager-continuation" ? session : kind === "original"
        ? { ...session, blocks: session.blocks.map((block, index) => index ? block : { ...block, text: "Changed original request" }) }
        : { ...session, ...(kind === "account" ? { providerAccountId: "changed-test-account" } : { codexStorageHome: "C:/changed-test-home" }) }));
      else if (kind === "disk-original") (disk["manager-continuation"] as Session).blocks[0].text = "Changed saved original request";
      else if (kind === "goal") ((disk["mono-goals:manager"] as { goals: { state: string }[] }).goals[0]).state = "cancelled";
      else if (kind === "owner") (disk.engine as { ownerMonoId: string }).ownerMonoId = "changed-owner";
      else if (kind === "receipt") (disk.engine as { wakeState: unknown }).wakeState = { events: [], waves: [], receipt: { id: "changed", eventIds: [], body: "changed" } };
      persist();
    },
  } });
  return <main style={{ maxWidth: 900, padding: 20 }}>
    <p>Actual App and runtime continuation · synthetic native persistence/provider boundary</p>
    <ProjectManagerReview run={run} noticesOnly />
    <MonoComposer sessionId="manager-continuation" name="Manager" onSubmit={(text, _attachments, _goal, event) => send(text, event)} />
    <button onClick={() => action(() => stop("manager-continuation"))}>Stop Manager</button>
    <button onClick={() => action(raise)}>Receive current Manager question</button>
    <button onClick={event => action(() => engine.continueManager("engine", event.nativeEvent))}>Unrelated control</button>
    <button data-manager-continue data-run-id="other-engine" onClick={event => action(() => engine.continueManager("engine", event.nativeEvent))}>Wrong run control</button>
    <button data-decision-ui disabled={!ledger.decisions("manager").length} onClick={event => action(() => {
      const old = ledger.decisions("manager")[0];
      return runtime.executeDecisionUi(event.nativeEvent, "manager", `old-answer-${crypto.randomUUID()}`, { action: "resolve", decisionId: old.id, expectedVersion: old.resolutionVersion, optionId: "one" }, decisionRuntime.current);
    })}>Try old answer</button>
    <output role="status">{notice}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
