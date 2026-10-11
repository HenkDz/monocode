// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MemberWorkLog } from "./MemberWorkLog";
import { orchestrator } from "../../orchestration/model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import type { Mono } from "../model/mono";
import type { GitPr } from "../../../platform/tauri/fs";
import {
  prStatusKey,
  usePrStatusCache,
} from "../../source-control/hooks/usePrStatus";
import { OrchestrationActions } from "../../orchestration/ui/OrchestrationActions";
import { openCardSession, cardSession } from "../model/monoCards";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("../../source-control/hooks/usePrStatus", async (original) => ({
  ...(await original<
    typeof import("../../source-control/hooks/usePrStatus")
  >()),
  usePrStatusCache: vi.fn(() => new Map()),
}));
vi.mock("../model/monoCards", () => ({
  openCardSession: vi.fn(),
  cardSession: vi.fn(),
  subscribeCardSessions: () => () => {},
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const manager: Mono = {
  id: "manager",
  role: "manager",
  name: "Project Manager",
  projects: ["/app"],
  mascot: "cat",
  color: "#abc",
};
const member: Mono = {
  id: "member",
  role: "member",
  reportsTo: manager.id,
  projects: ["/app"],
  mascot: "cat",
  color: "#abc",
};
const base = {
  id: "markdown",
  memberId: member.id,
  title: "Improve report cards",
  status: "completed",
  accepted: false,
  sessionId: "worker",
  prompt: "Assignment instructions",
  result:
    "<details><summary>Verification</summary>Checks passed.</details>\n\n```js\nconst checked = true;\n```\n\n<script>alert('unsafe')</script>",
  workspace: {
    checkoutCwd: "C:/Users/user/worktrees/report-cards",
    branch: "feature/cards",
  },
  lastDispatchId: "dispatch",
  prUrl: "https://github.com/org/repo/pull/7",
} as OrchestrationTask;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.mocked(usePrStatusCache).mockReturnValue(new Map());
  vi.mocked(cardSession).mockReset();
  vi.unstubAllGlobals();
});

it("links task reports, reviews and PR summaries while keeping artifact reports out of the inline transcript", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem(
    "monocode:mono-roster",
    JSON.stringify([manager, member]),
  );
  const task = {
    ...base,
    id: "artifact-task",
    readOnly: true,
    accepted: true,
    acceptedDispatchId: "dispatch",
    completionOutcome: "no-changes",
    prUrl: undefined,
    reportArtifactId: "report-1",
    reviewArtifactId: "review-1",
    prSummaryArtifactId: "summary-1",
  } as OrchestrationTask;
  const runs = [{ tasks: [task] }] as OrchestrationRun[];
  vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const container = document.createElement("div"),
    root = createRoot(container),
    opened = vi.fn();
  window.addEventListener("monocode:open-artifact", opened);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    expect(
      container.querySelector('[data-member-task="artifact-task"]'),
    ).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-controls$="-history"]')!
        .click(),
    );
    expect(container.textContent).toContain("Completed (no changes)");
    expect(container.querySelectorAll("[data-org-artifact]")).toHaveLength(3);
    for (const id of ["report-1", "review-1", "summary-1"]) {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(`[data-org-artifact="${id}"]`)!
          .click(),
      );
      expect(opened).toHaveBeenLastCalledWith(
        expect.objectContaining({ detail: { monoId: member.id, id } }),
      );
    }
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!
        .click(),
    );
    expect(
      document.querySelector('[role="dialog"] .mono-run-report'),
    ).toBeNull();
    expect(
      document.querySelectorAll('[role="dialog"] [data-org-artifact]'),
    ).toHaveLength(3);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [data-org-artifact="report-1"]',
        )!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(opened).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: { monoId: member.id, id: "report-1" },
      }),
    );
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener("monocode:open-artifact", opened);
  }
});

it("shows a summary and opens sanitized Markdown with assignment and worker actions in a dialog", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem(
    "monocode:mono-roster",
    JSON.stringify([manager, member]),
  );
  const runs = [
    {
      tasks: [base],
      dispatches: [
        {
          id: "dispatch",
          taskId: base.id,
          startedAt: Date.now() - 120000,
          updatedAt: Date.now() - 60000,
        },
      ],
    },
  ] as OrchestrationRun[];
  vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const openWorktree = vi.fn();
  const container = document.createElement("div"),
    root = createRoot(container);
  const render = () => (
    <OrchestrationActions.Provider
      value={{
        update: vi.fn(),
        confirm: vi.fn(),
        retry: vi.fn(),
        open: vi.fn(),
        openWorker: openWorktree,
      }}
    >
      <MemberWorkLog member={member} />
    </OrchestrationActions.Provider>
  );
  try {
    await act(async () => root.render(render()));
    const header = () =>
      container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    expect(header().textContent).toBe("Open");
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).not.toContain("Assignment instructions");
    expect(container.textContent).toContain("From Project Manager");
    expect(container.textContent).toContain("PR #7");
    expect(container.querySelector("time")?.textContent).toBeTruthy();
    expect(container.querySelector("strong")?.className).toContain("truncate");
    await act(async () => header().click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(container.querySelector("details")).toBeNull();
    expect(dialog.textContent).toContain("Assignment instructions");
    expect(
      dialog.querySelector(`[title="${base.workspace!.checkoutCwd}"]`)
        ?.textContent,
    ).toBe("feature/cards");
    expect(container.textContent).not.toContain(base.workspace!.checkoutCwd);
    const report = dialog.querySelector(".mono-run-report")!;
    expect(report.querySelector("details summary")?.textContent).toBe(
      "Verification",
    );
    expect(report.querySelector(".markdown-code-shell")).not.toBeNull();
    expect(report.textContent).toContain("const checked = true;");
    expect(report.querySelector("script")).toBeNull();
    for (const label of ["Open worker session", "Open worktree", "Open PR"]) {
      if (!document.querySelector('[role="dialog"]'))
        await act(async () => header().click());
      await act(async () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[role="dialog"] button',
          ),
        ]
          .find((button) => button.textContent === label)!
          .click(),
      );
      if (label !== "Open PR")
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(openCardSession).toHaveBeenCalledWith("worker");
    expect(openWorktree).toHaveBeenCalledWith("worker");
    expect(openUrl).toHaveBeenCalledWith(base.prUrl);
    await act(async () => root.render(null));
    await act(async () => root.render(render()));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => header().click());
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Close"]')!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps lifecycle and verified PR outcomes separate from canonical availability without treating stale acceptance as ready", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const verdict = (decision: "approve" | "changes") => ({
    decision,
    notes: "Review notes",
    dispatchId: "dispatch",
  });
  const tasks = [
    {
      ...base,
      id: "running",
      status: "running",
      activeDispatchId: "new-dispatch",
      reviewVerdict: verdict("changes"),
    },
    {
      ...base,
      id: "queued",
      status: "queued",
      reviewVerdict: verdict("changes"),
    },
    {
      ...base,
      id: "cancelling",
      status: "cancelling",
      reviewVerdict: verdict("changes"),
    },
    { ...base, id: "review" },
    { ...base, id: "changes", reviewVerdict: verdict("changes") },
    { ...base, id: "approved", reviewVerdict: verdict("approve") },
    { ...base, id: "ready", accepted: true, acceptedDispatchId: "dispatch" },
    {
      ...base,
      id: "stale",
      accepted: true,
      acceptedDispatchId: "old-dispatch",
    },
    {
      ...base,
      id: "stale-verdict",
      reviewVerdict: { ...verdict("approve"), dispatchId: "old-dispatch" },
    },
    {
      ...base,
      id: "merged",
      accepted: true,
      acceptedDispatchId: "dispatch",
      workspace: { ...base.workspace, branch: "merged" },
    },
    {
      ...base,
      id: "closed",
      accepted: true,
      acceptedDispatchId: "dispatch",
      workspace: { ...base.workspace, branch: "closed" },
    },
    { ...base, id: "cancelled", status: "cancelled" },
    { ...base, id: "failed", status: "failed" },
    { ...base, id: "blocked", status: "blocked" },
    {
      ...base,
      id: "no-changes",
      prUrl: undefined,
      completionOutcome: "no-changes",
      accepted: true,
      acceptedDispatchId: "dispatch",
    },
  ] as OrchestrationTask[];
  vi.mocked(usePrStatusCache).mockReturnValue(
    new Map(
      ["merged", "closed"].map((state) => [
        prStatusKey(base.workspace!.checkoutCwd, state),
        { url: base.prUrl, state } as GitPr,
      ]),
    ),
  );
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    { tasks, dispatches: [] },
  ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    for (const id of [
      "ready",
      "review",
      "approved",
      "stale",
      "stale-verdict",
      "changes",
      "failed",
      "blocked",
    ]) {
      expect(
        container.querySelector(`[data-member-task="${id}"]`),
      ).not.toBeNull();
    }
    for (const id of ["merged", "closed", "cancelled", "no-changes"]) {
      expect(container.querySelector(`[data-member-task="${id}"]`)).toBeNull();
    }
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-controls$="-history"]')!
        .click(),
    );
    for (const [id, label, status] of [
      ["running", "Running", "thinking"],
      ["queued", "Queued", "queued"],
      ["cancelling", "Cancelling", "thinking"],
      ["review", "In review", "waiting-review"],
      ["changes", "Changes requested", "waiting-review"],
      ["approved", "Approved", "waiting-review"],
      ["ready", "PR ready", "done"],
      ["stale", "In review", "waiting-review"],
      ["stale-verdict", "In review", "waiting-review"],
      ["merged", "Merged", "done"],
      ["closed", "Closed (not merged)", "done"],
      ["cancelled", "Cancelled", "done"],
      ["failed", "Failed", "failed"],
      ["blocked", "Blocked", "blocked"],
      ["no-changes", "Completed (no changes)", "done"],
    ]) {
      const card = container.querySelector(`[data-member-task="${id}"]`)!;
      expect(card.querySelector("[data-task-status]")?.textContent).toBe(label);
      expect(card.getAttribute("data-state")).toBe(status);
      expect(card.querySelector(".agent-state")?.getAttribute("data-agent-state")).toBe(status);
      expect(card.querySelectorAll(".agent-state-cue")).toHaveLength(1);
      if (["running", "queued", "cancelling", "stale-verdict"].includes(id))
        expect(card.querySelector('[title="Review notes"]')).toBeNull();
      expect(card.querySelector('[aria-haspopup="dialog"]')?.textContent).toBe(
        "Open",
      );
    }
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps large histories unmounted, prioritizes attention and lets every past task open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const history = Array.from({ length: 200 }, (_, index) => ({
    ...base,
    id: `past-${index}`,
    title: `Past assignment ${index}`,
    accepted: true,
    acceptedDispatchId: "dispatch",
    completionOutcome: "no-changes" as const,
  }));
  const runs = [
    {
      tasks: [
        { ...base, id: "blocked", status: "blocked" },
        { ...base, id: "running", status: "running" },
        ...history,
        { ...base, id: "other", memberId: "other-member" },
      ],
      dispatches: [],
    },
  ] as unknown as OrchestrationRun[];
  vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    const toggle = host.querySelector<HTMLButtonElement>(
      'button[aria-controls]:not([aria-controls$="-history"])',
    )!;
    const historyToggle = host.querySelector<HTMLButtonElement>(
      'button[aria-controls$="-history"]',
    )!;
    expect(toggle.textContent).toContain("Tasks (202)");
    expect(historyToggle.textContent).toContain("History (200)");
    expect(historyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("Needs attention (1)");
    expect(
      [...host.querySelectorAll("[data-member-task]")].map((el) =>
        el.getAttribute("data-member-task"),
      ),
    ).toEqual(["blocked", "running"]);
    expect(host.textContent).not.toContain("Past assignment");
    await act(async () => historyToggle.click());
    expect(historyToggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll("[data-member-task]")).toHaveLength(202);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          '[data-member-task="past-0"] button[aria-haspopup="dialog"]',
        )!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Past assignment 0",
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [aria-label="Close"]',
        )!
        .click(),
    );
    await act(async () => historyToggle.click());
    expect(host.querySelectorAll("[data-member-task]")).toHaveLength(2);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll("[data-member-task]")).toHaveLength(0);
    await act(async () => historyToggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll("[data-member-task]")).toHaveLength(202);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps opened details readable when a current task moves into collapsed history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const snapshot = vi
    .spyOn(orchestrator, "snapshot")
    .mockReturnValue([
      { tasks: [base], dispatches: [] },
    ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!
        .click(),
    );
    snapshot.mockReturnValue([
      {
        tasks: [
          {
            ...base,
            accepted: true,
            acceptedDispatchId: "dispatch",
            completionOutcome: "no-changes",
          },
        ],
        dispatches: [],
      },
    ] as unknown as OrchestrationRun[]);
    await act(async () => root.render(<MemberWorkLog member={member} />));
    expect(host.querySelectorAll("[data-member-task]")).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Assignment instructions",
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [aria-label="Close"]',
        )!
        .click(),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('button[aria-controls$="-history"]')!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("[data-task-status]")?.textContent).toBe(
      "Completed (no changes)",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("highlights a task awaiting the user without automatically opening its body", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(cardSession).mockReturnValue({
    id: "attention",
    needsInput: true,
  } as ReturnType<typeof cardSession>);
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    {
      tasks: [{ ...base, id: "attention", status: "running" }],
      dispatches: [],
    },
  ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    const header = () =>
      host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("[data-task-status]")?.textContent).toBe(
      "Needs you",
    );
    await act(async () => header().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.render(null));
    await act(async () => root.render(<MemberWorkLog member={member} />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.mocked(cardSession).mockReset();
  }
});

it("separates current work, queued assignments and review from collapsed completed history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tasks = [
    { ...base, id: "running", status: "running" },
    {
      ...base,
      id: "blocked",
      status: "blocked",
      error: "Worker lost its connection",
    },
    { ...base, id: "queued", status: "queued", dependsOn: ["dependency"] },
    {
      ...base,
      id: "available",
      status: "queued",
      dependsOn: ["accepted-dependency"],
    },
    { ...base, id: "review" },
    { ...base, id: "ready", accepted: true, acceptedDispatchId: "dispatch" },
    {
      ...base,
      id: "past",
      accepted: true,
      acceptedDispatchId: "dispatch",
      completionOutcome: "no-changes",
    },
    { ...base, id: "cancelled", status: "cancelled" },
    { ...base, id: "dependency", memberId: "other-member" },
    {
      ...base,
      id: "accepted-dependency",
      memberId: "other-member",
      accepted: true,
    },
  ] as OrchestrationTask[];
  const runs = [
    { leadId: "active-engine", status: "active", tasks, dispatches: [] },
    {
      leadId: "paused-engine",
      status: "paused",
      lastPauseReason: "Review checkout permissions",
      tasks: [{ ...base, id: "paused", status: "queued" }],
      dispatches: [],
    },
  ] as unknown as OrchestrationRun[];
  vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  const ids = (section: string) =>
    [
      ...host.querySelectorAll(
        `[data-member-section="${section}"] [data-member-task]`,
      ),
    ].map((card) => card.getAttribute("data-member-task"));
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    expect(ids("current")).toEqual(["blocked", "running"]);
    expect(ids("queue")).toEqual(["available", "queued", "paused"]);
    expect(ids("log")).toEqual(["ready", "review"]);
    expect(host.textContent).toContain("Current assignment");
    expect(host.textContent).toContain("Queue (3)");
    expect(host.textContent).toContain("Work log (2)");
    expect(
      host.querySelector('[data-member-task="queued"] [data-task-reason]')
        ?.textContent,
    ).toBe("Waiting for task dependency");
    expect(
      host.querySelector('[data-member-task="available"] [data-task-reason]')
        ?.textContent,
    ).toBe("Waiting for an available worker");
    expect(
      host.querySelector('[data-member-task="paused"] [data-task-reason]')
        ?.textContent,
    ).toBe("Review checkout permissions");
    expect(
      host.querySelector('[data-member-task="blocked"] [data-task-reason]')
        ?.textContent,
    ).toBe("Worker lost its connection");
    expect(
      host.querySelector('[data-member-task="review"] [data-task-metrics]')
        ?.textContent,
    ).toContain("Waiting review");
    expect(host.querySelector('[data-member-task="past"]')).toBeNull();
    expect(host.querySelector('[data-member-task="cancelled"]')).toBeNull();
    expect(host.textContent).not.toContain("Assignment instructions");
  } finally {
    await act(async () => root.unmount());
  }
});

it("shows a blocked queue reason while keeping historical state and task metrics separate from a reused worker", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(cardSession).mockReturnValue({
    id: base.sessionId,
    title: "Worker",
    harness: "codex",
    busy: false,
    needsInput: true,
    liveState: {
      status: "blocked",
      reason: "storage",
      detail: "Storage must be repaired",
    },
    taskMetrics: {
      review: {
        turns: 1,
        startedAt: 1000,
        endedAt: 6000,
        elapsedMs: 5000,
        inputTokens: 4000,
        outputTokens: 200,
        partial: false,
      },
    },
  } as ReturnType<typeof cardSession>);
  const tasks = [
    { ...base, id: "queued", status: "queued" },
    { ...base, id: "review" },
    {
      ...base,
      id: "stale",
      accepted: true,
      acceptedDispatchId: "old-dispatch",
    },
    {
      ...base,
      id: "past",
      accepted: true,
      acceptedDispatchId: "dispatch",
      completionOutcome: "no-changes",
    },
  ] as OrchestrationTask[];
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    { tasks, dispatches: [] },
  ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    expect(
      host.querySelector('[data-member-task="queued"] [data-task-reason]')
        ?.textContent,
    ).toBe("Storage must be repaired");
    expect(
      host.querySelector('[data-member-task="queued"] [data-task-metrics]')
        ?.textContent,
    ).toContain("Blocked");
    expect(
      host.querySelector('[data-member-section="current"]')?.textContent,
    ).toContain("No current assignment");
    const review = host.querySelector('[data-member-task="review"]')!;
    expect(review.querySelector("[data-task-status]")?.textContent).toBe(
      "In review",
    );
    expect(review.querySelector("[data-task-metrics]")?.textContent).toContain(
      "4,000 in / 200 out tokens",
    );
    expect(review.querySelector("[data-task-metrics]")?.textContent).toContain(
      "Waiting review",
    );
    expect(review.textContent).not.toContain("Storage must be repaired");
    expect(
      host.querySelector('[data-member-task="stale"] [data-task-metrics]')
        ?.textContent,
    ).toContain("Waiting review");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('button[aria-controls$="-history"]')!
        .click(),
    );
    const past = host.querySelector('[data-member-task="past"]')!;
    expect(past.querySelector("[data-task-status]")?.textContent).toBe(
      "Completed (no changes)",
    );
    expect(past.textContent).not.toContain("Storage must be repaired");
    expect(past.querySelector("[data-task-metrics]")?.textContent).toContain(
      "Done",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("opens queued workers and cancels the exact task with pending and retryable error feedback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const task = { ...base, id: "queued", status: "queued" } as OrchestrationTask;
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    { leadId: "engine", tasks: [task], dispatches: [] },
  ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  let rejectCancel!: (error: Error) => void;
  const cancel = vi.spyOn(orchestrator, "cancelTask").mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectCancel = reject;
      }),
  );
  const open = vi.fn();
  const host = document.createElement("div"),
    root = createRoot(host);
  const cancelButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.textContent === "Cancel task" ||
        button.textContent === "Cancelling…",
    )!;
  try {
    await act(async () =>
      root.render(
        <OrchestrationActions.Provider
          value={{ update: vi.fn(), confirm: vi.fn(), retry: vi.fn(), open }}
        >
          <MemberWorkLog member={member} />
        </OrchestrationActions.Provider>,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open worker session")!
        .click(),
    );
    expect(open).toHaveBeenCalledWith(task.sessionId);
    await act(async () => cancelButton().click());
    expect(cancel).toHaveBeenCalledWith("engine", task.id);
    expect(cancelButton().disabled).toBe(true);
    expect(cancelButton().textContent).toBe("Cancelling…");
    await act(async () => rejectCancel(new Error("Could not stop worker")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not stop worker",
    );
    expect(cancelButton().disabled).toBe(false);
    expect(host.querySelector('[data-member-task="queued"]')).not.toBeNull();
    cancel.mockImplementation(async () => {
      task.status = "cancelled";
    });
    await act(async () => cancelButton().click());
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[data-member-task="queued"]')).toBeNull();
    expect(host.textContent).toContain("History (1)");
  } finally {
    await act(async () => root.unmount());
  }
});

it("restores focus to the task toggle when an open assignment moves into collapsed history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const snapshot = vi
    .spyOn(orchestrator, "snapshot")
    .mockReturnValue([
      { tasks: [base], dispatches: [] },
    ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    const open = host.querySelector<HTMLButtonElement>(
      '[aria-haspopup="dialog"]',
    )!;
    await act(async () => open.focus());
    await act(async () => open.click());
    snapshot.mockReturnValue([
      {
        tasks: [
          {
            ...base,
            accepted: true,
            acceptedDispatchId: "dispatch",
            completionOutcome: "no-changes",
          },
        ],
        dispatches: [],
      },
    ] as unknown as OrchestrationRun[]);
    await act(async () => root.render(<MemberWorkLog member={member} />));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"] [aria-label="Close"]',
        )!
        .click(),
    );
    expect(document.activeElement).toBe(
      host.querySelector(
        'button[aria-controls]:not([aria-controls$="-history"])',
      ),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("dismisses hovered task hints while a reader is open so Escape closes it and restores the same trigger", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    { tasks: [base], dispatches: [] },
  ] as unknown as OrchestrationRun[]);
  vi.spyOn(orchestrator, "subscribe").mockReturnValue(() => {});
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<MemberWorkLog member={member} />));
    const open = host.querySelector<HTMLButtonElement>(
      '[aria-haspopup="dialog"]',
    )!;
    await act(async () => {
      open.focus();
      open.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await act(async () => open.click());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(host.querySelector('[aria-haspopup="dialog"]')).toBe(open);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[aria-haspopup="dialog"]')).toBe(open);
    expect(document.activeElement).toBe(open);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
