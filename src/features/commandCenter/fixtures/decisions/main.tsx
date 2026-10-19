import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../../ui/Decisions";
import { selectDecisionView, endedDecisionSources, decisionCountsByProject } from "../../model/decisionView";
import { AttentionQueueView } from "../../ui/AttentionQueue";
import { teamDecisions } from "../../../monos/model/monoTeamActivity";
import type { OrchestrationRun, OrchestrationTask } from "../../../orchestration/model/orchestrationState";
import { MonoManagerGoals } from "../../../monos/model/monoManagerGoals";
import { decisionAsk, type DecisionPayload } from "../../../monos/model/monoDecisions";
import { sendDecisionFromClick } from "../../../monos/model/monoDecisionUi";
import { enqueueMonoMessage } from "../../../monos/model/monoMessaging";
import { newSession, type Session } from "../../../sessions/model/session";
import { canDispatchQueuedHead, canSteerQueuedHead } from "../../../sessions/model/messageQueue";
import type { Mono } from "../../../monos/model/mono";

const roster: Mono[] = [
  { id: "boss", name: "Boss", role: "orchestrator", projects: [], sessionId: "boss-chat", mascot: "b", color: "blue" },
  { id: "manager", name: "Mira", role: "manager", reportsTo: "boss", projects: ["/synthetic/project"], sessionId: "manager-chat", mascot: "m", color: "blue" },
  { id: "worker", name: "Atlas", role: "member", reportsTo: "manager", projects: ["/synthetic/project"], mascot: "w", color: "blue" },
];
const params = new URLSearchParams(location.search);
const payload: DecisionPayload = { version: 1, type: "decision", question: "Should we reuse the existing queue?", impact: params.has("delegation") ? "med" : "high", context: "This keeps the experience simple and preserves the current Stop and Continue behavior.", options: [{ id: "reuse", label: "Reuse the existing queue" }, { id: "change", label: "Change the queue" }], recommendedOptionId: "reuse", operation: "work" };
const ledger = new MonoManagerGoals({ load: async () => params.has("delegation") ? { version: 1, goals: [], receipts: {}, autonomy: { "/synthetic/project": "everything" } } : null, save: async () => {} });
const row = decisionAsk({ id: "worker-chat:ask", managerId: "manager", senderId: "worker", recipientId: "manager", kind: "question", topic: "queue", text: JSON.stringify(payload), at: Date.now() }, "worker-chat", "/synthetic/project", roster, params.has("delegation") ? "everything" : "high-impact-only", { taskId: "task" })!;
await ledger.recordDecision("manager", row);
await ledger.recordDecision("manager", { ...row, id: "worker-chat:protected", question: "Send the project update to the team?", operation: "message-people" });
const pending = new Set<string>(), accepted = new Set<string>();
const chats = new Map<string, Session>(["worker-chat", "boss-chat"].map(id => [id, { ...newSession("claude", "/synthetic/project"), id, busy: true, turnReady: false }]));
const sends: { sessionId: string; text: string; attachments: [] }[] = [];
let mode: "normal" | "refuse" | "missing" | "log-fail" = "normal";
const submit = async (sessionId: string, text: string, attachments: []) => {
  await new Promise(resolve => setTimeout(resolve, 80));
  if (mode === "refuse") return false;
  const session = chats.get(sessionId);
  if (!session) return false;
  sends.push({ sessionId, text, attachments });
  chats.set(sessionId, enqueueMonoMessage(session, { id: crypto.randomUUID(), text, attachments }));
  return true;
};
const actions: DecisionUiActions = {
  answer: (event, managerId, decisionId, optionId) => sendDecisionFromClick(event, decisionId, optionId, {
    read: () => ledger.decisions(managerId).find(entry => entry.id === decisionId),
    open: async id => mode !== "missing" && chats.has(id), bossSession: async () => "boss-chat", submit,
    askerName: id => roster.find(mono => mono.id === id)?.name ?? "the asker",
    record: async selected => {
      if (mode === "log-fail") throw Error("Synthetic log failure");
      if (selected === undefined) await ledger.delegateDecision(managerId, decisionId);
      else await ledger.recordDecisionAnswer(managerId, decisionId, "user", row.options.find(option => option.id === selected)!.label);
    }, pending, accepted,
  }),
  wasAccepted: (_managerId, decisionId) => accepted.has(decisionId),
  autonomy: (event, managerId, projectId, value) => ledger.setAutonomy(event, managerId, projectId, value),
  openProject: () => {},
};
const controls = {
  sends,
  mode: (value: typeof mode) => { mode = value; },
  queue: (id = "worker-chat") => chats.get(id),
  pause: () => { const session = chats.get("worker-chat")!; chats.set(session.id, { ...session, queueStatus: "paused" }); },
  continueQueue: () => { const session = chats.get("worker-chat")!; chats.set(session.id, { ...session, busy: false, queueStatus: "active" }); },
  moved: () => { const session = chats.get("worker-chat")!; chats.set(session.id, { ...session, cwd: "/synthetic/moved" }); },
  queueReady: () => { const session = chats.get("worker-chat")!; return { dispatch: canDispatchQueuedHead(session), steer: canSteerQueuedHead(session) }; },
  typed: (text: string) => submit("worker-chat", text, []),
  bossReply: (explicit = false) => ledger.recordDecisionReply("manager", { id: "boss-chat:reply", managerId: "manager", senderId: "boss", recipientId: "worker", topic: explicit ? `decision:${row.id}` : "queue", text: "Reuse the existing queue", at: Date.now() }),
  answerer: () => ledger.decisions("manager").find(entry => entry.id === row.id)?.answererId,
  settle: (status: OrchestrationTask["status"]) => ledger.finishDecisionAsks(endedDecisionSources([], [{ tasks: [{ id: "task", status }] } as OrchestrationRun]), new Set()),
  finish: () => ledger.finishDecisionAsks(endedDecisionSources([], [{ tasks: [{ id: "task", status: "cancelled" }] } as OrchestrationRun]), new Set()),
  autonomy: () => ledger.autonomy("manager", "/synthetic/project"),
};
declare global { interface Window { decisionFixture: typeof controls } }
window.decisionFixture = controls;
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
function Fixture() {
  useSyncExternalStore(ledger.subscribe, ledger.snapshot);
  const [paused, setPaused] = useState(params.has("attention"));
  const managerChat = { ...newSession("claude", "/synthetic/project"), id: "manager-chat" };
  const runs = params.has("attention") ? [{ leadId: "engine", ownerMonoId: "manager", ownerSessionId: managerChat.id, projectManager: true, status: paused ? "paused" : "active", cwd: "/synthetic/project", tasks: [] } as unknown as OrchestrationRun] : [];
  const view = selectDecisionView(ledger, roster, Date.now());
  return <main style={{ maxWidth: params.get("rail") ? 360 : 900, margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column" }}>
    {params.has("attention") && <output aria-label="Decisions badge">{decisionCountsByProject(roster, [managerChat], runs, view).get("/synthetic/project") ?? 0}</output>}
    <div style={{ padding: "16px 28px" }}><ProjectAutonomyControl managerId="manager" projectId="/synthetic/project" value={ledger.autonomy("manager", "/synthetic/project")} actions={actions} /></div>
    <Decisions view={view} roster={roster} actions={actions} presentation={params.get("rail") ? "rail" : "page"}
      attentionCount={teamDecisions(roster, [managerChat], runs).length}
      attention={params.has("attention") && <AttentionQueueView input={{ roster, sessions: [managerChat], runs, goals: [] }} open presentation="panel" onClose={() => {}}
        callbacks={{ approval: () => {}, question: () => {}, questionInteraction: () => {}, repair: async () => {}, resume: () => {}, resumeAtReset: () => {}, retryDelivery: () => {}, continueManager: async () => setPaused(false), inspect: () => {} }} />} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
