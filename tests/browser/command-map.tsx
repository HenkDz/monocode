import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { TeamMap } from "../../src/features/teamMap/TeamMap";
import { monoManagerGoals, type MonoManagerGoal } from "../../src/features/monos/model/monoManagerGoals";
import type { Mono } from "../../src/features/monos/model/mono";
import { newSession } from "../../src/features/sessions/model/session";
import type { OrchestrationRun } from "../../src/features/orchestration/model/orchestrationState";
import "../../src/styles/index.css";

document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
document.body.style.margin = "0";
const names = ["browser-link-4", "dzdistro", "monocode", "grok-bot"];
const roster: Mono[] = [{ id: "Boss", name: "Boss", role: "orchestrator", projects: [], mascot: "owl", color: "#c9a7ff" }];
const goals: MonoManagerGoal[] = [];
const runs: OrchestrationRun[] = [];
for (const [index, name] of names.entries()) {
  const manager: Mono = { id: `manager-${index}`, name: `${name} Manager`, role: "manager", reportsTo: "Boss", managerEngineId: `engine-${index}`, projects: [`C:/synthetic/${name}`], managerProject: `C:/synthetic/${name}`, mascot: "cat", color: ["#5ed3b8", "#f2b45c", "#7aa2ff", "#ff8fb1"][index] };
  roster.push(manager);
  const members: Mono[] = ["Atlas", "Iris", "Sentinel"].map((label, member) => ({ ...manager, id: `member-${index}-${member}`, name: label, role: "member", reportsTo: manager.id, sessionId: `chat-${index}-${member}` }));
  roster.push(...members);
  goals.push({ id: `goal-${index}`, monoId: "Boss", managerId: manager.managerEngineId!, projectId: manager.managerProject!, title: ["Profile routing + one-time Open with chooser", "Distributor portal: invoicing export", "Command center polish", "Native team explainer"][index], state: "running", prUrls: [], requestId: `request-${index}`, userMessageId: `request-${index}`, createdAt: 1, updatedAt: 1 });
  runs.push({ id: `run-${index}`, leadId: manager.managerEngineId, ownerMonoId: manager.id, cwd: manager.managerProject, status: "active", tasks: members.map((member, item) => ({ id: `task-${index}-${item}`, memberId: member.id, sessionId: member.sessionId!, title: ["Implementing chooser focus", "Delivered the interaction spec", "Waiting for review"][item], status: item === 0 ? "running" : "completed", accepted: item === 1, result: item === 1 ? "Accepted synthetic report" : "", monoGoalId: `goal-${index}`, dependsOn: [], prompt: "Synthetic task" })), dispatches: [] } as unknown as OrchestrationRun);
}
localStorage.clear();
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
const sessions = roster.filter(mono => mono.sessionId).map((mono, index) => ({ ...newSession("codex", mono.projects[0]), id: mono.sessionId!, busy: index % 3 === 0, blocks: [{ id: `saved-${index}`, role: "assistant" as const, text: "Saved synthetic work evidence", turnModel: { harness: "codex" as const, id: "saved-model", name: "Saved fixture model" } }] }));
const selectorCase = new URLSearchParams(location.search).get("selector");
if (selectorCase === "question") {
  sessions[0].pendingQuestion = { requestId: 1, title: "Choose the API contract", questions: [] };
  runs[0].tasks[0] = { ...runs[0].tasks[0], sessionId: "failed-worker", status: "failed", error: "Worker failed" };
}
if (selectorCase === "progress") {
  runs[0].tasks = [{ ...runs[0].tasks[0], status: "queued", accepted: false }];
  for (const conflict of [{ ownerMonoId: "other-manager" }, { cwd: "C:/Other" }]) {
    runs.push({ ...runs[0], ...conflict, id: `conflict-${runs.length}`, tasks: [{ ...runs[0].tasks[0], accepted: true, activeDispatchId: "accepted", acceptedDispatchId: "accepted" }] });
  }
}
mockIPC(command => {
  if (command === "control_load") return JSON.stringify({ version: 1, goals, receipts: {} });
  throw Error(`Unexpected fixture native operation: ${command}`);
});
await monoManagerGoals.hydrate("Boss");
const events: string[] = [];
Object.assign(window, { commandMapFixture: { events } });
createRoot(document.getElementById("root")!).render(<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
  <p style={{ padding: "6px 16px", fontSize: 11 }}>Synthetic independent map · GO/V2 product wiring UNWIRED</p>
  <TeamMap sessions={sessions} runs={runs} statuses={new Map()} onOpenMono={id => events.push(`open:${id}`)} onClose={() => events.push("close")}
    decisions={{ needYou: 1, handledToday: 3, incomplete: false,
      rail: <><h2>Decisions</h2><p>Synthetic presentation slot</p><p>Shared V2 controls remain unwired.</p></>,
      project: path => ({ pending: path.endsWith("browser-link-4") ? 1 : 0, teamPending: 0, incomplete: false,
        autonomy: <p>Autonomy unavailable · accepted V2 wiring held</p>, cards: <p>Decision actions unavailable</p> }),
    }} />
</div>);
