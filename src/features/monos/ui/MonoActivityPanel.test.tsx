// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MonoActivityContent } from "./MonoActivityPanel";
import { orchestrator } from "../../orchestration/model/orchestration";
import {
  workspaceIdentity,
  type OrchestrationRun,
  type OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import type { Block } from "../../sessions/model/session";
import type { Mono } from "../model/mono";
import { openCardSession } from "../model/monoCards";

vi.mock("../../source-control/hooks/usePrStatus", () => ({
  usePrStatusCache: () => new Map(),
}));
vi.mock("../model/monoCards", () => ({
  cardSession: () => undefined,
  openCardSession: vi.fn(),
  subscribeCardSessions: () => () => {},
}));

const member = {
  id: "reviewer",
  name: "Reviewer",
  role: "member",
  projects: [],
  mascot: "cat",
  color: "#888",
} as Mono;
const task: OrchestrationTask = {
  id: "review",
  memberId: member.id,
  title: "Review V5 process reconciliation",
  status: "failed",
  sessionId: "worker",
  prompt:
    "Check reconciliation.\n<monocode_context>Private authority</monocode_context>",
  error: "Private Mono storage is only supported for Codex app-server",
  result: "",
  harness: "codex",
  model: "codex:test",
  files: [],
  scopes: [],
  dependsOn: [],
  accepted: false,
  delivered: false,
};
const run: OrchestrationRun = {
  version: 2,
  leadId: "manager",
  cwd: "/repo",
  status: "active",
  allowedHarnesses: ["codex"],
  maxWorkers: 2,
  cli: "monocode",
  tasks: [task],
  dispatches: [],
  continuations: 0,
  requests: {},
};
const blocks: Block[] = [
  {
    id: "message",
    role: "user",
    startedAt: 20,
    text: "Injected prompt <team_sender>{}</team_sender>",
    monoTeamMessage: {
      id: "native",
      name: "Native Core",
      mascot: "cat",
      color: "#888",
      topic: "V5 process reconciliation",
      text: "Please verify the retained process.",
    },
  },
  {
    id: "tool",
    role: "tool",
    text: "git status",
    tool: { kind: "shell", status: "completed", detail: "Working tree clean" },
  },
  {
    id: "reply",
    role: "assistant",
    text: "The retained process is reconciled. <org_chart>Internal roster</org_chart>",
  },
  {
    id: "private",
    role: "user",
    text: "Private engine instructions",
    internal: true,
  },
  { id: "thought", role: "reasoning", text: "Private reasoning" },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(openCardSession).mockClear();
});

it("filters one flat member timeline and keeps injected protocol and diagnostics out of inline text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    {
      ...run,
      tasks: [task],
      dispatches: [
        {
          id: "dispatch",
          taskId: task.id,
          state: "failed",
          startedAt: 10,
          finishedAt: 30,
          error: task.error,
          sessionId: task.sessionId,
          workspace: workspaceIdentity("/repo", "/repo"),
          stage: "settled",
          updatedAt: 30,
        },
      ],
    },
  ]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <MonoActivityContent member={member} blocks={blocks} readOutput />,
      ),
    );
    const chip = (value: string) =>
      [
        ...host.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Filter activity"] button',
        ),
      ].find((button) => button.textContent === value)!;
    expect(host.querySelectorAll("[data-member-activity]")).toHaveLength(5);
    expect(host.textContent).not.toContain("Finished");
    expect(host.querySelector("[aria-expanded]")).toBeNull();
    expect(host.textContent).toContain("Native Core");
    expect(host.textContent).toContain("Please verify the retained process.");
    for (const privateText of [
      "team_sender",
      "org_chart",
      "Private engine instructions",
      "Private reasoning",
      task.error,
    ])
      expect(host.textContent).not.toContain(privateText);
    for (const [filter, count] of [
      ["assignments", 1],
      ["tools", 1],
      ["messages", 1],
      ["results", 1],
      ["errors", 1],
    ] as const) {
      await act(async () => chip(filter).click());
      expect(chip(filter).getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelectorAll("[data-member-activity]")).toHaveLength(
        count,
      );
      expect(
        host.querySelector(`[data-member-activity="${filter}"]`),
      ).not.toBeNull();
    }
    expect(
      host.querySelector('[data-transcript-error="storage"]'),
    ).not.toBeNull();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open details")!
        .click(),
    );
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(
      task.error,
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [aria-label="Close"]',
        )!
        .click(),
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open worker session")!
        .click(),
    );
    expect(openCardSession).toHaveBeenCalledWith("worker");
    await act(async () => chip("assignments").click());
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[data-member-activity="assignments"] button',
        )!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Check reconciliation.",
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("Private authority");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps default failed task cards and their readers free of raw storage errors", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([run]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const { MemberWorkLog } = await import("./MemberWorkLog");
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    expect(host.textContent).not.toContain(task.error);
    expect(
      host.querySelector('[data-transcript-error="storage"]'),
    ).not.toBeNull();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open")!
        .click(),
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain(task.error);
    expect(
      document.querySelector(
        '[role="dialog"] [data-transcript-error="storage"]',
      ),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("opens the exact assignment when different Managers reuse a task identity", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const runs = ["a", "b"].map((id): OrchestrationRun => ({
    ...run,
    leadId: `manager-${id}`,
    tasks: [
      {
        ...task,
        title: `Assignment ${id}`,
        prompt: `Instructions ${id}`,
        sessionId: `worker-${id}`,
        status: "queued",
        error: undefined,
      },
    ],
    dispatches: [],
  }));
  vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <MonoActivityContent member={member} blocks={[]} readOutput />,
      ),
    );
    const assignments = host.querySelectorAll<HTMLButtonElement>(
      '[data-member-activity="assignments"] button',
    );
    expect(assignments).toHaveLength(2);
    await act(async () => assignments[1].click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Instructions b");
    expect(dialog.textContent).not.toContain("Instructions a");
    await act(async () =>
      [...dialog.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open worker session")!
        .click(),
    );
    expect(openCardSession).toHaveBeenCalledWith("worker-b");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps long member histories bounded and lets the reader load every earlier event", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const runs = [
    {
      ...run,
      leadId: "manager",
      tasks: Array.from({ length: 90 }, (_, index): OrchestrationTask => ({
        ...task,
        id: `task-${index}`,
        status: "queued",
        error: undefined,
      })),
      dispatches: [],
    },
  ];
  vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MonoActivityContent member={member} blocks={[]} readOutput />,
      ),
    );
    expect(host.querySelectorAll("[data-member-activity]")).toHaveLength(80);
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Show earlier events")!
        .click(),
    );
    expect(host.querySelectorAll("[data-member-activity]")).toHaveLength(90);
    expect(host.textContent).not.toContain("Show earlier events");
  } finally {
    await act(async () => root.unmount());
  }
});

it("shows clean empty-filter feedback while preserving pending approval controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host),
    onApproval = vi.fn();
  try {
    await act(async () =>
      root.render(
        <MonoActivityContent
          blocks={[
            {
              id: "approval",
              role: "tool",
              text: "npm test",
              approval: { requestId: 42 },
              tool: { kind: "shell", status: "pending" },
            },
          ]}
          live
          onApproval={onApproval}
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Allow")!
        .click(),
    );
    expect(onApproval).toHaveBeenCalledWith(42, "allow");
    await act(async () =>
      [
        ...host.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Filter activity"] button',
        ),
      ]
        .find((button) => button.textContent === "messages")!
        .click(),
    );
    expect(host.textContent).toContain("No messages yet.");
    expect(host.querySelector("[aria-expanded]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
