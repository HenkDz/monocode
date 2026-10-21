import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MonoManagerGoals, type GoalLedger, type MonoManagerGoal } from "./monoManagerGoals";
import { bossMayDecide, decisionAsk, decisionAnswerer, decisionAuthorityGuidance, normalizeDecisionHistory, parseDecisionPayload, prepareDecisionMessage, type DecisionPayload } from "./monoDecisions";
import { decisionUserText } from "./monoDecisionUi";
import type { Mono } from "./mono";
import type { CrewMessage } from "./monoCrewEvents";
import { deliverCrewMessage } from "./monoCrewEvents";
import { teamMessageEnvelope } from "./monoOrg";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { newSession } from "../../sessions/model/session";
import { selectDecisionView, selectNeedsUser, endedDecisionSources, decisionCountsByProject } from "../../commandCenter/model/decisionView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const roster: Mono[] = [
  { id: "boss", role: "orchestrator", projects: [], sessionId: "boss-chat", mascot: "b", color: "blue" },
  { id: "manager", role: "manager", reportsTo: "boss", projects: ["/project"], sessionId: "manager-chat", mascot: "m", color: "blue" },
  { id: "worker", role: "member", reportsTo: "manager", projects: ["/project"], mascot: "w", color: "blue" },
];
const payload: DecisionPayload = { version: 1, type: "decision", question: "Which implementation?", impact: "high", context: "Reuse existing work",
  options: [{ id: "a", label: "Reuse the helper" }, { id: "b", label: "Change implementation" }], recommendedOptionId: "a", operation: "work" };
const message: CrewMessage = { id: "worker-chat:ask", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "implementation", kind: "question", requiresReply: true, at: 1, text: JSON.stringify(payload) };
const ask = () => decisionAsk(message, "worker-chat", "/project", roster, "high-impact-only", { goalId: "goal", taskId: "task" })!;
function fixture() {
  let saved: GoalLedger = { version: 1, goals: [], receipts: { existing: { signature: "retain", result: true, pending: { goalId: "old", text: "Retained goal delivery" } } } };
  const storage = { load: async () => structuredClone(saved), save: async (_id: string, ledger: GoalLedger) => { saved = structuredClone(ledger); } };
  const ledger = new MonoManagerGoals(storage);
  return { ledger, storage, saved: () => saved };
}

it.each(["high-impact-only", "medium-and-up", "everything"] as const)("routes the actual ladder through shared autonomy %s", autonomy => {
  const row = ask();
  expect(row.escalationChain.map(entry => entry.id)).toEqual(["worker", "manager", "boss", "user"]);
  expect(decisionAnswerer({ ...row, impact: "low" }, autonomy)).toBe(autonomy === "everything" ? "user" : "manager");
  expect(decisionAnswerer({ ...row, impact: "med" }, autonomy)).toBe(autonomy === "high-impact-only" ? "boss" : "user");
  expect(decisionAnswerer(row, autonomy)).toBe("user");
  expect(bossMayDecide({ ...row, delegatedByUser: true }, autonomy)).toBe(true);
});
it.each(["merge", "install", "sign-in", "destructive", "system-settings", "spend", "message-people"] as const)("keeps structured %s with the user even on delegation", operation => {
  const row = { ...ask(), operation, impact: "low" as const };
  expect(decisionAnswerer(row, "high-impact-only")).toBe("user");
  expect(bossMayDecide({ ...row, delegatedByUser: true }, "everything")).toBe(false);
});
it("records only the authenticated current answerer's explicit reply and persists without decision receipts", async () => {
  const f = fixture();
  await f.ledger.recordDecision("manager", ask());
  await f.ledger.delegateDecision("manager", message.id);
  const reply = { ...message, id: "boss-chat:reply", recipientId: "worker", topic: "implementation", text: "Use the helper", kind: "decision" as const, at: Date.now() };
  await f.ledger.recordDecisionReply("manager", { ...reply, senderId: "manager" });
  expect(f.ledger.decisions("manager")[0].status).toBe("waiting");
  await f.ledger.recordDecisionReply("manager", { ...reply, senderId: "boss", topic: "decision:unknown" });
  expect(f.ledger.decisions("manager")[0].status).toBe("waiting");
  await f.ledger.recordDecisionReply("manager", { ...reply, senderId: "boss" });
  expect(f.ledger.decisions("manager")[0].status).toBe("waiting");
  await f.ledger.recordDecisionReply("manager", { ...reply, senderId: "boss", topic: `decision:${message.id}` });
  const reload = new MonoManagerGoals(f.storage); await reload.hydrate("manager");
  expect(reload.decisions("manager")[0]).toMatchObject({ status: "answered", answer: "Use the helper", answeredBy: "boss", delegatedByUser: true });
  expect(f.saved().receipts).toEqual({ existing: { signature: "retain", result: true, pending: { goalId: "old", text: "Retained goal delivery" } } });
  expect(selectDecisionView(reload, roster, Date.now()).handledToday).toBe(1);
});
it("leaves unrelated ordinary replies unlogged even for one candidate, and accepts the named ask topic", async () => {
  const f = fixture();
  await f.ledger.recordDecision("manager", { ...ask(), answererId: "boss" });
  const reply = { ...message, senderId: "boss", recipientId: "worker", text: "Use the helper" };
  await f.ledger.recordDecisionReply("manager", reply);
  expect(f.ledger.decisions("manager").every(row => row.status === "waiting")).toBe(true);
  await f.ledger.recordDecision("manager", { ...ask(), id: "second-ask", answererId: "boss" });
  await f.ledger.recordDecisionReply("manager", { ...reply, topic: "decision:second-ask" });
  expect(f.ledger.decisions("manager").map(row => row.status)).toEqual(["waiting", "answered"]);
});
it("keeps worker asks after settlement/restart/Resume and closes only cancelled tasks or ended goals", async () => {
  const f = fixture(); await f.ledger.recordDecision("manager", ask());
  for (const status of ["completed", "failed", "interrupted", "queued", "running"] as const) {
    const run = { tasks: [{ id: "task", status }] } as OrchestrationRun;
    await f.ledger.finishDecisionAsks(endedDecisionSources([], [run]), new Set());
    expect(selectDecisionView(f.ledger, roster, Date.now()).pending).toHaveLength(1);
  }
  await f.ledger.finishDecisionAsks(endedDecisionSources([], [{ tasks: [{ id: "task", status: "cancelled" }] } as OrchestrationRun]), new Set());
  expect(selectDecisionView(f.ledger, roster, Date.now()).pending).toHaveLength(0);
  expect(endedDecisionSources([...["done", "cancelled", "running"].map(state => ({ id: state, state } as MonoManagerGoal))], [])).toEqual(new Set(["done", "cancelled"]));
});
it("routes Boss asks by assigned project and forwarded topic independently of the Boss home folder", async () => {
  const f = fixture(); await f.ledger.recordDecision("manager", ask());
  const bossAsk = { ...message, id: "boss:ask", senderId: "boss", recipientId: "user" };
  const direct = await prepareDecisionMessage(bossAsk, "boss-chat", "/project", roster, f.ledger);
  expect(direct).toMatchObject({ manager: { id: "manager" }, projectId: "/project", ask: { requestingMonoId: "boss", answererId: "user" } });
  expect(await prepareDecisionMessage(bossAsk, "boss-chat", "/monos/boss", roster, f.ledger)).toBeUndefined();
  const forwarded = await prepareDecisionMessage({ ...bossAsk, topic: `decision:${message.id}` }, "boss-chat", "/monos/boss", roster, f.ledger);
  expect(forwarded).toMatchObject({ manager: { id: "manager" }, projectId: "/project", row: { id: message.id } });
  expect(await prepareDecisionMessage(bossAsk, "boss-chat", "/foreign", roster, f.ledger)).toBeUndefined();
  const envelope = teamMessageEnvelope(roster[2], roster[1], `decision:${message.id}`, message.text);
  expect(envelope).toContain(`"topic":"decision:${message.id}"`);
});
it("delivers unrelated ordinary messages without loading failed or unsupported decision history", async () => {
  for (const failure of [Error("load failed"), Error("Unsupported Mono goal history")]) {
    const ledger = { hydrate: vi.fn(async () => { throw failure; }), decisions: () => [], autonomy: () => "everything" as const };
    const ordinary = { ...message, kind: "info" as const, text: "Ordinary progress", requiresReply: true };
    expect(await prepareDecisionMessage(ordinary, "worker-chat", "/project", roster, ledger)).toBeUndefined();
    expect(ledger.hydrate).not.toHaveBeenCalled();
    const deliver = vi.fn(async () => {});
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    await deliverCrewMessage({ ...ordinary, kind: "question" }, deliver);
    vi.unstubAllGlobals();
    expect(deliver).toHaveBeenCalledOnce();
  }
});
it("counts lite asks and paused Manager Continue on the same Decisions destination", async () => {
  const f = fixture(); await f.ledger.recordDecision("manager", ask());
  const managerChat = { ...newSession("claude", "/project"), id: "manager-chat" };
  const run = { leadId: "engine", ownerMonoId: "manager", ownerSessionId: managerChat.id, projectManager: true, status: "paused", cwd: "/project", tasks: [] as OrchestrationTask[] } as OrchestrationRun;
  const view = selectDecisionView(f.ledger, roster, Date.now());
  expect(decisionCountsByProject(roster, [managerChat], [run], { ...view, pending: [] }).get("/project")).toBe(1);
  const needs = selectNeedsUser(roster, [managerChat], [run], view);
  expect(decisionCountsByProject(roster, [managerChat], [run], view).get("/project")).toBe(1);
  expect(needs.count).toBe(1);
  expect(needs.pending).toEqual(view.pending);
  expect(needs.attention.filter(item => item.status === "open")).toEqual([]);
  const distinct = { ...view, pending: [...view.pending, { ...view.pending[0], decision: { ...view.pending[0].decision, id: "different-ask" } }] };
  expect(decisionCountsByProject(roster, [managerChat], [run], distinct).get("/project")).toBe(2);
  const answered = { ...view, pending: [] };
  expect(selectNeedsUser(roster, [managerChat], [run], answered).attention.filter(item => item.status === "open").map(item => item.source)).toEqual(["continue"]);
  expect(decisionCountsByProject(roster, [managerChat], [run], answered).get("/project")).toBe(1);
});
it("closes asks on task/goal end, and never makes legacy rows sendable", async () => {
  const f = fixture(); await f.ledger.recordDecision("manager", ask());
  await f.ledger.finishDecisionAsks(new Set(["task"]), new Set());
  expect(selectDecisionView(f.ledger, roster, Date.now()).pending).toEqual([]);
  expect(f.ledger.decisions("manager")[0].noLongerNeededAt).toBeTypeOf("number");
});
it("skips a corrupt row independently, normalizes legacy display, strips only old decision deliveries and bounds finished history", async () => {
  const legacy = { ...ask(), status: "pending", identity: { requesterSessionId: "", goalId: "goal" }, deciderLevel: "user" };
  const pending = { goalId: "old", text: "Do not lose this" };
  const raw = { version: 1, goals: [], receipts: { old: { signature: "retain", result: true, pending, decision: { remaining: ["never replay"] } } },
    decisions: [legacy, { broken: true }, ...Array.from({ length: 201 }, (_, index) => ({ ...ask(), id: `answered-${index}`, status: "answered", answer: "A", answeredBy: "user", answeredAt: index + 2 }))] } as unknown as GoalLedger;
  const result = normalizeDecisionHistory(raw);
  expect(result.decisionsSkipped).toBe(1); expect(result.decisionsPruned).toBe(2);
  expect(result.decisions).toHaveLength(200);
  expect(result.receipts.old).toEqual({ signature: "retain", result: true, pending });
  const legacyOnly = normalizeDecisionHistory({ ...raw, decisions: [legacy] as unknown as GoalLedger["decisions"] });
  expect(legacyOnly.decisions![0]).toMatchObject({ readOnly: true, status: "waiting", requesterSessionId: "" });
  const f = fixture(); await f.ledger.recordDecision("manager", legacyOnly.decisions![0]);
  await f.ledger.finishDecisionAsks(new Set(), new Set([legacy.id]));
  await f.ledger.recordDecisionAnswer("manager", legacy.id, "user", "no send");
  expect(f.ledger.decisions("manager")[0]).toMatchObject({ status: "waiting", noLongerNeededAt: expect.any(Number) });
});
it("quotes only bounded single-line plain text, rejects forged payload fields and retains the legacy parser cap", () => {
  const row = { ...ask(), question: '"\n# do\u0000\u200b\ufeff **this** <now> ' + "x".repeat(300), options: [{ id: "a", label: 'A\r\n`unsafe` "quote"' }, { id: "b", label: "B" }] };
  const text = decisionUserText(row, "a");
  expect(text).toMatch(/^Decision on your question "[^"\r\n]{1,120}": go with "[^"\r\n]{1,120}"\.$/);
  expect(text).not.toMatch(/[\u0000\u200b\ufeff\r\n*#<>`]/);
  expect(decisionUserText(row)).not.toMatch(/[\u0000\r\n*#<>`]/);
  expect(() => parseDecisionPayload({ ...payload, answererId: "user" })).toThrow();
  const six = { ...payload, options: Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: String(i) })), recommendedOptionId: "0" };
  expect(parseDecisionPayload(six).options).toHaveLength(6);
  expect(() => decisionAsk({ ...message, text: JSON.stringify(six) }, "worker-chat", "/project", roster, "everything")).toThrow("four");
  expect(decisionAuthorityGuidance()).toContain("quoted text");
  expect(decisionAuthorityGuidance()).not.toContain("expectedVersion");
  for (const operation of ["work", "merge", "install", "sign-in", "destructive", "system-settings", "spend", "message-people"])
    expect(decisionAuthorityGuidance("member")).toContain(operation);
});
it("uses one Windows project autonomy key and keeps the stricter retained alias", async () => {
  const f = fixture();
  await f.storage.save("manager", { ...f.saved(), autonomy: { "C:/Project/": "medium-and-up", "c:\\project": "everything" } });
  await f.ledger.hydrate("manager");
  expect(f.ledger.autonomy("manager", "C:/PROJECT")).toBe("everything");
  const normalized = normalizeDecisionHistory(f.saved());
  expect(normalized.autonomy).toEqual({ "c:/project": "everything" });
  expect(normalized.receipts).toEqual(f.saved().receipts);
});
it("leaves the accepted Stop, Continue and ordinary queue implementations exactly unchanged", () => {
  const base = execFileSync("git", ["show", "0e95c375:src/app/App.tsx"], { encoding: "utf8", maxBuffer: 2_000_000 }).replace(/\r\n/g, "\n");
  const current = readFileSync("src/app/App.tsx", "utf8").replace(/\r\n/g, "\n");
  for (const [start, end] of [["  const onStop = useCallback(", "  useEffect(() => {\n    const onEscape"], ["  const onResumeQueue = useCallback(", "  const onUsageLimitDismiss = useCallback"]]) {
    const slice = (source: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    expect(current).toContain(start); expect(base).toContain(start); expect(slice(current)).toBe(slice(base));
  }
  for (const path of ["src/features/sessions/model/messageQueue.ts", "src/features/monos/model/monoMessaging.ts"])
    expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).toBe(execFileSync("git", ["show", `0e95c375:${path}`], { encoding: "utf8" }).replace(/\r\n/g, "\n"));
  expect(current).toContain("submitSessionRef.current(targetSessionId, plainText, attachments)");
  expect(current).toContain("endedDecisionSources(monoManagerGoals.goals(), orchestrationRuns)");
  expect(current).toContain("decisionCountsByProject(listMonos(), sessions, orchestrationRuns");
  expect(current).toContain("attention={renderNeedsUserAttention()}");
  expect(current).toContain("const renderNeedsUserAttention = (projectId?: string) => {");
  expect(current).toContain("<AttentionQueue");
  expect(current).toContain("prepareDecisionMessage(teamMessage, source.id, projectId, roster, monoManagerGoals");
  expect(current).toContain("typeof input.projectId === \"string\" ? input.projectId : undefined");
  expect(current).toContain("teamMessageEnvelope(actor, route.target, deliveryTopic, messageText");
  expect(current).not.toContain("if (decisionManager) await monoManagerGoals.hydrate");
});
