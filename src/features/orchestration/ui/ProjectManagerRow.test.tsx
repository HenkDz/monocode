// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectManagerRow, SidebarUnseenCounts } from "./ProjectManagerRow";
import { orchestrator, type OrchestrationRun } from "../model/orchestration";
import { newSession } from "../../sessions/model/session";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => localStorage.clear());

it("shows the member's storage block instead of idle and clears it after repair", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "m", role: "manager", managerProject: "/repo", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
    { id: "b", role: "member", reportsTo: "m", name: "Reviewer", sessionId: "member-chat", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
  ]));
  const session = { ...newSession("codex", "/repo"), id: "member-chat", codexStorageError: "hooks.json conflict" };
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<ProjectManagerRow project="/repo" onOpen={vi.fn()} sessions={[session]} />));
    expect(host.querySelector('[aria-label="Open Reviewer"] [role="status"]')?.textContent).toBe("Blocked · storage");
    const reviewer = host.querySelector<HTMLButtonElement>('[aria-label="Open Reviewer"]')!;
    const detailId = reviewer.getAttribute("aria-describedby")!;
    expect(document.getElementById(detailId)?.textContent).toContain("Blocked · storage");
    expect(document.getElementById(detailId)?.textContent).toContain("hooks.json conflict");
    await act(async () => reviewer.focus());
    expect(document.getElementById(detailId)?.getAttribute("role")).toBe("tooltip");
    expect(reviewer.querySelector("button, [tabindex]")).toBeNull();
    await act(async () => root.render(<ProjectManagerRow project="/repo" onOpen={vi.fn()} sessions={[{ ...session, codexStorageError: undefined }]} />));
    expect(host.querySelector('[aria-label="Open Reviewer"] [role="status"]')?.textContent).toBe("Idle");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem("monocode:mono-roster");
  }
});

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
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-controls]')!.click());
    const member = host.querySelector<HTMLButtonElement>('[aria-label="Open Backend"]')!;
    await act(async () => member.focus());
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
  const render = (attention = new Set<string>(), busy = new Set<string>(), sessions?: Parameters<typeof ProjectManagerRow>[0]["sessions"]) => act(async () => root.render(
    <ProjectManagerRow project="/repo" onOpen={vi.fn()} expanded onToggle={vi.fn()} approvalSessionIds={attention} busySessionIds={busy} sessions={sessions} />,
  ));
  const member = () => host.querySelector<HTMLButtonElement>('[aria-label="Open Backend"]')!;
  try {
    await render();
    expect(member().textContent).toBe("BackendWaiting review");
    expect(member().title).toBe(task.title);
    expect(host.textContent).not.toContain(task.title);
    expect(host.textContent).not.toContain("completed");
    expect(host.querySelector('[aria-label="Toggle Manager team"]')).not.toBeNull();
    task.status = "running";
    await render();
    expect(member().textContent).toBe("BackendThinking");
    await render(new Set(["worker"]));
    expect(member().textContent).toBe("BackendNeeds you");
    task.status = "completed";
    await render(new Set(), new Set(["member-chat"]));
    expect(member().textContent).toBe("BackendThinking");
    await render(new Set(), new Set(), [{ ...newSession("codex", "/repo"), id: "worker", codexStorageError: "Repair AGENTS.md", queuedMessages: [{ id: "q", text: "review", attachments: [] }] }]);
    expect(member().textContent).toBe("BackendBlocked · storage");
    expect(member().querySelector('[data-agent-state="blocked"]')?.getAttribute("title")).toBe("Blocked · storage · Repair AGENTS.md");
  } finally {
    await act(async () => root.unmount());
    snapshot.mockRestore();
    localStorage.removeItem("monocode:mono-roster");
  }
});
const trees = vi.hoisted(() => ({
  data: { worktrees: [{}] } as { worktrees: unknown[] } | undefined,
}));

it("folds idle members while retaining selected, unread, attention, queued, blocked and active rows in saved order", async () => {
  const names = ["Idle first", "Selected", "Unread", "Attention", "Queued", "Blocked", "Active", "Idle last"];
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "m", role: "manager", managerProject: "/repo", projects: ["/repo"], mascot: "cat", color: "#aaaaaa" },
    ...names.map((name, index) => ({ id: String(index), name, role: "member", reportsTo: "m", sessionId: `chat-${index}`, projects: ["/repo"], mascot: "cat", color: "#aaaaaa" })),
  ]));
  const sessions = names.map((_, index) => ({ ...newSession("codex", "/repo"), id: `chat-${index}` }));
  sessions[4].queuedMessages = [{ id: "q", text: "Next task", attachments: [] }];
  sessions[5].codexStorageError = "Repair storage";
  sessions[6].busy = true;
  const host = document.createElement("div");
  let root = createRoot(host);
  const render = (collapsed = false) => act(async () => root.render(
    <SidebarUnseenCounts.Provider value={new Map([["2", 1]])}>
      <ProjectManagerRow project="/repo" onOpen={vi.fn()} sessions={sessions} selectedMemberId="1" expanded={!collapsed} attention={[{ id: "chat-3", key: "reply", project: "/repo", kind: "reply", question: "New reply" }]} />
    </SidebarUnseenCounts.Provider>,
  ));
  const visibleNames = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open "]')].slice(1).map(button => button.getAttribute("aria-label")?.slice(5));
  try {
    await render();
    expect(visibleNames()).toEqual(names.slice(1, 7));
    const disclosure = host.querySelector<HTMLButtonElement>('button[aria-controls]')!;
    expect(disclosure.textContent).toBe("2 idle members");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await act(async () => disclosure.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, bubbles: true })));
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await act(async () => disclosure.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(visibleNames()).toEqual(names);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    await render(true);
    expect(visibleNames()).toEqual(names.slice(1, 7));
    expect(host.querySelector('button[aria-controls]')).toBeNull();
    await render();
    expect(visibleNames()).toEqual(names);
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ProjectManagerRow project="/repo" onOpen={vi.fn()} sessions={sessions} />));
    expect(host.querySelector('button[aria-controls]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[aria-label="Open Idle first"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
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
    expect(host.querySelector("button")?.textContent).toBe("Manager");
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
