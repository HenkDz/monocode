import { expect, it } from "vitest";
import {
  newSession,
  type Block,
  type MonoSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import {
  launchedSessionState,
  monoSpawnedSessions,
  recordMonoSpawnedSession,
  sanitizeMonoSpawnedSessions,
} from "./monoSpawnedSessions";

const launch: MonoSpawnedSession = {
  sessionId: "app-mono-review",
  cwd: "/repo",
  title: "Review latest PR",
  harness: "codex",
  model: "gpt-6",
};

it("attaches accepted launches to their originating turn without mutating or duplicating them", () => {
  const mono = newSession("codex", "/repo");
  mono.blocks = [
    { id: "first", role: "user", text: "Review" },
    { id: "reply", role: "assistant", text: "Started" },
    { id: "second", role: "user", text: "Another task" },
  ];
  const updated = recordMonoSpawnedSession(mono, "first", launch);
  expect(mono.blocks[0].monoSpawnedSessions).toBeUndefined();
  expect(updated.blocks[0].monoSpawnedSessions).toEqual([launch]);
  expect(updated.blocks[2]).toBe(mono.blocks[2]);
  expect(monoSpawnedSessions(updated.blocks.slice(0, 2))).toEqual([launch]);
  expect(monoSpawnedSessions(updated.blocks.slice(2))).toEqual([]);
  expect(recordMonoSpawnedSession(updated, "first", launch)).toBe(updated);
  expect(recordMonoSpawnedSession(mono, "missing", launch)).toBe(mono);
  expect(recordMonoSpawnedSession(mono, "reply", launch)).toBe(mono);
});

function receipt(command = "monocode app sessions.start", ok = true): Block {
  return {
    id: "call",
    role: "tool",
    text: command,
    tool: {
      status: "completed",
      detail: JSON.stringify({
        ok,
        result: { ...launch, id: launch.sessionId },
      }),
    },
  };
}

it("recovers confirmed launches from older chats, including shell wrappers, and deduplicates metadata", () => {
  expect(monoSpawnedSessions([receipt()])).toEqual([launch]);
  expect(
    monoSpawnedSessions([
      receipt("/bin/zsh -lc 'monocode app sessions.start'"),
    ]),
  ).toEqual([launch]);
  expect(
    monoSpawnedSessions([
      {
        id: "user",
        role: "user",
        text: "Review",
        monoSpawnedSessions: [launch],
      },
      receipt(),
      receipt(),
    ]),
  ).toEqual([launch]);
});

it("does not turn failed, pending, unrelated or truncated output into session links", () => {
  const call = receipt();
  expect(
    monoSpawnedSessions([
      receipt(undefined, false),
      receipt("monocode app sessions.read"),
      receipt("echo monocode app sessions.start"),
      { ...call, role: "assistant" },
      { ...call, tool: { ...call.tool, status: "in_progress" } },
      { ...call, tool: { ...call.tool, detail: '{"ok":true,"result":' } },
    ]),
  ).toEqual([]);
});

function appReceipt(
  action: string,
  result: unknown,
  requestId?: string,
): Block {
  return {
    id: action,
    role: "tool",
    text: action,
    tool: {
      status: "completed",
      preview: {
        kind: "shell",
        title: `/bin/zsh -lc 'monocode app ${action}${requestId ? ` --request-id ${requestId}` : ""}'`,
      },
      detail: JSON.stringify({
        ok: true,
        result,
        ...(requestId ? { requestId } : {}),
      }),
    },
  };
}

it("recovers accepted follow-ups to existing sessions without linking every listed session", () => {
  const other = {
    ...launch,
    sessionId: "existing-session",
    title: "Second article",
  };
  const listing = appReceipt("sessions.list", {
    cwd: launch.cwd,
    sessions: [launch, other].map((entry) => ({
      ...entry,
      id: entry.sessionId,
    })),
  });
  const send = appReceipt("sessions.send", {
    sessionId: other.sessionId,
    submitted: true,
    alreadySubmitted: false,
    notifyOnComplete: true,
  });
  expect(monoSpawnedSessions([listing])).toEqual([]);
  expect(monoSpawnedSessions([listing, send, send])).toEqual([other]);
  // The listing can be in a different folded work group from the follow-up.
  expect(monoSpawnedSessions([send], [other])).toEqual([other]);
  expect(monoSpawnedSessions([send])).toEqual([]);
  expect(
    monoSpawnedSessions([
      listing,
      send,
      appReceipt("sessions.send", {
        sessionId: launch.sessionId,
        submitted: true,
        alreadySubmitted: true,
      }),
    ]),
  ).toEqual([other, launch]);
});

it("requires a successful submission and trustworthy session details to recover a follow-up", () => {
  const send = appReceipt("sessions.send", {
    sessionId: launch.sessionId,
    submitted: true,
  });
  const listing = appReceipt("sessions.list", {
    cwd: launch.cwd,
    sessions: [{ ...launch, id: launch.sessionId }],
  });
  const malformedListing = {
    ...listing,
    tool: { ...listing.tool, detail: '{"ok":true,"result":' },
  };
  expect(
    monoSpawnedSessions([
      listing,
      appReceipt("sessions.send", {
        sessionId: launch.sessionId,
        submitted: false,
      }),
      appReceipt("sessions.read", {
        sessionId: launch.sessionId,
        submitted: true,
      }),
      appReceipt("sessions.draft", {
        sessionId: launch.sessionId,
        submitted: true,
      }),
      appReceipt("sessions.send", { sessionId: "unlisted", submitted: true }),
      { ...send, role: "assistant" },
      { ...send, tool: { ...send.tool, status: "in_progress" } },
      {
        ...send,
        tool: {
          ...send.tool,
          detail: JSON.stringify({
            ok: false,
            result: { sessionId: launch.sessionId, submitted: true },
          }),
        },
      },
    ]),
  ).toEqual([]);
  expect(monoSpawnedSessions([malformedListing, send])).toEqual([]);
  expect(
    monoSpawnedSessions([
      { ...listing, tool: { ...listing.tool, status: "failed" } },
      send,
    ]),
  ).toEqual([]);
});

it("recovers reused sessions from CC5-A CLI listing and send receipts with request IDs", () => {
  // agentApp returns project cwd on the listing; control_cli adds requestId to the envelope.
  const listing = appReceipt(
    "sessions.list",
    {
      cwd: launch.cwd,
      sessions: [
        {
          id: launch.sessionId,
          title: launch.title,
          harness: launch.harness,
          model: launch.model,
          busy: false,
          hasDraft: false,
          archived: false,
        },
      ],
    },
    "list-1",
  );
  const send = appReceipt(
    "sessions.send",
    {
      sessionId: launch.sessionId,
      submitted: true,
      alreadySubmitted: false,
      notifyOnComplete: true,
    },
    "send-1",
  );
  const retry = appReceipt(
    "sessions.send",
    {
      sessionId: launch.sessionId,
      submitted: true,
      alreadySubmitted: true,
      notifyOnComplete: true,
    },
    "send-1",
  );
  expect(monoSpawnedSessions([listing])).toEqual([]);
  expect(monoSpawnedSessions([listing, send, retry])).toEqual([launch]);
  expect(
    monoSpawnedSessions([send], monoSpawnedSessions([listing, retry])),
  ).toEqual([launch]);
});

it("keeps a reused session in both Monos without moving or duplicating its original card", () => {
  const first = {
    ...newSession("codex", "/repo"),
    blocks: [{ id: "first", role: "user" as const, text: "Start" }],
  };
  const second = {
    ...newSession("codex", "/repo"),
    blocks: [{ id: "second", role: "user" as const, text: "Continue" }],
  };
  const original = recordMonoSpawnedSession(first, "first", launch);
  const followUp = recordMonoSpawnedSession(second, "second", launch);
  expect(monoSpawnedSessions(original.blocks)).toEqual([launch]);
  expect(monoSpawnedSessions(followUp.blocks)).toEqual([launch]);
  expect(second.blocks[0]).not.toHaveProperty("monoSpawnedSessions");
  expect(recordMonoSpawnedSession(followUp, "second", launch)).toBe(followUp);
});

it("sanitizes saved references and strips extra fields", () => {
  expect(
    sanitizeMonoSpawnedSessions([
      { ...launch, title: "  Review  ", extra: "discard" },
      launch,
      { ...launch, sessionId: "../bad" },
      { ...launch, sessionId: "other", harness: "unknown" },
      { ...launch, sessionId: "empty", cwd: "" },
      null,
    ]),
  ).toEqual([{ ...launch, title: "Review" }]);
  expect(sanitizeMonoSpawnedSessions({})).toEqual([]);
});

it("uses canonical live states for launched sessions, including closed and unsent chats", () => {
  const session = newSession("codex", "/repo");
  const ran = (blocks: Block[], extra: Partial<Session> = {}) =>
    launchedSessionState({ ...session, blocks, ...extra }).status;
  const prompt: Block = { id: "u", role: "user", text: "Fix it" };
  expect(ran([prompt], { busy: true })).toBe("thinking");
  // Waiting on the user outranks working, so the card asks for attention.
  expect(
    ran(
      [
        prompt,
        { id: "a", role: "tool", text: "rm", approval: { requestId: 1 } },
      ],
      { busy: true },
    ),
  ).toBe("needs-you");
  expect(ran([{ ...prompt, draft: true }])).toBe("idle");
  expect(
    ran([prompt], {
      queuedMessages: [{ id: "q", text: "Next", attachments: [] }],
    }),
  ).toBe("queued");
  expect(
    ran([prompt], { busy: true, codexStorageError: "Repair AGENTS.md" }),
  ).toBe("blocked");
  expect(
    ran([prompt, { id: "e", role: "system", text: "Boom", notice: "error" }]),
  ).toBe("failed");
  expect(
    ran([
      prompt,
      { id: "i", role: "system", text: "Stopped", notice: "interrupt" },
    ]),
  ).toBe("idle");
  expect(ran([prompt, { id: "r", role: "assistant", text: "Done." }])).toBe(
    "idle",
  );
  expect(launchedSessionState(undefined)).toEqual({ status: "idle" });
  expect(launchedSessionState(undefined, { runStatus: "finished" })).toEqual({
    status: "done",
  });
});
