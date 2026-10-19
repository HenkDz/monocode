import { expect, it, vi } from "vitest";
import { appendUser } from "../../../integrations/harness/core/apply";
import { newSession, type Session } from "../../sessions/model/session";
import { canSteerQueuedHead, queuedMessageForSubmit } from "../../sessions/model/messageQueue";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { MonoManagerGoals } from "./monoManagerGoals";
import type { Mono } from "./mono";
import type { CrewMessage } from "./monoCrewEvents";
import { assertDecisionUiGesture, executeDecisionUi, handleDecisionTeamMessage, runtimeDecisionHost, type DecisionRuntimeHost } from "./monoDecisionRuntime";
import { assertDecisionQueueConsumer, queueDecisionEvidence } from "./monoDecisionDelivery";

async function fixture() {
  const sessions = new Map<string, Session>();
  for (const id of ["manager-session", "worker-session", "boss-session", "habit-session", "automation-session"]) {
    sessions.set(id, { ...newSession("claude", "/project"), id, busy: true });
  }
  const managerSession = appendUser(sessions.get("manager-session")!, "Fix the current project", []);
  sessions.set(managerSession.id, managerSession);
  const roster: Mono[] = [
    { id: "boss", role: "orchestrator", projects: [], mascot: "b", color: "blue", sessionId: "boss-session" },
    { id: "manager", role: "manager", reportsTo: "boss", projects: ["/project"], mascot: "m", color: "blue", sessionId: "manager-session" },
    { id: "worker", role: "member", reportsTo: "manager", projects: ["/project"], mascot: "w", color: "blue" },
  ];
  let disk: string | null = null;
  const storage = { load: vi.fn(async () => disk ? JSON.parse(disk) : null), save: vi.fn(async (_id: string, value: unknown) => { disk = JSON.stringify(value); }) };
  const ledger = new MonoManagerGoals(storage);
  const goal = await ledger.anchorManagerRequest(roster[1], { id: "/project", name: "Project", folder: "/project", managerId: "engine", managerExists: true, managerMonoId: "manager", running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] }, managerSession.blocks[managerSession.blocks.length - 1]);
  const run: OrchestrationRun = { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: "manager-session", cwd: "/project", projectManager: true, status: "active", allowedHarnesses: ["claude"], maxWorkers: 1, cli: "synthetic", requests: {}, continuations: 0,
    tasks: [{ id: "task", memberId: "worker", sessionId: "worker-session", monoGoalId: goal.id, activeDispatchId: "dispatch", status: "running", accepted: false, title: "Fix", prompt: "Fix", harness: "claude", model: "synthetic", files: ["src"], scopes: [], dependsOn: [], delivered: false, result: "" }],
    dispatches: [{ id: "dispatch", taskId: "task", sessionId: "worker-session", workspace: { id: "checkout", projectCwd: "/project", checkoutCwd: "/project/worker", kind: "worktree" }, state: "running", stage: "turn_submitted", startedAt: 42, updatedAt: 42 }] };
  const notifications = new Map<string, string>();
  const host: DecisionRuntimeHost = { ledger, roster: () => roster, sessions: () => [...sessions.values()], runs: () => [run], generation: () => 1,
    eventOwner: id => ["habit-session", "automation-session"].includes(id) ? "boss" : undefined,
    queue: vi.fn(async (message, decision, validate) => {
      const recipientId = message.recipientId === "worker" ? "worker-session" : roster.find(mono => mono.id === message.recipientId)!.sessionId!;
      await queueDecisionEvidence("manager", message, decision, validate, { recipient: () => sessions.get(recipientId), update: async (id, change) => { sessions.set(id, change(sessions.get(id)!)); } });
    }),
    notifyUser: vi.fn(async (id, decision, validate) => { validate(); notifications.set(id, decision.id); }),
    askManager: vi.fn(async () => {}),
  };
  const question: CrewMessage = { id: "worker-session:question", senderId: "worker", managerId: "manager", recipientId: "manager", at: 1, topic: "decision", kind: "question", requiresReply: true,
    text: JSON.stringify({ version: 1, type: "decision", question: "Which implementation?", impact: "low", context: "Current authorized task", options: [{ id: "reuse", label: "Reuse" }, { id: "change", label: "Change" }], recommendedOptionId: "reuse", operation: "work" }) };
  const ingest = () => handleDecisionTeamMessage("worker-session", "question", question, host);
  let counter = 0;
  const act = (actor: string, action: string, extra = {}, source = `${actor}-session`) => {
    const requestId = `action-${++counter}`;
    return handleDecisionTeamMessage(source, requestId, { ...question, id: `${source}:${requestId}`, senderId: actor, kind: "decision", recipientId: "worker",
      text: JSON.stringify({ version: 1, type: "decision-action", action, decisionId: question.id, expectedVersion: ledger.decisions("manager")[0].resolutionVersion, ...extra }) }, host);
  };
  return { ledger, host, roster, sessions, run, storage, notifications, question, ingest, act };
}

it("routes an authenticated question and answer through the real ledger and existing queue, without steering", async () => {
  const f = await fixture();
  await f.ingest();
  expect(f.sessions.get("manager-session")!.queuedMessages).toHaveLength(1);
  expect(canSteerQueuedHead(f.sessions.get("manager-session")!)).toBe(false);
  await f.act("manager", "resolve", { optionId: "reuse" });
  const decision = f.ledger.decisions("manager")[0];
  const worker = f.sessions.get("worker-session")!, message = worker.queuedMessages![0];
  expect(message.monoDecision).toMatchObject({ decisionId: f.question.id, recipientId: "worker", resolutionVersion: 1 });
  expect(message.id).toMatch(/^decision-[a-f0-9]{64}$/);
  expect(queuedMessageForSubmit(worker, message.id, "steer")).toBeUndefined();
  await assertDecisionQueueConsumer(message, "worker", decision, runtimeDecisionHost("manager", { kind: "mono", id: "manager" }, "", undefined, f.host));
  const restored = new MonoManagerGoals(f.storage); await restored.hydrate("manager");
  expect(restored.decisions("manager")[0]).toMatchObject({ status: "decided", selectedOptionId: "reuse" });
  expect(restored.goals("manager")).toHaveLength(1);
});

it("dedupes exact queued events and rejects forged or stale restored evidence", async () => {
  const f = await fixture(); await f.ingest(); await f.ingest();
  expect(f.sessions.get("manager-session")!.queuedMessages).toHaveLength(1);
  await f.act("manager", "resolve", { optionId: "reuse" });
  const message = f.sessions.get("worker-session")!.queuedMessages![0], decision = f.ledger.decisions("manager")[0];
  const host = runtimeDecisionHost("manager", { kind: "mono", id: "manager" }, "", undefined, f.host);
  await expect(assertDecisionQueueConsumer({ ...message, text: "forged approval" }, "worker", decision, host)).rejects.toThrow("retained delivery");
  f.run.tasks[0].status = "cancelled";
  await expect(assertDecisionQueueConsumer(message, "worker", decision, host)).rejects.toThrow();
  expect(f.run.tasks[0].status).toBe("cancelled");
});

it.each(["habit-session", "automation-session"])("refuses user resolve/delegate/autonomy impersonation from %s", async source => {
  const f = await fixture(); await f.ingest(); await f.act("manager", "escalate"); await f.act("boss", "escalate");
  await expect(f.act("boss", "resolve", { optionId: "reuse" }, source)).rejects.toThrow("current decider");
  await expect(f.act("boss", "delegate", {}, source)).rejects.toThrow("impersonate user");
  await expect(f.act("boss", "autonomy", { projectId: "/project", value: "everything" }, source)).rejects.toThrow("impersonate user");
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "pending", deciderLevel: "user" });
});

it("refuses programmatic UI events before actor:user can be created", async () => {
  const f = await fixture();
  expect(() => assertDecisionUiGesture(new Event("click"))).toThrow("direct click");
  expect(() => executeDecisionUi(new Event("click"), "manager", "policy", { action: "autonomy", projectId: "/project", value: "everything" }, f.host)).toThrow("direct click");
  expect(f.ledger.autonomy("manager", "/project")).toBe("high-impact-only");
});

it("queues busy recipients and never revives stopped original work", async () => {
  const f = await fixture(); await f.ingest();
  expect(f.sessions.get("manager-session")!.busy).toBe(true);
  expect(f.sessions.get("manager-session")!.queuedMessages).toHaveLength(1);
  f.run.status = "stopped";
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow();
  expect(f.run.status).toBe("stopped");
  expect(f.sessions.get("worker-session")!.queuedMessages).toBeUndefined();
});

it("retains failed-save authority and rejects an actor whose turn changed while awaiting the serial writer", async () => {
  const f = await fixture(); await f.ingest();
  f.storage.save.mockRejectedValueOnce(Error("disk unavailable"));
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("disk unavailable");
  expect(f.ledger.decisions("manager")[0].status).toBe("pending");
  expect(f.sessions.get("worker-session")!.queuedMessages).toBeUndefined();
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { started = resolve; });
  const save = f.storage.save.getMockImplementation()!;
  f.storage.save.mockImplementationOnce(async (id, ledger) => { started(); await held; await save(id, ledger); });
  const prior = f.ledger.acknowledgeEvents("manager", []);
  await saving;
  const action = f.act("manager", "resolve", { optionId: "reuse" });
  f.host.generation = () => 2;
  release(); await prior;
  await expect(action).rejects.toThrow("turn changed");
  expect(f.ledger.decisions("manager")[0].status).toBe("pending");
});
