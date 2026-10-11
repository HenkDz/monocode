import { expect, it, vi } from "vitest";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { newSession } from "../../sessions/model/session";
import {
  MonoManagerGoals,
  validManagerProjects,
  type GoalLedger,
  type GoalRouteMetadata,
  type ManagerGoalHost,
} from "./monoManagerGoals";
import { enqueueMonoMessage } from "./monoMessaging";

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
  const deliver = vi.fn<ManagerGoalHost["deliver"]>(async () => {});
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
const route: GoalRouteMetadata = {
  sourceUserMessageId: user.messageId,
  projectId: "/project",
  managerId: "engine",
  reason: "Exact project name",
  override: "auto",
};

it("stores the authorized route once and replays its receipt after reload", async () => {
  const f = setup();
  const input = { projectId: "/project", goal: "Fix tests" };
  const result = await f.ledger.handle("mono", user, "routed", "goals.assign", input, f.host, route);
  const restored = new MonoManagerGoals(f.storage);
  const reordered: GoalRouteMetadata = { override: route.override, reason: route.reason,
    managerId: route.managerId, projectId: route.projectId, sourceUserMessageId: route.sourceUserMessageId };
  expect(await restored.handle("mono", user, "routed", "goals.assign", input, f.host, reordered)).toEqual(result);
  expect(restored.goals("mono")).toHaveLength(1);
  expect(restored.goals("mono")[0]).toMatchObject({ route, userMessageId: user.messageId, state: "queued" });
  expect(Object.keys(f.saved.get("mono")!.receipts)).toEqual(["routed"]);
  expect(f.deliver).toHaveBeenCalledTimes(1);
  expect(restored.deliveryPending("mono", "routed")).toBe(false);
});

it("requires canonical route IDs while accepting the registered project path as input", async () => {
  const f = setup();
  const project = (await f.host.projects("mono"))[0];
  f.host.projects = async () => [{ ...project, id: "registered-project", folder: "C:\\Work\\Project", running: 2 }];
  const selected = { ...route, projectId: "registered-project", override: "manager" as const };
  const input = { projectId: "c:/work/project/", goal: "Fix tests" };
  await expect(f.ledger.handle("mono", user, "alias", "goals.assign", input, f.host,
    { ...selected, projectId: input.projectId })).rejects.toThrow("no longer matches");
  expect(f.saved.size).toBe(0);
  await f.ledger.handle("mono", user, "canonical", "goals.assign", input, f.host, selected);
  expect(f.ledger.goals()[0]).toMatchObject({ projectId: selected.projectId, route: selected, state: "queued" });
  expect(f.deliver).toHaveBeenCalledTimes(1);
});

it.each([
  { origin: event, action: "goals.assign", selected: route },
  { origin: { kind: "habit" as const, messageId: user.messageId }, action: "goals.assign", selected: route },
  { origin: user, action: "projects.list", selected: route },
  { origin: user, action: "goals.assign", selected: { ...route, sourceUserMessageId: "different-user" } },
  { origin: user, action: "goals.assign", selected: { ...route, override: "grand" } as unknown as GoalRouteMetadata },
])("rejects a route without a matching user assignment before persistence: %j", async ({ origin, action, selected }) => {
  const f = setup();
  await expect(f.ledger.handle("mono", origin, "invalid-route", action,
    action === "projects.list" ? {} : { projectId: "/project", goal: "Fix tests" }, f.host, selected))
    .rejects.toThrow("Invalid user goal route");
  expect(f.saved.size).toBe(0);
  expect(f.deliver).not.toHaveBeenCalled();
});

it("keeps route metadata out of the CLI input whitelist and preserves delegation authority", async () => {
  const f = setup();
  const input = { projectId: "/project", goal: "Fix tests" };
  await expect(f.ledger.handle("mono", user, "cli-route", "goals.assign", { ...input, route }, f.host))
    .rejects.toThrow("Unknown Manager action or input field");
  f.host.mayDelegate = () => false;
  await expect(f.ledger.handle("mono", user, "not-grand", "goals.assign", input, f.host, route))
    .rejects.toThrow("Only the Orchestrator");
  expect(f.saved.size).toBe(0);
  expect(f.deliver).not.toHaveBeenCalled();
});

it.each([
  { managerId: "replacement", managerExists: true },
  { managerId: route.managerId, managerExists: false },
])("rejects a stale Manager before a routed goal is persisted: %j", async changed => {
  const f = setup();
  const project = (await f.host.projects("mono"))[0];
  f.host.projects = async () => [{ ...project, ...changed }];
  await expect(f.ledger.handle("mono", user, "stale", "goals.assign",
    { projectId: "/project", goal: "Fix tests" }, f.host, route)).rejects.toThrow("no longer matches");
  expect(f.saved.size).toBe(0);
  expect(f.deliver).not.toHaveBeenCalled();
});

it("binds all route metadata to its receipt and rejects a changed Manager on retry", async () => {
  const f = setup();
  const input = { projectId: "/project", goal: "Fix tests" };
  f.deliver.mockRejectedValueOnce(Error("offline"));
  await expect(f.ledger.handle("mono", user, "bound", "goals.assign", input, f.host, route)).rejects.toThrow("offline");
  const saved = structuredClone(f.saved.get("mono"));
  for (const changed of [undefined, { ...route, reason: "Selected project" }, { ...route, override: "manager" as const },
    { ...route, managerId: "replacement" }, { ...route, projectId: "/other" }])
    await expect(f.ledger.handle("mono", user, "bound", "goals.assign", input, f.host, changed))
      .rejects.toThrow("different input");
  await expect(f.ledger.handle("mono", { ...user, messageId: "other-user" }, "bound", "goals.assign", input, f.host, route))
    .rejects.toThrow("Invalid user goal route");
  const project = (await f.host.projects("mono"))[0];
  f.host.projects = async () => [{ ...project, managerId: "replacement" }];
  await expect(f.ledger.handle("mono", user, "bound", "goals.assign", input, f.host, route))
    .rejects.toThrow("no longer available");
  expect(f.saved.get("mono")).toEqual(saved);
  expect(f.deliver).toHaveBeenCalledTimes(1);
});

it("binds the selected Manager Mono identity as well as its engine", async () => {
  const f = setup();
  const project = (await f.host.projects("mono"))[0];
  f.host.projects = async () => [{ ...project, managerMonoId: "selected-manager" }];
  const selected = { ...route, managerMonoId: "selected-manager" };
  const input = { projectId: "/project", goal: "Fix tests" };
  await expect(f.ledger.handle("mono", user, "wrong-manager", "goals.assign", input, f.host,
    { ...selected, managerMonoId: "other-manager" })).rejects.toThrow("no longer matches");
  expect(f.saved.size).toBe(0);
  f.deliver.mockRejectedValueOnce(Error("offline"));
  await expect(f.ledger.handle("mono", user, "selected-manager", "goals.assign", input, f.host, selected))
    .rejects.toThrow("offline");
  expect(f.ledger.goals()[0].route).toEqual(selected);
  await expect(f.ledger.handle("mono", user, "selected-manager", "goals.assign", input, f.host,
    { ...selected, managerMonoId: "other-manager" })).rejects.toThrow("different input");
  const saved = structuredClone(f.saved.get("mono"));
  f.host.projects = async () => [{ ...project, managerMonoId: "replacement-manager" }];
  await expect(f.ledger.handle("mono", user, "selected-manager", "goals.assign", input, f.host, selected))
    .rejects.toThrow("no longer available");
  expect(f.saved.get("mono")).toEqual(saved);
  const restored = new MonoManagerGoals(f.storage);
  await expect(restored.recover("mono", f.host)).rejects.toThrow("no longer available");
  expect(restored.deliveryPending("mono", "selected-manager")).toBe(true);
  expect(f.deliver).toHaveBeenCalledTimes(1);
});

it("retains a blocked route and its pending receipt across restart, then queues it once", async () => {
  const f = setup();
  f.deliver.mockRejectedValueOnce(Error("Manager storage blocked"));
  const input = { projectId: "/project", goal: "Fix tests" };
  await expect(f.ledger.handle("mono", user, "blocked-route", "goals.assign", input, f.host, route))
    .rejects.toThrow("Manager storage blocked");
  expect(f.saved.get("mono")!.goals[0]).toMatchObject({ state: "blocked", route });
  expect(f.ledger.deliveryPending("mono", "blocked-route")).toBe(true);
  const receipt = f.saved.get("mono")!.receipts["blocked-route"];
  const restored = new MonoManagerGoals(f.storage);
  await restored.hydrate("mono");
  expect(restored.deliveryPending("mono", "blocked-route")).toBe(true);
  const run = { leadId: "engine", ownerSessionId: "manager-chat", status: "active", tasks: [] } as unknown as OrchestrationRun;
  await restored.reconcile([run], new Set(), new Map());
  expect(restored.goals("mono")[0].state).toBe("blocked");
  await restored.recover("mono", f.host);
  expect(restored.goals("mono")[0]).toMatchObject({ state: "queued", route });
  expect(restored.deliveryPending("mono", "blocked-route")).toBe(false);
  expect(await restored.handle("mono", user, "blocked-route", "goals.assign", input, f.host, route)).toEqual(receipt.result);
  expect(Object.keys(f.saved.get("mono")!.receipts)).toEqual(["blocked-route"]);
  expect(f.deliver).toHaveBeenCalledTimes(2);
  expect(f.deliver.mock.calls[0][2]).toBe(f.deliver.mock.calls[1][2]);
});

it("revalidates a pending routed Manager on recovery", async () => {
  const f = setup();
  f.deliver.mockRejectedValueOnce(Error("offline"));
  await expect(f.ledger.handle("mono", user, "stale-recovery", "goals.assign",
    { projectId: "/project", goal: "Fix tests" }, f.host, route)).rejects.toThrow("offline");
  const project = (await f.host.projects("mono"))[0];
  f.host.projects = async () => [{ ...project, managerId: "replacement" }];
  const restored = new MonoManagerGoals(f.storage);
  await expect(restored.recover("mono", f.host)).rejects.toThrow("no longer available");
  expect(restored.deliveryPending("mono", "stale-recovery")).toBe(true);
  expect(restored.goals("mono")).toHaveLength(1);
  expect(f.deliver).toHaveBeenCalledTimes(1);
});

it("retires a pending routed assignment after its cancellation succeeds", async () => {
  const f = setup();
  f.deliver.mockRejectedValueOnce(Error("offline"));
  const input = { projectId: "/project", goal: "Fix tests" };
  await expect(f.ledger.handle("mono", user, "cancelled-route", "goals.assign", input, f.host, route))
    .rejects.toThrow("offline");
  const goalId = f.ledger.goals()[0].id;
  const originalReceipt = structuredClone(f.saved.get("mono")!.receipts["cancelled-route"]);
  await f.ledger.handle("mono", user, "cancel-route", "goals.cancel", { goalId }, f.host);
  expect(f.ledger.goals()[0].state).toBe("cancelled");
  expect(f.ledger.deliveryPending("mono", "cancelled-route")).toBe(true);
  expect(f.deliver).toHaveBeenCalledTimes(2);
  expect(f.deliver.mock.calls[1][3]).toBe(true);

  const restored = new MonoManagerGoals(f.storage);
  await restored.recover("mono", f.host);
  expect(restored.goals("mono")[0]).toMatchObject({ id: goalId, state: "cancelled", route });
  expect(restored.deliveryPending("mono", "cancelled-route")).toBe(false);
  expect(f.saved.get("mono")!.receipts["cancelled-route"]).toEqual({
    signature: originalReceipt.signature, result: originalReceipt.result,
  });
  expect(await restored.handle("mono", user, "cancelled-route", "goals.assign", input, f.host, route))
    .toEqual(originalReceipt.result);
  expect(Object.keys(f.saved.get("mono")!.receipts)).toEqual(["cancelled-route", "cancel-route"]);
  expect(f.deliver).toHaveBeenCalledTimes(2);
});

it("delivers a pending cancellation before retrying its blocked routed assignment", async () => {
  const f = setup();
  f.deliver.mockRejectedValueOnce(Error("assignment offline")).mockRejectedValueOnce(Error("cancel offline"));
  await expect(f.ledger.handle("mono", user, "cancel-pending-route", "goals.assign",
    { projectId: "/project", goal: "Fix tests" }, f.host, route)).rejects.toThrow("assignment offline");
  const goalId = f.ledger.goals()[0].id;
  await expect(f.ledger.handle("mono", user, "pending-cancel", "goals.cancel", { goalId }, f.host))
    .rejects.toThrow("cancel offline");
  const restored = new MonoManagerGoals(f.storage);
  await restored.recover("mono", f.host);
  expect(restored.goals("mono")[0].state).toBe("cancelled");
  expect(restored.deliveryPending("mono", "cancel-pending-route")).toBe(true);
  expect(restored.deliveryPending("mono", "pending-cancel")).toBe(false);
  expect(f.deliver.mock.calls.map(call => call[3])).toEqual([false, true, true]);
  expect(f.deliver.mock.calls[1][2]).toBe(f.deliver.mock.calls[2][2]);
  await restored.recover("mono", f.host);
  expect(restored.deliveryPending("mono", "cancel-pending-route")).toBe(false);
  expect(restored.goals("mono")).toHaveLength(1);
  expect(restored.goals("mono")[0].state).toBe("cancelled");
  expect(f.deliver).toHaveBeenCalledTimes(3);
});

it("retains the outbox identity when clearing a routed receipt fails after target acceptance", async () => {
  const f = setup();
  const save = f.storage.save;
  let saves = 0;
  f.storage.save = async (id, ledger) => {
    if (++saves === 2) throw Error("receipt write failed");
    await save(id, ledger);
  };
  let manager = newSession("codex", "/project");
  const deliver = vi.fn<ManagerGoalHost["deliver"]>(async (_goal, text, receiptId) => {
    if (manager.blocks.some(block => block.appRequestId === receiptId) ||
        manager.queuedMessages?.some(message => message.id === receiptId)) return;
    manager = enqueueMonoMessage(manager, { id: receiptId, text, attachments: [] });
  });
  f.host.deliver = deliver;
  const input = { projectId: "/project", goal: "Fix tests" };
  await expect(f.ledger.handle("mono", user, "write-failure", "goals.assign", input, f.host, route))
    .rejects.toThrow("receipt write failed");
  expect(f.ledger.goals()[0].state).toBe("blocked");
  expect(f.ledger.deliveryPending("mono", "write-failure")).toBe(true);
  const restored = new MonoManagerGoals(f.storage);
  await restored.handle("mono", user, "write-failure", "goals.assign", input, f.host, route);
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(manager.queuedMessages).toHaveLength(1);
  expect(manager.queuedMessages![0].id).toBe("mono-goal-mono-write-failure");
  expect(restored.goals("mono")).toHaveLength(1);
  expect(restored.goals("mono")[0].state).toBe("queued");
  expect(restored.deliveryPending("mono", "write-failure")).toBe(false);
});

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

it("replays the original goal receipt after lost stdout without a second queued delivery", async () => {
  const f = setup();
  let manager = newSession("codex", "/project");
  const deliver = vi.fn<ManagerGoalHost["deliver"]>(async (_goal, text, receiptId) => {
    manager = enqueueMonoMessage(manager, { id: receiptId, text, attachments: [] });
  });
  f.host.deliver = deliver;
  const input = { projectId: "/project", goal: "Fix tests" };

  // The mutation completed, but the caller did not receive its first CLI response.
  await f.ledger.handle("mono", user, "lost-output", "goals.assign", input, f.host).then(() => undefined);
  const original = f.saved.get("mono")!.receipts["lost-output"].result;
  const restored = new MonoManagerGoals(f.storage);
  const stdout = JSON.stringify(await restored.handle("mono", user, "lost-output", "goals.assign", input, f.host));

  expect(JSON.parse(stdout)).toEqual(original);
  expect(JSON.parse(stdout)).toMatchObject({ accepted: true, goalId: f.saved.get("mono")!.goals[0].id });
  expect(restored.goals("mono")).toHaveLength(1);
  expect(f.saved.get("mono")!.goals).toHaveLength(1);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(manager.queuedMessages).toHaveLength(1);
  expect(manager.queuedMessages![0]).toMatchObject({ id: "mono-goal-mono-lost-output", text: input.goal });
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
