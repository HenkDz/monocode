import { describe, expect, it } from "vitest";
import type { GitPr } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";
import { selectCockpit } from "./cockpit";
import { selectGoalViews, type GoalViewInput } from "./goalView";

const fixture = (): GoalViewInput => structuredClone({ goals, roster, runs, sessions, now });
const project = (input = fixture(), statuses?: ReadonlyMap<string, GitPr | null>) => selectCockpit(input, statuses);
const agent = (input: GoalViewInput, name: string) => project(input).agents.find(item => item.name === name)!;

describe("CC7N Cockpit recorded organization projection", () => {
  it("retains the full roster, independent live activity and blockers with zero goals", () => {
    const input = fixture(); input.goals = [];
    const result = project(input);
    expect(result.agents).toHaveLength(roster.length);
    expect(result.active).toBe(1);
    expect(result.agents.find(item => item.name === "Reviewer")?.state).toMatchObject({ status: "blocked", reason: "storage" });
    expect(result.agents.find(item => item.name === "Search worker")?.activity).toContain("Validate search");
    expect(result.agents.find(item => item.name === "Builder")?.state.status).toBe("idle");
  });

  it("keeps Manager blocker rollup independent of goal visibility", () => {
    const input = fixture(); input.goals = [];
    expect(agent(input, "Atlas Manager").state).toMatchObject({ status: "waiting-on-member", waitingOn: "Reviewer", detail: "Reviewer blocked" });
  });

  it("uses canonical project keys shared with the App goal ledger on Windows", () => {
    const input = fixture();
    input.goals = input.goals.map(goal => ({ ...goal, projectId: pathKey(goal.projectId) }));
    expect(agent(input, "Atlas Manager").projectId).toBe(input.goals[0].projectId);
    expect(agent(input, "Reviewer").projectId).toBe(input.goals[0].projectId);
    expect(agent(input, "Grand Orch").projectId).toBeUndefined();
  });

  it("excludes archived members without hiding their retained goal history", () => {
    const input = fixture(); input.roster = input.roster.map(mono => ({ ...mono, archivedAt: mono.id === "synthetic-builder" ? now : undefined }));
    const views = selectGoalViews(input);
    expect(selectCockpit(input).agents.some(item => item.name === "Builder")).toBe(false);
    expect(views.live[0].nodes.some(node => node.name === "Builder")).toBe(true);
  });

  it("does not inherit historical worker blockers from a finished run", () => {
    const input = fixture(); input.goals = [];
    input.runs = input.runs.map(run => ({ ...run, status: "finished" }));
    const result = project(input);
    expect(result.agents.find(item => item.name === "Reviewer")?.state.status).toBe("idle");
    expect(result.agents.find(item => item.name === "Reviewer")?.target).toEqual({ monoId: "synthetic-reviewer" });
  });

  it("does not turn terminal goal failures into current member work", () => {
    const input = fixture();
    input.goals = input.goals.map(goal => ({ ...goal, state: "done" }));
    input.runs[0].tasks = [{ ...input.runs[0].tasks[1], status: "failed", error: "Historical review failed" }];
    expect(agent(input, "Reviewer")).toMatchObject({ state: { status: "idle" }, activity: "Available for a new assignment", target: { monoId: "synthetic-reviewer" } });
  });

  it("chooses a fresh queued assignment before an older failed attempt for the same member", () => {
    const input = fixture();
    const run = input.runs[0];
    const old = run.tasks[1];
    run.tasks = [{ ...old, status: "failed", error: "Previous attempt failed" }, {
      ...old, id: "new-review", sessionId: "new-review-chat", title: "Review the new assignment", status: "queued", activeDispatchId: undefined,
    }];
    run.dispatches = run.dispatches?.filter(dispatch => dispatch.taskId === old.id);
    input.sessions = input.sessions.filter(session => session.id !== old.sessionId);
    const result = agent(input, "Reviewer");
    expect(result.state.status).toBe("queued");
    expect(result.activity).toBe("Review the new assignment");
    expect(result.target).toEqual({ sessionId: "new-review-chat" });
  });

  it("opens the exact engine conversation whose blocker wins over the Manager's durable chat", () => {
    const input = fixture();
    input.runs[0].ownerSessionId = "blocked-engine-chat";
    input.sessions = [...input.sessions, { ...input.sessions[1], id: "blocked-engine-chat", codexStorageError: "Engine storage requires repair" }];
    const result = agent(input, "Atlas Manager");
    expect(result.state).toMatchObject({ status: "blocked", reason: "storage" });
    expect(result.target).toEqual({ sessionId: "blocked-engine-chat" });
  });

  it("routes a selected engine decision through the existing request-session adapter", () => {
    const input = fixture(); input.runs[0].ownerSessionId = "decision-engine-chat";
    input.sessions = [...input.sessions, { ...input.sessions[1], id: "decision-engine-chat", pendingQuestion: { requestId: 1, questions: [{ id: "continue", header: "Continue", prompt: "Continue this assignment?", multiSelect: false, allowCustom: true, options: [] }] } }];
    expect(agent(input, "Atlas Manager")).toMatchObject({ state: { status: "needs-you", reason: "decision" }, target: { requestSessionId: "decision-engine-chat" } });
  });

  it("leaves elapsed time unknown when the current turn has no captured start", () => {
    const input = fixture(); input.sessions = input.sessions.map(session => session.id === "synthetic-search-chat" ? { ...session, blocks: [] } : session);
    expect(agent(input, "Search worker").elapsedMs).toBeUndefined();
    expect(agent(input, "Search worker").state.status).toBe("thinking");
  });

  it("deduplicates receipt identities and excludes conflicting and reversed handoffs", () => {
    const input = fixture();
    expect(project(input)).toMatchObject({ handoffMs: 10_000, handoffSamples: 2 });
    input.runs = [...input.runs, structuredClone(input.runs[0])];
    expect(project(input)).toMatchObject({ handoffMs: 10_000, handoffSamples: 2 });
    input.runs[1].dispatches![0].turnStartedAt! += 1_000;
    expect(project(input)).toMatchObject({ handoffMs: 10_000, handoffSamples: 1 });
    input.runs[1].dispatches![2].turnStartedAt = input.runs[1].dispatches![2].dispatchedAt! - 1;
    expect(project(input)).toMatchObject({ handoffMs: undefined, handoffSamples: 0 });
  });

  it("counts each loaded session and started turn once for the local day without adding cache twice", () => {
    const input = fixture();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const first = { ...input.sessions[0].blocks[0], id: "daily-one", startedAt: today.getTime(), durationMs: 1_000,
      turnMetrics: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 90 } };
    const second = { ...first, id: "daily-two", startedAt: now - 1_000, turnMetrics: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 9 } };
    input.sessions = [{ ...input.sessions[0], blocks: [first, second, first,
      { ...first, id: "yesterday", startedAt: today.getTime() - 1 }, { ...first, id: "tomorrow", startedAt: now + 1 }] }];
    input.sessions = [...input.sessions, structuredClone(input.sessions[0])];
    expect(project(input)).toMatchObject({ tokensToday: 117, tokensPartial: false });
  });

  it("distinguishes observed zero, partial counters and unavailable counters", () => {
    const input = fixture();
    input.sessions = [{ ...input.sessions[0], blocks: [{ ...input.sessions[0].blocks[0], startedAt: now - 1_000, turnMetrics: { inputTokens: 0, outputTokens: 0 } }] }];
    expect(project(input)).toMatchObject({ tokensToday: 0, tokensPartial: false });
    input.sessions[0].blocks[0].turnMetrics = { outputTokens: 5 };
    expect(project(input)).toMatchObject({ tokensToday: 5, tokensPartial: true });
    input.sessions[0].blocks[0].turnMetrics = undefined;
    expect(project(input)).toMatchObject({ tokensToday: undefined, tokensPartial: true });
  });

  it("uses captured completion receipts for recent history while preserving unknown timestamps", () => {
    const input = fixture();
    const completed = project(input).activity.find(item => item.kind === "completion")!;
    expect(completed).toMatchObject({ at: now - 700_000, target: { sessionId: "synthetic-builder-chat" } });
    input.runs[0].dispatches![0].finishedAt = undefined;
    input.runs[0].dispatches![0].updatedAt = now;
    expect(project(input).activity.find(item => item.kind === "completion")?.at).toBeUndefined();
  });

  it("requires the task's exact recorded PR identity before labelling a verified merge", () => {
    const input = fixture(); const task = input.runs[0].tasks[0];
    task.workspace = { ...input.runs[0].workspace!, branch: "reused-branch" };
    task.prUrl = "https://example.test/Atlas/pull/1";
    const statuses = new Map<string, GitPr | null>([[prStatusKey(task.workspace.checkoutCwd, task.workspace.branch), {
      number: 2, title: "Unrelated old PR on reused branch", url: "https://example.test/Atlas/pull/2", state: "merged", closedAt: new Date(now - 1000).toISOString(),
    }]]);
    expect(project(input, statuses).activity.some(item => item.kind === "merge")).toBe(false);
    const pr = statuses.values().next().value!;
    statuses.set(prStatusKey(task.workspace.checkoutCwd, task.prUrl), { ...pr, number: 1, url: task.prUrl });
    expect(project(input, statuses).activity.find(item => item.kind === "merge")).toMatchObject({ detail: "Merged PR #1 · Builder · Completed", at: now - 1_000 });
  });

  it("gives equally named Managers their project initials and the organization lead its word initials", () => {
    const input = fixture();
    input.roster = [input.roster[0], { ...input.roster[1], name: "Manager" },
      { ...input.roster[1], id: "delta-manager", name: "Manager", managerProject: "C:/synthetic/Delta", projects: ["C:/synthetic/Delta"] }];
    expect(project(input).agents.map(item => item.initials)).toEqual(["GO", "AM", "DM"]);
  });

  it("keeps a verified merge once with completion and linked review as secondary detail", () => {
    const input = fixture(); const run = input.runs[0]; const task = run.tasks[0];
    task.prUrl = "https://example.test/Atlas/pull/1";
    task.workspace = run.workspace;
    run.dispatches![1] = { ...run.dispatches![1], state: "completed", finishedAt: now - 500 };
    const statuses = new Map<string, GitPr | null>([[prStatusKey(run.workspace!.checkoutCwd, task.prUrl), {
      number: 1, url: task.prUrl, title: task.title, state: "merged", closedAt: new Date(now - 1_000).toISOString(),
    }]]);
    input.runs.push(structuredClone(run));
    const recent = project(input, statuses).activity;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ kind: "merge", title: task.title, at: now - 1_000, target: { sessionId: task.sessionId } });
    expect(recent[0].detail).toBe("Merged PR #1 · Reviewer · Review completed · Builder · Completed");
  });

  it("keeps unrelated tasks with matching titles and goals distinct, and scopes task ids to their Manager", () => {
    const input = fixture(); const run = input.runs[0]; const task = run.tasks[0];
    run.tasks.push({ ...task, id: "another-task" });
    run.dispatches!.push({ ...run.dispatches![0], id: "another-dispatch", taskId: "another-task" });
    input.runs.push({ ...structuredClone(run), leadId: "another-manager" });
    const recent = project(input).activity;
    expect(recent).toHaveLength(4);
    expect(new Set(recent.map(item => item.id)).size).toBe(4);
  });

  it("coalesces repeated completions for a task or saved PR without inventing merge status", () => {
    const input = fixture(); const run = input.runs[0]; const task = run.tasks[0];
    run.dispatches!.push({ ...run.dispatches![0], id: "later-dispatch", sessionId: "later-chat", finishedAt: now - 500 });
    expect(project(input).activity).toHaveLength(1);
    expect(project(input).activity[0]).toMatchObject({ kind: "completion", at: now - 500, target: { sessionId: "later-chat" } });
    task.prUrl = "https://example.test/Atlas/pull/1";
    const other = structuredClone(run); other.leadId = "another-manager";
    input.runs.push(other);
    expect(project(input).activity).toHaveLength(1);
    expect(project(input).activity[0].kind).toBe("completion");
  });

  it("leaves roster, saved turns, task receipts and goal history unchanged", () => {
    const input = fixture(); const before = structuredClone(input);
    project(input);
    expect(input).toEqual(before);
  });
});
