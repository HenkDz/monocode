// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectManagerReview } from "./ProjectManagerReview";
import { orchestrator } from "../model/orchestration";
import type { OrchestrationRun } from "../model/orchestrationState";
import { openUrl } from "@tauri-apps/plugin-opener";
import { OrchestrationActions } from "./OrchestrationActions";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
const statusView = vi.hoisted(() => ({ statuses: new Map() }));
vi.mock("../../source-control/hooks/usePrStatus", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../source-control/hooks/usePrStatus")
  >()),
  usePrStatusCache: () => statusView.statuses,
}));
const checkView = vi.hoisted(() => ({
  loading: false,
  error: null as string | null,
  checks: { checks: [{ state: "pass" }, { state: "pass" }] },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));
vi.mock("../../inbox/model/githubTasks", () => ({
  githubPrDiff: vi.fn(async () => ({
    additions: 29,
    deletions: 0,
    files: [{}],
  })),
}));
vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: () => checkView,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("explains a real blocker in chat and continues explicitly, without a Resume link", async () => {
  const continueManager = vi.spyOn(orchestrator, "continueManager").mockResolvedValue();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ProjectManagerReview run={{ leadId: "manager", tasks: [], status: "paused", error: "Provider unavailable" } as unknown as OrchestrationRun} />));
    expect(host.textContent).toContain("Provider unavailable");
    expect(host.textContent).not.toContain("Resume");
    await act(async () => host.querySelector("button")!.click());
    expect(continueManager).toHaveBeenCalledWith("manager");
    await act(async () => root.render(<ProjectManagerReview run={{ leadId: "manager", tasks: [], status: "active", recoveryNotice: "Continued 2 workers after restart." } as unknown as OrchestrationRun} />));
    expect(host.textContent).toContain("Continued 2 workers");
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    continueManager.mockRestore();
  }
});

it("navigates to workers, cycles ready cards and offers removal only after matching merged evidence", async () => {
  const tasks = ["one", "two"].map((id) => ({
    id,
    title: id,
    sessionId: `worker-${id}`,
    harness: "codex",
    model: "codex:test",
    status: "completed",
    accepted: true,
    lastDispatchId: id,
    acceptedDispatchId: id,
    prUrl: `https://github.com/example/repo/pull/${id === "one" ? 1 : 2}`,
    workspace: { checkoutCwd: `/${id}`, branch: id },
  }));
  const run = { cwd: "/repo", leadId: "manager", tasks } as OrchestrationRun;
  const openWorker = vi.fn();
  const remove = vi.fn(async () => {});
  const actions = {
    openWorker,
    removeManagerWorktree: remove,
    open: vi.fn(),
    update: vi.fn(),
    confirm: vi.fn(),
    retry: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  const render = () =>
    act(async () =>
      root.render(
        <OrchestrationActions.Provider value={actions}>
          <ProjectManagerReview run={run} />
        </OrchestrationActions.Provider>,
      ),
    );
  try {
    await render();
    await act(async () =>
      (
        host.querySelector('[aria-label="Go to worktree"]') as HTMLButtonElement
      ).click(),
    );
    expect(openWorker).toHaveBeenCalledWith("worker-one");
    expect(host.textContent).toContain("Codex · codex:test");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Next")!
        .click(),
    );
    expect(document.activeElement?.id).toBe("manager-review-two");
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "N",
          altKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(document.activeElement?.id).toBe("manager-review-one");
    run.tasks = [tasks[0]] as OrchestrationRun["tasks"];
    await render();
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Next")!
        .click(),
    );
    expect(document.activeElement?.id).toBe("manager-review-one");
    expect(scroll).not.toHaveBeenCalled();
    run.tasks = tasks as OrchestrationRun["tasks"];
    statusView.statuses = new Map([
      [prStatusKey("/one", "one"), { url: tasks[0].prUrl, state: "merged" }],
    ]);
    await render();
    const merged = host.querySelector('[aria-label="Merged: one"]')!;
    expect(merged.textContent).not.toContain("Send back");
    await act(async () =>
      [...merged.querySelectorAll("button")]
        .find((button) => button.textContent === "Remove worktree")!
        .click(),
    );
    expect(remove).toHaveBeenCalledWith("/repo", "/one");
    statusView.statuses = new Map([
      [
        prStatusKey("/one", "one"),
        { url: "https://other/pr", state: "merged" },
      ],
    ]);
    await render();
    expect(host.querySelector('[aria-label="Merged: one"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    scroll.mockRestore();
    statusView.statuses = new Map();
  }
});

it("opens the PR and worker diff and resumes to send corrections without losing a failed draft", async () => {
  const run = {
    leadId: "manager",
    cwd: "/project",
    status: "finished",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    tasks: [
      {
        id: "task",
        sessionId: "worker",
        title: "Docs",
        accepted: true,
        status: "completed",
        prUrl: "https://github.com/example/repo/pull/1",
        lastDispatchId: "d",
        acceptedDispatchId: "d",
        checksSummary: "Tests passed",
        workspace: { checkoutCwd: "/worker", branch: "docs" },
      },
    ],
  } as OrchestrationRun;
  const current = vi.spyOn(orchestrator, "run").mockReturnValue(run);
  const resume = vi.spyOn(orchestrator, "start").mockResolvedValue();
  const send = vi
    .spyOn(orchestrator, "handle")
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({});
  const host = document.createElement("div");
  const root = createRoot(host);
  const click = (label: string) =>
    act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === label)!
        .click();
    });
  try {
    await act(async () => root.render(<ProjectManagerReview run={run} />));
    expect(host.textContent).toContain("Tests passed");
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.textContent).not.toContain("/worker");
    expect(host.textContent).toContain("+29 −0 · 1 file");
    expect(host.textContent).toContain("✓ 2 checks");
    expect(
      [...host.querySelectorAll("span")].find(
        (span) => span.textContent === "+29",
      )?.className,
    ).toContain("text-emerald-700 dark:text-emerald-400");
    expect(
      [...host.querySelectorAll("span")].find(
        (span) => span.textContent === "−0",
      )?.className,
    ).toContain("text-rose-700 dark:text-rose-400");
    for (const [state, color] of [
      ["pass", "text-emerald-700 dark:text-emerald-400"],
      ["fail", "text-rose-700 dark:text-rose-400"],
      ["pending", "text-amber-700 dark:text-amber-400"],
      ["unknown", "text-content/60"],
      ["skipping", "text-content/60"],
      ["cancel", "text-content/60"],
      ["empty", "text-content/60"],
      ["loading", "text-content/60"],
      ["error", "text-rose-700 dark:text-rose-400"],
    ]) {
      checkView.loading = state === "loading";
      checkView.error = state === "error" ? "Unavailable" : null;
      checkView.checks.checks = [
        { state: ["error", "loading"].includes(state) ? "pass" : state },
      ];
      if (state === "empty") checkView.checks.checks = [];
      await act(async () => root.render(<ProjectManagerReview run={run} />));
      expect(host.querySelector("span[title]")?.className).toBe(color);
    }
    await click("Open PR");
    expect(openUrl).toHaveBeenCalledWith(run.tasks[0].prUrl);
    await click("Open diff");
    expect(openUrl).toHaveBeenCalledWith(`${run.tasks[0].prUrl}/files`);
    await click("Send back");
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Add an example");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(resume).toHaveBeenCalledWith(
      "manager",
      ["codex"],
      2,
      undefined,
      true,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Unavailable",
    );
    expect(textarea.value).toBe("Add an example");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(send).toHaveBeenLastCalledWith(
      "manager",
      expect.any(String),
      "message",
      { taskId: "task", text: "Add an example" },
    );
    expect(host.querySelector("textarea")).toBeNull();
  } finally {
    Object.assign(checkView, {
      loading: false,
      error: null,
      checks: { checks: [{ state: "pass" }, { state: "pass" }] },
    });
    await act(async () => root.unmount());
    current.mockRestore();
    resume.mockRestore();
    send.mockRestore();
  }
});
