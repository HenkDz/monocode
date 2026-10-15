import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import { canDispatchQueuedHead } from "../../sessions/model/messageQueue";
import { newSession, type Session } from "../../sessions/model/session";
import { pendingHandoff, consumeHandoff, wrapHandoffPrompt } from "../../sessions/model/handoff";
import { parseClaudeOAuthUsage } from "../../providers/model/rateLimits";
import { MANUAL_USAGE_FAILOVER, type UsageFailoverCandidate } from "../../providers/model/usageFailover";
import { createMonoUsageFailoverController, type MonoUsageFailoverHost } from "./monoUsageFailover";
import { assertManagerDelivery, managerRequestBinding, type ManagerRequestRecovery } from "./managerAuthorizedWork";
import type { Mono } from "./mono";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const { sanitizeSessionForPersist, readPersistedSession } = await import("../../sessions/data/sessionStore");
const now = 1_800_000_000_000;
function available(): UsageFailoverCandidate {
  return {
    account: { id: "work", provider: "claude", label: "Work" }, identity: { name: "Synthetic" }, ready: true,
    limits: { ...parseClaudeOAuthUsage(JSON.stringify({
      five_hour: { utilization: 20, resets_at: new Date(now + 3_600_000).toISOString() },
      seven_day: { utilization: 50, resets_at: new Date(now + 86_400_000).toISOString() },
    })), updatedAt: now },
  };
}
function fixture(patch: Partial<Session> = {}) {
  let session = applyHarnessEvent({ ...newSession("claude", "/synthetic/project"),
    providerAccountId: "default", providerSessionId: "old-thread", runtimeMode: "supervised" as const,
    blocks: [{ id: "request", role: "user" as const, text: "Finish the original task. No push." }],
    ...patch }, { type: "session.error", message: "Quota exceeded" });
  let generation = 1, held = false;
  const policy = { enabled: true, rankedAccountIds: ["work"] };
  const candidates = [available()];
  const saved: Session[] = [];
  const host: MonoUsageFailoverHost = {
    session: () => session, generation: () => generation, held: () => held,
    policy: () => policy, candidates: () => candidates, now: () => now,
    commit: vi.fn(async (expected, next, validate) => {
      expect(session).toBe(expected);
      if (!validate()) return false;
      saved.push(next);
      // The real store's sanitizer is part of this boundary; no live store/profile.
      sanitizeSessionForPersist(next);
      if (!validate()) return false;
      session = next;
      return true;
    }),
  };
  return { host, saved, candidates, policy, current: () => session,
    setSession: (next: Session) => { session = next; },
    stop: () => { held = true; generation++; },
    changeGeneration: () => { generation++; } };
}
beforeEach(() => invoke.mockReset());

describe("automatic Mono usage recovery", () => {
  it("OFF preserves existing manual behavior, and a generic 401 never authorizes failover", async () => {
    const f = fixture(); f.host.policy = () => MANUAL_USAGE_FAILOVER;
    const original = f.current();
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "manual" });
    expect(f.current()).toBe(original); expect(f.host.commit).not.toHaveBeenCalled();
    f.host.policy = () => f.policy;
    f.setSession(applyHarnessEvent({ ...original, usageLimit: undefined }, { type: "session.error", message: "401 Unauthorized. Please sign in" }));
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "manual" });
    expect(f.host.commit).not.toHaveBeenCalled();
  });
  it("persists a visible same-provider handoff with a fresh thread and one continuation", async () => {
    const f = fixture(); const original = f.current();
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "switched", accountId: "work" });
    const next = f.current();
    expect(next.harness).toBe(original.harness); expect(next.model).toBe(original.model);
    expect(next.runtimeMode).toBe(original.runtimeMode); expect(next.cwd).toBe(original.cwd);
    expect(next.providerAccountId).toBe("work"); expect(next.providerSessionId).toBeUndefined();
    expect(next.pendingSwitch).toBeUndefined(); expect(next.usageLimit).toBeUndefined();
    expect(next.queuedMessages).toHaveLength(1); expect(canDispatchQueuedHead(next)).toBe(true);
    expect(pendingHandoff(next)).toMatchObject({ from: "claude", to: "claude" });
    expect(pendingHandoff(next)?.text).toContain("No push");
    expect(next.blocks.filter(block => block.id === "usage-failover-request")).toHaveLength(1);
    expect(next.blocks.find(block => block.id === "usage-failover-request")?.text).toContain("Work");
    expect(wrapHandoffPrompt(pendingHandoff(next)!.text, "claude", "Continue")).toContain("No push");
    expect(f.saved).toEqual([next]);
  });
  it("retains queued request/goal identity, constraints, attachments and exact ordering", async () => {
    const source = { id: "member", name: "Builder", mascot: "gear", color: "blue", goalId: "goal" };
    const queued = [
      { id: "first", appRequestId: "request-first", text: "Plan without edits", attachments: [], intent: "plan" as const, monoSource: source },
      { id: "second", appRequestId: "request-second", text: "Then report", attachments: [] },
    ];
    const f = fixture({ queuedMessages: queued });
    await createMonoUsageFailoverController()(f.host);
    expect(f.current().queuedMessages).toEqual(queued);
    expect(f.current().queuedMessages?.[0].monoSource).toBe(source);
    expect(f.current().queuedMessages?.[0].intent).toBe("plan");
    expect(f.current().blocks[0].text).toContain("No push");
  });
  it.each([
    { busy: true }, { compacting: true }, { pendingQuestion: {} }, { backgroundTasks: ["task"] },
    { sendingQueuedMessageId: "sending" }, { editingQueuedMessageId: "editing" },
    { pendingSwitch: { from: "claude", fromModel: "old", fromSettings: {} } },
    { codexStorageError: "blocked" }, { codexStoragePreparing: true }, { codexStorageHeld: {} },
    { codexHomeThreadsUnresolved: true }, { worktreePreparing: true }, { worktreeRemoved: true },
    { rotationWarning: "Pending carry" },
    { pendingMonoEvents: [{ id: "event", text: "New request", attachments: [] }] },
  ] as Partial<Session>[])("holds unsafe boundaries %j", async patch => {
    const f = fixture(); f.setSession({ ...f.current(), ...patch });
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
    expect(f.host.commit).not.toHaveBeenCalled();
  });
  it.each([
    { id: "approval", role: "tool", text: "Run", approval: { requestId: 1 } },
    { id: "tool", role: "tool", text: "Run", tool: { status: "running" } },
    { id: "tool", role: "tool", text: "Run", tool: { status: "in_progress" } },
    { id: "tool", role: "tool", text: "Run", tool: { title: "Unknown current tool" } },
    { id: "tool", role: "tool", text: "Run", tool: { background: true } },
    { id: "stream", role: "assistant", text: "Working", streaming: true },
  ] as Session["blocks"])("respects approvals and live tool/stream activity %j", async block => {
    const f = fixture(); f.setSession({ ...f.current(), blocks: [...f.current().blocks, block] });
    expect((await createMonoUsageFailoverController()(f.host)).kind).toBe("pause-and-ask");
    expect(f.host.commit).not.toHaveBeenCalled();
  });
  it("pauses when none qualifies, without mutating or resuming the outbox", async () => {
    const f = fixture(); f.candidates[0].limits!.weekly!.usedPercent = 100;
    const original = f.current();
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "no-eligible-account" });
    expect(f.current()).toBe(original); expect(canDispatchQueuedHead(f.current())).toBe(false);
  });
  it.each(["pending", "continued"] as const)("holds %s Manager authority and preserves delivery on the original account", async state => {
    const f = fixture(); const original = f.current();
    const manager: Mono = { id: "manager", sessionId: original.id, role: "manager", projects: [original.cwd], mascot: "cat", color: "blue" };
    const request: ManagerRequestRecovery = { monoId: manager.id, sessionId: original.id, managerId: "engine", projectId: original.cwd,
      userMessageId: "request", providerAccountId: original.providerAccountId, binding: managerRequestBinding(original), state: "pending" };
    const source = { id: manager.id, name: "Manager", mascot: manager.mascot, color: manager.color, goalId: "goal", request };
    const receiptId = "mono-goal-manager-continue-request";
    f.setSession({ ...original, blocks: [...original.blocks,
      { id: "manager-request-request", role: "system", text: "Continue this request", managerRequestRecovery: { ...request, state } }] });
    const held = f.current();
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
    expect(f.current()).toBe(held); expect(f.host.commit).not.toHaveBeenCalled();
    // The user resumes the original account; its retained grant still validates.
    const resumed: Session = { ...f.current(), usageLimit: undefined, queueStatus: "active", queuedMessages: [],
      blocks: [...held.blocks, { id: "continued", role: "user", text: "Continue", appRequestId: receiptId, monoSource: source }] };
    expect(() => assertManagerDelivery(source, receiptId, resumed, manager)).not.toThrow();
    expect(() => assertManagerDelivery(source, receiptId, { ...resumed, providerAccountId: "work" }, manager)).toThrow("changed or is held");
  });
  it.each(["request", "id", "appRequestId", "wake"])("holds queued Manager %s even without a loaded recovery card", async authority => {
    const f = fixture();
    const message = { id: "queued", text: "Continue", attachments: [] } as NonNullable<Session["queuedMessages"]>[number];
    if (authority === "request") message.monoSource = { id: "manager", name: "Manager", mascot: "cat", color: "blue", goalId: "goal",
      request: { monoId: "manager", sessionId: f.current().id, managerId: "engine", projectId: f.current().cwd, userMessageId: "request", state: "pending" } };
    if (authority === "id") message.id = "mono-goal-manager-continue-request";
    if (authority === "appRequestId") message.appRequestId = "mono-goal-manager-continue-request";
    if (authority === "wake") message.managerWake = { leadId: "engine", receiptId: message.id };
    f.setSession({ ...f.current(), queueStatus: "paused", queuedMessages: [message] }); const original = f.current();
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
    expect(f.current()).toBe(original); expect(f.host.commit).not.toHaveBeenCalled();
  });
  it.each(["request", "id", "appRequestId", "digest", "legacy-digest"])("holds committed Manager %s when the recovery card is outside the loaded window", async authority => {
    const f = fixture();
    const turn = { ...f.current().blocks[0] };
    if (authority === "request") turn.monoSource = { id: "manager", name: "Manager", mascot: "cat", color: "blue", goalId: "goal",
      request: { monoId: "manager", sessionId: f.current().id, managerId: "engine", projectId: f.current().cwd, userMessageId: "request", state: "pending" } };
    if (authority === "id") turn.id = "mono-goal-manager-continue-request";
    if (authority === "appRequestId") turn.appRequestId = "mono-goal-manager-continue-request";
    if (authority === "digest") { turn.internal = true; turn.appRequestId = "manager-digest-synthetic"; }
    if (authority === "legacy-digest") { turn.internal = true; turn.appRequestId = "manager-digest:00000000-0000-0000-0000-000000000001"; }
    f.setSession({ ...f.current(), blocks: [turn] });
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
    expect(f.host.commit).not.toHaveBeenCalled();
  });
  it("does not hold an unrelated cancelled Manager recovery card", async () => {
    const f = fixture();
    f.setSession({ ...f.current(), blocks: [...f.current().blocks, { id: "manager-request-old", role: "system", text: "Cancelled",
      managerRequestRecovery: { monoId: "manager", sessionId: f.current().id, managerId: "engine", projectId: f.current().cwd, userMessageId: "old", state: "cancelled" } }] });
    expect((await createMonoUsageFailoverController()(f.host)).kind).toBe("switched");
  });
  it("respects resume-at-reset across later telemetry polls and controller recreation until a deliberate user change", async () => {
    const f = fixture(); const run = createMonoUsageFailoverController();
    f.candidates[0].ready = false;
    expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "no-eligible-account" });
    f.setSession({ ...f.current(), usageLimit: { resetsAt: now + 60_000, resumeAtReset: true } });
    const waiting = f.current(); f.candidates[0].ready = true;
    for (const clock of [now + 1_000, now + 61_000]) {
      f.host.now = () => clock;
      expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
      expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
    }
    expect(f.current()).toBe(waiting); expect(f.host.commit).not.toHaveBeenCalled();
    f.setSession({ ...waiting, usageLimit: { ...waiting.usageLimit, resumeAtReset: false } });
    expect((await run(f.host)).kind).toBe("switched");
  });
  it("holds an armed reset choice while its reset is unknown, then leaves reset resume to its existing owner", async () => {
    const f = fixture(); const run = createMonoUsageFailoverController();
    f.setSession({ ...f.current(), usageLimit: { resumeAtReset: true } });
    expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "held" });
    f.setSession({ ...f.current(), usageLimit: undefined });
    expect(await run(f.host)).toEqual({ kind: "manual" });
    expect(f.host.commit).not.toHaveBeenCalled();
  });
  it("does not retry a failed save/rejected switch on each poll", async () => {
    const f = fixture(); const original = f.current();
    f.host.commit = vi.fn(async () => { throw Error("disk full"); });
    const run = createMonoUsageFailoverController();
    expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
    expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "already-attempted" });
    expect(f.current()).toBe(original); expect(f.host.commit).toHaveBeenCalledTimes(1);
  });
  it("holds a rejected CAS without dispatch or repeated switch attempts", async () => {
    const f = fixture(); const original = f.current();
    f.host.commit = vi.fn(async () => false);
    const run = createMonoUsageFailoverController();
    expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
    expect(await run(f.host)).toEqual({ kind: "pause-and-ask", reason: "already-attempted" });
    expect(f.current()).toBe(original); expect(canDispatchQueuedHead(f.current())).toBe(false);
  });
  it("allows completed current tools and historical tools without status", async () => {
    const f = fixture(); const original = f.current();
    f.setSession({ ...original, blocks: [
      { id: "historical", role: "tool", text: "Old", tool: { title: "Legacy tool" } },
      ...original.blocks,
      { id: "done", role: "tool", text: "Done", tool: { status: "completed" } },
    ] });
    expect((await createMonoUsageFailoverController()(f.host)).kind).toBe("switched");
  });
  it.each(["stop", "generation", "policy", "telemetry", "session"])("revalidates %s after the durable await before publication", async change => {
    const f = fixture(); const original = f.current();
    f.host.commit = vi.fn(async (_expected, next, validate) => {
      expect(validate()).toBe(true); sanitizeSessionForPersist(next);
      await Promise.resolve();
      if (change === "stop") f.stop();
      if (change === "generation") f.changeGeneration();
      if (change === "policy") f.policy.enabled = false;
      if (change === "telemetry") f.candidates[0].ready = false;
      if (change === "session") f.setSession({ ...f.current(), title: "Edited" });
      expect(validate()).toBe(false); return false;
    });
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "save-rejected" });
    expect(f.current().providerAccountId).toBe(original.providerAccountId);
    expect(canDispatchQueuedHead(f.current())).toBe(false);
  });
  it("deduplicates concurrent calls while allowing simultaneous independent Monos", async () => {
    const a = fixture(), b = fixture(); b.setSession({ ...b.current(), id: "second-mono" });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const originalCommit = a.host.commit;
    a.host.commit = async (...args) => { await gate; return originalCommit(...args); };
    const run = createMonoUsageFailoverController(); const pending = run(a.host);
    expect(await run(a.host)).toEqual({ kind: "pause-and-ask", reason: "already-attempted" });
    expect((await run(b.host)).kind).toBe("switched");
    release(); expect((await pending).kind).toBe("switched");
    expect(a.current().id).not.toBe(b.current().id);
  });
  it("retains a ready handoff and paused exact continuation through actual store normalization/reload", async () => {
    const f = fixture(); await createMonoUsageFailoverController()(f.host);
    const saved = sanitizeSessionForPersist(f.current());
    expect(saved.queuedMessages).toHaveLength(1);
    invoke.mockResolvedValue(saved);
    const restored = (await readPersistedSession(saved.id))!;
    expect(restored.queueStatus).toBe("paused"); expect(canDispatchQueuedHead(restored)).toBe(false);
    expect(restored.queuedMessages).toEqual(saved.queuedMessages);
    expect(restored.providerAccountId).toBe("work"); expect(restored.providerSessionId).toBeUndefined();
    expect(pendingHandoff(restored)?.text).toContain("No push");
    const stopped = applyHarnessEvent(consumeHandoff(restored), { type: "session.error", message: "Quota exceeded" });
    f.setSession(stopped); f.policy.rankedAccountIds.push("backup");
    f.candidates.push({ ...available(), account: { id: "backup", provider: "claude", label: "Backup" } });
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "already-attempted" });
  });
  it.each([{ codexStorageHome: "/synthetic/original" }, { providerSessionIdByHome: { "/synthetic/original": "old-thread" } }])("preserves account-owned Codex homes and threads for reviewed manual transition %j", async patch => {
    const f = fixture({ harness: "codex", ...patch }); const original = f.current();
    expect(await createMonoUsageFailoverController()(f.host)).toEqual({ kind: "pause-and-ask", reason: "home-binding" });
    expect(f.current()).toBe(original); expect(f.host.commit).not.toHaveBeenCalled();
    expect(f.current().providerSessionIdByHome).toBe(original.providerSessionIdByHome);
  });
});
