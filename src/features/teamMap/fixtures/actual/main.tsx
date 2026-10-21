import React, { useState, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import AppMapHost from "virtual:app-map-host";
import { listMonos, findMono, monoLook, subscribeMonos, monosSnapshot, saveMonoTeamRoster } from "../../../monos/model/mono";
import { monoManagerGoals } from "../../../monos/model/monoManagerGoals";
import { sendDecisionFromClick } from "../../../monos/model/monoDecisionUi";
import { ensureMonoSession } from "../../../monos/model/monoWorkspace";
import { monoGoalRoutingContext, type MonoGoalSubmission } from "../../../monos/model/monoGoalRouting";
import { sameProjectPath } from "../../../projects/model/recents";
import { projectKey } from "../../../../shared/lib/paths";
import { newSession, type Session } from "../../../sessions/model/session";
import { TeamMap } from "../../TeamMap";
import { commandMapDecisions } from "../../commandMapDecisions";
import { capabilityDecisionReason } from "../../../integrations/model/integrationCapabilities";
import { INTEGRATIONS_SCOPE } from "../../../integrations/model/projectIntegrations";
import { useTeamMap } from "../../navigation";
import { ask, protectedAsk, project, roster } from "../lite/data";
import "../../../../styles/index.css";

const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", query.get("theme") === "light");
document.body.style.margin = "0";
localStorage.clear();
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster.map(mono => mono.role === "member" ? { ...mono, specialty: "API implementation" } : mono)));
const store = new Map<string, string>([["mono-goals:manager", JSON.stringify({ version: 1, goals: [], receipts: {}, decisions: [ask, protectedAsk] })]]);
let releaseLoad: (() => void) | undefined;
const loading = query.get("load") === "hold" ? new Promise<void>(resolve => { releaseLoad = resolve; }) : Promise.resolve();
let failLoad = query.get("load") === "fail", failSave = query.has("failSave"), refuse = false, uncertainGoal = query.has("uncertainGoal");
const sends: { sessionId: string; text: string; attachments: unknown[] }[] = [];
const goals: { sessionId: string; text: string; submission: MonoGoalSubmission }[] = [];
const opened: string[] = [], sessionSetup: string[] = [], native: string[] = [];
mockIPC(async (command, args) => {
  native.push(command);
  if (command === "control_load") {
    await loading;
    if (failLoad) throw Error("Fixture ledger unavailable");
    return store.get((args as { leadId: string }).leadId) ?? null;
  }
  if (command === "control_save") {
    if (failSave) throw Error("Fixture log unavailable");
    const value = args as { leadId: string; state: string }; store.set(value.leadId, value.state); return;
  }
  throw Error(`Unexpected fixture native operation: ${command}`);
});
const controls = {
  sends, goals, opened, sessionSetup, native,
  release: () => releaseLoad?.(), recover: () => { failLoad = false; },
  refuse: (value: boolean) => { refuse = value; }, failSave: (value: boolean) => { failSave = value; },
  addAsk: () => monoManagerGoals.recordDecision("manager", { ...ask, id: "fresh", question: "A new live ask?" }),
  archive: () => saveMonoTeamRoster(listMonos(true).map(mono => mono.id === "manager" ? { ...mono, archivedAt: Date.now() } : mono)),
  reply: () => monoManagerGoals.recordDecisionReply("manager", { id: "boss-chat:answer", managerId: "manager", senderId: "boss", recipientId: "worker", topic: "decision:ask", text: "Reuse the interface", at: Date.now() }),
};
declare global { interface Window { actualMapFixture: typeof controls } }
window.actualMapFixture = controls;
const noop = () => {};

function Fixture() {
  const teamMap = useTeamMap();
  const [sessions, setSessions] = useState<Session[]>([{ ...newSession("codex", project), id: "worker-chat" }]);
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  const submit = async (sessionId: string, text: string, attachments: unknown[]) => {
    if (refuse) return false;
    sends.push({ sessionId, text, attachments }); return true;
  };
  const submitSessionRef = useRef(submit); submitSessionRef.current = submit;
  const goalPort = { current: async (sessionId: string, text: string, _attachments: unknown[], submission: MonoGoalSubmission) => {
    goals.push({ sessionId, text, submission });
    if (uncertainGoal) { uncertainGoal = false; throw Error("Fixture uncertain acceptance"); }
    return true;
  } };
  useEffect(() => teamMap.show(), []);
  const ports = {
    React, useState, useRef, useEffect, useCallback, useSyncExternalStore,
    subscribeMonos, monosSnapshot, monoManagerGoals, listMonos, findMono, teamMap, sendDecisionFromClick,
    ensureOpenSession: async (id: string) => sessionsRef.current.find(session => session.id === id),
    ensureMonoSession: (id: string, host: Parameters<typeof ensureMonoSession>[1]) => {
      sessionSetup.push(id); return ensureMonoSession(id, { ...host, workspace: async () => "C:/synthetic/monos/boss" });
    },
    homeDir: async () => "C:/synthetic/home", saveMonoPermissions: async () => {}, newDefaultSession: (cwd: string) => newSession("codex", cwd), selectedProviderAccountId: () => undefined,
    sessionsRef, setSessions, submitSessionRef, submitSession: submit, submitMonoGoalRef: goalPort, sameProjectPath,
    monoLook, monoGoalRoutingContext, remoteProjectFor: () => undefined, recents: [{ path: project }], projectKey,
    workspaceNavigation: { cancel: noop }, setFilePickerOpen: noop, setSettingsOpen: noop, setSearchViewOpen: noop,
    setInboxViewOpen: noop, setNotesViewOpen: noop, setAutomationsViewOpen: noop,
    MISSION_CONTROL_SCOPE: "mission-control", ATTENTION_QUEUE_SCOPE: "attention-queue", DECISIONS_SCOPE: "decisions", USAGE_DASHBOARD_SCOPE: "usage",
    TeamMap, sessions, orchestrationRuns: [], managerPrStatuses: new Map(), onOpenMono: (id: string) => opened.push(id), onOpenRailMono: (id: string) => opened.push(id), commandMapDecisions,
    INTEGRATIONS_SCOPE, capabilityDecisionReason, renderIntegrationRequest: () => null, // Integration rendering has its own actual-App fixture.
    goalNextSteps: [], renderGoalNextAction: () => null, // Existing-goal binding is covered by the separate App goal callback fixture.
  };
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <div style={{ padding: "6px 16px", fontSize: 11 }}>Actual App source-selected map branch/callbacks · injected shell/native ports <button onClick={() => teamMap.show()}>Fixture open map</button></div>
    <AppMapHost {...ports} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
