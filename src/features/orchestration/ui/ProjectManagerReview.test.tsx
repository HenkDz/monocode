// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectManagerReview } from "./ProjectManagerReview";
import { orchestrator } from "../model/orchestration";
import type { OrchestrationRun } from "../model/orchestrationState";
import { openUrl } from "@tauri-apps/plugin-opener";
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("opens the PR and worker diff and resumes to send corrections without losing a failed draft", async () => {
  const run = {
    leadId: "manager",
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
    await act(async () =>
      root.render(<ProjectManagerReview run={run} />),
    );
    expect(host.textContent).toContain("Tests passed");
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
    await act(async () => root.unmount());
    current.mockRestore();
    resume.mockRestore();
    send.mockRestore();
  }
});
