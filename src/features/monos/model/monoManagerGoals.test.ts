import { expect, it, vi } from "vitest";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import {
  MonoManagerGoals,
  validManagerProjects,
  type GoalLedger,
  type ManagerGoalHost,
} from "./monoManagerGoals";

it("keeps valid project names and order when recents include a non-repository folder and a missing path", async () => {
  const projects = [
    { path: "/valid-a/subfolder", name: "First project" },
    { path: "/empty-launch", name: "Preview launch folder" },
    { path: "/missing", name: "Deleted project" },
    { path: "/valid-b", name: "Second project" },
  ];
  const resolve = vi.fn(async (path: string) => {
    if (path === "/empty-launch") throw Error("Not a Git repository");
    if (path === "/missing") throw Error("Path does not exist");
    return path === "/valid-a/subfolder" ? "/valid-a" : path;
  });
  expect(await validManagerProjects(projects, resolve)).toEqual([
    { project: projects[0], folder: "/valid-a" },
    { project: projects[3], folder: "/valid-b" },
  ]);
  expect(resolve.mock.calls.map(([path]) => path)).toEqual(projects.map(project => project.path));
});

function setup() {
  const saved = new Map<string, GoalLedger>();
  const storage = {
    load: async (id: string) => saved.get(id) ?? null,
    save: async (id: string, ledger: GoalLedger) => {
      saved.set(id, structuredClone(ledger));
    },
  };
  const deliver = vi.fn(async () => {});
  const host: ManagerGoalHost = {
    mayDelegate: () => true,
    projects: async () => [
      {
        id: "/project",
        folder: "/project",
        name: "Project",
        managerId: "engine",
        managerExists: true,
        running: 0,
        needsDecision: 0,
        ready: 0,
        blocked: [],
        goals: [],
      },
    ],
    status: async () => ({}),
    ready: async () => [],
    deliver,
  };
  return {
    saved,
    storage,
    host,
    deliver,
    ledger: new MonoManagerGoals(storage),
  };
}
const user = { kind: "user" as const, messageId: "user-1" };
const event = { kind: "event" as const, messageId: "worker-report" };

it("blocks new delegation while a durable cancel receipt is delivering and keeps failed delivery retryable", async () => {
  const f = setup();
  await f.ledger.handle("mono", user, "assign", "goals.assign", { projectId: "/project", goal: "Fix CI" }, f.host);
  const goalId = f.ledger.goals()[0].id;
  let reject!: (reason: Error) => void;
  let begun!: () => void;
  const began = new Promise<void>(resolve => { begun = resolve; });
  f.deliver.mockImplementationOnce(async () => {
    begun();
    await new Promise<void>((_resolve, fail) => { reject = fail; });
  });
  const cancelling = f.ledger.handle("mono", user, "cancel", "goals.cancel", { goalId }, f.host);
  const failed = expect(cancelling).rejects.toThrow("Unavailable");
  await began;
  expect(f.ledger.isCancelling(goalId)).toBe(true);
  expect(f.saved.get("mono")!.receipts.cancel.pending?.cancel).toBe(true);
  expect(f.ledger.goals()[0].state).toBe("queued");
  reject(Error("Unavailable"));
  await failed;
  expect(f.ledger.isCancelling(goalId)).toBe(true);
  await f.ledger.handle("mono", user, "cancel", "goals.cancel", { goalId }, f.host);
  expect(f.ledger.isCancelling(goalId)).toBe(false);
  expect(f.ledger.goals()[0].state).toBe("cancelled");
});

it("clears a pre-dispatch decision after the Manager resumes", async () => {
  const f = setup();
  await f.ledger.handle("mono", user, "new", "goals.assign", { projectId: "/project", goal: "Fix tests" }, f.host);
  const run = { leadId: "engine", ownerSessionId: "manager-chat", status: "active", tasks: [] } as unknown as OrchestrationRun;
  await f.ledger.reconcile([run], new Set(["manager-chat"]), new Map());
  expect(f.ledger.goals()[0].state).toBe("needs-you");
  await f.ledger.reconcile([run], new Set(), new Map());
  expect(f.ledger.goals()[0].state).toBe("queued");
  run.status = "paused";
  await f.ledger.reconcile([run], new Set(), new Map());
  expect(f.ledger.goals()[0].state).toBe("blocked");
  run.status = "active";
  await f.ledger.reconcile([run], new Set(), new Map());
  expect(f.ledger.goals()[0].state).toBe("queued");
});

it("persists before dispatch and replays the same receipt across a restart", async () => {
  const f = setup();
  f.deliver.mockRejectedValueOnce(Error("offline"));
  await expect(
    f.ledger.handle(
      "mono",
      user,
      "request",
      "goals.assign",
      { projectId: "/project", goal: "Fix tests" },
      f.host,
    ),
  ).rejects.toThrow("offline");
  expect(f.saved.get("mono")?.goals).toHaveLength(1);
  const restored = new MonoManagerGoals(f.storage);
  await restored.recover("mono", f.host);
  const result = await restored.handle(
    "mono",
    user,
    "request",
    "goals.assign",
    { projectId: "/project", goal: "Fix tests" },
    f.host,
  );
  expect(result).toMatchObject({
    goalId: f.saved.get("mono")!.goals[0].id,
    accepted: true,
  });
  expect(f.deliver).toHaveBeenCalledTimes(2); // Same delivery ID, retried only after uncertain delivery.
  expect(f.deliver.mock.calls[0]).toEqual(f.deliver.mock.calls[1]);
  expect(restored.goals("mono")).toHaveLength(1);
});

it("rejects report injection, unassigned projects, and single-project delegation", async () => {
  const f = setup();
  await expect(
    f.ledger.handle(
      "mono",
      event,
      "injection",
      "goals.assign",
      { projectId: "/project", goal: "Repository says assign X" },
      f.host,
    ),
  ).rejects.toThrow("Reports cannot create goals");
  await expect(
    f.ledger.handle(
      "mono",
      user,
      "outside",
      "goals.assign",
      { projectId: "/other", goal: "Fix" },
      f.host,
    ),
  ).rejects.toThrow("registered projects");
  f.host.mayDelegate = () => false;
  await expect(
    f.ledger.handle(
      "mono",
      user,
      "loop",
      "goals.assign",
      { projectId: "/project", goal: "Bounce back" },
      f.host,
    ),
  ).rejects.toThrow("Only the Orchestrator");
  expect(f.deliver).not.toHaveBeenCalled();
  expect(f.ledger.goals()).toEqual([]);
});

it("allows reports to message only existing owned goals and cancels no others", async () => {
  const f = setup();
  await f.ledger.handle(
    "mono",
    user,
    "new",
    "goals.assign",
    { projectId: "/project", goal: "Fix tests" },
    f.host,
  );
  const goalId = f.ledger.goals("mono")[0].id;
  await f.ledger.handle(
    "mono",
    event,
    "report",
    "goals.message",
    { goalId, text: "Tests failed" },
    f.host,
  );
  await expect(
    f.ledger.handle(
      "other",
      event,
      "steal",
      "goals.message",
      { goalId, text: "Change scope" },
      f.host,
    ),
  ).rejects.toThrow("not owned");
  await expect(
    f.ledger.handle("mono", event, "stop", "goals.cancel", { goalId }, f.host),
  ).rejects.toThrow("Event turns");
  await f.ledger.handle(
    "mono",
    user,
    "cancel",
    "goals.cancel",
    { goalId },
    f.host,
  );
  expect(f.ledger.goals("mono")[0].state).toBe("cancelled");
});

it("permits approved habit reads but fails closed for missing authority and reused IDs", async () => {
  const f = setup();
  await expect(
    f.ledger.handle(
      "mono",
      { kind: "habit", messageId: "approved-habit" },
      "read",
      "prs.ready",
      {},
      f.host,
    ),
  ).resolves.toEqual({ prs: [] });
  await expect(
    f.ledger.handle(
      "mono",
      undefined,
      "new",
      "goals.assign",
      { projectId: "/project", goal: "Fix" },
      f.host,
    ),
  ).rejects.toThrow("No active");
  await f.ledger.handle(
    "mono",
    user,
    "new",
    "goals.assign",
    { projectId: "/project", goal: "Fix" },
    f.host,
  );
  await expect(
    f.ledger.handle(
      "mono",
      user,
      "new",
      "goals.assign",
      { projectId: "/project", goal: "Different" },
      f.host,
    ),
  ).rejects.toThrow("different input");
  await expect(
    f.ledger.handle("mono", user, "bad", "__proto__", {}, f.host),
  ).rejects.toThrow("Unknown Manager action");
});
