import type { Mono } from "../../../monos/model/mono";
import type { MonoDecision } from "../../../monos/model/monoDecisions";
import { MonoManagerGoals } from "../../../monos/model/monoManagerGoals";

export const project = "C:/synthetic/map";
export const roster: Mono[] = [
  { id: "boss", name: "Boss", role: "orchestrator", projects: [], mascot: "owl", color: "#c9a7ff" },
  { id: "manager", name: "Mira", role: "manager", reportsTo: "boss", projects: [project], managerProject: project, mascot: "cat", color: "#5ed3b8" },
  { id: "worker", name: "Atlas", role: "member", reportsTo: "manager", projects: [project], sessionId: "worker-chat", mascot: "cat", color: "#7aa2ff" },
];
export const ask: MonoDecision = {
  version: 1, type: "decision", id: "ask", projectId: project, requestingMonoId: "worker", requesterSessionId: "worker-chat",
  question: "Choose the API contract", impact: "high", context: "Reuse the existing project interface.", operation: "work",
  options: [{ id: "reuse", label: "Reuse the interface" }, { id: "change", label: "Change the interface" }], recommendedOptionId: "reuse",
  escalationChain: [{ id: "worker", level: "worker" }, { id: "manager", level: "manager" }, { id: "boss", level: "boss" }, { id: "user", level: "user" }],
  answererId: "user", status: "waiting", createdAt: Date.now(),
};
export const protectedAsk: MonoDecision = { ...ask, id: "protected", question: "Send the project update?", operation: "message-people" };
export async function fixtureLedger(rows = [ask, protectedAsk], pruned = 0, skipped = 0) {
  const ledger = new MonoManagerGoals({
    load: async id => ({ version: 1, goals: [], receipts: {}, decisions: id === "manager" ? rows : [], decisionsPruned: pruned, decisionsSkipped: skipped }),
    save: async () => {},
  });
  await ledger.hydrate("manager");
  return ledger;
}
