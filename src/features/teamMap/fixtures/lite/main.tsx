import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { DecisionUiActions } from "../../../commandCenter/ui/Decisions";
import { sendDecisionFromClick } from "../../../monos/model/monoDecisionUi";
import { newSession } from "../../../sessions/model/session";
import { TeamMap } from "../../TeamMap";
import { commandMapDecisions } from "../../commandMapDecisions";
import { fixtureLedger, project, roster } from "./data";
import "../../../../styles/index.css";

document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
document.body.style.margin = "0";
localStorage.clear(); localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
mockIPC(command => { throw Error(`Unexpected fixture native operation: ${command}`); });
const ledger = await fixtureLedger();
const sends: { sessionId: string; text: string }[] = [];
const gestures: { trusted: boolean; type: string; action: string }[] = [];
const pending = new Set<string>(), accepted = new Set<string>();
const session = { ...newSession("codex", project), id: "worker-chat", pendingQuestion: { requestId: 1, title: "Choose the API contract", questions: [] } };
const controls = { sends, gestures, autonomy: () => ledger.autonomy("manager", project),
  reply: () => ledger.recordDecisionReply("manager", { id: "boss-chat:answer", managerId: "manager", senderId: "boss", recipientId: "worker", topic: "decision:ask", text: "Reuse the interface", at: Date.now() }),
};
declare global { interface Window { mapLiteFixture: typeof controls } }
window.mapLiteFixture = controls;

function Fixture() {
  useSyncExternalStore(ledger.subscribe, ledger.snapshot);
  const [scope, setScope] = useState<string>();
  const actions: DecisionUiActions = {
    answer: (event, managerId, decisionId, optionId) => {
      gestures.push({ trusted: event.isTrusted, type: event.type, action: optionId ?? "delegate" });
      return sendDecisionFromClick(event, `${managerId}:${decisionId}`, optionId, {
        read: () => ledger.decisions(managerId).find(row => row.id === decisionId),
        open: async id => ["worker-chat", "boss-chat"].includes(id), bossSession: async () => "boss-chat",
        askerName: id => roster.find(mono => mono.id === id)?.name ?? "the asker",
        submit: async (sessionId, text) => { sends.push({ sessionId, text }); return true; },
        record: async selected => {
          if (selected === undefined) await ledger.delegateDecision(managerId, decisionId);
          else {
            const row = ledger.decisions(managerId).find(row => row.id === decisionId)!;
            await ledger.recordDecisionAnswer(managerId, decisionId, "user", row.options.find(option => option.id === selected)!.label);
          }
        }, pending, accepted,
      });
    },
    autonomy: (event, managerId, projectId, value) => {
      gestures.push({ trusted: event.isTrusted, type: event.type, action: value });
      return ledger.setAutonomy(event, managerId, projectId, value);
    },
    openProject: projectId => { if (projectId === project) setScope("manager"); },
  };
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <p style={{ padding: "6px 16px", fontSize: 11 }}>Synthetic map + frozen unreviewed lite UI · actual App/GO/queue wiring HELD</p>
    <TeamMap key={scope ?? "org"} scope={scope} sessions={[session]} runs={[]} statuses={new Map()} onOpenMono={() => {}} onClose={() => {}}
      decisions={commandMapDecisions(ledger, roster, actions, Date.now())} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
