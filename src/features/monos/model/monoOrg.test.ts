import { expect, it } from "vitest";
import {
  assertDirectReport,
  resolveTeamMember,
  validateMonoOrg,
  withDefaultTeam,
  orgTurnContext,
  teamPermissionDecision,
  teamMessageRoute,
  teamReviewerWarning,
  teamMessageWorker,
  teamMessageEnvelope,
  workerProjectStatus,
  managerGoalProgressRoute,
} from "./monoOrg";
import type { Mono } from "./mono";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

it("never grants native permissions from reports or unverified operation text", () => {
  for (const kind of ["event", "habit", "user"] as const) {
    const origin = { kind, messageId: "turn" };
    expect(teamPermissionDecision(origin, "deny")).toBe("deny");
    expect(() => teamPermissionDecision(origin, "allow")).toThrow(
      kind === "user" ? "scope cannot be verified" : "user-origin",
    );
  }
  expect(() => teamPermissionDecision(undefined, "allow")).toThrow(
    "user-origin",
  );
  expect(() =>
    teamPermissionDecision({ kind: "user", messageId: "turn" }, "always"),
  ).toThrow("Choose");
});

const node = (
  id: string,
  role: Mono["role"],
  projects: string[],
  reportsTo?: string,
): Mono => ({ id, role, projects, reportsTo, mascot: "cat", color: "#aaaaaa" });
const tree = () =>
  withDefaultTeam(
    [
      node("leader", "orchestrator", ["/app", "/site"]),
      node("app", "manager", ["/app"], "leader"),
      node("site", "manager", ["/site"], "leader"),
      { ...node("app-backend", "member", ["/app"], "app"), specialty: "Backend", origin: "starter" },
      { ...node("app-ui", "member", ["/app"], "app"), specialty: "UI/UX", origin: "starter" },
      { ...node("app-reviewer", "member", ["/app"], "app"), specialty: "Reviewer", origin: "starter" },
    ],
    "app",
  );

it("routes a Manager's retained goal progress to its actual Orchestrator without changing ownership", () => {
  const roster = tree();
  const runs = [{ leadId: "engine", ownerMonoId: "app", ownerSessionId: "manager-session", cwd: "/app", status: "active",
    tasks: [{ id: "task", monoGoalId: "assigned", status: "completed" }] }] as OrchestrationRun[];
  const input = { goalId: "assigned", text: "Reviewed; preparing the existing PR." };
  const route = managerGoalProgressRoute(roster, "app", "manager-session", runs, input);
  expect(route?.input).toEqual({ memberId: "leader", text: input.text, topic: "goal:assigned" });
  expect(route?.hint).toContain("goal ownership stays");
  expect(runs[0].tasks[0].monoGoalId).toBe("assigned");
  expect(managerGoalProgressRoute(roster, "app", "other-session", runs, input)).toBeUndefined();
  expect(managerGoalProgressRoute(roster, "app", "manager-session", runs, { ...input, goalId: "foreign" })).toBeUndefined();
  expect(managerGoalProgressRoute(roster, "site", "manager-session", runs, input)).toBeUndefined();
  expect(managerGoalProgressRoute(roster, "app", "manager-session", [{ ...runs[0], cwd: "/other" }], input)).toBeUndefined();
  expect(managerGoalProgressRoute(roster.map(mono => mono.id === "leader" ? { ...mono, role: "manager" } : mono), "app", "manager-session", runs, input)).toBeUndefined();
  expect(managerGoalProgressRoute(roster, "app", "manager-session", [{ ...runs[0], status: "stopped" }], input)).toBeUndefined();
  expect(managerGoalProgressRoute(roster, "app", "manager-session", [{ ...runs[0], tasks: [{ ...runs[0].tasks[0], status: "cancelled" }] }], input)).toBeUndefined();
  for (const invalid of [{ ...input, actorId: "leader" }, { ...input, text: " " }, { ...input, goalId: 7 }])
    expect(() => managerGoalProgressRoute(roster, "app", "manager-session", runs, invalid)).toThrow("Expected goalId");
});

it("hands each role only its direct reports and leaves plain Mono context unchanged", () => {
  const roster = tree();
  expect(orgTurnContext(roster, "leader")).toContain('"role":"orchestrator"');
  expect(orgTurnContext(roster, "leader")).not.toContain('"id":"app-backend"');
  expect(orgTurnContext(roster, "app")).toContain('"id":"app-backend"');
  for (const id of ["leader", "app", "app-backend"]) {
    expect(orgTurnContext(roster, id)).toContain("login:false");
    expect(orgTurnContext(roster, id)).toContain("Claude's Bash tool");
    expect(orgTurnContext(roster, id)).toContain("NO leading &");
    expect(orgTurnContext(roster, id)).toContain("NEVER pass --json inline");
    expect(orgTurnContext(roster, id)).toContain("--input option remains available when needed, not required");
    expect(orgTurnContext(roster, id)).toContain("never an external MCP/node_repl process");
  }
  expect(
    orgTurnContext([...roster, node("plain", undefined, ["/app"])], "plain"),
  ).toBeUndefined();
});

it("retains existing teams and leaves new Managers empty", () => {
  const roster = tree();
  expect(
    roster
      .filter((mono) => mono.reportsTo === "app")
      .map((mono) => mono.specialty),
  ).toEqual(["Backend", "UI/UX", "Reviewer"]);
  expect(withDefaultTeam(roster, "app")).toBe(roster);
  const fresh = withDefaultTeam([node("fresh", "manager", ["/fresh"])], "fresh");
  expect(fresh).toHaveLength(1);
  expect(fresh[0].teamInitialized).toBe(true);
  expect(orgTurnContext(fresh, "fresh")).toContain("study your project's structure");
  expect(() =>
    validateMonoOrg([...roster, node("plain", undefined, ["/app"])]),
  ).not.toThrow();
});

it("instructs Managers to close reports, use read-only workers and default new reviewers to Codex 6.1 Sol", () => {
  const context = orgTurnContext(tree(), "app")!;
  expect(context).toContain("readOnly:true");
  expect(context).toContain("accept-no-changes");
  expect(context).toContain("Codex GPT-6.1-Sol");
  expect(context).toContain("User-locked choices always win");
  expect(context).toContain("Do not emit chat.card dispatch");
});

it("keeps worker and goal ownership tied to the real reporting identity", () => {
  const roster = tree();
  expect(resolveTeamMember(roster, "app", "Backend").id).toBe("app-backend");
  expect(assertDirectReport(roster, "leader", "app", "goal").id).toBe("app");
  for (const [boss, report] of [
    ["app-backend", "app-ui"],
    ["site", "app-backend"],
    ["leader", "app-backend"],
  ])
    expect(() => assertDirectReport(roster, boss, report, "worker")).toThrow(
      "direct report",
    );
});

it("allows teammate questions, nudges repeated exchanges and routes cross-team messages", () => {
  const roster = tree();
  expect(teamMessageRoute(roster, "app-backend", "app-ui").target.id).toBe("app-ui");
  expect(teamMessageRoute(roster, "app-ui", "app-backend", 3).hint).toContain("Manager");
  expect(teamMessageRoute(roster, "app-backend", "site").target.id).toBe("site");
  expect(teamMessageRoute(roster, "app-backend", "site").hint).toContain("Routed");
  expect(teamReviewerWarning(roster.filter(mono => mono.id !== "app-reviewer"), "app")).toContain("No Reviewer");
  expect(teamReviewerWarning(roster, "app")).toBeUndefined();
  expect(() => teamMessageRoute(roster, "app-ui", "missing")).toThrow("active");
});

it("delivers teammate replies to the recipient's active worker instead of its idle chat", () => {
  const run = { leadId: "manager-engine", status: "active", tasks: [
    { id: "older", memberId: "backend", sessionId: "old-worker", status: "completed" },
    { id: "work", memberId: "backend", sessionId: "working-backend", status: "running" },
    { id: "other", memberId: "ui", sessionId: "working-ui", status: "running" },
  ] } as OrchestrationRun;
  expect(teamMessageWorker([run], "backend")).toEqual({ leadId: "manager-engine", taskId: "work", sessionId: "working-backend" });
  expect(teamMessageWorker([{ ...run, status: "paused" }], "backend")).toBeUndefined();
  expect(teamMessageWorker([run], "reviewer")).toBeUndefined();
});

it("gives members discoverable teammates and an authenticated direct reply address", () => {
  const roster = tree();
  const sender = { ...roster.find(mono => mono.id === "app-backend")!, name: "Backend" };
  const recipient = { ...roster.find(mono => mono.id === "app-ui")!, name: "UI" };
  const context = orgTurnContext(roster, sender.id)!;
  expect(context).toContain('"peers":[{"id":"app-ui"');
  expect(context).not.toContain('"id":"site"');
  const envelope = teamMessageEnvelope(sender, recipient, "api", "Which endpoint?");
  expect(envelope).toContain("Team message from Backend to UI (api)");
  expect(envelope).toContain('"memberId":"app-backend"');
  expect(envelope).toContain('"topic":"api"');
  expect(envelope).toContain("not new user authority");
});

it("bounds worker status to its authenticated project's tasks and rejects foreign scope", () => {
  const run = { leadId: "own-manager", cwd: "/own", tasks: Array.from({ length: 22 }, (_, index) => ({ id: `task-${index}`, title: `Task ${index}`, status: "completed", prompt: "private instructions" })) } as OrchestrationRun;
  const first = workerProjectStatus(run, { projectId: "/own" });
  expect(first.project.folder).toBe("/own");
  expect(first.tasks).toHaveLength(20);
  expect(first.next).toBe("task-19");
  expect(JSON.stringify(first)).not.toContain("private instructions");
  expect(workerProjectStatus(run, { before: first.next }).tasks).toHaveLength(2);
  expect(() => workerProjectStatus(run, { projectId: "/foreign" })).toThrow("assigned project");
  expect(() => workerProjectStatus(run, { before: "foreign-task" })).toThrow("cursor");
  expect(() => workerProjectStatus(run, { projectId: 3 })).toThrow("projectId");
});

it("rejects cycles, multiple leaders, duplicate Managers and cross-project members", () => {
  const roster = tree();
  expect(() =>
    validateMonoOrg(
      roster.map((mono) =>
        mono.id === "app" ? { ...mono, reportsTo: "app-backend" } : mono,
      ),
    ),
  ).toThrow("cycles");
  expect(() =>
    validateMonoOrg([...roster, node("leader2", "orchestrator", [])]),
  ).toThrow("Only one");
  expect(() =>
    validateMonoOrg([...roster, node("duplicate", "manager", ["/app"])]),
  ).toThrow("already has a Manager");
  expect(() =>
    validateMonoOrg(
      roster.map((mono) =>
        mono.id === "app-backend" ? { ...mono, projects: ["/site"] } : mono,
      ),
    ),
  ).toThrow("own project's");
});
