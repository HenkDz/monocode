import { describe, expect, it, vi } from "vitest";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationDispatch, OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import type { Block, Session } from "../../sessions/model/session";
import type { UserQuestionPrompt, UserQuestionReply } from "../../sessions/model/userQuestion";
import type { TrackedCiRepair } from "../../inbox/model/ciRepairTracking";
import type { Automation } from "../../automations/model/automations";
import { attentionHistory, executeAttentionAction, selectAttention,
  type AttentionCallbacks, type AttentionInput, type AttentionItem, type AttentionSource } from "./attention";

const turn = (id: string, startedAt = 100): Block => ({ id, role: "user", text: "Build", startedAt });
const approval = (extra: Partial<Block> = {}): Block => ({ id: "permission", role: "tool", text: "Run the selected command",
  tool: { title: "Run tests", detail: "npm test" }, approval: { requestId: 7 }, ...extra });
const question: UserQuestionPrompt = { requestId: 8, title: "Choose the release",
  questions: [{ id: "release", prompt: "Which release?", multiSelect: true, allowCustom: true,
    options: [{ id: "stable", label: "Stable" }, { id: "preview", label: "Preview" }] }], autoResolveAt: 5000 };
const session = (id = "lead", extra: Partial<Session> = {}): Session => ({ id, title: id, cwd: "/repo", harness: "codex",
  providerSessionId: `${id}-provider`, model: "test", modelSettings: {}, runtimeMode: "supervised", blocks: [turn(`${id}-turn`)], ...extra });
const mono = (id: string, extra: Partial<Mono> = {}): Mono => ({ id, name: id, mascot: "owl", color: "blue", projects: ["/repo"], ...extra });
const task = (extra: Partial<OrchestrationTask> = {}): OrchestrationTask => ({ id: "task", sessionId: "worker", memberId: "member",
  memberName: "Builder", monoGoalId: "goal", title: "Build the release", harness: "codex", model: "test", prompt: "Build",
  files: ["src"], scopes: [], dependsOn: [], status: "failed", error: "Build failed", result: "", delivered: true,
  lastDispatchId: "attempt", ...extra });
const dispatch = (extra: Partial<OrchestrationDispatch> = {}): OrchestrationDispatch => ({ id: "attempt", taskId: "task", sessionId: "worker",
  workspace: { id: "workspace", projectCwd: "/repo", checkoutCwd: "/repo-worker", kind: "main" },
  state: "failed", stage: "settled", dispatchedAt: 100, startedAt: 110, updatedAt: 180, finishedAt: 180, ...extra });
const run = (extra: Partial<OrchestrationRun> = {}): OrchestrationRun => ({ version: 2, leadId: "engine", ownerSessionId: "lead", ownerMonoId: "manager",
  cwd: "/repo", status: "active", tasks: [task()], dispatches: [dispatch()], allowedHarnesses: ["codex"], maxWorkers: 2,
  cli: "test", continuations: 0, requests: {}, ...extra });
const goal = (id = "goal", extra: Partial<MonoManagerGoal> = {}): MonoManagerGoal => ({ id, title: id, monoId: "grand", managerId: "engine",
  projectId: "/repo", userMessageId: `${id}-turn`, requestId: id, state: "running", prUrls: [], createdAt: 50, updatedAt: 100, ...extra });
const input = (extra: Partial<AttentionInput> = {}): AttentionInput => ({ sessions: [session()], runs: [], roster: [], goals: [], ...extra });
const from = (source: AttentionSource, data: AttentionInput): AttentionItem => {
  const item = selectAttention(data).find(item => item.source === source);
  if (!item) throw Error(`Missing ${source} fixture`);
  return item;
};
const callbacks = (): AttentionCallbacks => ({ approval: vi.fn(), question: vi.fn(), questionInteraction: vi.fn(),
  repair: vi.fn(async () => {}), resume: vi.fn(), resumeAtReset: vi.fn(), retryDelivery: vi.fn(),
  continueManager: vi.fn(async () => {}), inspect: vi.fn() });
const permissionInput = () => input({ sessions: [session("lead", { blocks: [turn("lead-turn"), approval()] })] });
const questionInput = () => input({ sessions: [session("lead", { pendingQuestion: question })] });
const storageInput = () => input({ sessions: [session("lead", { codexStorageError: "Storage conflict", providerAccountId: "account" })] });
const deliveryInput = (extra: Partial<Session> = {}) => input({ sessions: [session("lead", { queueStatus: "paused",
  queuedMessages: [{ id: "message", text: "Keep this message", attachments: [], error: "Delivery failed" }], ...extra })] });
const continuationInput = () => input({ sessions: [session()], roster: [mono("manager", { role: "manager", sessionId: "lead" })],
  runs: [run({ projectManager: true, status: "paused", error: "Inspect before continuing", tasks: [] })] });
const repair = (extra: Partial<TrackedCiRepair> = {}): TrackedCiRepair => ({ id: "repair", sessionId: "lead", cwd: "/repo",
  repo: "owner/repo", number: 7, headOid: "checked-head", checks: [{ name: "Tests", workflow: "Build", url: null }],
  startedAt: 100, phase: "failed", goalId: "goal", managerId: "engine", ...extra });
const automation = (extra: Partial<Automation> = {}): Automation => ({ id: "automation", name: "Nightly checks", prompt: "Check", harness: "codex",
  model: "test", cwd: "/repo", workspaceMode: "current", reuseSession: false, runtimeMode: "supervised", triggerKind: "time", triggerEvent: "",
  scheduleKind: "daily", minute: 0, time: "12:00", dayOfWeek: 0, missedRunGraceMinutes: 0, enabled: true, nextRunAt: 1000,
  lastRunAt: 100, lastRunStatus: "failed", lastRunError: "Launch failed", lastSessionId: "automation-session", createdAt: 10, updatedAt: 100, ...extra });

describe("attention projection", () => {
  it("deduplicates shared requests by exact session identity while retaining all linked goals", () => {
    const lead = session("lead", { blocks: [turn("lead-turn"), approval()] });
    const data = input({ sessions: [lead, lead], roster: [mono("manager", { role: "manager", sessionId: "lead" })],
      runs: [run({ tasks: [] })], goals: [goal(), goal("second")] });
    const permissions = selectAttention(data).filter(item => item.source === "approval");
    expect(permissions).toHaveLength(1);
    expect(permissions[0].goals).toEqual(["goal", "second"]);
    expect(selectAttention({ ...data, sessions: [...data.sessions].reverse(), goals: [...data.goals].reverse() })[0].id).toBe(permissions[0].id);
  });

  it("does not collide equal provider request IDs across sessions or provider sessions", () => {
    const first = session("first", { blocks: [turn("first-turn"), approval()] });
    const second = session("second", { blocks: [turn("second-turn"), approval()], providerSessionId: first.providerSessionId });
    const rows = selectAttention(input({ sessions: [first, second] }));
    expect(new Set(rows.map(item => item.id)).size).toBe(2);
    const switched = from("approval", input({ sessions: [{ ...first, providerSessionId: "replacement-provider" }] }));
    expect(switched.id).not.toBe(rows.find(item => item.sessionId === "first")!.id);
  });

  it.each(["run", "session", "roster", "orphan"] as const)("routes a worker request to its lead using %s ownership", source => {
    const worker = session("worker", { blocks: [turn("worker-turn"), approval()], pendingQuestion: question,
      ...(source === "session" ? { orchestrationLeadId: "engine" } : {}) });
    const data = input({ sessions: [worker], runs: source === "run" ? [run()] : [], roster: source === "roster" || source === "orphan"
      ? [mono("member", { role: "member", sessionId: "worker", reportsTo: "manager" }),
        ...(source === "roster" ? [mono("manager", { role: "manager", sessionId: "lead" })] : [])] : [] });
    const requests = selectAttention(data).filter(item => item.source === "approval" || item.source === "question");
    expect(requests).toHaveLength(2);
    expect(requests.every(item => item.route === "lead")).toBe(true);
    expect(requests[0].leadId).toBe(source === "roster" ? "lead" : source === "orphan" ? undefined : "engine");
  });

  it("recognizes historical dispatch ownership even after the task has a replacement session", () => {
    const data = input({ sessions: [session("old-worker", { pendingQuestion: question })],
      runs: [run({ tasks: [task({ sessionId: "new-worker" })], dispatches: [dispatch({ sessionId: "old-worker" })] })] });
    expect(from("question", data)).toMatchObject({ route: "lead", leadId: "engine" });
  });

  it("rechecks lead ownership when a previously user-owned request becomes a worker request", async () => {
    const before = permissionInput(), item = from("approval", before), calls = callbacks();
    const after = { ...before, sessions: [{ ...before.sessions[0], orchestrationLeadId: "engine" }] };
    await expect(executeAttentionAction(item, "allow", after, calls)).rejects.toThrow("belongs to the lead");
    expect(calls.approval).not.toHaveBeenCalled();
  });

  it("shows escalation as the lead's distinct user request without granting the worker authority", () => {
    const data = input({ sessions: [session("worker", { orchestrationLeadId: "engine", pendingQuestion: question }),
      session("lead", { pendingQuestion: { ...question, title: "User authority needed" } })], runs: [run()] });
    const requests = selectAttention(data).filter(item => item.source === "question");
    expect(requests.find(item => item.sessionId === "worker")?.route).toBe("lead");
    expect(requests.find(item => item.sessionId === "lead")?.route).toBe("user");
    expect(new Set(requests.map(item => item.id)).size).toBe(2);
  });

  it("groups storage by original account, retains affected conversations and separates other accounts", () => {
    const data = input({ sessions: [session("first", { providerAccountId: "new-account", codexStorageAccountId: "original", codexStorageError: "Conflict" }),
      session("second", { providerAccountId: "original", codexStorageError: "Conflict" }),
      session("third", { providerAccountId: "other", codexStorageError: "Other conflict" })] });
    const rows = selectAttention(data).filter(item => item.source === "storage");
    expect(rows).toHaveLength(2);
    expect(rows.find(item => item.sessionId === "first")?.sessionIds).toEqual(["first", "second"]);
  });

  it("marks requests from removed working copies stale and settled approvals resolved", () => {
    const data = input({ sessions: [session("lead", { worktreeRemoved: true, pendingQuestion: question,
      blocks: [turn("lead-turn"), approval(), approval({ id: "settled", approval: { requestId: 9, decided: "deny" } })] })] });
    expect(selectAttention(data).filter(item => item.status === "stale").map(item => item.source).sort()).toEqual(["approval", "question"]);
    expect(selectAttention(data).find(item => item.status === "resolved")).toMatchObject({ requestId: 9, state: { status: "done", detail: "deny" } });
  });

  it("does not resurrect an error from a preceding turn after a retry starts", () => {
    const data = input({ sessions: [session("lead", { blocks: [turn("old-turn"), { id: "old-error", role: "system", text: "Previous failure", notice: "error" }, turn("retry-turn", 200)] })] });
    expect(selectAttention(data).filter(item => item.source === "error")).toEqual([]);
    expect(from("error", input({ sessions: [session("lead", { blocks: [turn("lead-turn"), { id: "error", role: "system", text: "Current failure", notice: "error" }] })] })).detail).toBe("Current failure");
  });

  it("binds task failure to the exact failed attempt and keeps cleanup and CI failures visible", () => {
    const data = input({ runs: [run()] });
    const failed = from("task", data);
    expect(failed).toMatchObject({ route: "lead", leadId: "engine", taskId: "task", dispatchId: "attempt", sessionId: "worker", detail: "Build failed" });
    expect(from("task", input({ runs: [run({ tasks: [task({ lastDispatchId: "retry" })], dispatches: [dispatch(), dispatch({ id: "retry" })] })] })).id).not.toBe(failed.id);
    expect(from("task", input({ runs: [run({ tasks: [task({ status: "completed", error: undefined })], dispatches: [dispatch({ cleanupError: "Cleanup failed" })] })] })).detail).toBe("Cleanup failed");
    expect(from("task", input({ runs: [run({ tasks: [task({ status: "completed", error: undefined,
      delivery: { head: "head", ci: "fail", conflicts: false, state: "fixing-ci" } })] })] })).category).toBe("failure");
  });

  it("retains saved failed dispatch history after the task starts its next attempt", () => {
    const data = input({ runs: [run({ tasks: [task({ status: "running", error: undefined, activeDispatchId: "retry", lastDispatchId: "retry" })],
      dispatches: [dispatch({ error: "Previous attempt failed" }), dispatch({ id: "retry", state: "running", finishedAt: undefined })] })] });
    const attempts = selectAttention(data).filter(item => item.source === "task");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ status: "replaced", dispatchId: "attempt", detail: "Previous attempt failed", sessionId: "worker" });
  });

  it("derives CI repair failure and settled history from durable phases with exact head and goals", () => {
    const rows = selectAttention(input({ repairs: [repair(), repair({ id: "interrupted", phase: "interrupted" }),
      repair({ id: "completed", phase: "completed" }), repair({ id: "not-needed", phase: "not-needed" }),
      repair({ id: "cancelled", phase: "cancelled" }), repair({ id: "running", phase: "running" })], goals: [goal()] }));
    const repairs = rows.filter(item => item.source === "ci-repair");
    expect(repairs).toHaveLength(5);
    expect(repairs.filter(item => item.status === "open")).toHaveLength(2);
    expect(repairs.filter(item => item.status === "resolved")).toHaveLength(3);
    expect(repairs[0]).toMatchObject({ sessionId: "lead", leadId: "engine", route: "lead", goals: ["goal"] });
    expect(repairs[0].detail).toContain("checked-head");
    expect(repairs[0].detail).toContain("Build");
    expect(new Set(repairs.map(item => item.id)).size).toBe(5);
  });

  it("shows automation failures without inventing a session and replaces distinct run identities", () => {
    const rows = selectAttention(input({ automations: [automation(), automation({ id: "no-session", lastSessionId: undefined }),
      automation({ id: "successful", lastRunStatus: "succeeded" })] })).filter(item => item.source === "automation");
    expect(rows).toHaveLength(2);
    expect(rows.find(item => item.automationId === "no-session")).toMatchObject({ sessionId: "", sessionIds: [], detail: "Launch failed" });
    expect(from("automation", input({ automations: [automation({ lastRunAt: 200 })] })).id).not.toBe(from("automation", input({ automations: [automation()] })).id);
  });

  it("separates remote storage issues from a matching local account's repair group", () => {
    const data = input({ sessions: [session("local", { codexStorageError: "Local conflict", providerAccountId: "account" }),
      session("remote", { codexStorageError: "Remote conflict", providerAccountId: "account" })], isLocalSession: session => session.id !== "remote" });
    const rows = selectAttention(data).filter(item => item.source === "storage");
    expect(rows).toHaveLength(2);
    expect(rows.find(item => item.sessionId === "local")?.sessionIds).toEqual(["local"]);
    expect(rows.find(item => item.sessionId === "remote")).toMatchObject({ repairable: false, sessionIds: ["remote"] });
  });

  it("deduplicates retained delivery identities while showing app event failures", () => {
    const message = { id: "message", text: "Retained report", attachments: [], error: "Cannot deliver" };
    const rows = selectAttention(input({ sessions: [session("lead", { queuedMessages: [message], pendingMonoEvents: [message,
      { ...message, id: "event", monoSessionCompletion: { sessionId: "worker", title: "Report", status: "failed" } }] })] }));
    expect(rows.filter(item => item.source === "delivery").map(item => item.messageId).sort()).toEqual(["event", "message"]);
  });

  it("prioritizes blockers, then known age, and excludes Inbox side questions", () => {
    const data = input({ sessions: [session("old", { blocks: [turn("old-turn", 10), approval({ sentAt: 10 })] }),
      session("usage", { usageLimit: {}, blocks: [turn("usage-turn", 200)] }),
      session("inbox", { inboxAsk: { key: "item", title: "Issue", url: "https://example.invalid/issue", provider: "github" }, pendingQuestion: question })] });
    expect(selectAttention(data).map(item => item.source)).toEqual(["usage", "approval"]);
  });
});

describe("attention actions", () => {
  it.each(["allow", "deny"] as const)("uses the existing %s callback for the exact request", async action => {
    const data = permissionInput(), calls = callbacks();
    await executeAttentionAction(from("approval", data), action, data, calls);
    expect(calls.approval).toHaveBeenCalledExactlyOnceWith("lead", 7, action);
  });

  it.each(["allow", "deny", "answer"] as const)("refuses direct worker %s actions", async action => {
    const data = input({ sessions: [session("worker", { orchestrationLeadId: "engine", pendingQuestion: question,
      blocks: [turn("worker-turn"), approval()] })] }), calls = callbacks();
    await expect(executeAttentionAction(from(action === "answer" ? "question" : "approval", data), action, data, calls,
      { reply: { kind: "skipped" } })).rejects.toThrow("belongs to the lead");
    expect(calls.approval).not.toHaveBeenCalled();
    expect(calls.question).not.toHaveBeenCalled();
  });

  it("preserves structured option IDs, custom answers and skip replies", async () => {
    const data = questionInput(), calls = callbacks(), item = from("question", data);
    const reply: UserQuestionReply = { kind: "answered", answers: { release: ["stable", "__custom__"] }, custom: { release: "Canary" } };
    await executeAttentionAction(item, "answer", data, calls, { reply });
    expect(calls.question).toHaveBeenCalledExactlyOnceWith("lead", 8, reply);
    await executeAttentionAction(item, "answer", data, calls, { reply: { kind: "skipped" } });
    expect(calls.question).toHaveBeenLastCalledWith("lead", 8, { kind: "skipped" });
    expect(item.question).toBe(question);
  });

  it.each(["text", "detail", "provider", "removed", "missing", "settled"] as const)("rejects a stale approval after %s changes", async change => {
    const before = permissionInput(), item = from("approval", before), calls = callbacks(), original = before.sessions[0];
    const changed = change === "text" ? { ...original, blocks: [turn("lead-turn"), approval({ text: "Different command" })] }
      : change === "detail" ? { ...original, blocks: [turn("lead-turn"), approval({ tool: { title: "Run tests", detail: "A different command" } })] }
      : change === "provider" ? { ...original, providerSessionId: "new-provider" }
      : change === "removed" ? { ...original, worktreeRemoved: true }
      : change === "settled" ? { ...original, blocks: [turn("lead-turn"), approval({ approval: { requestId: 7, decided: "allow" } })] }
      : undefined;
    await expect(executeAttentionAction(item, "allow", { ...before, sessions: changed ? [changed] : [] }, calls)).rejects.toThrow(/changed|unavailable/);
    expect(calls.approval).not.toHaveBeenCalled();
  });

  it("rejects changed question content and a replacement turn even when request ID is reused", async () => {
    const before = questionInput(), item = from("question", before), calls = callbacks();
    for (const changed of [session("lead", { pendingQuestion: { ...question, questions: [{ ...question.questions[0], prompt: "A different question" }] } }),
      session("lead", { pendingQuestion: question, blocks: [turn("replacement-turn")] })]) {
      await expect(executeAttentionAction(item, "answer", { ...before, sessions: [changed] }, calls, { reply: { kind: "skipped" } })).rejects.toThrow("changed");
    }
    expect(calls.question).not.toHaveBeenCalled();
  });

  it("rejects changed storage membership when equal errors would hide a replacement target", async () => {
    const blocked = (id: string) => session(id, { providerAccountId: "account", codexStorageError: "Same conflict" });
    const before = input({ sessions: [blocked("old"), blocked("shared")] }), item = from("storage", before), calls = callbacks();
    const after = input({ sessions: [session("old", { providerAccountId: "account" }), blocked("replacement"), blocked("shared")] });
    await expect(executeAttentionAction(item, "repair", after, calls)).rejects.toThrow(/changed|unavailable/);
    expect(calls.repair).not.toHaveBeenCalled();
  });

  it("propagates failed repair without dropping its version choice", async () => {
    const data = storageInput(), calls = callbacks();
    vi.mocked(calls.repair).mockRejectedValueOnce(Error("File remains busy"));
    await expect(executeAttentionAction(from("storage", data), "repair", data, calls, { resolution: "keep_mono_version" })).rejects.toThrow("File remains busy");
    expect(calls.repair).toHaveBeenCalledExactlyOnceWith("lead", "keep_mono_version");
  });

  it.each(["repair", "compare", "reveal"] as const)("refuses local storage %s for a remote host", async action => {
    const data = { ...storageInput(), isLocalSession: () => false }, item = from("storage", data), calls = callbacks();
    calls.compare = vi.fn(async () => ({ sourceContent: "source", monoContent: "mono", truncated: false }));
    calls.reveal = vi.fn(async () => {});
    await expect(executeAttentionAction(item, action, data, calls)).rejects.toThrow(/local|remote|unavailable/);
    expect(calls.repair).not.toHaveBeenCalled();
    expect(calls.compare).not.toHaveBeenCalled();
    expect(calls.reveal).not.toHaveBeenCalled();
  });

  it.each(["busy", "preparing"] as const)("does not retry storage while %s", async state => {
    const data = storageInput(), item = from("storage", data), calls = callbacks();
    const after = { ...data, sessions: [{ ...data.sessions[0], ...(state === "busy" ? { busy: true } : { codexStoragePreparing: true }) }] };
    await expect(executeAttentionAction(item, "repair", after, calls)).rejects.toThrow("Wait");
    expect(calls.repair).not.toHaveBeenCalled();
  });

  it("retries the retained head delivery through the original callback and propagates failure", async () => {
    const data = deliveryInput(), calls = callbacks(), item = from("delivery", data);
    vi.mocked(calls.retryDelivery).mockRejectedValueOnce(Error("Retry failed"));
    await expect(executeAttentionAction(item, "retry-delivery", data, calls)).rejects.toThrow("Retry failed");
    expect(calls.retryDelivery).toHaveBeenCalledExactlyOnceWith("lead");
    expect(data.sessions[0].queuedMessages?.[0].id).toBe("message");
  });

  it.each(["head", "active", "storage", "usage", "sending", "editing", "event"] as const)("refuses unsafe delivery retry: %s", async blocker => {
    const data = deliveryInput(), item = from("delivery", data), calls = callbacks(), original = data.sessions[0];
    const extras: Partial<Session> = blocker === "head" ? { queuedMessages: [{ id: "first", text: "First", attachments: [] }, ...original.queuedMessages!] }
      : blocker === "active" ? { queueStatus: "active" }
      : blocker === "storage" ? { codexStorageError: "Storage blocked" }
      : blocker === "usage" ? { usageLimit: {} }
      : blocker === "sending" ? { sendingQueuedMessageId: "message" }
      : blocker === "editing" ? { editingQueuedMessageId: "message" }
      : { queuedMessages: [], pendingMonoEvents: original.queuedMessages };
    await expect(executeAttentionAction(item, "retry-delivery", { ...data, sessions: [{ ...original, ...extras }] }, calls)).rejects.toThrow(/review|Wait/);
    expect(calls.retryDelivery).not.toHaveBeenCalled();
  });

  it("resumes usage only through the existing callbacks and propagates recovery failure", async () => {
    const data = input({ sessions: [session("lead", { usageLimit: { resetsAt: 1000 } })] }), item = from("usage", data), calls = callbacks();
    await executeAttentionAction(item, "resume-at-reset", data, calls, { enabled: false });
    expect(calls.resumeAtReset).toHaveBeenCalledExactlyOnceWith("lead", false);
    vi.mocked(calls.resume).mockRejectedValueOnce(Error("Provider still exhausted"));
    await expect(executeAttentionAction(item, "resume", data, calls)).rejects.toThrow("Provider still exhausted");
    await expect(executeAttentionAction(item, "resume", { ...data, sessions: [{ ...data.sessions[0], codexStorageError: "Storage blocked" }] }, calls)).rejects.toThrow("storage");
    expect(calls.resume).toHaveBeenCalledTimes(1);
  });

  it("propagates Manager continuation and exact-conversation navigation failures", async () => {
    const data = continuationInput(), item = from("continue", data), calls = callbacks();
    expect(item.route).toBe("user");
    vi.mocked(calls.continueManager).mockRejectedValueOnce(Error("Manager cannot continue"));
    await expect(executeAttentionAction(item, "continue", data, calls)).rejects.toThrow("Manager cannot continue");
    expect(calls.continueManager).toHaveBeenCalledExactlyOnceWith("engine");
    vi.mocked(calls.inspect).mockRejectedValueOnce(Error("Conversation cannot open"));
    await expect(executeAttentionAction(item, "inspect", input({ sessions: [] }), calls)).rejects.toThrow("Conversation cannot open");
    expect(calls.inspect).toHaveBeenCalledExactlyOnceWith("lead");
  });

  it("preserves the worker session identity for existing lead navigation instead of inventing a retry", async () => {
    const data = input({ runs: [run()] }), item = from("task", data), calls = callbacks();
    await executeAttentionAction(item, "inspect", data, calls);
    expect(calls.inspect).toHaveBeenCalledExactlyOnceWith("worker");
    expect(calls.retryDelivery).not.toHaveBeenCalled();
    expect(calls.continueManager).not.toHaveBeenCalled();
  });

  it("inspects failed CI repairs through their existing session without launching another repair", async () => {
    const data = input({ repairs: [repair()] }), item = from("ci-repair", data), calls = callbacks();
    await executeAttentionAction(item, "inspect", data, calls);
    expect(calls.inspect).toHaveBeenCalledExactlyOnceWith("lead");
    await expect(executeAttentionAction(item, "retry-delivery", data, calls)).rejects.toThrow("review");
    expect(calls.retryDelivery).not.toHaveBeenCalled();
    expect(calls.repair).not.toHaveBeenCalled();
  });

  it("opens the exact automation with an existing adapter and retains navigation errors", async () => {
    const data = input({ automations: [automation({ lastSessionId: undefined })] }), item = from("automation", data), calls = callbacks();
    calls.inspectAutomation = vi.fn(async () => {});
    await executeAttentionAction(item, "inspect", data, calls);
    expect(calls.inspectAutomation).toHaveBeenCalledExactlyOnceWith("automation");
    expect(calls.inspect).not.toHaveBeenCalled();
    vi.mocked(calls.inspectAutomation).mockRejectedValueOnce(Error("Automation view unavailable"));
    await expect(executeAttentionAction(item, "inspect", data, calls)).rejects.toThrow("Automation view unavailable");
    await expect(executeAttentionAction(item, "inspect", data, callbacks())).rejects.toThrow("Conversation unavailable");
  });

  it("does not send an action to a different source or a question without a reply", async () => {
    const data = questionInput(), item = from("question", data), calls = callbacks();
    await expect(executeAttentionAction(item, "allow", data, calls)).rejects.toThrow("Approval unavailable");
    await expect(executeAttentionAction(item, "answer", data, calls)).rejects.toThrow("Answer unavailable");
    expect(calls.approval).not.toHaveBeenCalled();
    expect(calls.question).not.toHaveBeenCalled();
  });
});

describe("attention history", () => {
  it("keeps missing or errored requests stale and identifies a replacement without guessing resolution", () => {
    const old = from("question", questionInput());
    expect(attentionHistory([old], [], {} )[0].status).toBe("stale");
    expect(attentionHistory([old], [], { [old.id]: { status: "error", message: "Failed" } })[0].status).toBe("stale");
    const replacement = from("question", input({ sessions: [session("lead", { pendingQuestion: { ...question, requestId: 9 } })] }));
    expect(attentionHistory([old], [replacement], { [old.id]: { status: "sent", message: "Sent" } })[0].status).toBe("replaced");
  });

  it.each(["question", "storage", "usage", "continue"] as const)("resolves acknowledged %s only after the source leaves the queue", source => {
    const data = source === "question" ? questionInput() : source === "storage" ? storageInput() : source === "continue" ? continuationInput()
      : input({ sessions: [session("lead", { usageLimit: {} })] });
    const item = from(source, data), receipt = { [item.id]: { status: "sent" as const, message: "Sent" } };
    const cleared = { ...data, sessions: data.sessions.map(session => ({ ...session, pendingQuestion: undefined,
      codexStorageError: undefined, usageLimit: undefined })), runs: data.runs.map(run => ({ ...run, status: "active" as const })) };
    expect(attentionHistory([item], [item], receipt)).toEqual([]);
    expect(attentionHistory([item], [], receipt, cleared)[0].status).toBe("resolved");
    expect(attentionHistory([item], [], receipt)[0].status).toBe("stale");
  });

  it.each(["question", "usage"] as const)("does not resolve missing or replaced-provider %s sources from a sent receipt", source => {
    const before = source === "question" ? questionInput() : input({ sessions: [session("lead", { usageLimit: {} })] });
    const item = from(source, before), receipts = { [item.id]: { status: "sent" as const, message: "Sent" } };
    for (const after of [input({ sessions: [] }), input({ sessions: [session("lead", { providerSessionId: "replacement-provider" })] })]) {
      expect(attentionHistory([item], [], receipts, after)[0].status).toBe("stale");
    }
  });

  it("does not resolve a storage group while one conversation remains blocked or its preparation is pending", () => {
    const before = input({ sessions: [session("first", { providerAccountId: "account", codexStorageError: "Conflict" }),
      session("second", { providerAccountId: "account", codexStorageError: "Conflict" })] });
    const item = from("storage", before), receipts = { [item.id]: { status: "sent" as const, message: "Sent" } };
    for (const second of [before.sessions[1], session("second", { codexStoragePreparing: true })]) {
      expect(attentionHistory([item], [], receipts, { ...before, sessions: [session("first"), second] })[0].status).toBe("stale");
    }
  });

  it("retains a replaced request's evidence when the stable identity stays the same but its revision changes", () => {
    const before = permissionInput(), old = from("approval", before);
    const changed = from("approval", input({ sessions: [session("lead", { blocks: [turn("lead-turn"), approval({ text: "New operation" })] })] }));
    expect(changed.id).toBe(old.id);
    expect(changed.revision).not.toBe(old.revision);
    const history = attentionHistory([old], [changed], {});
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "replaced", detail: old.detail, revision: old.revision });
  });

  it("does not use another revision's receipt to confirm a cleared question", () => {
    const data = questionInput(), item = from("question", data);
    const receipts = { [item.id]: { status: "sent" as const, message: "Sent", revision: "older-revision" } };
    expect(attentionHistory([item], [], receipts, input())[0].status).toBe("stale");
  });

  it("preserves acknowledged submission after a later failed inspection without bypassing revision matching", () => {
    const item = from("question", questionInput());
    const receipt = { status: "error" as const, message: "Inspection failed", submitted: true, revision: item.revision };
    expect(attentionHistory([item], [], { [item.id]: receipt }, input())[0].status).toBe("resolved");
    expect(attentionHistory([item], [], { [item.id]: { ...receipt, revision: "other-revision" } }, input())[0].status).toBe("stale");
  });

  it("does not mistake an accepted delivery retry or inspection for confirmed resolution", () => {
    const delivery = from("delivery", deliveryInput()), failure = from("task", input({ runs: [run()] }));
    for (const item of [delivery, failure]) {
      expect(attentionHistory([item], [], { [item.id]: { status: "sent", message: "Request accepted" } })[0].status).toBe("stale");
    }
  });

  it("preserves settled approvals in history and never duplicates current source history", () => {
    const settled = from("approval", input({ sessions: [session("lead", { blocks: [turn("lead-turn"), approval({ approval: { requestId: 7, decided: "cancelled" } })] })] }));
    expect(attentionHistory([settled], [], {})[0]).toBe(settled);
    expect(attentionHistory([settled], [settled], {})).toEqual([]);
  });
});
