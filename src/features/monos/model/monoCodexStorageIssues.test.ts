import { expect, it } from "vitest";
import { codexStorageBlockedContext, monoCodexStorageIssues } from "./monoCodexStorageIssues";
import { newSession, type Session } from "../../sessions/model/session";

const blocked = (id: string, account = "default"): Session => ({
  ...newSession("codex", "/repo"),
  id,
  title: id,
  codexStorageAccountId: account,
  codexStorageError: "Codex storage needs repair: conflict",
  queuedMessages: [{ id: `${id}-message`, text: "Exact held prompt", attachments: [] }],
});

it("groups blocked members once per account and retains their exact session ids", () => {
  const issues = monoCodexStorageIssues(
    [blocked("Reviewer"), blocked("Backend"), blocked("Other", "work"), newSession("codex")],
    () => "newly-selected-account",
    session => session.title,
  );
  expect(issues).toHaveLength(2);
  expect(issues[0].accountId).toBe("default");
  expect(issues[0].sessionIds).toEqual(["Reviewer", "Backend"]);
  expect(issues[0].blockedContext).toContain("1 queued message on Reviewer is waiting");
  expect(issues[0].blockedContext).toContain("1 queued message on Backend is waiting");
  expect(issues[1].accountId).toBe("work");
});

it("describes unsent drafts without exposing prompt contents", () => {
  const session = { ...blocked("Reviewer"), queuedMessages: undefined,
    blocks: [{ id: "draft", role: "user" as const, text: "private prompt", draft: true }] };
  expect(codexStorageBlockedContext(session, "Reviewer")).toBe("An unsent message on Reviewer is waiting");
});
