import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Orchestrator,
  orchestrationPathKey,
  scopesOverlap,
  visibleUserPrompt,
  workerTurnPrompt,
  type ControlOutcome,
  type OrchestrationHost,
  type OrchestrationRun,
  shellPath,
} from "./orchestration";
import { newSession } from "../../sessions/model/session";
import type { OrchestrationProposal } from "./orchestrationPlan";
import { normalizeOrchestrationRun } from "./orchestrationState";
import { previewFromToolPart } from "../../../integrations/harness/providers/opencode/opencodeProtocol";

function setup() {
  const saved = new Map<string, OrchestrationRun>();
  const store = {
    save: vi.fn(async (run: OrchestrationRun) => {
      saved.set(run.leadId, structuredClone(run));
    }),
    load: vi.fn(async (id: string) => saved.get(id) ?? null),
    enable: vi.fn(
      async () => "/Applications/MonoCode.app/Contents/MacOS/monocode",
    ),
    disable: vi.fn(async () => {}),
    attachOwner: vi.fn(async () => {}),
    scopes: vi.fn(async (cwd: string, files: string[]) =>
      files.map((file) => (file === "." ? cwd : `${cwd}/${file}`)),
    ),
    resolvePath: vi.fn(async (path: string) => path),
  };
  const manager = new Orchestrator(store);
  const lead = { ...newSession("claude", "/repo"), id: "lead", busy: true };
  const sessions = [lead];
  const completions = new Map<string, (outcome: ControlOutcome) => void>();
  const host: OrchestrationHost = {
    session: (id) => sessions.find((session) => session.id === id),
    sessions: () => sessions,
    choices: () => [
      { harness: "codex", models: [{ id: "codex:test", name: "Test" }] },
    ],
    createWorker: vi.fn(async (run, task) => {
      sessions.push({
        ...newSession(task.harness, run.cwd),
        id: task.sessionId,
        busy: false,
      });
      return {
        scratchDir: `/private/var/folders/test/T/monocode-worker-${task.sessionId}`,
        workspace: {
          id: `checkout:/worktrees/${task.id}`,
          projectCwd: run.cwd,
          checkoutCwd: `/worktrees/${task.id}`,
          kind: "worktree" as const,
          branch: `mc/orch-${task.id}`,
        },
      };
    }),
    integrateWorker: vi.fn(async () => ({ files: [], alreadyApplied: 0 })),
    cleanupWorker: vi.fn(async () => true),
    submit: vi.fn((id, _text, done) => {
      const session = sessions.find((session) => session.id === id)!;
      session.busy = true;
      completions.set(id, (outcome) => {
        session.busy = false;
        done(outcome);
      });
    }),
    stop: vi.fn(async (id) => {
      const session = sessions.find((entry) => entry.id === id);
      if (session) session.busy = false;
    }),
    steer: vi.fn(async () => {}),
    respondApproval: vi.fn(),
    answerQuestion: vi.fn(),
  };
  manager.bind(host);
  let request = 0;
  const call = (
    action: string,
    input: Record<string, unknown> = {},
    id = `request-${++request}`,
  ) => manager.handle("lead", id, action, input);
  const start = async () => {
    lead.busy = false;
    await manager.start("lead", ["codex"], 2);
    lead.busy = true;
  };
  const delegate = (files: string[], extra = {}) =>
    call("delegate", {
      title: "Task",
      prompt: "Implement the bounded change",
      harness: "codex",
      files,
      ...extra,
    });
  const tasks = () => manager.run("lead")!.tasks;
  return {
    manager,
    store,
    host,
    lead,
    saved,
    sessions,
    start,
    call,
    delegate,
    tasks,
    completions,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function reportTaskFixture() {
  const f = setup();
  const snapshot = { head: "assignment-head", fingerprint: "baseline", clean: true, commitsAhead: 0, baseDiff: false };
  f.host.checkoutSnapshot = vi.fn(async () => ({ ...snapshot }));
  const create = f.host.createWorker;
  f.host.createWorker = vi.fn(async (run, task) => {
    const prepared = await create(run, task);
    return task.workspacePolicy === "shared" ? {
      ...prepared, workspace: { id: "checkout:/repo", projectCwd: "/repo", checkoutCwd: "/repo", kind: "main" as const },
    } : prepared;
  });
  f.manager.bind(f.host);
  const finish = async () => {
    await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
    f.completions.get(f.tasks()[0].sessionId)!({ status: "completed", text: "Investigation findings" });
    await vi.waitFor(() => expect(f.tasks()[0].status).not.toBe("running"));
  };
  return { ...f, snapshot, finish };
}

it("accepts a report-only task after checkout verification without a PR or Reviewer", async () => {
  const f = reportTaskFixture();
  f.lead.busy = false;
  await f.manager.start("lead", ["codex"], 2, undefined, true);
  await f.delegate(["."]);
  await f.finish();
  expect(f.tasks()[0].accepted).toBe(false);
  await expect(f.call("review", { taskId: f.tasks()[0].id, outcome: "accept-no-changes" })).resolves.toMatchObject({ accepted: true, completionOutcome: "no-changes" });
  expect(f.tasks()[0]).toMatchObject({ status: "completed", accepted: true, completionOutcome: "no-changes", acceptedDispatchId: f.tasks()[0].lastDispatchId });
  expect(f.host.integrateWorker).not.toHaveBeenCalled();
  expect(f.host.cleanupWorker).not.toHaveBeenCalled();
});

it.each([
  { clean: false, commitsAhead: 0, baseDiff: false },
  { clean: true, commitsAhead: 1, baseDiff: false },
  { clean: true, commitsAhead: 0, baseDiff: true },
])("rejects no-change completion for dirty files or commits (including empty/reverted commits): %j", async changed => {
  const f = reportTaskFixture();
  await f.start();
  await f.delegate(["."]);
  await f.finish();
  Object.assign(f.snapshot, changed);
  await expect(f.call("review", { taskId: f.tasks()[0].id, outcome: "accept-no-changes" })).rejects.toThrow("changes or commits");
  expect(f.tasks()[0].accepted).toBe(false);
});

it("runs read-only work in the project checkout and accepts an unchanged dirty baseline", async () => {
  const f = reportTaskFixture();
  f.snapshot.clean = false;
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await f.finish();
  expect(f.tasks()[0]).toMatchObject({ readOnly: true, workspacePolicy: "shared", workspace: { checkoutCwd: "/repo", kind: "main" }, readOnlyBaseline: { fingerprint: "baseline" } });
  expect(f.host.submit).toHaveBeenCalledWith(f.tasks()[0].sessionId, expect.stringContaining("read-only investigation"), expect.any(Function));
  await f.call("review", { taskId: f.tasks()[0].id, outcome: "accept-no-changes" });
  expect(f.tasks()[0].completionOutcome).toBe("no-changes");
});

it("flags read-only content changes as blocked even when dirty status was already present", async () => {
  const f = reportTaskFixture();
  f.snapshot.clean = false;
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
  f.snapshot.fingerprint = "new-content-at-existing-dirty-path";
  await f.finish();
  expect(f.tasks()[0]).toMatchObject({ status: "blocked", accepted: false });
  expect(f.tasks()[0].error).toContain("read-only task modified files");
  await expect(f.call("review", { taskId: f.tasks()[0].id, outcome: "accept-no-changes" })).rejects.toThrow("Only a completed result");
});

it("uses an explicit worktree fallback for a harness without enforced read-only permissions", async () => {
  const f = reportTaskFixture();
  f.host.choices = () => [{ harness: "pi", models: [{ id: "pi:test", name: "Pi" }] }];
  f.manager.bind(f.host);
  f.lead.busy = false;
  await f.manager.start("lead", ["pi"], 2);
  await f.call("delegate", { title: "Read-only", prompt: "Inspect", files: ["."], harness: "pi", readOnly: true });
  await f.finish();
  expect(f.tasks()[0]).toMatchObject({ readOnly: true, workspacePolicy: "isolated-child", workspace: { kind: "worktree" } });
  expect(f.tasks()[0].readOnlyFallback).toContain("cannot enforce read-only");
});

it("validates read-only mode and documents report closure in the Manager prompt", async () => {
  const f = reportTaskFixture();
  f.lead.busy = false;
  await f.manager.start("lead", ["codex"], 2, undefined, true);
  await expect(f.delegate(["."], { readOnly: "true" })).rejects.toThrow("boolean");
  await expect(f.delegate(["."], { readOnly: true, checkout: "worktree" })).rejects.toThrow("project checkout");
  expect(f.manager.prompt("lead", "Goal")).toContain("readOnly:true");
  expect(f.manager.prompt("lead", "Goal")).toContain("accept-no-changes");
  expect(workerTurnPrompt("Inspect", ["."], undefined, true)).toContain("omit tooling chatter");
});

it("lets a Manager run an investigation without hiring a Reviewer while retaining the code gate", async () => {
  const f = reportTaskFixture();
  f.lead.busy = false;
  f.manager.registerMonoEngine("lead", "lead", "manager-mono", "/repo");
  await f.manager.start("lead", ["codex"], 2, undefined, true);
  await expect(f.delegate(["."])).rejects.toThrow("Hire an independent Reviewer");
  await f.delegate(["."], { readOnly: true });
  await f.finish();
  await f.call("review", { taskId: f.tasks()[0].id, outcome: "accept-no-changes" });
  expect(f.tasks()[0].accepted).toBe(true);
});

it("keeps the original read-only baseline through retries instead of accepting a changed checkout", async () => {
  const f = reportTaskFixture();
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await f.finish();
  f.snapshot.fingerprint = "changed-after-report";
  await f.call("message", { taskId: f.tasks()[0].id, text: "Continue investigation" });
  await vi.waitFor(() => expect(f.tasks()[0].status).toBe("blocked"));
  expect(f.tasks()[0].readOnlyBaseline?.fingerprint).toBe("baseline");
  expect(f.tasks()[0].error).toContain("read-only task modified files");
});

it("does not resurrect a cancelled task when read-only checkout verification returns late", async () => {
  const f = reportTaskFixture();
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
  let resolveSnapshot!: (value: typeof f.snapshot) => void;
  const pending = vi.fn(() => new Promise<typeof f.snapshot>(resolve => { resolveSnapshot = resolve; }));
  f.host.checkoutSnapshot = pending;
  f.completions.get(f.tasks()[0].sessionId)!({ status: "completed", text: "Report" });
  await vi.waitFor(() => expect(pending).toHaveBeenCalledOnce());
  await f.call("cancel", { taskId: f.tasks()[0].id });
  resolveSnapshot({ ...f.snapshot });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.tasks()[0].status).toBe("cancelled");
  expect(f.tasks()[0].accepted).toBe(false);
});

it("does not treat pending Write metadata or Claude's external plan file as a project modification", async () => {
  const f = reportTaskFixture();
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
  f.manager.observe(f.tasks()[0].sessionId, { type: "tool.started", callId: "write", title: "Write", status: "pending", preview: { kind: "write", title: "Write" } });
  f.manager.observe(f.tasks()[0].sessionId, { type: "tool.updated", callId: "write", status: "completed", preview: { kind: "write", title: "Write", path: "/home/user/.claude/plans/review.md" } });
  await f.finish();
  expect(f.tasks()[0].status).toBe("completed");
  expect(f.host.stop).not.toHaveBeenCalledWith(f.tasks()[0].sessionId);
});

it("blocks actual read-only checkout modifications when a Write event arrives", async () => {
  const f = reportTaskFixture();
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
  f.snapshot.fingerprint = "actual-project-write";
  f.manager.observe(f.tasks()[0].sessionId, { type: "tool.updated", callId: "write", status: "completed", preview: { kind: "write", title: "Write", path: "/repo/README.md" } });
  await vi.waitFor(() => expect(f.tasks()[0].status).toBe("blocked"));
  expect(f.tasks()[0].error).toContain("read-only task modified files");
  expect(f.host.stop).toHaveBeenCalledWith(f.tasks()[0].sessionId);
});

it("fails closed when a read-only Write event cannot verify its checkout", async () => {
  const f = reportTaskFixture();
  await f.start();
  await f.delegate(["."], { readOnly: true });
  await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
  f.host.checkoutSnapshot = vi.fn(async () => { throw Error("Git unavailable"); });
  f.manager.observe(f.tasks()[0].sessionId, { type: "tool.started", callId: "write", title: "Write", preview: { kind: "write", title: "Write" } });
  await vi.waitFor(() => expect(f.tasks()[0].status).toBe("blocked"));
  expect(f.tasks()[0].error).toContain("Read-only verification failed: Git unavailable");
});

it("refreshes an idle Manager harness without requesting a user stop of its queued goal", async () => {
  const f = setup();
  f.lead.busy = false;
  f.lead.queuedMessages = [{ id: "goal", text: "Implement the assigned goal", attachments: [] }];
  f.lead.queueStatus = "active";
  f.host.stop = vi.fn(async (_id, reason) => {
    if (reason !== "refresh") f.lead.queueStatus = "paused";
  });
  f.manager.bind(f.host);
  await f.manager.start("lead", ["codex"], 2, undefined, true);
  expect(f.host.stop).toHaveBeenCalledWith("lead", "refresh");
  expect(f.lead.queueStatus).toBe("active");
  expect(f.lead.queuedMessages[0].id).toBe("goal");
  await f.manager.pause("lead", "Delivery interrupted");
  f.lead.queueStatus = "paused";
  f.host.resumeQueue = vi.fn(() => { f.lead.queueStatus = "active"; return true; });
  f.manager.bind(f.host);
  await f.manager.continueManager("lead");
  expect(f.host.resumeQueue).toHaveBeenCalledWith("lead");
  expect(f.host.submit).not.toHaveBeenCalled();
  expect(f.lead.queuedMessages).toHaveLength(1);
});

it("owns separate project engines from one Mono conversation and restores their owner", async () => {
  const f = setup();
  f.lead.busy = false;
  f.manager.registerMonoEngine("engine-a", f.lead.id, "mono", "/repo/a");
  f.manager.registerMonoEngine("engine-b", f.lead.id, "mono", "/repo/b");
  await f.manager.start("engine-a", ["codex"], 2, undefined, true);
  await f.manager.start("engine-b", ["codex"], 2, undefined, true);
  expect(f.manager.run("engine-a")).toMatchObject({
    cwd: "/repo/a",
    ownerSessionId: "lead",
    ownerMonoId: "mono",
    projectManager: true,
  });
  expect(f.manager.run("engine-b")).toMatchObject({
    cwd: "/repo/b",
    ownerSessionId: "lead",
    tasks: [],
  });
  expect(f.host.stop).toHaveBeenCalledWith("lead", "refresh");
  expect(f.manager.submissionError("lead")).toBeNull();
  const turn = await f.manager.beginManagerTurn("engine-a", true);
  expect(f.store.attachOwner).toHaveBeenCalledWith("engine-a", "lead");
  await f.manager.endManagerTurn("engine-a", turn, { status: "completed", text: "" });
  const restored = new Orchestrator(f.store);
  restored.bind(f.host);
  await restored.hydrate("engine-a");
  expect(restored.ownerSession("engine-a")).toBe("lead");
  expect(restored.run("engine-a")?.cwd).toBe("/repo/a");
  expect(() =>
    restored.registerMonoEngine("engine-a", "other", "other", "/repo/a"),
  ).toThrow("already belongs");
});

it("fails the Manager turn closed when its owner connection cannot attach", async () => {
  const f = setup();
  f.lead.busy = false;
  f.manager.registerMonoEngine("engine", f.lead.id, "mono", "/repo");
  await f.manager.start("engine", ["codex"], 2, undefined, true);
  f.store.attachOwner.mockRejectedValueOnce(Error("Lead connection is inactive"));
  await expect(f.manager.beginManagerTurn("engine", true)).rejects.toThrow("Lead connection is inactive");
  expect(f.manager.run("engine")?.status).toBe("paused");
  expect(f.host.submit).not.toHaveBeenCalled();
});

it("allows an owning Mono's habit without acquiring or ending its Manager turn", async () => {
  const f = setup();
  f.lead.busy = false;
  f.manager.registerMonoEngine("lead", "lead", "manager-mono", "/repo");
  await f.manager.start("lead", ["codex"], 2, undefined, true);
  f.sessions.push({ ...newSession("codex", "/repo"), id: "habit" });
  f.host.habitOwnerMono = (id) => (id === "habit" ? "manager-mono" : undefined);
  expect(f.manager.submissionError("habit")).toBeNull();
  expect(f.manager.run("lead")?.status).toBe("active");
  expect(f.manager.run("lead")?.managerTurnId).toBeUndefined();
  f.host.habitOwnerMono = () => "another-mono";
  expect(f.manager.submissionError("habit")).toContain("active orchestrator");
});

it("keeps usage-limited Managers active but holds events for genuinely paused owners", async () => {
  const f = setup();
  f.lead.busy = false;
  f.manager.registerMonoEngine("lead", "lead", "manager-mono", "/repo");
  await f.manager.start("lead", ["codex"], 2, undefined, true);
  const turn = await f.manager.beginManagerTurn("lead", true);
  await f.manager.endManagerTurn("lead", turn, {
    status: "failed",
    text: "",
    error: "Usage limit reached",
  });
  expect(f.manager.run("lead")?.status).toBe("active");
  const failed = await f.manager.beginManagerTurn("lead", true);
  await f.manager.endManagerTurn("lead", failed, {
    status: "failed",
    text: "",
    error: "Provider crashed",
  });
  expect(f.manager.submissionError("lead", true)).toContain("Continue");
});

it("preflights independent launches in retained worker checkouts and nested folders", async () => {
  const f = setup();
  await f.start();
  await f.delegate(["src"]);
  await vi.waitFor(() => expect(f.tasks()[0].workspace).toBeDefined());
  const checkout = f.tasks()[0].workspace!.checkoutCwd;
  const createSession = vi.fn();
  const launch = () => {
    f.manager.assertCanLaunch("new", { cwd: "/repo", worktreeCwd: checkout });
    createSession();
    return true; // UI acceptance may otherwise mean only parked for Retry.
  };
  expect(launch).toThrow("Do not retry this launch");
  try { launch(); } catch (error) { expect(error).toMatchObject({ retryable: false }); }
  expect(createSession).not.toHaveBeenCalled();
  expect(
    f.manager.submissionError("new", false, {
      cwd: "/repo",
      worktreeCwd: checkout,
    }),
  ).toContain("worker checkout");
  expect(
    f.manager.submissionError("new", false, { cwd: `${checkout}/src` }),
  ).toContain("worker checkout");
  expect(
    f.manager.submissionError("new", false, { cwd: `${checkout}-other` }),
  ).toBeNull();
});

describe("worker assignment prompts", () => {
  it("rejects self-review both at assignment and verdict boundaries", async () => {
    const f = setup();
    f.host.reviewerFor = () => ({ id: "reviewer", name: "Reviewer" });
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    const labels = { memberName: "Reviewer", memberMascot: "ghost", memberColor: "#aaaaaa" };
    await f.delegate(["src"], { ...labels, member: "reviewer" });
    const target = f.tasks()[0];
    await vi.waitFor(() => expect(f.completions.has(target.sessionId)).toBe(true));
    f.completions.get(target.sessionId)!({ status: "completed", text: "Implemented" });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await expect(f.delegate(["."], { ...labels, member: "reviewer", reviewTaskId: target.id })).rejects.toThrow("exact completed task");
    // Simulate older persisted review evidence crossing the verdict trust boundary.
    f.manager.run("lead")!.tasks[0].memberId = "backend";
    await f.delegate(["."], { ...labels, member: "reviewer", reviewTaskId: target.id });
    const review = f.tasks()[1];
    await vi.waitFor(() => expect(f.completions.has(review.sessionId)).toBe(true));
    f.manager.run("lead")!.tasks[0].memberId = "reviewer";
    await expect(f.manager.recordReviewerResult(review.sessionId, "self", { decision: "approve", notes: "Self-approved" })).rejects.toThrow("independent Reviewer");
  });
  it("requires a Reviewer on Mono teams before delegate and PR acceptance", async () => {
    const f = setup();
    f.lead.busy = false;
    f.manager.registerMonoEngine("lead", "lead", "manager-mono", "/repo");
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await expect(f.delegate(["src"])).rejects.toThrow("Hire an independent Reviewer");
    expect(f.tasks()).toHaveLength(0);
    f.host.reviewerFor = () => ({ id: "reviewer", name: "Reviewer" });
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true));
    f.completions.get(f.tasks()[0].sessionId)!({ status: "completed", text: "Implemented" });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    f.host.reviewerFor = () => undefined;
    f.host.reviewedPullRequest = vi.fn(async () => "https://github.com/example/app/pull/1");
    await expect(f.call("review", { taskId: f.tasks()[0].id })).rejects.toThrow("cannot self-approve");
    expect(f.host.reviewedPullRequest).not.toHaveBeenCalled();
  });
  it("requires an authenticated Reviewer verdict on the latest dispatch before the PR gate", async () => {
    const f = setup();
    f.host.reviewerFor = () => ({ id: "reviewer", name: "Reviewer" });
    f.host.reviewedPullRequest = vi.fn(
      async () => "https://github.com/example/app/pull/1",
    );
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.delegate(["src"], {
      member: "backend",
      memberName: "Backend",
      memberMascot: "cat",
      memberColor: "#aaaaaa",
    });
    const impl = f.tasks()[0];
    await vi.waitFor(() =>
      expect(f.completions.has(impl.sessionId)).toBe(true),
    );
    const write = vi.fn(async () => ({ added: true }));
    await f.manager.recordMemberFact(
      impl.sessionId,
      "fact-1",
      { fact: "Project uses UTC timestamps" },
      write,
    );
    await f.manager.recordMemberFact(
      impl.sessionId,
      "fact-1",
      { fact: "Project uses UTC timestamps" },
      write,
    );
    expect(write).toHaveBeenCalledTimes(1);
    await f.manager.recordMemberFact(
      impl.sessionId,
      "fact-2",
      { fact: "Second fact" },
      write,
    );
    await f.manager.recordMemberFact(
      impl.sessionId,
      "fact-3",
      { fact: "Third fact" },
      write,
    );
    await expect(
      f.manager.recordMemberFact(
        impl.sessionId,
        "fact-4",
        { fact: "Fourth fact" },
        write,
      ),
    ).rejects.toThrow("three facts");
    f.completions.get(impl.sessionId)!({
      status: "completed",
      text: "Implemented, tests passed",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await expect(f.call("review", { taskId: impl.id })).rejects.toThrow(
      "Reviewer must approve",
    );
    await f.delegate(["."], {
      member: "reviewer",
      memberName: "Reviewer",
      memberMascot: "ghost",
      memberColor: "#aaaaaa",
      reviewTaskId: impl.id,
    });
    const review = f.tasks()[1];
    await vi.waitFor(() =>
      expect(f.completions.has(review.sessionId)).toBe(true),
    );
    await expect(
      f.manager.recordReviewerResult(impl.sessionId, "fake", {
        decision: "approve",
        notes: "Self approved",
      }),
    ).rejects.toThrow("Only this team's assigned Reviewer");
    await f.manager.recordReviewerResult(review.sessionId, "verdict", {
      decision: "approve",
      notes: "Exact diff and tests reviewed",
    });
    await expect(f.call("review", { taskId: impl.id })).rejects.toThrow(
      "Reviewer must approve",
    );
    f.completions.get(review.sessionId)!({
      status: "completed",
      text: "Approved",
    });
    await vi.waitFor(() => expect(f.tasks()[1].status).toBe("completed"));
    await expect(f.call("review", { taskId: impl.id })).resolves.toMatchObject({
      accepted: true,
    });
    expect(f.tasks()[0].reviewedBy).toBe("Reviewer");
    const priorCompletion = f.completions.get(impl.sessionId);
    await f.call("message", {
      taskId: impl.id,
      text: "Make one more correction",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await vi.waitFor(() =>
      expect(f.completions.get(impl.sessionId)).not.toBe(priorCompletion),
    );
    f.completions.get(impl.sessionId)!({
      status: "completed",
      text: "Corrected",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await expect(f.call("review", { taskId: impl.id })).rejects.toThrow(
      "Reviewer must approve",
    );
  });
  it("keeps the task text and wraps it in the assignment envelope", () => {
    const sent = workerTurnPrompt("Review the branch.", ["src/App.tsx"]);
    expect(sent.startsWith("Review the branch.")).toBe(true);
    expect(sent).toContain("<monocode_assignment>");
    expect(sent).toContain("src/App.tsx");
    expect(sent).toContain("override any contradictory wording");
    expect(sent).toContain("stage, commit, push");
    expect(sent).toContain(
      "Git finalization remains the lead's responsibility",
    );
    expect(visibleUserPrompt(sent)).toBe("Review the branch.");
  });
  it("asks workers for a plain-language ending with collapsed command evidence", () => {
    const sent = workerTurnPrompt("Implement the change.", ["src/App.tsx"]);
    expect(sent).toContain("End your final message with a short plain-language summary");
    expect(sent).toContain("what changed (including changed files), what was verified, and what remains open");
    expect(sent).toContain("<details><summary>Command output</summary>");
    expect(sent).toContain("redact secrets");
    expect(visibleUserPrompt(sent)).toBe("Implement the change.");
  });
});

describe("local orchestration", () => {
  it("stops an archived project's run without removing unchanged worker worktrees", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const worker = f.tasks()[0];
    await f.manager.stopRun("lead", { retainWorktrees: true });
    expect(f.host.stop).toHaveBeenCalledWith(worker.sessionId);
    expect(f.manager.run("lead")?.status).toBe("stopped");
    expect(f.tasks()[0].workspace).toEqual(worker.workspace);
    expect(f.tasks()[0].status).toBe("cancelled");
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();
  });
  it("passively loads a saved Manager run for archival without recovering workers", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await vi.waitFor(() => expect(f.saved.get("lead")?.tasks[0].workspace).toBeDefined());
    f.saved.set("lead", { ...f.saved.get("lead")!, projectManager: true });
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    const enableCount = f.store.enable.mock.calls.length;
    const submitCount = vi.mocked(f.host.submit).mock.calls.length;
    await restored.stopRun("lead", { retainWorktrees: true });
    expect(restored.run("lead")?.status).toBe("stopped");
    expect(restored.run("lead")?.tasks[0].workspace).toEqual(f.tasks()[0].workspace);
    expect(f.store.enable.mock.calls).toHaveLength(enableCount);
    expect(vi.mocked(f.host.submit).mock.calls).toHaveLength(submitCount);
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();
    expect(f.host.stop).toHaveBeenCalledWith(f.tasks()[0].sessionId);
  });
  it("reports failed archival persistence after stopping workers and disabling control", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await vi.waitFor(() => expect(f.saved.get("lead")?.tasks[0].workspace).toBeDefined());
    f.store.save.mockRejectedValue(new Error("Cannot save stopped run"));
    await expect(f.manager.stopRun("lead", { retainWorktrees: true })).rejects.toThrow("Cannot save stopped run");
    expect(f.host.stop).toHaveBeenCalledWith(f.tasks()[0].sessionId);
    expect(f.store.disable).toHaveBeenCalledWith("lead");
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();
  });
  it("restores idle managers without pausing, but retains real manager interruptions", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    const states: string[] = [];
    restored.subscribe(() => {
      if (restored.run("lead")) states.push(restored.run("lead")!.status);
    });
    await restored.hydrate("lead");
    expect(restored.run("lead")?.status).toBe("active");
    expect(states).not.toContain("paused");
    expect(f.host.submit).not.toHaveBeenCalled();
    const turn = await restored.beginManagerTurn("lead", true);
    expect(turn).toBeTruthy();
    const crashed = new Orchestrator(f.store);
    crashed.bind(f.host);
    await crashed.hydrate("lead");
    expect(crashed.run("lead")).toMatchObject({
      status: "paused",
      error: expect.stringContaining("Manager's last turn"),
    });
    expect(f.host.submit).not.toHaveBeenCalled();
  });

  it("automatically continues restart-interrupted workers once from their retained checkout", async () => {
    const f = setup();
    f.lead.harness = "codex";
    f.lead.model = "codex:test";
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const original = structuredClone(f.tasks()[0]);
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    await restored.hydrate("lead");
    await restored.hydrate("lead");
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    expect(restored.run("lead")).toMatchObject({
      status: "active",
      recoveryNotice:
        "Continued 1 worker after restart from retained checkouts.",
    });
    expect(restored.run("lead")!.tasks[0]).toMatchObject({
      sessionId: original.sessionId,
      workspace: original.workspace,
      status: "running",
    });
    expect(f.host.submit).toHaveBeenLastCalledWith(
      original.sessionId,
      expect.stringContaining("Preserve completed work"),
      expect.any(Function),
    );
  });

  it("resets the continuation budget on user turns and exposes failed turns without replaying them", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.manager.run("lead")!.continuations = 20;
    const turn = await f.manager.beginManagerTurn("lead", true);
    expect(f.manager.run("lead")!.continuations).toBe(0);
    await f.manager.endManagerTurn("lead", turn, {
      status: "failed",
      text: "",
      error: "Provider unavailable",
    });
    expect(f.manager.run("lead")).toMatchObject({
      status: "paused",
      error: "Provider unavailable",
    });
    await f.manager.continueManager("lead");
    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.host.submit).toHaveBeenCalledOnce();
  });

  it("treats stopping a Manager as an interruption, preserving its workers for Continue", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    await f.manager.stopForSession("lead");
    expect(f.manager.run("lead")?.status).toBe("paused");
    expect(f.tasks()[0].status).toBe("interrupted");
    expect(f.tasks()[0].workspace).toBeDefined();
    expect(f.host.stop).toHaveBeenCalledWith("lead");
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();
  });

  it("does not replay a saved safety/provider blocker and waits for provider discovery during recovery", async () => {
    const f = setup();
    f.lead.harness = "codex";
    f.lead.model = "codex:test";
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    let discovered!: () => void;
    f.host.probeProviders = () =>
      new Promise<void>((resolve) => {
        discovered = resolve;
      });
    f.host.choices = () => [];
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    const loading = restored.hydrate("lead");
    await vi.waitFor(() => expect(discovered).toBeTypeOf("function"));
    expect(f.host.submit).toHaveBeenCalledOnce();
    discovered();
    await loading;
    expect(restored.run("lead")).toMatchObject({
      status: "paused",
      recovering: undefined,
      error: expect.stringContaining("provider is unavailable"),
    });
    const blocked = new Orchestrator(f.store);
    blocked.bind(f.host);
    await blocked.hydrate("lead");
    expect(blocked.run("lead")?.status).toBe("paused");
    expect(f.host.submit).toHaveBeenCalledOnce();
  });

  it("uses the folder display name and captures its branch for each assignment", async () => {
    const f = setup();
    f.lead.busy = false;
    f.lead.cwd = "/worktrees/browser-link-4";
    f.host.projectIdentity = vi.fn(async () => ({
      name: "Browser Link 4",
      branch: "v4",
    }));
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.delegate(["src"]);
    expect(f.manager.prompt("lead", "Build")).toContain(
      'Manager for "Browser Link 4"',
    );
    expect(f.manager.run("lead")!.workspace).toMatchObject({
      checkoutCwd: f.lead.cwd,
      branch: "v4",
    });
    expect(f.tasks()[0].baseBranch).toBe("v4");
  });

  it("defaults to the current Manager model and reassigns stopped workers without losing scope or checkout", async () => {
    const f = setup();
    f.lead.harness = "codex";
    f.lead.model = "codex:test";
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.call("delegate", {
      title: "Recover",
      prompt: "Original scope",
      files: ["src"],
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const original = f.tasks()[0];
    expect(original.model).toBe(f.lead.model);
    await expect(
      f.call("reassign", { taskId: original.id, reason: "quota" }),
    ).rejects.toThrow("Cancel");
    await f.call("cancel", { taskId: original.id });
    await expect(
      f.call("reassign", { taskId: original.id, reason: "safety" }),
    ).rejects.toThrow("Safety refusals");
    const input = { taskId: original.id, reason: "configuration" };
    const result = await f.call("reassign", input, "replace-once");
    expect(await f.call("reassign", input, "replace-once")).toEqual(result);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    const replacement = f.tasks()[0];
    expect(replacement.sessionId).not.toBe(original.sessionId);
    expect(replacement.workspace).toEqual(original.workspace);
    expect(replacement.files).toEqual(original.files);
    expect(replacement.prompt).toBe(original.prompt);
    expect(f.sessions.some((s) => s.id === original.sessionId)).toBe(true);
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();
    expect(f.host.submit).toHaveBeenLastCalledWith(
      replacement.sessionId,
      expect.stringContaining("Original scope"),
      expect.any(Function),
    );
    f.completions.get(original.sessionId)!({
      status: "completed",
      text: "Late old result",
    });
    expect(f.tasks()[0].status).toBe("running");
  });

  it("runs independent project goals concurrently, retains reviewed PR worktrees and preserves receipts", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    expect(f.manager.prompt("lead", "Goal")).toContain(
      "Never rephrase, change models, or switch providers to bypass a refusal",
    );
    f.lead.busy = true;
    const input = {
      title: "Goal one",
      prompt: "Implement",
      harness: "codex",
      files: ["."],
    };
    const first = await f.call("delegate", input, "stable-assignment");
    expect(await f.call("delegate", input, "stable-assignment")).toEqual(first);
    await f.delegate(["."], { title: "Goal two", checkout: "named-worktree" });
    await vi.waitFor(() =>
      expect(f.tasks().map((task) => task.status)).toEqual([
        "running",
        "running",
      ]),
    );
    expect(f.tasks()[1].checkout).toBe("named-worktree");
    const task = f.tasks()[0];
    f.completions.get(task.sessionId)!({
      status: "completed",
      text: "Tests passed",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    f.host.reviewedPullRequest = vi.fn(async () => {
      throw new Error("No open PR");
    });
    await expect(f.call("review", { taskId: task.id })).rejects.toThrow(
      "No open PR",
    );
    expect(f.tasks()[0].accepted).toBe(false);
    f.host.reviewedPullRequest = vi.fn(
      async () => "https://github.com/example/repo/pull/1",
    );
    f.host.notifyReady = vi.fn();
    const reviewInput = {
      taskId: task.id,
      checks: "Diff reviewed; focused tests passed",
    };
    f.lead.blocks = [
      {
        id: "ready-turn",
        role: "user",
        text: "Implement goal one",
        startedAt: 100,
      },
    ];
    await f.call("review", reviewInput, "review-once");
    const readyAt = f.tasks()[0].prReadyAt;
    expect(readyAt).toEqual(expect.any(Number));
    expect(f.tasks()[0].prReadyTurnId).toBe("ready-turn");
    f.lead.blocks.push({
      id: "next-turn",
      role: "user",
      text: "Start new work",
      startedAt: 500,
    });
    await f.call("review", reviewInput, "review-once");
    await f.call("review", reviewInput);
    expect(f.tasks()[0]).toMatchObject({
      prReadyAt: readyAt,
      prReadyTurnId: "ready-turn",
    });
    expect(f.saved.get("lead")?.tasks[0]).toMatchObject({
      prReadyAt: readyAt,
      prReadyTurnId: "ready-turn",
    });
    expect(f.host.notifyReady).toHaveBeenCalledTimes(1);
    expect(f.tasks()[0].checksSummary).toBe(reviewInput.checks);
    expect(f.tasks()[0]).toMatchObject({
      accepted: true,
      prUrl: "https://github.com/example/repo/pull/1",
      acceptedDispatchId: f.tasks()[0].lastDispatchId,
    });
    expect(f.tasks()[0].workspace).toBeDefined();
    expect(f.host.integrateWorker).not.toHaveBeenCalled();
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();
    await f.call("message", {
      taskId: task.id,
      text: "Address review feedback",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    expect(f.tasks()[0].accepted).toBe(false);
    expect(f.tasks()[0]).toMatchObject({
      prReadyAt: readyAt,
      prReadyTurnId: "ready-turn",
    });
    expect(f.saved.get("lead")?.tasks[0]).toMatchObject({
      prReadyAt: readyAt,
      prReadyTurnId: "ready-turn",
    });
  });

  it("recovers a project manager without replaying workers until explicit resume", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.start("lead", ["codex"], 2, undefined, true);
    f.lead.busy = true;
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const recovered = new Orchestrator(f.store);
    await vi.waitFor(() =>
      expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true),
    );
    recovered.bind(f.host);
    vi.mocked(f.host.submit).mockClear();
    await recovered.hydrate("lead");
    expect(recovered.run("lead")).toMatchObject({
      projectManager: true,
      status: "paused",
    });
    expect(recovered.run("lead")!.tasks[0]).toMatchObject({
      status: "interrupted",
      workspace: f.tasks()[0].workspace,
    });
    expect(f.host.submit).not.toHaveBeenCalled();
    await recovered.start("lead", ["codex"], 2);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
  });
  it("stops and forgets a deleted lead without persisting it again", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    const remove = vi.fn(async () => {
      expect(f.lead.busy).toBe(false);
      expect(f.manager.run("lead")?.status).toBe("stopped");
      f.saved.delete("lead");
    });
    await f.manager.deleteSession("lead", remove);
    expect(remove).toHaveBeenCalledOnce();
    expect(f.host.stop).toHaveBeenCalledWith(task.sessionId);
    expect(f.manager.snapshot()).toEqual([]);
    f.store.save.mockClear();
    f.completions.get(task.sessionId)?.({
      status: "completed",
      text: "Late result",
    });
    await f.manager.hydrate("lead");
    f.manager.sync();
    await Promise.resolve();
    expect(f.manager.snapshot()).toEqual([]);
    expect(f.store.save).not.toHaveBeenCalled();
  });

  it("reloads a deleted worker's pruned run and preserves state if deletion fails", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    await expect(
      f.manager.deleteSession(task.sessionId, async () => {
        throw new Error("Delete failed");
      }),
    ).rejects.toThrow("Delete failed");
    expect(f.tasks()).toHaveLength(1);
    expect(f.manager.run("lead")?.status).toBe("stopped");
    await f.manager.deleteSession(task.sessionId, async () => {
      f.saved.set("lead", { ...f.saved.get("lead")!, tasks: [], requests: {} });
      f.store.save.mockClear();
    });
    expect(f.tasks()).toEqual([]);
    expect(f.manager.forSession(task.sessionId)).toBeUndefined();
    expect(f.store.save).not.toHaveBeenCalled();
  });

  const proposal = (): OrchestrationProposal => ({
    version: 1,
    leadId: "lead",
    cwd: "/repo",
    request: "Build settings",
    author: { harness: "claude", model: "claude:test", name: "Lead" },
    settings: {
      choices: [{ harness: "codex", model: "codex:test", name: "Test" }],
      maxWorkers: 2,
    },
    status: "ready",
    title: "Settings",
    summary: "Split the work",
    tasks: [
      {
        id: "ui",
        title: "UI",
        prompt: "User edited instructions",
        harness: "codex",
        model: "codex:test",
        files: ["src/ui"],
        dependsOn: ["types"],
      },
      {
        id: "types",
        title: "Types",
        prompt: "Define the types",
        harness: "codex",
        model: "codex:test",
        files: ["src/types"],
        dependsOn: [],
      },
    ],
  });
  it("starts exactly the approved assignments and preserves forward dependencies", async () => {
    const f = setup();
    f.lead.busy = false;
    const card = proposal();
    card.tasks[1].modelSettings = { reasoningEffort: "xhigh" };
    expect(f.host.submit).not.toHaveBeenCalled();
    await f.manager.startApproved("lead", "card", card);
    await vi.waitFor(() =>
      expect(f.host.createWorker).toHaveBeenCalledTimes(1),
    );
    expect(f.tasks().map((task) => task.status)).toEqual(["queued", "running"]);
    expect(f.tasks()[0].prompt).toBe("User edited instructions");
    expect(f.tasks()[0].dependsOn).toEqual([f.tasks()[1].id]);
    expect(f.tasks()[1].modelSettings).toEqual({
      reasoningEffort: "xhigh",
    });
    expect(f.host.createWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelSettings: { reasoningEffort: "xhigh" },
      }),
    );
    expect(f.manager.run("lead")?.proposalId).toBe("card");
    expect(f.saved.get("lead")?.tasks).toHaveLength(2);
    const workerPrompt = vi
      .mocked(f.host.submit)
      .mock.calls.find(
        ([id, prompt]) =>
          id !== "lead" && String(prompt).includes("<monocode_assignment>"),
      )?.[1];
    expect(workerPrompt).toContain("Define the types");
    expect(workerPrompt).toContain("<monocode_assignment>");
    expect(
      vi.mocked(f.host.submit).mock.calls.find(([id]) => id === "lead")?.[1],
    ).toContain("do not delegate duplicates");
    expect(
      vi.mocked(f.host.submit).mock.calls.find(([id]) => id === "lead")?.[1],
    ).toContain('"modelSettings":{"reasoningEffort":"xhigh"}');
  });
  it("names the conversation that blocks a paused run from resuming", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.startApproved("lead", "card", proposal());
    f.completions.get("lead")!({
      status: "failed",
      text: "",
      error: "Lead interrupted",
    });
    await vi.waitFor(() =>
      expect(f.manager.run("lead")?.status).toBe("paused"),
    );
    await vi.waitFor(() =>
      expect(
        f
          .tasks()
          .every(
            (task) => task.status !== "running" && task.status !== "cancelling",
          ),
      ).toBe(true),
    );
    f.sessions.push({
      ...newSession("codex", "/repo"),
      id: "investigation",
      title: "Investigating the failure",
      busy: true,
    });

    expect(f.manager.resumeBlocker("lead")?.id).toBe("investigation");
    await expect(f.manager.start("lead", ["codex"], 2)).rejects.toThrow(
      '"Investigating the failure" is still running in this checkout. Stop it before resuming orchestration.',
    );
  });
  it("checks the new checkout rather than a stopped run's old checkout", async () => {
    const f = setup();
    await f.start();
    await f.manager.stopRun("lead");
    f.lead.worktreeCwd = "/repo-worktrees/new";
    f.sessions.push({
      ...newSession("codex", "/repo"),
      id: "old-checkout-work",
      title: "Old checkout work",
      busy: true,
    });

    await f.manager.start("lead", ["codex"], 2);

    expect(f.manager.run("lead")?.workspace?.checkoutCwd).toBe(
      "/repo-worktrees/new",
    );
  });
  it("never launches a partial plan when one assignment has invalid scopes", async () => {
    const f = setup();
    f.lead.busy = false;
    f.store.scopes.mockRejectedValueOnce(new Error("Scope escapes project"));
    await expect(
      f.manager.startApproved("lead", "card", proposal()),
    ).rejects.toThrow("Scope escapes");
    expect(f.store.enable).not.toHaveBeenCalled();
    expect(f.host.submit).not.toHaveBeenCalled();
  });
  it("requires a ready proposal and enforces the exact model pool for later CLI calls", async () => {
    const f = setup();
    f.lead.busy = false;
    await expect(
      f.manager.startApproved("lead", "card", {
        ...proposal(),
        status: "planning",
      }),
    ).rejects.toThrow("completed proposal");
    f.host.choices = () => [
      {
        harness: "codex",
        models: [
          { id: "codex:test", name: "Test" },
          { id: "codex:extra", name: "Unselected" },
        ],
      },
    ];
    await f.manager.startApproved("lead", "card", proposal());
    const result = (await f.call("list")) as {
      harnesses: { models: { id: string }[] }[];
    };
    expect(result.harnesses[0].models.map((model) => model.id)).toEqual([
      "codex:test",
    ]);
    await expect(
      f.delegate(["extra"], { model: "codex:extra" }),
    ).rejects.toThrow("model ID returned by list");
  });
  it("does not duplicate work when confirmation is repeated", async () => {
    const f = setup();
    f.lead.busy = false;
    const results = await Promise.allSettled([
      f.manager.startApproved("lead", "card", proposal()),
      f.manager.startApproved("lead", "card", proposal()),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.store.enable).toHaveBeenCalledTimes(1);
    expect(f.tasks()).toHaveLength(2);
  });
  it("ignores unavailable unused catalog models but blocks an unavailable assignment", async () => {
    const f = setup();
    f.lead.busy = false;
    const card = proposal();
    card.settings.choices.push({
      harness: "claude",
      model: "claude:removed",
      name: "Removed",
    });
    await f.manager.startApproved("lead", "card", card);
    expect(f.manager.run("lead")?.allowedHarnesses).toEqual(["codex"]);
    expect(f.manager.run("lead")?.allowedModels).toEqual(
      proposal().settings.choices,
    );

    const unavailable = setup();
    unavailable.lead.busy = false;
    card.tasks[0] = {
      ...card.tasks[0],
      harness: "claude",
      model: "claude:removed",
    };
    await expect(
      unavailable.manager.startApproved("lead", "card", card),
    ).rejects.toThrow("An assigned model is no longer available");
    expect(unavailable.store.enable).not.toHaveBeenCalled();
    expect(unavailable.host.submit).not.toHaveBeenCalled();
  });
  it("treats directory scopes as overlapping only at path boundaries", () => {
    expect(scopesOverlap(["/repo/src"], ["/repo/src/file.ts"])).toBe(true);
    expect(scopesOverlap(["/repo/src"], ["/repo/src2/file.ts"])).toBe(false);
    expect(scopesOverlap(["/repo"], ["/repo/anything"])).toBe(true);
    expect(scopesOverlap(["/"], ["/repo/anything"])).toBe(true);
  });
  it("compares Windows canonical and provider paths as the same scope", () => {
    expect(orchestrationPathKey("\\\\?\\D:\\Projects\\Repo\\src")).toBe(
      "d:/projects/repo/src",
    );
    expect(orchestrationPathKey("\\\\?\\UNC\\Server\\Share\\Repo\\src")).toBe(
      "//server/share/repo/src",
    );
    expect(
      scopesOverlap(
        ["//?/d:/projects/repo/src"],
        ["D:/Projects/Repo/src/file.ts"],
      ),
    ).toBe(true);
    expect(scopesOverlap(["//?/d:/"], ["D:/Projects/Repo"])).toBe(true);
  });
  it("preserves case for POSIX checkout and scope identities", () => {
    expect(orchestrationPathKey("/repo/Foo")).toBe("/repo/Foo");
    expect(scopesOverlap(["/repo/Foo"], ["/repo/foo/file.ts"])).toBe(false);
  });
  it("records the selected worktree separately from the project identity", async () => {
    const f = setup();
    f.lead.worktreeCwd = "/repo-worktrees/feature";
    f.lead.branch = "feature";
    f.store.scopes.mockImplementation(async (cwd: string, files: string[]) =>
      files.map((file) => (file === "." ? cwd : `${cwd}/${file}`)),
    );

    await f.start();

    expect(f.manager.run("lead")).toMatchObject({
      version: 2,
      cwd: "/repo",
      workspace: {
        projectCwd: "/repo",
        checkoutCwd: "/repo-worktrees/feature",
        kind: "worktree",
        branch: "feature",
      },
    });
    expect(f.store.enable).toHaveBeenCalledWith(
      "lead",
      "/repo-worktrees/feature",
    );
    await f.delegate(["src/a"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    expect(f.tasks()[0].scopes).toEqual(["/repo-worktrees/feature/src/a"]);
    expect(f.manager.run("lead")?.dispatches?.[0].workspace).toMatchObject({
      projectCwd: "/repo",
      checkoutCwd: "/repo-worktrees/feature",
    });
  });
  it("starts an approved proposal only in the checkout it inspected", async () => {
    const f = setup();
    f.lead.busy = false;
    f.lead.worktreeCwd = "/repo-worktrees/feature";
    const card = {
      ...proposal(),
      checkoutCwd: "/repo-worktrees/feature",
    };
    f.store.scopes.mockImplementation(async (cwd: string, files: string[]) =>
      files.map((file) => (file === "." ? cwd : `${cwd}/${file}`)),
    );

    await f.manager.startApproved("lead", "card", card);
    expect(f.manager.run("lead")?.workspace?.checkoutCwd).toBe(
      "/repo-worktrees/feature",
    );

    const moved = setup();
    moved.lead.busy = false;
    moved.lead.worktreeCwd = "/repo-worktrees/other";
    await expect(
      moved.manager.startApproved("lead", "card", card),
    ).rejects.toThrow("proposal's checkout");

    const switched = setup();
    switched.lead.busy = false;
    switched.lead.worktreeCwd = "/repo-worktrees/feature";
    switched.store.scopes.mockImplementation(
      async (cwd: string, files: string[]) => {
        switched.lead.worktreeCwd = "/repo-worktrees/other";
        return files.map((file) => `${cwd}/${file}`);
      },
    );
    await expect(
      switched.manager.startApproved("lead", "card", card),
    ).rejects.toThrow("proposal's checkout");
    expect(switched.store.enable).not.toHaveBeenCalled();
  });
  it("persists dispatch authority and binds review to the completed attempt", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const task = f.tasks()[0];
    const dispatchId = task.activeDispatchId!;

    expect(dispatchId).toBeTruthy();
    await vi.waitFor(() =>
      expect(f.saved.get("lead")?.dispatches).toContainEqual(
        expect.objectContaining({
          id: dispatchId,
          taskId: task.id,
          state: "running",
          stage: "turn_submitted",
        }),
      ),
    );
    f.completions.get(task.sessionId)!({
      status: "completed",
      text: "Done",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    expect(f.tasks()[0]).toMatchObject({
      activeDispatchId: undefined,
      lastDispatchId: dispatchId,
    });
    expect(f.manager.run("lead")?.dispatches?.[0]).toMatchObject({
      id: dispatchId,
      state: "completed",
      stage: "settled",
      result: "Done",
    });
    await f.call("review", { taskId: task.id });
    expect(f.tasks()[0].acceptedDispatchId).toBe(dispatchId);
    expect(f.host.integrateWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: task.id }),
    );
    expect(f.host.cleanupWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: task.id }),
      false,
    );
    expect(f.tasks()[0].workspace).toBeUndefined();
    expect(f.manager.run("lead")?.dispatches?.[0].stage).toBe("cleaned");
  });
  it("reports a cancelled dirty worktree instead of silently orphaning it", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await vi.waitFor(() =>
      expect(f.tasks()[0].workspace?.checkoutCwd).toContain("/worktrees/"),
    );
    const task = f.tasks()[0];
    vi.mocked(f.host.cleanupWorker).mockResolvedValue(false);

    await f.call("cancel", { taskId: task.id });
    const result = await f.call("finish");

    expect(result).toEqual({
      finished: true,
      cleanupPending: [`/worktrees/${task.id}`],
    });
    expect(f.tasks()[0].workspace?.checkoutCwd).toBe(`/worktrees/${task.id}`);
    expect(f.host.cleanupWorker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: task.id }),
      true,
    );
  });
  it("keeps an isolated worker recoverable when integration conflicts", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const task = f.tasks()[0];
    f.completions.get(task.sessionId)!({
      status: "completed",
      text: "Done",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    vi.mocked(f.host.integrateWorker).mockRejectedValueOnce(
      new Error("lead checkout changed"),
    );

    await expect(f.call("review", { taskId: task.id })).rejects.toThrow(
      "lead checkout changed",
    );
    expect(f.tasks()[0].accepted).toBe(false);
    expect(f.tasks()[0].workspace?.checkoutCwd).toBe(`/worktrees/${task.id}`);
    expect(f.host.cleanupWorker).not.toHaveBeenCalled();

    await f.call("review", { taskId: task.id });
    expect(f.tasks()[0].accepted).toBe(true);
    expect(f.host.integrateWorker).toHaveBeenCalledTimes(2);
  });
  it("does not let a late completion settle a newer retry", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const task = f.tasks()[0];
    const firstDispatchId = task.activeDispatchId!;
    const late = f.completions.get(task.sessionId)!;

    await f.call("cancel", { taskId: task.id });
    await f.call("message", { taskId: task.id, text: "Retry" });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    const retryDispatchId = f.tasks()[0].activeDispatchId!;
    late({ status: "completed", text: "Stale result" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(f.tasks()[0]).toMatchObject({
      status: "running",
      activeDispatchId: retryDispatchId,
      result: "",
    });
    expect(f.manager.run("lead")?.dispatches).toHaveLength(2);
  });
  it("runs disjoint workers concurrently and queues overlap", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await f.delegate(["src/b"]);
    await f.delegate(["src/a/file.ts"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    expect(f.tasks().map((task) => task.status)).toEqual([
      "running",
      "running",
      "queued",
    ]);
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Implemented A",
    });
    await vi.waitFor(() => expect(f.tasks()[2].status).toBe("running"));
    expect(f.tasks()[0].accepted).toBe(false);
  });
  it("keeps a dependency queued until the lead accepts the upstream result", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/types.ts"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const upstream = f.tasks()[0];
    await f.delegate(["src/ui"], { dependsOn: [upstream.id] });
    f.completions.get(upstream.sessionId)!({
      status: "completed",
      text: "Types ready",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    expect(f.tasks()[1].status).toBe("queued");
    await f.call("review", { taskId: upstream.id });
    await vi.waitFor(() => expect(f.tasks()[1].status).toBe("running"));
  });
  it("deduplicates command retries and rejects foreign tasks or unapproved harnesses", async () => {
    const f = setup();
    await f.start();
    const input = {
      title: "A",
      prompt: "Implement",
      harness: "codex",
      files: ["a"],
    };
    const first = await f.call("delegate", input, "same");
    expect(await f.call("delegate", input, "same")).toEqual(first);
    expect(f.tasks()).toHaveLength(1);
    await expect(
      f.call("delegate", { ...input, title: "B" }, "same"),
    ).rejects.toThrow("different input");
    await expect(f.call("get", { taskId: "foreign" })).rejects.toThrow(
      "does not belong",
    );
    await expect(f.delegate(["a"], { harness: "pi" })).rejects.toThrow(
      "not allowed",
    );
  });
  it("does not dispatch a worker if its task cannot be persisted", async () => {
    const f = setup();
    await f.start();
    f.store.save.mockRejectedValueOnce(new Error("Disk full"));
    await expect(f.delegate(["a"])).rejects.toThrow("Disk full");
    expect(f.manager.run("lead")!.status).toBe("paused");
    expect(f.host.submit).not.toHaveBeenCalled();
  });
  it("persists a delegation and its retry receipt in the same snapshot", async () => {
    const f = setup();
    await f.start();
    const input = {
      title: "A",
      prompt: "Implement",
      harness: "codex",
      files: ["a"],
    };
    await f.call("delegate", input, "durable");
    const firstTaskSave = f.store.save.mock.calls.find(
      ([run]) => run.tasks.length === 1,
    )![0];
    expect(firstTaskSave.requests.durable.result).toMatchObject({
      taskId: firstTaskSave.tasks[0].id,
    });
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    await restored.hydrate("lead");
    expect(await restored.handle("lead", "durable", "delegate", input)).toEqual(
      firstTaskSave.requests.durable.result,
    );
    expect(restored.run("lead")!.tasks).toHaveLength(1);
  });
  it("rejects conflicting reuse of an in-flight request ID", async () => {
    const f = setup();
    await f.start();
    let release!: (paths: string[]) => void;
    f.store.scopes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const input = {
      title: "A",
      prompt: "Implement",
      harness: "codex",
      files: ["a"],
    };
    const pending = f.call("delegate", input, "pending");
    await vi.waitFor(() => expect(f.store.scopes).toHaveBeenCalled());
    await expect(
      f.call("delegate", { ...input, files: ["b"] }, "pending"),
    ).rejects.toThrow("different input");
    release(["/repo/a"]);
    await pending;
    expect(f.tasks()).toHaveLength(1);
  });
  it("stops an active worker if saving another assignment fails", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.store.save.mockRejectedValueOnce(new Error("Disk full"));
    await expect(f.delegate(["b"])).rejects.toThrow("Disk full");
    expect(f.host.stop).toHaveBeenCalledWith(f.tasks()[0].sessionId);
    expect(f.manager.run("lead")!.status).toBe("paused");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
  it("blocks only the worker that escapes its scope and allows an explicit re-scope", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await f.delegate(["src/c"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    const offender = f.tasks()[0];
    const independent = f.tasks()[1];
    f.manager.observe(f.tasks()[0].sessionId, {
      type: "tool.started",
      callId: "edit",
      title: "Edit",
      preview: { kind: "write", path: "src/a/../b/file.ts" },
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("blocked"));
    expect(f.tasks()[0].error).toContain("outside its assignment");
    expect(f.tasks()[1].status).toBe("running");
    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.manager.run("lead")!.error).toBeUndefined();
    expect(f.host.stop).toHaveBeenCalledWith(offender.sessionId);
    expect(f.host.stop).not.toHaveBeenCalledWith(independent.sessionId);

    await f.call("retry", {
      taskId: offender.id,
      text: "The additional file is required; continue carefully.",
      files: ["src/a", "src/b"],
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    expect(f.tasks()[0].files).toEqual(["src/a", "src/b"]);
    expect(f.tasks()[0].scopes).toEqual(["/repo/src/a", "/repo/src/b"]);
  });
  it("migrates an old global scope pause into one blocked task and resumable collateral work", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"], { title: "Offender" });
    await f.delegate(["src/b"], { title: "Independent" });
    await vi.waitFor(() =>
      expect(f.tasks().every((task) => task.activeDispatchId)).toBe(true),
    );
    const current = structuredClone(f.manager.run("lead")!);
    const reason =
      "Offender reported a write outside its assignment: /outside. Review the shared files before resuming.";
    const legacy = {
      ...current,
      status: "paused" as const,
      error: reason,
      tasks: current.tasks.map((task) => ({
        ...task,
        status: "failed" as const,
        error: reason,
        lastDispatchId: task.activeDispatchId,
        activeDispatchId: undefined,
      })),
      dispatches: current.dispatches?.map((dispatch) => ({
        ...dispatch,
        state: "failed" as const,
        error: reason,
      })),
    };

    const migrated = normalizeOrchestrationRun(legacy);

    expect(migrated.tasks.map((task) => task.status)).toEqual([
      "blocked",
      "interrupted",
    ]);
    expect(migrated.tasks.map((task) => task.delivered)).toEqual([false, true]);
    expect(migrated.dispatches?.map((dispatch) => dispatch.state)).toEqual([
      "blocked",
      "interrupted",
    ]);
    await f.manager.stopRun("lead");
  });
  it("allows OpenCode scratch writes only in that worker's private directory", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await f.delegate(["commands.py"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    const [worker, other] = f.tasks();
    const write = (path: string) => ({
      type: "tool.updated" as const,
      callId: path,
      title: "Write",
      status: "running",
      preview: previewFromToolPart({
        id: path,
        type: "tool",
        tool: "write",
        state: {
          status: "running",
          input: { filePath: path, content: "test" },
        },
      }),
    });
    expect(vi.mocked(f.host.submit).mock.calls[0][1]).toContain(
      worker.scratchDir,
    );
    // macOS reports both /var and /private/var for the same file.
    f.store.resolvePath.mockImplementation(async (path) =>
      path.replace(/^\/var\//, "/private/var/"),
    );
    f.manager.observe(
      worker.sessionId,
      write(`${worker.scratchDir!.replace("/private", "")}/helper.py`),
    );
    f.manager.observe(worker.sessionId, write("brief.py"));
    await vi.waitFor(() =>
      expect(f.store.resolvePath).toHaveBeenCalledTimes(2),
    );
    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.tasks().every((task) => task.status === "running")).toBe(true);
    f.manager.observe(worker.sessionId, write(`${other.scratchDir}/helper.py`));
    await vi.waitFor(() =>
      expect(f.tasks().map((task) => task.status)).toEqual([
        "blocked",
        "running",
      ]),
    );
    expect(f.tasks()[0].error).toContain("outside its assignment");
    expect(f.manager.run("lead")!.status).toBe("active");
  });

  it("keeps a paused run inspectable and automatically continues interrupted work on Resume", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.startApproved("lead", "card", proposal());
    await vi.waitFor(() => expect(f.host.createWorker).toHaveBeenCalledOnce());
    const interrupted = f.tasks().find((task) => task.title === "Types")!;
    const queued = f.tasks().find((task) => task.title === "UI")!;
    f.completions.get("lead")!({
      status: "failed",
      text: "",
      error: "Lead provider disconnected",
    });
    await vi.waitFor(() =>
      expect(f.manager.run("lead")?.status).toBe("paused"),
    );
    await vi.waitFor(() =>
      expect(f.tasks().find((task) => task.id === interrupted.id)?.status).toBe(
        "interrupted",
      ),
    );
    const pausedTask = f.tasks().find((task) => task.id === interrupted.id)!;
    expect(pausedTask.status).toBe("interrupted");
    expect(queued.status).toBe("queued");
    const reason = f.manager.run("lead")!.error;
    expect(await f.call("list")).toMatchObject({
      run: { status: "paused", error: reason },
    });
    expect(await f.call("get", { taskId: interrupted.id })).toMatchObject({
      runStatus: "paused",
      error: reason,
    });
    // A paused wait returns immediately despite queued validation.
    expect(await f.call("wait", { timeoutSeconds: 25 })).toMatchObject({
      status: "paused",
      recovery: expect.stringContaining(
        "Do not retry mutations or keep polling",
      ),
    });
    await expect(
      f.call("message", { taskId: interrupted.id, text: "Continue" }),
    ).rejects.toThrow("click Resume");
    await expect(f.call("finish")).rejects.toThrow(reason);
    const submitsBeforeResume = vi.mocked(f.host.submit).mock.calls.length;
    await f.manager.start("lead", ["codex"], 2);
    await vi.waitFor(() =>
      expect(vi.mocked(f.host.submit).mock.calls.length).toBeGreaterThan(
        submitsBeforeResume,
      ),
    );
    expect(f.manager.run("lead")!.lastPauseReason).toBe(reason);
    expect(f.tasks().find((task) => task.id === interrupted.id)?.status).toBe(
      "running",
    );
    expect(f.tasks().find((task) => task.id === queued.id)?.status).toBe(
      "queued",
    );
    const resumed = vi
      .mocked(f.host.submit)
      .mock.calls.slice(submitsBeforeResume)
      .find(([id]) => id === interrupted.sessionId);
    expect(resumed?.[1]).toContain("Continue the existing assignment");
    expect(resumed?.[1]).toContain("retained worker checkout");
    await f.manager.stopRun("lead");
  });

  it("does not allow scratch symlinks to escape into another assignment", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const task = f.tasks()[0];
    f.store.resolvePath.mockResolvedValueOnce("/repo/commands.py");
    f.manager.observe(task.sessionId, {
      type: "tool.started",
      callId: "link",
      title: "Write",
      preview: { kind: "write", path: `${task.scratchDir}/link/commands.py` },
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("blocked"));
    expect(f.manager.run("lead")!.status).toBe("active");
  });

  it("waits for scope verification before publishing a completed result", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const task = f.tasks()[0];
    let resolve!: (path: string) => void;
    f.store.resolvePath.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    f.manager.observe(task.sessionId, {
      type: "tool.updated",
      callId: "late",
      title: "Write",
      status: "completed",
      preview: { kind: "write", path: "/outside.py" },
    });
    f.completions.get(task.sessionId)!({ status: "completed", text: "Done" });
    expect(f.tasks()[0].status).toBe("running");
    resolve("/outside.py");
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("blocked"));
    await expect(f.call("review", { taskId: task.id })).rejects.toThrow(
      "blocked",
    );
  });

  it("ignores failed write reports and discards late checks from cancelled attempts", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["brief.py"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    const task = f.tasks()[0];
    const event = {
      type: "tool.updated" as const,
      callId: "outside",
      title: "Write",
      status: "failed",
      preview: { kind: "write" as const, path: "/outside.py" },
    };
    f.manager.observe(task.sessionId, event);
    expect(f.store.resolvePath).not.toHaveBeenCalled();
    let resolve!: (path: string) => void;
    f.store.resolvePath.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    f.manager.observe(task.sessionId, { ...event, status: "running" });
    f.completions.get(task.sessionId)!({
      status: "completed",
      text: "Old result awaiting its write check",
    });
    await f.call("cancel", { taskId: task.id });
    await f.call("message", {
      taskId: task.id,
      text: "Try again within scope",
    });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    resolve("/outside.py");
    await new Promise((done) => setTimeout(done, 0));
    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.tasks()[0].status).toBe("running");
    await f.manager.stopRun("lead");
  });

  it("accepts Windows drive paths inside an extended canonical scope", async () => {
    const f = setup();
    f.lead.cwd = "D:/Projects/repo-a";
    f.store.scopes.mockResolvedValueOnce(["//?/d:/projects/repo-a"]);
    await f.start();
    f.store.scopes.mockResolvedValueOnce(["//?/d:/projects/repo-a/src/a"]);
    await f.delegate(["src/a"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];

    for (const path of [
      "src/a/relative.ts",
      "D:/Projects/repo-a/src/a/forward.ts",
      "D:\\Projects\\repo-a\\src\\a\\backward.ts",
    ]) {
      f.manager.observe(task.sessionId, {
        type: "tool.started",
        callId: path,
        title: "Edit",
        preview: { kind: "write", path },
      });
    }

    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.tasks()[0].status).toBe("running");
  });
  it("holds ownership until a cancelled process has stopped", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    let stopped!: () => void;
    vi.mocked(f.host.stop).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          stopped = resolve;
        }),
    );
    const cancel = f.call("cancel", { taskId: f.tasks()[0].id });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("cancelling"));
    expect(f.tasks()[1].status).toBe("queued");
    stopped();
    await cancel;
    await vi.waitFor(() => expect(f.tasks()[1].status).toBe("running"));
  });
  it("stops queued work and suppresses lead continuation on stop", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const done = f.completions.get(f.tasks()[0].sessionId)!;
    await f.manager.stopRun("lead");
    done({ status: "completed", text: "late output" });
    f.lead.busy = false;
    f.manager.sync();
    expect(f.tasks().map((task) => task.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(f.manager.run("lead")!.status).toBe("stopped");
    expect(f.store.disable).toHaveBeenCalledWith("lead");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
  it("defers results when a user turn starts during continuation persistence", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.store.save.mockImplementation(async (run) => {
      f.saved.set(run.leadId, structuredClone(run));
      if (run.continuations === 1) f.lead.busy = true;
    });
    f.lead.busy = false;
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Tests pass",
    });
    await vi.waitFor(() => {
      expect(f.lead.busy).toBe(true);
      expect(f.tasks()[0].delivered).toBe(false);
      expect(f.manager.run("lead")!.continuations).toBe(0);
    });
    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    f.store.save.mockImplementation(async (run) => {
      f.saved.set(run.leadId, structuredClone(run));
    });
    f.lead.busy = false;
    f.manager.sync();
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
  });
  it("returns worker output to an idle lead once", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.lead.busy = false;
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Tests pass",
    });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.host.submit).mock.calls[1][0]).toBe("lead");
    expect(vi.mocked(f.host.submit).mock.calls[1][1]).toContain("Tests pass");
    f.manager.sync();
    expect(f.host.submit).toHaveBeenCalledTimes(2);
  });
  it("keeps results available and pauses when the lead cannot continue", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.lead.busy = false;
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Result",
    });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    f.completions.get("lead")!({
      status: "failed",
      text: "",
      error: "Provider unavailable",
    });
    await vi.waitFor(() =>
      expect(f.manager.run("lead")!.status).toBe("paused"),
    );
    expect(f.tasks()[0].delivered).toBe(false);
    f.manager.sync();
    expect(f.host.submit).toHaveBeenCalledTimes(2);
  });
  it("recovers interrupted tasks without claiming completion and continues them on Resume", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await vi.waitFor(() =>
      expect(f.saved.get("lead")?.tasks[0].status).toBe("running"),
    );
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    await restored.hydrate("lead");
    expect(restored.run("lead")?.status).toBe("paused");
    expect(restored.run("lead")?.tasks[0].status).toBe("interrupted");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    await restored.start("lead", ["codex"], 2);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    expect(restored.run("lead")?.tasks[0].status).toBe("running");
    expect(vi.mocked(f.host.submit).mock.calls[1][1]).toContain(
      "Continue the existing assignment",
    );
    await restored.stopRun("lead");
  });
  it("does not claim a turn or run is successful before review", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await expect(f.call("finish")).rejects.toThrow("Review all");
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "failed",
      text: "Partial edits",
      error: "Provider crashed",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("failed"));
    await expect(f.call("review", { taskId: f.tasks()[0].id })).rejects.toThrow(
      "Only a completed",
    );
  });
  it("names the way out of a run that cannot finish yet", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "failed",
      text: "",
      error: "Provider crashed",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("failed"));
    // A failed task can never be reviewed, so both exits must be spelled out.
    await expect(f.call("review", { taskId: f.tasks()[0].id })).rejects.toThrow(
      /message.*cancel/,
    );
    await expect(f.call("finish")).rejects.toThrow(/Task \(failed\)/);
    await expect(f.call("finish")).rejects.toThrow(/message.*cancel/);
    await f.call("cancel", { taskId: f.tasks()[0].id });
    expect(await f.call("finish")).toEqual({ finished: true });
  });
  it("rejects mistyped fields instead of silently dropping them", async () => {
    const f = setup();
    await f.start();
    // Silently ignoring depends_on would race two workers over one file.
    await expect(
      f.delegate(["a"], { depends_on: [], modelId: "codex:test" }),
    ).rejects.toThrow("Unknown delegate fields: depends_on, modelId");
    await expect(f.call("finish", { taskId: "x" })).rejects.toThrow(
      "finish takes no input",
    );
    await expect(f.call("wait", { timeout: 5 })).rejects.toThrow(
      "wait accepts: timeoutSeconds",
    );
    expect(f.tasks()).toHaveLength(0);
  });
  it("points a bad delegate at the values list would have returned", async () => {
    const f = setup();
    await f.start();
    await expect(f.delegate(["a"], { harness: "claude" })).rejects.toThrow(
      'Harness "claude" is not allowed in this run. Allowed: codex.',
    );
    await expect(f.delegate(["a"], { model: "codex:ghost" })).rejects.toThrow(
      "Choose a model ID returned by list for codex: codex:test.",
    );
    await expect(f.delegate([], {})).rejects.toThrow("at least one file");
    await expect(
      f.call("delegate", {
        title: "T",
        prompt: "P",
        harness: "codex",
        files: ["a"],
        dependsOn: ["nope"],
      }),
    ).rejects.toThrow("unknown or cancelled: nope");
  });
  it("keeps the retry ledger free of inherited object keys", async () => {
    const f = setup();
    await f.start();
    const first = await f.call(
      "delegate",
      {
        title: "A",
        prompt: "Implement",
        harness: "codex",
        files: ["a"],
      },
      "constructor",
    );
    expect(first).toHaveProperty("taskId");
  });
  it("quotes the control path only when the shell needs it", () => {
    expect(
      shellPath("/Applications/MonoCode.app/Contents/MacOS/monocode"),
    ).toBe("/Applications/MonoCode.app/Contents/MacOS/monocode");
    expect(shellPath("/Users/a b/MonoCode")).toBe("'/Users/a b/MonoCode'");
    expect(shellPath("C:/Program Files/MonoCode/monocode.exe")).toBe(
      '"C:/Program Files/MonoCode/monocode.exe"',
    );
    expect(shellPath("C:\\Tools\\monocode.exe")).toBe(
      "C:\\Tools\\monocode.exe",
    );
    // A backslash escapes in a POSIX shell, so bare would rewrite the path.
    expect(shellPath("/Users/a\\b/MonoCode")).toBe("'/Users/a\\b/MonoCode'");
    expect(shellPath("/Users/it's/MonoCode")).toBe(
      "'/Users/it'\\''s/MonoCode'",
    );
  });
  it("treats an action named after an Object member as unknown", async () => {
    const f = setup();
    await f.start();
    for (const action of ["constructor", "toString", "__proto__"])
      await expect(f.call(action)).rejects.toThrow(
        `Unknown action "${action}"`,
      );
  });
  it("routes a blocked agent to the lead instead of the user", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "rm -rf build",
        approval: { requestId: 7 },
      },
    ];
    const view = (await f.call("get", { taskId: f.tasks()[0].id })) as {
      needsInput?: { kind: string; requestId: number };
    };
    expect(view.needsInput).toMatchObject({ kind: "approval", requestId: 7 });
    // A stale or invented requestId must never decide a live prompt.
    await expect(
      f.call("respond", {
        taskId: f.tasks()[0].id,
        requestId: 6,
        decision: "allow",
      }),
    ).rejects.toThrow("Stale requestId");
    await expect(
      f.call("respond", {
        taskId: f.tasks()[0].id,
        requestId: 7,
        decision: "maybe",
      }),
    ).rejects.toThrow('decision must be "allow" or "deny"');
    await f.call("respond", {
      taskId: f.tasks()[0].id,
      requestId: 7,
      decision: "deny",
    });
    expect(f.host.respondApproval).toHaveBeenCalledWith(worker.id, 7, "deny");
  });
  it("returns from wait immediately when a worker already needs input", async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "Run the check",
        approval: { requestId: 7 },
      },
    ];

    const waiting = f.call("wait", { timeoutSeconds: 20 }) as Promise<{
      tasks: Array<{ needsInput?: { kind: string; requestId: number } }>;
    }>;
    expect(vi.getTimerCount()).toBe(0);
    expect((await waiting).tasks[0].needsInput).toMatchObject({
      kind: "approval",
      requestId: 7,
    });
  });
  it("wakes an active wait as soon as a worker needs input", async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;

    const waiting = f.call("wait", { timeoutSeconds: 20 }) as Promise<{
      tasks: Array<{ needsInput?: { kind: string; requestId: number } }>;
    }>;
    expect(vi.getTimerCount()).toBe(1);
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "Run the check",
        approval: { requestId: 8 },
      },
    ];
    f.manager.sync();

    expect((await waiting).tasks[0].needsInput).toMatchObject({
      kind: "approval",
      requestId: 8,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("validates the lead's answer against the agent's own question", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.pendingQuestion = {
      requestId: 9,
      title: "Pick a check",
      questions: [
        {
          id: "check",
          prompt: "Which check?",
          multiSelect: false,
          allowCustom: false,
          options: [{ id: "unit", label: "Unit" }],
        },
      ],
    };
    const taskId = f.tasks()[0].id;
    await expect(
      f.call("answer", { taskId, requestId: 9, answers: { check: ["e2e"] } }),
    ).rejects.toThrow("Unknown option");
    await expect(
      f.call("answer", { taskId, requestId: 9, answers: { nope: ["unit"] } }),
    ).rejects.toThrow("Unknown question");
    await f.call("answer", {
      taskId,
      requestId: 9,
      answers: { check: ["unit"] },
    });
    expect(f.host.answerQuestion).toHaveBeenCalledWith(worker.id, 9, {
      kind: "answered",
      answers: { check: ["unit"] },
    });
  });
  it("stops the agents whenever the lead stops supervising", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.startApproved("lead", "card", proposal());
    await vi.waitFor(() =>
      expect(f.host.createWorker).toHaveBeenCalledTimes(1),
    );
    const running = f.tasks().find((task) => task.title === "Types")!;
    expect(running.status).toBe("running");
    // The lead's turn dies. Its agents must not carry on without supervision.
    f.completions.get("lead")!({
      status: "failed",
      text: "",
      error: "Provider crashed",
    });
    await vi.waitFor(() =>
      expect(f.manager.run("lead")!.status).toBe("paused"),
    );
    await vi.waitFor(() =>
      expect(f.tasks().find((task) => task.title === "Types")!.status).toBe(
        "interrupted",
      ),
    );
    expect(f.host.stop).toHaveBeenCalledWith(running.sessionId);
    // Queued work is untouched, so resuming picks it up intact.
    expect(f.tasks().find((task) => task.title === "UI")!.status).toBe(
      "queued",
    );
  });
  it("steers a running agent and refuses one that is not", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    await f.call("steer", { taskId: task.id, text: "Use the existing helper" });
    expect(f.host.steer).toHaveBeenCalledWith(
      task.sessionId,
      "Use the existing helper",
    );
    // Steering must not end the turn, so the agent keeps its work.
    expect(f.tasks()[0].status).toBe("running");
    expect(f.host.stop).not.toHaveBeenCalledWith(task.sessionId);
    // A stopped agent takes a fresh turn instead, and the error says so.
    f.completions.get(task.sessionId)!({
      status: "completed",
      text: "Done",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await expect(
      f.call("steer", { taskId: task.id, text: "Too late" }),
    ).rejects.toThrow(/Only a running agent can be steered.*message/s);
  });
  it("blocks ordinary sessions while a run owns their checkout", async () => {
    const f = setup();
    await f.start();
    f.sessions.push({
      ...newSession("claude", "/repo"),
      id: "other",
      busy: false,
    });
    expect(f.manager.submissionError("other")).toContain("active orchestrator");
    expect(f.manager.submissionError("lead")).toBeNull();
  });
  it("does not block a home-folder session containing a controlled checkout", async () => {
    const f = setup();
    await f.start();
    f.sessions.push({ ...newSession("claude", "/"), id: "home", busy: false });
    expect(f.manager.submissionError("home")).toBeNull();
  });
});
