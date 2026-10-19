import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MonoManagerGoals, type GoalLedger, type MonoManagerGoal } from "./monoManagerGoals";
import { bossMayDecide, decisionAuthorityGuidance, parseDecisionPayload, parseDecisionAction, validateDecisionHistory, type DecisionCommand, type DecisionHost, type DecisionPayload, type DecisionSnapshot } from "./monoDecisions";
import { addManagerWakeEvent, type ManagerWakeState } from "../../orchestration/model/managerWake";
import { newSession } from "../../sessions/model/session";
import type { CrewMessage } from "./monoCrewEvents";

const ipc = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc }));
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); ipc.mockReset(); });
const payload: DecisionPayload = { version: 1, type: "decision", question: "Which implementation?", impact: "low", context: "Existing authorized task",
  options: [{ id: "reuse", label: "Reuse the helper" }, { id: "change", label: "Change implementation" }], recommendedOptionId: "reuse", operation: "work" };

it("keeps the shared prompt protocol short and truthful about protected operations", () => {
  const guidance = decisionAuthorityGuidance();
  expect(guidance.length).toBeLessThanOrEqual(1250);
  for (const required of ["high-impact-only: Boss may decide low/med", "medium-and-up: Boss may decide low", "everything: Boss may decide only explicitly", "summaries", "original goal only", "merge|install|sign-in|destructive|system-settings|spend", "Never claim higher-level decisions"])
    expect(guidance).toContain(required);
  console.info(`V2 decision prompt delta: ${guidance.length + 1} characters per org chart; authority core unchanged.`);
  expect(decisionAuthorityGuidance("member").length).toBeLessThanOrEqual(160);
  console.info(`V2 member prompt delta: ${decisionAuthorityGuidance("member").length + 1} characters; full protocol fetched via app rules team.`);
});

function fixture(override: Partial<DecisionPayload> = {}) {
  const goal: MonoManagerGoal = { id: "goal", monoId: "manager", managerId: "engine", projectId: "/project", userMessageId: "original", requestId: "manager-original", title: "Fix existing work", state: "running", prUrls: [], createdAt: 1, updatedAt: 1 };
  const requestSession = { ...newSession("claude", "/project"), id: "manager-session", blocks: [{ id: "original", role: "user" as const, text: "Fix existing work" }] };
  const requesterSession = { ...newSession("claude", "/project/worker"), id: "worker-session" };
  const state: DecisionSnapshot = { goal, cancelling: false, requestSession, requesterSession, generation: 1,
    roster: [
      { id: "boss", role: "orchestrator", projects: ["/project"], sessionId: "boss-session", mascot: "b", color: "blue" },
      { id: "manager", role: "manager", reportsTo: "boss", projects: ["/project"], sessionId: "manager-session", mascot: "m", color: "blue" },
      { id: "worker", role: "member", reportsTo: "manager", projects: ["/project"], mascot: "w", color: "blue" },
    ],
    run: { version: 2, leadId: "engine", ownerMonoId: "manager", ownerSessionId: "manager-session", cwd: "/project", projectManager: true,
      status: "active", allowedHarnesses: ["claude"], maxWorkers: 1, cli: "synthetic", requests: {}, continuations: 0,
      tasks: [{ id: "task", sessionId: "worker-session", memberId: "worker", monoGoalId: "goal", activeDispatchId: "dispatch", status: "running", accepted: false,
        title: "Fix", prompt: "Fix", harness: "claude", model: "synthetic", files: [], scopes: [], dependsOn: [], delivered: false, result: "" }],
      dispatches: [{ id: "dispatch", taskId: "task", sessionId: "worker-session", workspace: { id: "checkout", projectCwd: "/project", checkoutCwd: "/project/worker", kind: "worktree" }, state: "running", stage: "turn_submitted", startedAt: 1, updatedAt: 1 }] } };
  const saved = new Map<string, GoalLedger>([["manager", { version: 1, goals: [structuredClone(goal)], receipts: { legacy: { signature: "legacy", result: { retained: true } } }, events: {} }]]);
  const storage = { load: vi.fn(async (id: string) => structuredClone(saved.get(id) ?? null)), save: vi.fn(async (id: string, value: GoalLedger) => { saved.set(id, structuredClone(value)); }) };
  let ledger = new MonoManagerGoals(storage);
  const inboxes = new Map<string, ManagerWakeState>();
  const host: DecisionHost = { actor: { kind: "mono", id: "worker" }, roster: () => state.roster, current: () => state,
    deliver: vi.fn(async (message, validate) => {
      validate();
      inboxes.set(message.recipientId, addManagerWakeEvent(inboxes.get(message.recipientId), message.event));
    }) };
  const message: CrewMessage = { id: "worker-session:question", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "decision", kind: "question", requiresReply: true, at: 1, text: JSON.stringify({ ...payload, ...override }) };
  let request = 0;
  const ingest = () => ledger.handleDecision("manager", "ingest", { action: "ingest", goalId: "goal", message }, host);
  const act = (actor: string, action: Exclude<DecisionCommand["action"], "ingest" | "autonomy">, extra = {}) => {
    host.actor = actor === "user" ? { kind: "user" } : { kind: "mono", id: actor };
    return ledger.handleDecision("manager", `action-${++request}`, { action, decisionId: message.id, expectedVersion: ledger.decisions("manager").find(record => record.id === message.id)!.resolutionVersion, ...extra } as DecisionCommand, host);
  };
  return { goal, state, saved, storage, host, inboxes, message, ingest, act,
    get ledger() { return ledger; }, reload() { ledger = new MonoManagerGoals(storage); return ledger.hydrate("manager"); } };
}

it("uses one Manager ledger, preserves legacy/unknown values, saves and reloads the same escalation", async () => {
  const f = fixture({ impact: "med" });
  Object.assign(f.saved.get("manager")!, { futureHistory: { keep: [1, 2] } });
  await f.ingest();
  expect(f.ledger.autonomy("manager", "/project")).toBe("high-impact-only");
  await f.act("manager", "escalate");
  await f.reload();
  expect(f.ledger.decisions("manager")).toMatchObject([{ id: f.message.id, deciderLevel: "boss", currentLevel: 2, recommenderId: "worker" }]);
  expect(f.saved.get("manager")).toMatchObject({ futureHistory: { keep: [1, 2] }, receipts: { legacy: { result: { retained: true } } }, goals: [f.goal] });
  expect([...f.saved.keys()]).toEqual(["manager"]);
  expect(f.inboxes.get("boss")!.events[0]).toMatchObject({ kind: "escalation", goalId: "goal", dispatchId: "dispatch" });
  await f.act("boss", "resolve", { optionId: "reuse" });
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "decided", decidedBy: "boss", deciderLevel: "boss" });
  expect(f.inboxes.get("worker")!.events[0].kind).toBe("decision");
});

it("keeps the decision at the Manager even when the original user goal belongs to the Boss", async () => {
  const f = fixture();
  f.goal.monoId = "boss";
  f.state.requestSession.id = "boss-session";
  f.saved.get("manager")!.goals = [];
  await f.ingest();
  expect(f.ledger.decisions("manager")[0].identity.ownerMonoId).toBe("boss");
  await expect(f.ledger.handleDecision("boss", "wrong-owner", { action: "ingest", goalId: "goal", message: f.message }, f.host)).rejects.toThrow("originating Manager");
});
it("routes a Manager question directly to its actual Boss even when the Boss has no local project list", async () => {
  const f = fixture({ impact: "med" });
  f.state.roster[0].projects = [];
  f.state.requesterSession = f.state.requestSession;
  Object.assign(f.message, { id: "manager-session:question", senderId: "manager", recipientId: "boss" });
  f.host.actor = { kind: "mono", id: "manager" };
  await f.ingest();
  expect(f.ledger.decisions("manager")[0].escalationChain.map(entry => entry.id)).toEqual(["manager", "boss", "user"]);
  expect(f.inboxes.get("boss")!.events).toHaveLength(1);
});

it("delivers the exact retained options and version for team action replies with a truthful bounded context preview", async () => {
  const f = fixture({ context: "x".repeat(600) }); await f.ingest();
  const event = f.inboxes.get("manager")!.events[0];
  expect(JSON.parse(event.text)).toMatchObject({ decisionId: f.message.id, expectedVersion: 0, options: payload.options,
    operation: "work", context: "x".repeat(400), contextTruncated: true });
  expect(event.text.length).toBeLessThanOrEqual(4000);
  await f.act("manager", "resolve", { optionId: "reuse" });
  expect(JSON.parse(f.inboxes.get("worker")!.events[0].text)).toMatchObject({ expectedVersion: 1, optionId: "reuse" });
});

it("keeps absent-protocol legacy records and their original delivery bytes through reload and resolution", async () => {
  const f = fixture(); await f.ingest();
  delete f.saved.get("manager")!.decisions![0].eventProtocol;
  const receipt = structuredClone(f.saved.get("manager")!.receipts.ingest);
  await f.reload();
  expect(f.ledger.decisionQuarantine("manager")).toEqual([]);
  await f.act("manager", "resolve", { optionId: "reuse" });
  const decision = f.ledger.decisions("manager")[0];
  expect(f.inboxes.get("worker")!.events[0].text).toBe(JSON.stringify({ type: "decision", decisionId: decision.id,
    question: decision.question, optionId: "reuse", senderId: "manager", recipientId: "worker", identity: decision.identity }));
  expect(f.saved.get("manager")!.receipts.ingest).toEqual(receipt);
});

it.each(["status", "decidedBy", "deciderLevel", "answer", "delegatedByUser", "identity"])("rejects a worker's forged answer field %s", async field => {
  const f = fixture();
  f.message.text = JSON.stringify({ ...payload, [field]: "user" });
  await expect(f.ingest()).rejects.toThrow();
  expect(f.ledger.decisions("manager")).toEqual([]);
  expect(f.host.deliver).not.toHaveBeenCalled();
});
it("refuses decision-kind answer ingestion and a Manager impersonating the Boss", async () => {
  const f = fixture();
  f.message.kind = "decision";
  await expect(f.ingest()).rejects.toThrow("source");
  f.message.kind = "question";
  await f.ingest(); await f.act("manager", "escalate");
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("current decider");
  await expect(f.act("worker", "resolve", { optionId: "reuse" })).rejects.toThrow("current decider");
});

it.each(["merge", "install", "sign-in", "destructive", "system-settings", "spend"] as const)("keeps low-impact %s explicitly user-owned", async operation => {
  const f = fixture({ operation });
  await f.ingest();
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("required authority");
  await f.act("manager", "escalate");
  await expect(f.act("boss", "resolve", { optionId: "reuse" })).rejects.toThrow("required authority");
  await f.act("boss", "escalate");
  await expect(f.act("user", "delegate")).rejects.toThrow("Only the user");
  await f.act("user", "resolve", { optionId: "reuse" });
  expect(f.ledger.decisions("manager")[0].decidedBy).toBe("user");
});
it.each(["high-impact-only", "medium-and-up", "everything"] as const)("shares the explicit Boss policy for %s", autonomy => {
  expect(bossMayDecide({ operation: "work", impact: "low" }, autonomy)).toBe(autonomy !== "everything");
  expect(bossMayDecide({ operation: "work", impact: "med" }, autonomy)).toBe(autonomy === "high-impact-only");
  expect(bossMayDecide({ operation: "work", impact: "high" }, autonomy)).toBe(false);
  expect(bossMayDecide({ operation: "work", impact: "high", delegatedByUser: true }, autonomy)).toBe(true);
  expect(bossMayDecide({ operation: "merge", impact: "low", delegatedByUser: true }, autonomy)).toBe(false);
});
it("persists project autonomy only from a trusted user action and retains impact floors", async () => {
  const f = fixture();
  await f.ingest();
  const command: DecisionCommand = { action: "autonomy", projectId: "/project", value: "everything" };
  await expect(f.ledger.handleDecision("manager", "policy", command, f.host)).rejects.toThrow("Only the user");
  f.host.actor = { kind: "user" };
  await f.ledger.handleDecision("manager", "policy", command, f.host);
  await f.reload();
  expect(f.ledger.autonomy("manager", "/project")).toBe("everything");
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("required authority");
  await f.act("manager", "raise-impact", { impact: "high" });
  await expect(f.act("manager", "raise-impact", { impact: "med" })).rejects.toThrow("cannot be lowered");
});
it("records reminders without auto-deciding or pausing the team, and records explicit user delegation", async () => {
  const f = fixture({ impact: "high" });
  await f.ingest(); await f.act("manager", "escalate"); await f.act("boss", "escalate");
  await f.act("boss", "remind");
  expect(f.state.run.status).toBe("active");
  expect(f.state.run.tasks[0].status).toBe("running");
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "pending", deciderLevel: "user", history: expect.arrayContaining([expect.objectContaining({ action: "remind", level: "boss" })]) });
  await f.act("user", "delegate");
  await f.act("boss", "resolve", { optionId: "change" });
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "decided", delegatedByUser: true, selectedOptionId: "change", decidedBy: "boss" });
});

it("serializes concurrent Boss/user actions and refuses the stale version", async () => {
  const f = fixture({ impact: "med" });
  await f.ingest(); await f.act("manager", "escalate");
  const current = f.ledger.decisions("manager")[0];
  const bossHost = { ...f.host, actor: { kind: "mono" as const, id: "boss" } };
  const userHost = { ...f.host, actor: { kind: "user" as const } };
  const results = await Promise.allSettled([
    f.ledger.handleDecision("manager", "concurrent-boss", { action: "escalate", decisionId: current.id, expectedVersion: current.resolutionVersion }, bossHost),
    f.ledger.handleDecision("manager", "concurrent-user", { action: "resolve", optionId: "reuse", decisionId: current.id, expectedVersion: current.resolutionVersion }, userHost),
  ]);
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.ledger.decisions("manager")).toHaveLength(1);
  expect(f.ledger.decisions("manager")[0].deciderLevel).toBe("user");
});

const staleChanges: [string, (f: ReturnType<typeof fixture>) => void][] = [
  ["generation", f => f.state.generation++], ["request", f => f.goal.requestId = "different"],
  ["goal", f => f.goal.id = "different"], ["project", f => f.goal.projectId = "/other"],
  ["account", f => f.state.requestSession.providerAccountId = "other"],
  ["worker account", f => f.state.requesterSession.providerAccountId = "other"],
  ["home", f => f.state.requestSession.codexStorageHome = "/synthetic-other"],
  ["session", f => f.state.requestSession.id = "other"],
  ["original text", f => f.state.requestSession.blocks[0].text = "Different request"],
  ["task", f => f.state.run.tasks[0].id = "different"],
  ["dispatch", f => f.state.run.tasks[0].activeDispatchId = "replacement"],
  ["cancel", f => f.goal.state = "cancelled"], ["pending cancel", f => f.state.cancelling = true],
  ["Stop", f => f.state.run.status = "stopped"], ["worker stopped", f => f.state.run.tasks[0].status = "cancelled"],
  ["reportsTo", f => f.state.roster = f.state.roster.map(mono => mono.id === "manager" ? { ...mono, reportsTo: "other" } : mono)],
  ["approval", f => f.state.requesterSession.pendingQuestion = {} as never],
];
it.each(staleChanges)("refuses stale %s authority after reload without delivering", async (_name, change) => {
  const f = fixture();
  await f.ingest(); await f.reload();
  const delivered = vi.mocked(f.host.deliver).mock.calls.length;
  change(f);
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow();
  expect(vi.mocked(f.host.deliver).mock.calls.length).toBe(delivered);
});
it("records a trusted stale user answer while withholding authority", async () => {
  const f = fixture({ impact: "high" });
  await f.ingest(); await f.act("manager", "escalate"); await f.act("boss", "escalate");
  f.goal.state = "cancelled";
  const delivered = vi.mocked(f.host.deliver).mock.calls.length;
  await f.act("user", "resolve", { optionId: "reuse" }); await f.reload();
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "decided", deliveryState: "stale", decidedBy: "user" });
  expect(vi.mocked(f.host.deliver).mock.calls.length).toBe(delivered);
});

it("replays durable receipt after a failed acknowledgment exactly once through CC5D event IDs", async () => {
  const f = fixture();
  await f.ingest();
  const save = f.storage.save.getMockImplementation()!;
  let failAck = true;
  f.storage.save.mockImplementation(async (id, value) => {
    if (failAck && value.decisions?.[0].status === "decided" && Object.values(value.receipts).some(receipt => receipt.decision?.decisionId === f.message.id && receipt.decision.remaining.length === 0) && f.inboxes.get("worker")) {
      failAck = false; throw Error("ack failed");
    }
    return save(id, value);
  });
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("ack failed");
  const eventId = f.inboxes.get("worker")!.events[0].id;
  await f.reload();
  await f.ledger.recoverDecisions("manager", f.host);
  await f.ledger.recoverDecisions("manager", f.host);
  expect(f.inboxes.get("worker")!.events).toHaveLength(1);
  expect(eventId).toContain(`${f.message.id}:1:decision`);
  expect(f.saved.get("manager")!.receipts["action-1"].decision!.remaining).toEqual([]);
});
it("does not publish after failed save and retries the same request without a second record", async () => {
  const f = fixture();
  f.storage.save.mockRejectedValueOnce(Error("disk full"));
  await expect(f.ingest()).rejects.toThrow("disk full");
  expect(f.host.deliver).not.toHaveBeenCalled();
  expect(f.ledger.decisions("manager")).toEqual([]);
  await f.ingest(); await f.ingest();
  expect(f.ledger.decisions("manager")).toHaveLength(1);
  expect(f.inboxes.get("manager")!.events).toHaveLength(1);
  f.message.text = JSON.stringify({ ...payload, context: "Changed" });
  await expect(f.ingest()).rejects.toThrow("different input");
});
it("rechecks binding across awaited save/delivery and retains a stale resolution without publication", async () => {
  const f = fixture(); await f.ingest();
  const original = f.storage.save.getMockImplementation()!;
  f.storage.save.mockImplementation(async (id, value) => {
    await original(id, value);
    if (value.decisions?.[0].status === "decided") f.state.generation++;
  });
  await f.act("manager", "resolve", { optionId: "reuse" });
  expect(f.inboxes.has("worker")).toBe(false);
  expect(f.ledger.decisions("manager")[0].deliveryState).toBe("stale");
});
it("rechecks identity inside asynchronous delivery before publication", async () => {
  const f = fixture(); await f.ingest();
  vi.mocked(f.host.deliver).mockImplementationOnce(async (_message, validate) => { await Promise.resolve(); f.state.generation++; validate(); });
  await f.act("manager", "resolve", { optionId: "reuse" });
  expect(f.inboxes.has("worker")).toBe(false);
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "decided", deliveryState: "stale" });
});
it("preserves retryable deliveries when the trusted context lookup is temporarily unavailable", async () => {
  const f = fixture(); await f.ingest();
  const lookup = f.host.current;
  vi.mocked(f.host.deliver).mockImplementationOnce(async () => {
    f.host.current = () => { throw Error("lookup offline"); };
    throw Error("transport offline");
  });
  // Freeze of actor/command must not freeze the live context lookup itself.
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow();
  expect(f.saved.get("manager")!.receipts["action-1"].decision!.remaining).toHaveLength(1);
  f.host.current = lookup;
  await f.ledger.recoverDecisions("manager", f.host);
  expect(f.inboxes.get("worker")!.events).toHaveLength(1);
});
it.each(["operation", "impact"] as const)("quarantines immutable %s corruption without authorizing it", async field => {
  const f = fixture({ impact: "high", operation: "merge" }); await f.ingest();
  if (field === "operation") f.saved.get("manager")!.decisions![0].operation = "work";
  else f.saved.get("manager")!.decisions![0].impact = "low";
  const raw = structuredClone(f.saved.get("manager")!.decisions);
  await f.reload();
  expect(f.ledger.decisionHistoryState("manager")).toBe("ready");
  expect(f.ledger.decisions("manager")).toEqual([]);
  expect(JSON.parse(f.ledger.decisionQuarantine("manager")[0].raw).decisions).toEqual(raw);
});

it.each([{}, { impact: "unknown" }, { question: "x".repeat(301) }, { context: "x".repeat(2001) }, { options: Array(7).fill({ id: "a", label: "a" }) }, { operation: "credentials" }])("rejects malformed, oversized or unknown payload %j", value => {
  expect(() => parseDecisionPayload(value)).toThrow();
});
it("retains context/options as untrusted text without execution or telemetry", () => {
  const value = { ...payload, context: "<script>throw Error('executed')</script>", options: [{ id: "reuse", label: "<b>Untrusted</b>" }, payload.options[1]] };
  expect(parseDecisionPayload(value)).toEqual(value);
});
it("preserves corrupt present history outside authority and keeps unrelated goal work usable", async () => {
  const f = fixture(); await f.ingest();
  f.saved.get("manager")!.decisions![0].impact = "unknown" as never;
  const raw = structuredClone(f.saved.get("manager")!);
  f.storage.save.mockRejectedValueOnce(Error("disk unavailable"));
  await expect(f.reload()).rejects.toThrow("disk unavailable");
  expect(f.saved.get("manager")).toEqual(raw);
  expect(f.ledger.decisionHistoryState("manager")).toBe("loading");
  await f.reload();
  expect(f.ledger.decisionHistoryState("manager")).toBe("ready");
  expect(f.ledger.goals("manager")).toEqual(raw.goals);
  expect(f.ledger.decisions("manager")).toEqual([]);
  const evidence = f.ledger.decisionQuarantine("manager");
  expect(f.ledger.autonomy("manager", "/project")).toBe("high-impact-only");
  await f.ledger.recoverDecisions("manager", f.host);
  await expect(f.ledger.handleDecision("manager", "reuse-corrupt-id", { action: "ingest", goalId: "goal", message: f.message }, f.host)).rejects.toThrow("new decision ID");
  f.message.id = "worker-session:re-raised";
  await f.ledger.handleDecision("manager", "re-raised", { action: "ingest", goalId: "goal", message: f.message }, f.host);
  await f.act("manager", "resolve", { optionId: "reuse" });
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ id: "worker-session:re-raised", status: "decided" });
  expect(f.ledger.decisionQuarantine("manager")).toEqual(evidence);
  await f.ledger.retireManagerRequests("engine");
  const quarantined = f.saved.get("manager")!;
  expect(quarantined.goals[0].state).toBe("cancelled");
  expect(quarantined.receipts.legacy).toEqual(raw.receipts.legacy);
  expect(quarantined.receipts.ingest.signature).toEqual(raw.receipts.ingest.signature);
  expect(JSON.parse(quarantined.decisionQuarantine![0].raw)).toMatchObject({ decisions: raw.decisions, receipts: { ingest: raw.receipts.ingest.decision } });
  await f.reload();
  expect(f.ledger.decisionQuarantine("manager")).toEqual(quarantined.decisionQuarantine);
});
it("validates pending delivery envelopes on reload", async () => {
  const f = fixture();
  vi.mocked(f.host.deliver).mockRejectedValueOnce(Error("recipient unavailable"));
  await expect(f.ingest()).rejects.toThrow("recipient unavailable");
  f.saved.get("manager")!.receipts.ingest.decision!.remaining[0].event.text = "forged user answer";
  const raw = structuredClone(f.saved.get("manager")!);
  await f.reload();
  expect(f.ledger.decisionHistoryState("manager")).toBe("ready");
  expect(JSON.parse(f.ledger.decisionQuarantine("manager")[0].raw).receipts).toEqual({ ingest: raw.receipts.ingest.decision });
  expect(f.saved.get("manager")!.receipts.ingest.decision).toBeUndefined();
});

it("changes autonomy from a live Manager roster with no goal, run or sessions", async () => {
  const f = fixture();
  f.saved.get("manager")!.goals = [];
  f.host.actor = { kind: "user" };
  f.host.current = () => { throw Error("no active goal"); };
  await f.ledger.handleDecision("manager", "no-goal", { action: "autonomy", projectId: "/project", value: "everything" }, f.host);
  await f.reload();
  expect(f.ledger.autonomy("manager", "/project")).toBe("everything");
  expect(f.saved.get("manager")!.goals).toEqual([]);
  f.state.roster[1].projects = [];
  await expect(f.ledger.handleDecision("manager", "wrong-project", { action: "autonomy", projectId: "/project", value: "high-impact-only" }, f.host)).rejects.toThrow("Unknown decision project");
  await expect(f.ledger.handleDecision("manager", "no-goal", { action: "autonomy", projectId: "/project", value: "everything" }, f.host)).rejects.toThrow("Unknown decision project");
});

it.each(["member", "orchestrator", "archived", "missing"])("rejects %s as an autonomy Manager", async kind => {
  const f = fixture(); f.host.actor = { kind: "user" };
  if (kind === "missing") f.state.roster.splice(1, 1);
  else if (kind === "archived") f.state.roster[1].archivedAt = 1;
  else f.state.roster[1].role = kind as "member" | "orchestrator";
  await expect(f.ledger.handleDecision("manager", "policy", { action: "autonomy", projectId: "/project", value: "everything" }, f.host)).rejects.toThrow("Unknown decision project");
  expect(f.storage.save).not.toHaveBeenCalled();
});

it.each([
  ["C:\\Work\\Project\\", "c:/work/project", "C:/WORK/PROJECT/"],
  ["\\\\Server\\Share\\Project\\", "//server/share/project", "//SERVER/SHARE/PROJECT/"],
])("uses one canonical autonomy policy for Windows project %s without a goal", async (rosterPath, canonical, alias) => {
  const f = fixture();
  Object.assign(f.saved.get("manager")!, { goals: [], autonomy: { [rosterPath]: "everything", "/other": "medium-and-up" } });
  f.state.roster[1].projects = [rosterPath];
  f.host.actor = { kind: "user" };
  f.host.current = () => { throw Error("no active goal"); };
  await f.reload();
  expect(f.ledger.autonomy("manager", alias)).toBe("everything");
  await f.ledger.handleDecision("manager", "alias-policy", { action: "autonomy", projectId: alias, value: "medium-and-up" }, f.host);
  await f.reload();
  expect(f.saved.get("manager")!.autonomy).toEqual({ [canonical]: "medium-and-up", "/other": "medium-and-up" });
  expect(f.ledger.autonomy("manager", rosterPath)).toBe("medium-and-up");
  expect(f.ledger.autonomyChanges("manager")).toEqual([]);
  expect(f.saved.get("manager")!.goals).toEqual([]);
});

it("uses stricter conflicting aliases without blocking user resolution and audits explicit consolidation", async () => {
  const f = fixture();
  f.state.goal.projectId = "C:/Work/Project";
  f.state.run.cwd = "c:/work/project/";
  for (const mono of f.state.roster) mono.projects = ["C:\\WORK\\Project"];
  const policies = { "c:\\work\\project\\": "everything" as const };
  f.saved.get("manager")!.autonomy = policies;
  await f.ingest();
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("required authority");
  f.saved.get("manager")!.autonomy = { ...policies, "C:/Work/Project": "high-impact-only" };
  await f.reload();
  const before = structuredClone(f.saved.get("manager"));
  expect(f.ledger.autonomy("manager", "C:/WORK/PROJECT")).toBe("everything");
  expect(f.ledger.autonomyConflicts("manager")).toEqual(["c:/work/project"]);
  await expect(f.act("manager", "resolve", { optionId: "reuse" })).rejects.toThrow("required authority");
  await f.act("manager", "escalate"); await f.act("boss", "escalate");
  await f.act("user", "resolve", { optionId: "reuse" });
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "decided", decidedBy: "user" });
  f.host.actor = { kind: "user" };
  await f.ledger.handleDecision("manager", "conflict", { action: "autonomy", projectId: "C:/work/project", value: "medium-and-up" }, f.host);
  await f.reload();
  expect(f.saved.get("manager")!.autonomy).toEqual({ "c:/work/project": "medium-and-up" });
  expect(f.ledger.autonomyConflicts("manager")).toEqual([]);
  expect(f.ledger.autonomyChanges("manager")).toEqual([{ type: "autonomy-change", projectId: "c:/work/project", actorId: "user", at: expect.any(Number),
    replaced: Object.entries(before!.autonomy!).map(([projectId, value]) => ({ projectId, value })), value: "medium-and-up" }]);
});

it("keeps differently cased POSIX project policies separate", async () => {
  const f = fixture();
  f.saved.get("manager")!.autonomy = { "/Project": "everything", "/project": "medium-and-up" };
  await f.reload();
  expect(f.ledger.autonomy("manager", "/Project")).toBe("everything");
  expect(f.ledger.autonomy("manager", "/project")).toBe("medium-and-up");
});

it.each([
  { action: "resolve", optionId: "reuse" }, { action: "escalate" },
  { action: "raise-impact", impact: "high" }, { action: "remind" },
])("parses only exact bounded team decision action $action", command => {
  expect(parseDecisionAction({ version: 1, type: "decision-action", decisionId: "worker:question", expectedVersion: 0, ...command }))
    .toEqual({ decisionId: "worker:question", expectedVersion: 0, ...command });
});

it.each([
  { actor: { kind: "user" } }, { requestId: "text-retry" }, { expectedVersion: -1 }, { expectedVersion: 0.5 },
  { expectedVersion: "0" }, { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, { decisionId: "x".repeat(257) },
  { optionId: "x".repeat(65) }, { optionId: "" }, { action: "escalate", optionId: "reuse" },
  { action: "delegate" }, { action: "autonomy" }, { action: "raise-impact", impact: "unknown", optionId: undefined },
])("rejects malformed, unbounded or impersonated team action %j", delta => {
  expect(() => parseDecisionAction({ version: 1, type: "decision-action", action: "resolve", decisionId: "worker:question", expectedVersion: 0, optionId: "reuse", ...delta })).toThrow();
});
it("caps resolved history at 200, retains every pending record and keeps duplicate tombstones", async () => {
  const f = fixture(); await f.ingest(); await f.act("manager", "resolve", { optionId: "reuse" });
  const record = f.ledger.decisions("manager")[0];
  const saved = f.saved.get("manager")!;
  saved.decisions = Array.from({ length: 205 }, (_, index) => ({ ...structuredClone(record), id: `historic-${index}`, source: { ...record.source, id: `historic-${index}` }, decidedAt: index, createdAt: 0, updatedAt: index }));
  await f.reload();
  f.message.id = "worker-session:new";
  await expect(f.ingest()).rejects.toThrow("different input");
  await f.ledger.handleDecision("manager", "new-ingest", { action: "ingest", goalId: "goal", message: f.message }, { ...f.host, actor: { kind: "mono", id: "worker" } });
  const history = f.ledger.decisions("manager");
  expect(history.filter(record => record.status === "decided")).toHaveLength(200);
  expect(history.filter(record => record.status === "pending")).toHaveLength(1);
  expect(f.saved.get("manager")!.decisionsPruned).toBe(5);
  expect(f.ledger.decisionsPruned("manager")).toBe(5);
  expect(f.saved.get("manager")!.receipts["action-1"]).toBeDefined();
  await f.reload();
  validateDecisionHistory(f.saved.get("manager")!);
  await f.act("manager", "resolve", { optionId: "reuse" });
  expect(f.ledger.decisions("manager")).toHaveLength(200);
  expect(f.ledger.decisionsPruned("manager")).toBe(6);
});
it("refuses oversized saves while retaining prior durable values", async () => {
  const f = fixture();
  Object.assign(f.saved.get("manager")!, { futureHistory: "x".repeat(7_000_001) });
  await expect(f.ingest()).rejects.toThrow("capacity");
  expect(f.host.deliver).not.toHaveBeenCalled();
  expect(f.saved.get("manager")!.decisions).toBeUndefined();
});

it("preserves the exact autonomy audit receipt through decision compaction, retry and reload", async () => {
  const f = fixture();
  f.saved.get("manager")!.autonomy = { "/project": "everything", "/project/": "high-impact-only" };
  f.host.actor = { kind: "user" };
  const command = { action: "autonomy" as const, projectId: "/project", value: "high-impact-only" as const };
  const result = await f.ledger.handleDecision("manager", "audit-policy", command, f.host);
  const receipt = structuredClone(f.saved.get("manager")!.receipts["audit-policy"]);
  f.host.actor = { kind: "mono", id: "worker" };
  await f.ingest(); await f.act("manager", "resolve", { optionId: "reuse" });
  const record = f.ledger.decisions("manager")[0];
  f.saved.get("manager")!.decisions = Array.from({ length: 205 }, (_, index) => ({ ...structuredClone(record),
    id: `audit-history-${index}`, source: { ...record.source, id: `audit-history-${index}` }, decidedAt: index, createdAt: 0, updatedAt: index }));
  await f.reload();
  await f.ledger.acknowledgeEvents("manager", []);
  await f.reload();
  expect(f.ledger.decisions("manager")).toHaveLength(200);
  expect(f.ledger.decisionsPruned("manager")).toBe(5);
  expect(f.saved.get("manager")!.receipts["audit-policy"]).toEqual(receipt);
  expect(f.ledger.autonomyChanges("manager")).toEqual([result]);
  f.host.actor = { kind: "user" };
  expect(await f.ledger.handleDecision("manager", "audit-policy", command, f.host)).toEqual(result);
  expect(f.ledger.autonomyChanges("manager")).toHaveLength(1);
});

it("round-trips the production control_save/control_load adapter through a synthetic disk SQLite database", async () => {
  const f = fixture();
  const file = join(mkdtempSync(join(tmpdir(), "monocode-v2-decisions-")), "synthetic.sqlite");
  const open = () => {
    const db = new DatabaseSync(file); databases.push(db);
    db.exec("CREATE TABLE IF NOT EXISTS orchestration_runs (lead_id TEXT PRIMARY KEY, state TEXT NOT NULL)");
    ipc.mockImplementation(async (command, input) => {
      if (command === "control_load") return (db.prepare("SELECT state FROM orchestration_runs WHERE lead_id=?").get(input.leadId) as { state: string } | undefined)?.state ?? null;
      if (command === "control_save") { db.prepare("INSERT INTO orchestration_runs VALUES (?, ?) ON CONFLICT(lead_id) DO UPDATE SET state=excluded.state").run(input.leadId, input.state); return; }
      throw Error(`Unexpected IPC ${command}`);
    });
    return db;
  };
  const db = open();
  db.prepare("INSERT INTO orchestration_runs VALUES (?, ?)").run("mono-goals:manager", JSON.stringify(f.saved.get("manager")));
  const original = new MonoManagerGoals();
  await original.handleDecision("manager", "ingest", { action: "ingest", goalId: "goal", message: f.message }, f.host);
  databases.splice(databases.indexOf(db), 1); db.close(); open();
  const restored = new MonoManagerGoals(); await restored.hydrate("manager");
  expect(restored.decisions("manager")).toEqual(original.decisions("manager"));
  expect(restored.goals("manager")).toEqual([f.goal]);
  expect(ipc.mock.calls.some(([command]) => command === "control_save")).toBe(true);
  expect(f.inboxes.get("manager")!.events).toHaveLength(1);
});
