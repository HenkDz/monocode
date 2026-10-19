import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../../../styles/index.css";
import { Decisions, ProjectAutonomyControl, type DecisionUiActions } from "../../ui/Decisions";
import { selectDecisionView } from "../../model/decisionView";
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
const payload: DecisionPayload = { version: 1, type: "decision", question: "Should we reuse the existing queue?", impact: "high", context: "This keeps the experience simple and preserves the current Stop and Continue behavior.", options: [{ id: "reuse", label: "Reuse the existing queue" }, { id: "change", label: "Change the queue" }], recommendedOptionId: "reuse", operation: "work" };
const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
const row = decisionAsk({ id: "worker-chat:ask", managerId: "manager", senderId: "worker", recipientId: "manager", kind: "question", topic: "queue", text: JSON.stringify(payload), at: Date.now() }, "worker-chat", "/synthetic/project", roster, "high-impact-only", { taskId: "task" })!;
await ledger.recordDecision("manager", row);
await ledger.recordDecision("manager", { ...row, id: "worker-chat:protected", question: "Send the project update to the team?", operation: "message-people" });
const pending = new Set<string>(), accepted = new Set<string>();
const chats = new Map<string, Session>(["worker-chat", "boss-chat"].map(id => [id, { ...newSession("claude", "/synthetic/project"), id, busy: true, turnReady: false }]));
const sends: { sessionId: string; text: string; attachments: [] }[] = [];
let mode: "normal" | "refuse" | "missing" = "normal";
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
    record: async selected => {
      if (selected === undefined) await ledger.delegateDecision(managerId, decisionId);
      else await ledger.recordDecisionAnswer(managerId, decisionId, "user", row.options.find(option => option.id === selected)!.label);
    }, pending, accepted,
  }),
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
  bossReply: () => ledger.recordDecisionReply("manager", { id: "boss-chat:reply", managerId: "manager", senderId: "boss", recipientId: "worker", topic: `decision:${row.id}`, text: "Reuse the existing queue", at: Date.now() }),
  finish: () => ledger.finishDecisionAsks(new Set(["task"]), new Set()),
  autonomy: () => ledger.autonomy("manager", "/synthetic/project"),
};
declare global { interface Window { decisionFixture: typeof controls } }
window.decisionFixture = controls;
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
function Fixture() {
  useSyncExternalStore(ledger.subscribe, ledger.snapshot);
  return <main style={{ maxWidth: params.get("rail") ? 360 : 900, margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column" }}>
    <div style={{ padding: "16px 28px" }}><ProjectAutonomyControl managerId="manager" projectId="/synthetic/project" value={ledger.autonomy("manager", "/synthetic/project")} actions={actions} /></div>
    <Decisions view={selectDecisionView(ledger, roster, Date.now())} roster={roster} actions={actions} presentation={params.get("rail") ? "rail" : "page"} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
