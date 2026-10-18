// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assignManagerCiRepair } from "./managerCiRepair";
import {
  MonoManagerGoals,
  type GoalLedger,
  type ManagerGoalHost,
} from "../../monos/model/monoManagerGoals";
import type { Mono } from "../../monos/model/mono";
import type { CiRepairRequest } from "./ciRepair";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
const manager: Mono = {
  id: "manager",
  sessionId: "real-chat",
  role: "manager",
  projects: ["/app"],
  name: "App Manager",
  mascot: "cat",
  color: "#abc",
};
const request: CiRepairRequest = {
  text: "Fix failed CI for PR #4.",
  prompt: "Inspect the failed test, preserve unrelated changes.",
  target: { repo: "a/app", number: 4, headOid: "abc", checks: [] },
};

it("creates one durable user goal for the real Manager and delivers its CI evidence", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager]));
  const saved = new Map<string, GoalLedger>();
  const ledger = new MonoManagerGoals({
    load: async (id) => saved.get(id) ?? null,
    save: async (id, state) => {
      saved.set(id, state);
    },
  });
  const deliver = vi.fn<ManagerGoalHost["deliver"]>(async () => {});
  const host: ManagerGoalHost = {
    mayDelegate: () => false,
    projects: async () => [
      {
        id: "/app",
        folder: "/app",
        name: "App",
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
  const receipt = await assignManagerCiRepair(
    manager,
    "/app",
    request,
    host,
    "repair-request",
    ledger,
  );
  expect(receipt).toEqual({
    accepted: true,
    managerId: "engine",
    goalId: ledger.goals()[0].id,
  });
  expect(ledger.goals()[0]).toMatchObject({
    monoId: manager.id,
    managerId: "engine",
    state: "queued",
    userMessageId: "repair-request",
  });
  expect(deliver.mock.calls[0][1]).toContain(request.prompt);
  await assignManagerCiRepair(
    manager,
    "/app",
    request,
    host,
    "repair-request",
    ledger,
  );
  expect(ledger.goals()).toHaveLength(1);
  expect(deliver).toHaveBeenCalledTimes(1);
});

it("rejects a replaced Manager before creating a goal", async () => {
  localStorage.setItem(
    "monocode:mono-roster",
    JSON.stringify([{ ...manager, id: "replacement" }]),
  );
  const host = { projects: vi.fn() } as unknown as ManagerGoalHost;
  await expect(
    assignManagerCiRepair(manager, "/app", request, host),
  ).rejects.toThrow("current Manager");
  expect(host.projects).not.toHaveBeenCalled();
});

it("retries a failed delivery with the picker request ID without duplicating the saved goal", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([manager]));
  const saved = new Map<string, GoalLedger>();
  const ledger = new MonoManagerGoals({
    load: async (id) => saved.get(id) ?? null,
    save: async (id, state) => {
      saved.set(id, state);
    },
  });
  const deliver = vi
    .fn<ManagerGoalHost["deliver"]>()
    .mockRejectedValueOnce(Error("Conversation unavailable"))
    .mockResolvedValue(undefined);
  const host: ManagerGoalHost = {
    mayDelegate: () => false,
    projects: async () => [
      {
        id: "/app",
        folder: "/app",
        name: "App",
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
  const pickerRequest = { ...request, requestId: "picker-request" };
  await expect(
    assignManagerCiRepair(
      manager,
      "/app",
      pickerRequest,
      host,
      undefined,
      ledger,
    ),
  ).rejects.toThrow("Conversation unavailable");
  expect(ledger.goals()).toHaveLength(1);
  await assignManagerCiRepair(
    manager,
    "/app",
    pickerRequest,
    host,
    undefined,
    ledger,
  );
  expect(ledger.goals()).toHaveLength(1);
  expect(deliver).toHaveBeenCalledTimes(2);
});
