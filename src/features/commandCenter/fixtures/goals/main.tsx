import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { TeamMap } from "../../../teamMap/TeamMap";
import { commandMapDecisions } from "../../../teamMap/commandMapDecisions";
import { monoManagerGoals, type MonoManagerGoal } from "../../../monos/model/monoManagerGoals";
import type { Mono } from "../../../monos/model/mono";
import { newSession } from "../../../sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "../../../orchestration/model/orchestrationState";
import { selectGoalNextAction, runGoalNextAction, type GoalNextStep } from "../../model/goalNextAction";
import { GoalNextAction } from "../../ui/GoalNextAction";
import "../../../teamMap/commandMap.css";
import "./styles.css";

const params = new URLSearchParams(location.search), mode = params.get("mode");
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
document.body.style.margin = "0";
const project = "/synthetic/browser-link-4";
const roster: Mono[] = [
  { id: "boss", name: "Boss", role: "orchestrator", projects: [project], mascot: "cat", color: "#8f87e8" },
  { id: "manager", name: "Project Manager", role: "manager", managerEngineId: "engine", managerProject: project, sessionId: "chat", reportsTo: "boss", projects: [project], mascot: "cat", color: "#8f87e8" },
  { id: "worker", name: "Builder", role: "member", reportsTo: "manager", projects: [project], mascot: "cat", color: "#8f87e8" },
];
localStorage.clear(); localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
const goal: MonoManagerGoal = { id: "goal", monoId: "manager", managerId: "engine", projectId: project, userMessageId: "original", requestId: "request", title: "Make project routing clearer", state: "running", prUrls: [], createdAt: 1, updatedAt: 1 };
let saved = JSON.stringify({ version: 1, goals: [goal], receipts: {}, decisions: [] });
mockIPC((command, args) => {
  if (command === "control_load") return saved;
  if (command === "control_save") { saved = (args as { state: string }).state; return; }
  if (command === "artifact_get") return null;
  throw Error(`Unexpected synthetic fixture operation: ${command}`);
});
await monoManagerGoals.hydrate("manager");
const task = { id: "task", memberId: "worker", memberName: "Builder", monoGoalId: "goal", sessionId: "worker-chat", title: "Implement the routing check", prompt: "RAW PROMPT: inspect the selected checkout and retain all safeguards.\nFull task constraints remain available here.", status: mode === "info" ? "completed" : "queued", accepted: mode === "info", result: "RAW REPORT: full saved report", dependsOn: [], files: [], scopes: [], delivered: false } as OrchestrationTask;
const run = { leadId: "engine", ownerMonoId: "manager", ownerSessionId: "chat", cwd: project, projectManager: true, status: mode === "info" || mode === "approval" ? "active" : "paused", tasks: [task], dispatches: [], wakeState: { waves: [], events: mode === "info" ? [{ id: "RAW EVENT ID", kind: "info", at: 1, text: "RAW UPDATE: retained informational event" }] : [] } } as unknown as OrchestrationRun;
const managerChat = { ...newSession("claude", "/synthetic/manager/workspace"), id: "chat", blocks: mode === "approval" ? [{ id: "approval", role: "tool", text: "", approval: { requestId: 42 } }] as never : [] };
const sessions = [managerChat, { ...newSession("claude", project), id: "worker-chat" }];
const calls = { continued: [] as string[], opened: [] as string[] };
declare global { interface Window { goalFixture: typeof calls } }
window.goalFixture = calls;

function Fixture() {
  const [runs] = useState([run]);
  const pending = useRef(new Set<string>()), accepted = useRef(new Set<string>());
  const input = { roster, runs, sessions, goals: monoManagerGoals.goals() };
  // Start is deliberately disconnected until the existing-goal contract is approved.
  const steps = input.goals.flatMap(goal => { const step = selectGoalNextAction(input, goal.id); return step && step.action !== "start" ? [step] : []; });
  const render = (step: GoalNextStep) => <GoalNextAction key={step.revision} step={step} onAction={(event, selected) => runGoalNextAction(event, selected, {
    read: () => selectGoalNextAction(input, selected.goalId),
    open: async id => { calls.opened.push(id); },
    continueManager: async id => { await new Promise(resolve => setTimeout(resolve, 80)); calls.continued.push(id); },
    pending: pending.current, accepted: accepted.current,
  })} />;
  const decisions = commandMapDecisions(monoManagerGoals, roster, {
    answer: async () => { throw Error("No fixture decisions"); },
    autonomy: (event, managerId, projectId, value) => monoManagerGoals.setAutonomy(event, managerId, projectId, value),
    openProject: () => {},
  }, Date.now(), { steps, render });
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <TeamMap sessions={sessions} runs={runs} statuses={new Map()} scope="manager" onOpenMono={id => calls.opened.push(id)} onClose={() => {}} decisions={decisions} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
