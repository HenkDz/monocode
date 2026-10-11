import { afterEach, beforeEach, expect, it, vi } from "vitest";
const runForSession = vi.hoisted(() => vi.fn());
const habitOwner = vi.hoisted(() => vi.fn());
vi.mock("../../features/orchestration/model/orchestration", () => ({ orchestrator: { forSession: runForSession } }));
vi.mock("../../features/monos/model/monoHabits", () => ({ habitRunMono: habitOwner }));
import { monoSkillsForSession } from "./monoSkillsForSession";

beforeEach(() => {
  runForSession.mockReset();
  habitOwner.mockReset();
  const roster = [{ id: "manager", role: "manager", sessionId: "manager-chat", projects: ["/repo"], mascot: "cat", color: "#abc", teamSkillsPolicy: { mode: "custom", enabled: ["testing"] } },
    { id: "member", role: "member", reportsTo: "manager", projects: ["/repo"], mascot: "cat", color: "#abc", specialty: "Builder", skillsPolicy: { mode: "custom", enabled: ["frontend"] } }];
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "monocode:mono-roster" ? JSON.stringify(roster) : null, setItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

it("applies the same role policy to Mono chats and their Habit turns, leaving ordinary chats alone", () => {
  expect(monoSkillsForSession("manager-chat")).toMatchObject({ codexStore: "mono", skillsRole: "manager", skillsPolicy: { mode: "role" } });
  habitOwner.mockReturnValueOnce("manager");
  expect(monoSkillsForSession("habit-run")).toMatchObject({ codexStore: "mono", skillsRole: "manager" });
  expect(monoSkillsForSession("ordinary-chat")).toEqual({});
});

it("uses member overrides for delegated workers and the reviewer role for review tasks", () => {
  runForSession.mockReturnValue({ ownerMonoId: "manager", tasks: [{ sessionId: "worker-task", memberId: "member" }] });
  expect(monoSkillsForSession("worker-task")).toMatchObject({ codexStore: "mono", skillsRole: "worker", skillsPolicy: { mode: "custom", enabled: ["frontend"] } });
  runForSession.mockReturnValue({ ownerMonoId: "manager", tasks: [{ sessionId: "review-task", memberId: "member", reviewOf: { taskId: "implemented" } }] });
  expect(monoSkillsForSession("review-task").skillsRole).toBe("reviewer");
});

it("keeps unnamed legacy workers in the team default without applying the Manager's role", () => {
  runForSession.mockReturnValue({ ownerMonoId: "manager", tasks: [{ sessionId: "legacy-task" }] });
  expect(monoSkillsForSession("legacy-task")).toMatchObject({ codexStore: "mono", skillsRole: "worker", skillsPolicy: { mode: "custom", enabled: ["testing"] } });
});

it("leaves ordinary orchestration workers outside the Mono storage and skills policy", () => {
  runForSession.mockReturnValue({ tasks: [{ sessionId: "ordinary-worker", reviewOf: { taskId: "implemented" } }] });
  expect(monoSkillsForSession("ordinary-worker")).toEqual({});
});
