// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectManagerRow } from "./ProjectManagerRow";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const trees = vi.hoisted(() => ({
  data: { worktrees: [{}] } as { worktrees: unknown[] } | undefined,
}));
vi.mock("../../source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => trees,
}));

it("opens the normal Manager conversation only on demand and reports opening failures", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const open = vi.fn(async () => {
    throw new Error("Project is missing");
  });
  try {
    await act(async () =>
      root.render(<ProjectManagerRow project="/repo" onOpen={open} selected />),
    );
    expect(open).not.toHaveBeenCalled();
    expect(host.textContent).toBe("Manager");
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("button")?.getAttribute("aria-current")).toBe("page");
    await act(async () => host.querySelector("button")!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("/repo");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Project is missing",
    );
    expect(host.querySelector("button")!.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows attention counts, running, and hides unavailable project types", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const open = vi.fn();
  const render = (
    project: string,
    attention: Parameters<typeof ProjectManagerRow>[0]["attention"] = [],
    running = false,
  ) =>
    act(async () =>
      root.render(
        <ProjectManagerRow
          project={project}
          onOpen={open}
          attention={attention}
          running={running}
        />,
      ),
    );
  try {
    await render("/repo", [
      {
        key: "q",
        id: "m",
        project: "/repo",
        question: "Choose",
        kind: "decision",
      },
      { key: "p", id: "m", project: "/repo", question: "Ready", kind: "ready" },
    ]);
    expect(
      host.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("Needs your decision (2)");
    await render("/repo", [
      { key: "p", id: "m", project: "/repo", question: "Ready", kind: "ready" },
    ]);
    expect(
      host.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("Ready to merge");
    await render("/repo", [], true);
    expect(
      host.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("Running");
    await render("remote:server/repo");
    expect(host.textContent).toBe("");
    trees.data = undefined;
    await render("/not-git");
    expect(host.textContent).toBe("");
  } finally {
    trees.data = { worktrees: [{}] };
    await act(async () => root.unmount());
  }
});
