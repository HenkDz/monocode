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

it("maps lifecycle and verified PR outcomes to light/dark status colors without treating stale acceptance as ready", async () => {
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
    for (const [id, label, border] of [
      ["running", "Running", "border-l-accent"],
      ["queued", "Queued", "border-l-content/20"],
      ["cancelling", "Cancelling", "border-l-content/20"],
      ["review", "In review", "border-l-amber-500"],
      ["changes", "Changes requested", "border-l-orange-500"],
      ["approved", "Approved", "border-l-emerald-500"],
      ["ready", "PR ready", "border-l-emerald-500"],
      ["stale", "In review", "border-l-amber-500"],
      ["stale-verdict", "In review", "border-l-amber-500"],
      ["merged", "Merged", "border-l-emerald-500/40"],
      ["closed", "Closed (not merged)", "border-l-content/20"],
      ["cancelled", "Cancelled", "border-l-content/20"],
      ["failed", "Failed", "border-l-red-500"],
      ["blocked", "Blocked", "border-l-red-500"],
      ["no-changes", "Completed (no changes)", "border-l-emerald-500/40"],
    ]) {
      const card = container.querySelector(`[data-member-task="${id}"]`)!;
      expect(card.querySelector("[data-task-status]")?.textContent).toBe(label);
      expect(card.className).toContain(border);
      if (
        !["running", "queued", "cancelling", "closed", "cancelled"].includes(id)
      )
        expect(card.className).toContain("dark:");
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

it("highlights a task awaiting the user without automatically opening its body", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(cardSession).mockReturnValue({
    id: "attention",
    needsInput: true,
  } as ReturnType<typeof cardSession>);
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([
    { tasks: [{ ...base, id: "attention" }], dispatches: [] },
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
