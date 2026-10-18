// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { Mono } from "../monos/model/mono";
import type { OrchestrationRun, OrchestrationTask } from "../orchestration/model/orchestrationState";
import { prStatusKey } from "../source-control/hooks/usePrStatus";
import { buildTeamMap, teamMapEvents, teamMapFeed, type TeamMapEvent } from "./model";

const roster: Mono[] = [
  { id: "manager", name: "Manager", role: "manager", managerProject: "/app", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "worker", name: "Native Core", role: "member", reportsTo: "manager", projects: ["/app"], mascot: "fox", color: "#abc" },
];
const task: OrchestrationTask = { id: "routing", memberId: "worker", sessionId: "worker-chat", title: "Routing", prompt: "Inspect project routing", harness: "codex", model: "test", files: [], scopes: [], dependsOn: [], status: "completed", accepted: true, acceptedDispatchId: "dispatch", lastDispatchId: "dispatch", acceptedAt: 50, completionOutcome: "no-changes", result: "Verified", delivered: true };
const run: OrchestrationRun = { version: 2, leadId: "engine", ownerMonoId: "manager", cwd: "/app", status: "active", cli: "", allowedHarnesses: ["codex"], maxWorkers: 1, continuations: 0, requests: {}, tasks: [task], dispatches: [{ id: "dispatch", taskId: task.id, sessionId: task.sessionId, state: "completed", stage: "settled", startedAt: 10, updatedAt: 20, workspace: { id: "workspace", projectCwd: "/app", checkoutCwd: "/app", kind: "main" } }] };

it("lists lifecycle acceptance at acceptance time, ahead of older reports, with actor names", () => {
  const events = teamMapEvents({ roster, sessions: [], runs: [run] });
  const feed = teamMapFeed(events, roster);
  expect(feed[0]).toMatchObject({ id: "routing:finished", at: 50, kind: "accepted", count: 1 });
  expect(feed[0].sentence).toBe("Native Core → Manager · accepted (no changes) · Routing");
  expect(feed.map(event => event.at)).toEqual([50, 20, 10]);
  const historical = teamMapEvents({ roster, sessions: [], runs: [{ ...run, tasks: [{ ...task, acceptedAt: undefined }] }] });
  expect(historical.find(event => event.kind === "accepted")?.at).toBe(20);
});

it("merges only consecutive events of the same kind, actors, task and verdict", () => {
  const event: TeamMapEvent = { id: "message", at: 1, source: "worker", target: "manager", kind: "message", taskId: "routing", label: "Routing" };
  const events = [
    { ...event, id: "one", at: 1 }, { ...event, id: "two", at: 2, label: "Routing update" },
    { ...event, id: "other-task", at: 3, taskId: "build" },
    { ...event, id: "three", at: 4 }, { ...event, id: "four", at: 5 },
    { ...event, id: "five", at: 6, source: "manager", target: "worker" },
    { ...event, id: "six", at: 7, kind: "report" as const },
  ];
  expect(teamMapFeed(events, roster).map(event => [event.id, event.count])).toEqual([
    ["six", 1], ["five", 1], ["four", 2], ["other-task", 1], ["two", 2],
  ]);
  expect(teamMapFeed([{ ...event, kind: "review", changes: true }, { ...event, id: "approve", at: 2, kind: "review", changes: false }], roster)).toHaveLength(2);
  expect(events[0].at).toBe(1);
});

it("merges repeated message updates identifying the same task and retains explicit closure messages", () => {
  const messages = [1, 2, 3, 4, 5].map(at => ({ id: `message-${at}`, managerId: "manager", senderId: "worker", recipientId: "manager", topic: "Routing update", text: `Routing progress ${at}`, at }));
  const closed = { ...messages[0], id: "closed", topic: "Task closed", text: "Routing is closed", at: 60 };
  const feed = teamMapFeed(teamMapEvents({ roster, sessions: [], runs: [{ ...run, tasks: [{ ...task, accepted: false }], dispatches: [] }], messages: [...messages, closed] }), roster);
  expect(feed.map(event => [event.kind, event.count])).toEqual([["closed", 1], ["message", 5]]);
});

it("includes PR-ready and closed PR outcomes without treating an open PR as closed", () => {
  const prTask = { ...task, completionOutcome: undefined, prUrl: "https://example.test/pull/1", prReadyAt: 40, workspace: { id: "checkout", projectCwd: "/app", checkoutCwd: "/checkout", branch: "routing", kind: "worktree" as const } };
  const statuses = new Map([[prStatusKey("/checkout", "routing"), { number: 1, title: "Routing", url: prTask.prUrl, state: "closed", closedAt: new Date(60).toISOString() }]]);
  const events = teamMapEvents({ roster, sessions: [], runs: [{ ...run, tasks: [prTask] }], statuses });
  expect(events.some(event => event.kind === "pr")).toBe(true);
  expect(events.some(event => event.kind === "closed")).toBe(true);
  expect(teamMapFeed(events, roster)[0]).toMatchObject({ kind: "closed", at: 60 });
  statuses.get(prStatusKey("/checkout", "routing"))!.closedAt = "invalid";
  expect(teamMapEvents({ roster, sessions: [], runs: [{ ...run, tasks: [prTask] }], statuses }).find(event => event.kind === "closed")?.at).toBe(50);
  statuses.get(prStatusKey("/checkout", "routing"))!.state = "open";
  expect(teamMapEvents({ roster, sessions: [], runs: [{ ...run, tasks: [prTask] }], statuses }).some(event => event.kind === "closed")).toBe(false);
});

it("keeps text-based review verdicts separate even when their topic matches", () => {
  const messages = [
    { id: "changes", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "Review Routing", text: "Changes requested: update the route", at: 10 },
    { id: "approved", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "Review Routing", text: "Approved, no changes needed", at: 20 },
  ];
  const feed = teamMapFeed(teamMapEvents({ roster, sessions: [], runs: [run], messages }), roster).filter(event => event.kind === "review");
  expect(feed.map(event => [event.id, event.changes, event.count])).toEqual([["approved", false, 1], ["changes", true, 1]]);
  expect(feed[1].sentence).toContain("requested changes");
});

it("does not merge distinct messages when overlapping task titles leave their identity ambiguous", () => {
  const messages = [
    { id: "first", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "Message", text: "Review Routing is ready", at: 10 },
    { id: "second", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "Message", text: "Review Routing is accepted", at: 20 },
  ];
  const events = teamMapEvents({ roster, sessions: [], runs: [{ ...run, dispatches: [], tasks: [task, { ...task, id: "review-routing", title: "Review Routing" }] }], messages });
  const feed = teamMapFeed(events, roster);
  expect(feed).toHaveLength(2);
  expect(feed.every(event => event.taskId === undefined && event.count === 1)).toBe(true);
});

it("prefers an explicit task ID over overlapping title matches", () => {
  const messages = [10, 20].map(at => ({ id: `message-${at}`, managerId: "manager", senderId: "worker", recipientId: "manager", topic: "Message", text: `review-routing Review Routing progress ${at}`, at }));
  const events = teamMapEvents({ roster, sessions: [], runs: [{ ...run, dispatches: [], tasks: [task, { ...task, id: "review-routing", title: "Review Routing" }] }], messages });
  expect(teamMapFeed(events, roster)).toMatchObject([{ taskId: "review-routing", count: 2, label: "Review Routing" }]);
});

it("describes the active edge flow using the worker's task and reporting parent", () => {
  const edge = (status: OrchestrationTask["status"]) => buildTeamMap({ roster, sessions: [], runs: [{ ...run, tasks: [{ ...task, status, accepted: false }] }] }).edges[0];
  expect(edge("running").tooltip).toBe("Native Core is working on Routing · progress reports up to Manager");
  expect(edge("queued").tooltip).toBe("Manager assigned Routing · waiting for Native Core to start");
  expect(edge("completed").tooltip).toContain("Native Core reports to Manager");
});
