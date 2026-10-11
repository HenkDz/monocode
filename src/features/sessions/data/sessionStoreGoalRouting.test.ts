import { beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block } from "../model/session";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { getMonoTranscriptPage, getSession, sanitizeSessionForPersist } = await import("./sessionStore");
const submission: NonNullable<Block["monoGoalSubmission"]> = {
  ownerId: "grand-1", requestId: "request-1", userMessageId: "user-1",
  projectId: "c:/projects/app", managerMonoId: "manager-1", reason: "Project selected",
  choice: { mode: "goal", override: "manager", projectId: "c:/projects/app" },
};

function saved(value: unknown = submission, extra: Partial<Block> = {}) {
  const session = newSession("codex", "/tmp/project");
  session.blocks = [{ id: "user-1", role: "user", text: "Fix app tests",
    monoGoalSubmission: value as Block["monoGoalSubmission"], ...extra }];
  return sanitizeSessionForPersist(session);
}

beforeEach(() => invoke.mockReset());

it("retains the durable goal identity through saving and both transcript loaders", async () => {
  const record = JSON.parse(JSON.stringify(saved()));
  invoke.mockImplementation(async (command: string) => command === "session_get" ? record :
    command === "mono_session_page" ? { blocks: record.blocks, before: null, hasNewer: false } : null);
  expect(record.blocks[0].monoGoalSubmission).toEqual(submission);
  const restored = await getSession(record.id);
  expect(restored?.blocks[0].monoGoalSubmission).toEqual(submission);
  expect(sanitizeSessionForPersist(restored!).blocks[0].monoGoalSubmission).toEqual(submission);
  expect((await getMonoTranscriptPage(record.id)).blocks[0].monoGoalSubmission).toEqual(submission);
});

it("accepts bounded identities and optional route metadata", () => {
  const bounded = { ...submission, ownerId: "o".repeat(128), requestId: "r".repeat(128),
    managerMonoId: "m".repeat(128), projectId: "/" + "p".repeat(4095), reason: "r".repeat(279) };
  expect(saved(bounded).blocks[0].monoGoalSubmission).toEqual(bounded);
  const minimal = { ownerId: "grand-1", requestId: "request-1", userMessageId: "user-1",
    reason: "Grand selected", choice: { mode: "chat", override: "grand" } };
  expect(saved(minimal).blocks[0].monoGoalSubmission).toEqual(minimal);
});

it.each([
  ["array", []], ["null", null],
  ["unknown field", { ...submission, origin: "user" }],
  ["unknown choice field", { ...submission, choice: { ...submission.choice, grant: true } }],
  ["invalid mode", { ...submission, choice: { ...submission.choice, mode: "report" } }],
  ["invalid override", { ...submission, choice: { ...submission.choice, override: "worker" } }],
  ["invalid owner", { ...submission, ownerId: "/tmp/grand" }],
  ["oversized owner", { ...submission, ownerId: "o".repeat(129) }],
  ["invalid request", { ...submission, requestId: "request:1" }],
  ["oversized request", { ...submission, requestId: "r".repeat(129) }],
  ["different user block", { ...submission, userMessageId: "another-user" }],
  ["oversized user identity", { ...submission, userMessageId: "u".repeat(129) }],
  ["invalid manager", { ...submission, managerMonoId: "manager/1" }],
  ["oversized manager", { ...submission, managerMonoId: "m".repeat(129) }],
  ["empty project", { ...submission, projectId: " " }],
  ["oversized project", { ...submission, projectId: "p".repeat(4097) }],
  ["invalid selected project", { ...submission, choice: { ...submission.choice, projectId: 1 } }],
  ["empty reason", { ...submission, reason: " " }],
  ["oversized reason", { ...submission, reason: "r".repeat(280) }],
] as const)("drops %s goal metadata without dropping the user message", (_label, malformed) => {
  expect(saved(malformed).blocks[0]).toEqual({ id: "user-1", role: "user", text: "Fix app tests" });
});

it.each([
  ["assistant", { role: "assistant" }], ["tool", { role: "tool" }],
  ["draft", { draft: true }],
  ["attachment", { attachments: [{ id: "file-1", name: "report.txt", kind: "file", mimeType: "text/plain", size: 1, path: "/report.txt" }] }],
  ["internal turn", { internal: true }], ["app request", { appRequestId: "request-1" }],
  ["malformed app request", { appRequestId: "" }],
  ["Manager report", { monoSource: { id: "manager-1", name: "Manager", mascot: "bot", color: "blue", goalId: "goal-1" } }],
  ["completion", { monoSessionCompletion: { sessionId: "worker-1", title: "Worker", status: "completed" } }],
  ["team message", { monoTeamMessage: { id: "worker-1", name: "Worker", mascot: "bot", color: "blue", topic: "Report", text: "Finished" } }],
  ["habit", { monoHabit: { id: "habit-1", name: "Check", at: 1 } }],
] as const)("does not restore new-goal authority from a %s", (_label, origin) => {
  expect(saved(submission, origin as Partial<Block>).blocks[0].monoGoalSubmission).toBeUndefined();
});
