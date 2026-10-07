import { expect, it, vi } from "vitest";
import { requestMemberWork } from "./memberWorkRequest";
import type { Mono } from "./mono";
const roster: Mono[] = [
  { id: "m", role: "manager", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#abc" },
  { id: "b", role: "member", reportsTo: "m", specialty: "Backend", projects: ["/app"], mascot: "cat", color: "#abc", workerProfile: { harness: "codex", model: "test" } },
];
it("routes direct user work into the Manager engine and notifies it, preserving the member profile", async () => {
  const receipt = { taskId: "task", sessionId: "worker" };
  const host = { delegate: vi.fn(async () => receipt), notify: vi.fn(async () => {}) };
  expect(await requestMemberWork(roster, "b", { kind: "user", messageId: "user-turn" }, "req", { title: "Fix", prompt: "Fix and test", files: ["src"] }, host)).toBe(receipt);
  expect(host.delegate).toHaveBeenCalledWith(roster[0], "member-b-req", expect.objectContaining({ member: "b", origin: "user", harness: "codex", model: "test", files: ["src"] }));
  expect(host.notify).toHaveBeenCalledWith(roster[0], roster[1], receipt, "req");
});
it("rejects event/habit authority, peer targets and injected fields before creating work", async () => {
  const host = { delegate: vi.fn(), notify: vi.fn() };
  for (const kind of ["event", "habit"] as const)
    await expect(requestMemberWork(roster, "b", { kind, messageId: "x" }, "r", { title: "Fix", prompt: "Fix" }, host)).rejects.toThrow("direct user");
  await expect(requestMemberWork(roster, "b", { kind: "user", messageId: "x" }, "r", { title: "Fix", prompt: "Fix", member: "other" }, host)).rejects.toThrow("Expected");
  expect(host.delegate).not.toHaveBeenCalled();
});
it.each([undefined, [], [""]])("rejects missing or empty scopes before touching the Manager engine (%j)", async files => {
  const host = { delegate: vi.fn(), notify: vi.fn() };
  await expect(requestMemberWork(roster, "b", { kind: "user", messageId: "x" }, "r", { title: "Fix", prompt: "Fix", files }, host)).rejects.toThrow("at least one");
  expect(host.delegate).not.toHaveBeenCalled();
});
