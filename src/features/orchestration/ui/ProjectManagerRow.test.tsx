// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectManagerRow } from "./ProjectManagerRow";
import { orchestrator, type OrchestrationRun } from "../model/orchestration";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("selects members with native keyboard-focusable buttons and only one current row", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "m", role: "manager", managerProject: "/repo", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
    { id: "b", role: "member", reportsTo: "m", name: "Backend", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
  ]));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const open = vi.fn(async () => {});
  try {
    await act(async () => root.render(<ProjectManagerRow project="/repo" onOpen={open} onOpenMember={open} selected />));
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const member = host.querySelector<HTMLButtonElement>('[aria-label="Open Backend"]')!;
    member.focus();
    expect(document.activeElement).toBe(member);
    await act(async () => member.click());
    expect(open).toHaveBeenCalledWith("b");
    await act(async () => root.render(<ProjectManagerRow project="/repo" onOpen={open} onOpenMember={open} selectedMemberId="b" />));
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe("Open Backend");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem("monocode:mono-roster");
  }
});

it("shows member availability and a task tooltip without repeating its title or raw outcome", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "m", role: "manager", managerProject: "/repo", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
    { id: "b", role: "member", reportsTo: "m", name: "Backend", sessionId: "member-chat", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
  ]));
  const task = { id: "new", memberId: "b", sessionId: "worker", title: "Fix sidebar hierarchy", status: "completed" };
  const runs = [{ tasks: [task], dispatches: [] }] as unknown as OrchestrationRun[];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (attention = new Set<string>(), busy = new Set<string>()) => act(async () => root.render(
    <ProjectManagerRow project="/repo" onOpen={vi.fn()} expanded onToggle={vi.fn()} approvalSessionIds={attention} busySessionIds={busy} />,
  ));
  const member = () => host.querySelector<HTMLButtonElement>('[aria-label="Open Backend"]')!;
  try {
    await render();
    expect(member().textContent).toBe("BackendIdle");
    expect(member().title).toBe(task.title);
    expect(host.textContent).not.toContain(task.title);
    expect(host.textContent).not.toContain("completed");
    expect(host.querySelector('[aria-label="Toggle Manager team"]')).not.toBeNull();
    task.status = "running";
    await render();
    expect(member().textContent).toBe("BackendWorking");
    await render(new Set(["worker"]));
    expect(member().textContent).toBe("BackendNeeds you");
    task.status = "completed";
    await render(new Set(), new Set(["member-chat"]));
    expect(member().textContent).toBe("BackendWorking");
  } finally {
    await act(async () => root.unmount());
    snapshot.mockRestore();
    localStorage.removeItem("monocode:mono-roster");
  }
});
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
