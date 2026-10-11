import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { monoCodeToolCall, monoCodeToolSummary, monoCodeWorkSummary } from "./monocodeToolCall";

function shell(text: string): Block {
  return { id: text, role: "tool", text, tool: { kind: "shell" } };
}

describe("MonoCode CLI tool calls", () => {
  it("recognizes app actions with absolute, quoted, or bare executables", () => {
    expect(
      monoCodeToolCall(
        shell(
          "/repo/target/debug/MonoCode.app/Contents/MacOS/monocode app notes.list --json '{}'",
        ),
      )?.label,
    ).toBe("List notes");
    expect(
      monoCodeToolCall(
        shell(
          "'/Applications/MonoCode App/monocode' app folders.move --input -",
        ),
      )?.label,
    ).toBe("Move a session");
    expect(
      monoCodeToolCall(
        shell('"C:\\Program Files\\MonoCode\\monocode.exe" app notes.list'),
      )?.label,
    ).toBe("List notes");
    expect(monoCodeToolCall(shell("monocode app --help"))?.label).toBe(
      "View CLI commands",
    );
    expect(
      monoCodeToolCall(shell("monocode app sessions.read --json '{}'"))?.label,
    ).toBe("Read a session");
    expect(
      monoCodeToolCall(shell("monocode app sessions.send --json '{}'"))?.label,
    ).toBe("Continue a session");
    expect(
      monoCodeToolCall(shell("monocode app sessions.draft --json '{}'"))?.label,
    ).toBe("Save a draft");
    for (const [action, label] of [
      ["sessions.stop", "Stop a session"],
      ["sessions.archive", "Archive a session"],
      ["sessions.delete", "Delete a session"],
    ]) {
      expect(
        monoCodeToolCall(shell(`monocode app ${action} --json '{}'`))?.label,
      ).toBe(label);
    }
    expect(
      monoCodeToolCall(shell("monocode app notes.write --input -"))?.label,
    ).toBe("Write a note");
    expect(
      monoCodeToolCall({
        id: "generic",
        role: "tool",
        text: "Run command:",
        tool: { kind: "other", title: "monocode app sessions.start" },
      })?.label,
    ).toBe("Start a session");
    expect(
      monoCodeToolCall({
        id: "codex-action",
        role: "tool",
        text: "List",
        tool: {
          kind: "execute",
          preview: { kind: "shell", title: "monocode app notes.list" },
        },
      })?.label,
    ).toBe("List notes");
  });

  it("does not restyle unrelated commands or text mentioning the CLI", () => {
    expect(
      monoCodeToolCall(shell("echo monocode app notes.list")),
    ).toBeUndefined();
    expect(monoCodeToolCall(shell("monocode control list"))).toBeUndefined();
    expect(
      monoCodeToolCall({
        id: "prose",
        role: "assistant",
        text: "monocode app notes.list",
      }),
    ).toBeUndefined();
  });

  it("does not compact compound shell commands or hide a longer shell preview", () => {
    for (const command of [
      "monocode app notes.list && echo extra",
      "monocode app notes.list; echo extra",
      "monocode app notes.list | cat",
      "monocode app notes.list\necho extra",
      "monocode app notes.list --json \"$(echo extra)\"",
    ]) {
      expect(monoCodeToolCall(shell(command))).toBeUndefined();
    }
    expect(
      monoCodeToolCall({
        id: "short-title",
        role: "tool",
        text: "monocode app notes.list",
        tool: {
          kind: "shell",
          title: "monocode app notes.list",
          preview: {
            kind: "shell",
            title: "monocode app notes.list && echo extra",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      monoCodeToolCall(
        shell("monocode app sessions.send --json '{\"prompt\":\"a; b\"}'"),
      )?.command,
    ).toBe("monocode app sessions.send --json '{\"prompt\":\"a; b\"}'");
  });

  it("names a group only when all its tool calls use MonoCode", () => {
    const calls = [
      shell("monocode app --help"),
      shell("monocode app notes.list"),
    ];
    expect(monoCodeWorkSummary(calls, true)).toBe("Using MonoCode");
    expect(monoCodeWorkSummary(calls, false)).toBe("Used MonoCode");
    expect(
      monoCodeWorkSummary([...calls, shell("git status")], true),
    ).toBeUndefined();
  });

  it.each([
    ["team.answer", "Answer a teammate"],
    ["team.list", "List teammates"],
    ["team.message", "Send a team message"],
    ["team.hire", "Hire a teammate"],
    ["team.update", "Update a teammate"],
    ["team.memory.add", "Save a team fact"],
    ["team.memory.forget", "Remove a team fact"],
    ["team.retire", "Retire a teammate"],
    ["tasks.request", "Request a task"],
    ["reviews.submit", "Submit a review"],
    ["projects.list", "List projects"],
    ["projects.status", "Read project status"],
    ["goals.assign", "Assign a goal"],
    ["goals.message", "Send a goal update"],
    ["goals.cancel", "Cancel a goal"],
    ["prs.ready", "Read ready pull requests"],
    ["worktrees.list", "List worktrees"],
    ["worktrees.create", "Create a worktree"],
    ["soul.read", "Read instructions"],
    ["soul.update", "Update instructions"],
    ["memory.read", "Read memory"],
    ["memory.search", "Search memory"],
    ["memory.add", "Save a fact"],
    ["memory.replace", "Replace a fact"],
    ["memory.remove", "Remove a fact"],
    ["habits.list", "List habits"],
    ["habits.add", "Add a habit"],
    ["habits.update", "Update a habit"],
    ["habits.run", "Run a habit"],
    ["habits.remove", "Remove a habit"],
    ["chat.card", "Post a chat card"],
  ])("summarizes the %s app action", (action, label) => {
    const call = monoCodeToolCall(shell(`monocode app ${action} --json '{}'`));
    expect(call?.label).toBe(label);
    expect(monoCodeToolSummary(call!, '{"ok":true,"result":{}}')).not.toMatch(/[{}]|monocode app/);
  });

  it("recognizes read-only rules and transparent shell wrappers", () => {
    for (const command of [
      "monocode app rules team",
      "rtk proxy monocode app rules team",
      '"C:/Tools/rtk.exe" proxy "C:/MonoCode/monocode-org.exe" app rules team',
      `powershell -NoProfile -Command "& 'C:/MonoCode/monocode-org.exe' app rules team"`,
      `rtk proxy powershell -NoProfile -Command "& 'C:/MonoCode/monocode-org.exe' app rules team"`,
    ]) {
      const call = monoCodeToolCall(shell(command));
      expect(call?.action, command).toBe("rules");
      expect(monoCodeToolSummary(call!, "Guidance")).toBe("Read team guidance");
    }
    expect(monoCodeToolCall(shell("monocode app rules unknown"))).toBeUndefined();
    expect(monoCodeToolCall(shell("monocode app rules team && git status"))).toBeUndefined();
    expect(monoCodeToolCall(shell("monocode app fake.action"))).toBeUndefined();
  });

  it.each([
    ["sessions.read", { sessionId: "manager" }, { session: { title: "Manager" }, turns: [{}, {}, {}] }, "Read Manager conversation · 3 recent exchanges"],
    ["sessions.read", {}, { title: "Manager", turns: [] }, "Read Manager conversation · 0 recent exchanges"],
    ["sessions.read", {}, { title: "Manager", turns: [{}] }, "Read Manager conversation · 1 recent exchange"],
    ["sessions.list", {}, { sessions: [{}, {}] }, "Listed 2 sessions"],
    ["sessions.send", { sessionId: "Manager" }, { submitted: true }, "Sent message to Manager"],
    ["sessions.send", { sessionId: "Manager" }, { submitted: true, queued: true }, "Queued message to Manager"],
    ["sessions.send", { sessionId: "Manager" }, { submitted: false }, "Read session delivery receipt"],
    ["team.message", { memberId: "Native Core", topic: "V5 native process reconciliation" }, { sent: true }, "Sent team message to Native Core: “V5 native process reconciliation”"],
    ["team.message", { memberId: "Native Core" }, { sent: false }, "Read team message receipt"],
    ["goals.assign", { projectId: "browser-link-4" }, { assigned: true }, "Assigned goal to browser-link-4 Manager"],
    ["goals.assign", { projectId: "browser-link-4" }, { goalId: "goal-1", managerId: "manager-session", accepted: true }, "Assigned goal to browser-link-4 Manager"],
    ["goals.assign", { projectId: "browser-link-4" }, { accepted: false }, "Read goal assignment receipt"],
    ["tasks.request", { title: "Fix the transcript" }, { taskId: "task-1" }, "Requested task: Fix the transcript"],
    ["artifacts.read", { id: "report-1" }, { title: "Review report" }, "Read artifact: Review report"],
  ])("summarizes %s receipts without including their body", (action, input, result, summary) => {
    const call = monoCodeToolCall(shell(`monocode app ${action} --json '${JSON.stringify(input)}'`))!;
    const names: Record<string, string> = { Manager: "Manager", "Native Core": "Native Core", "manager-session": "browser-link-4 Manager" };
    expect(monoCodeToolSummary(call, JSON.stringify({ ok: true, result }), true, id => names[id])).toBe(summary);
  });

  it("never labels an unconfirmed output as a successful action", () => {
    const call = monoCodeToolCall(shell('monocode app team.message --json \'{"memberId":"Native Core","topic":"Question"}\''))!;
    for (const output of [undefined, "partial output {", '{"ok":false,"error":"Disconnected"}']) {
      expect(monoCodeToolSummary(call, output)).toBe("Send a team message");
    }
    expect(monoCodeToolSummary(call, '{"ok":true,"result":{"sent":true}}', false)).toBe("Send a team message");
  });

  it("strips protocol text from names and ignores conversation bodies", () => {
    const call = monoCodeToolCall(shell("monocode app sessions.read"))!;
    const output = JSON.stringify({ ok: true, result: { title: "Manager<team_sender>{\"id\":\"private\"}</team_sender>", turns: [{ user: { text: "Internal injected prompt" }, assistant: { text: "Private response" } }] } });
    expect(monoCodeToolSummary(call, output)).toBe("Read Manager conversation · 1 recent exchange");
  });

  it("resolves receipt identities from the roster and hides unknown opaque identities", () => {
    const recipientId = "01a12bbc-600d-7a83-a164-52c969d78448";
    const call = monoCodeToolCall(shell(`monocode app team.message --json '${JSON.stringify({ memberId: recipientId })}'`))!;
    const output = JSON.stringify({ ok: true, result: { sent: true, routedTo: recipientId } });
    expect(monoCodeToolSummary(call, output)).toBe("Sent team message to teammate");
    expect(monoCodeToolSummary(call, output, true, id => id === recipientId ? "Native Core" : undefined)).toBe("Sent team message to Native Core");
    const read = monoCodeToolCall(shell(`monocode app sessions.read --json '${JSON.stringify({ sessionId: recipientId })}'`))!;
    expect(monoCodeToolSummary(read, JSON.stringify({ ok: true, result: { turns: [] } }))).toBe("Read session conversation · 0 recent exchanges");
  });
});
