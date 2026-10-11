// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OrchestrationSidebarAgents } from "./OrchestrationSidebarAgents";
import { OrchestrationWorkers } from "./OrchestrationActions";
import { orchestrator, type OrchestrationRun, type OrchestrationTask } from "../model/orchestration";
import type { OrchestrationSummary } from "../model/orchestrationSummary";
import { publishCardSessions } from "../../monos/model/monoCards";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
import type { GitPr } from "../../../platform/tauri/fs";

const prs = vi.hoisted(() => ({ statuses: new Map<string, GitPr | null>() }));
vi.mock("../../source-control/hooks/usePrStatus", async original => ({
  ...(await original<object>()),
  usePrStatusCache: () => prs.statuses,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const noop = () => {};
afterEach(() => {
  publishCardSessions([], noop);
  localStorage.clear();
  prs.statuses.clear();
  vi.restoreAllMocks();
});
const task = (sessionId: string, status: OrchestrationTask["status"]): OrchestrationSummary["tasks"][number] => ({
  sessionId, status, title: sessionId, harness: "codex", model: "codex:gpt-5.4",
});

it("filters all-cancelled groups with persisted Active/All and row expansion, and original order", async () => {
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([]);
  const summary: OrchestrationSummary = { status: "finished", tasks: [task("first", "cancelled"), task("second", "cancelled")] };
  const host = document.createElement("div");
  let root = createRoot(host);
  const render = () => act(async () => root.render(<OrchestrationSidebarAgents leadId="history-lead" summary={summary} />));
  try {
    await render();
    expect(host.textContent).toContain("2 tasks · all cancelled");
    expect(host.textContent).not.toContain("0/2 done");
    expect(host.querySelectorAll('[data-orchestration-agent]')).toHaveLength(0);
    const controls = () => host.querySelectorAll<HTMLButtonElement>('[aria-label="Task filter"] button');
    expect(controls()[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('button[aria-controls]')).toBeNull();
    await act(async () => controls()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect(controls()[0].getAttribute("aria-pressed")).toBe("true");
    await act(async () => controls()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect([...host.querySelectorAll('[data-orchestration-agent]')].map(row => row.getAttribute("data-orchestration-agent"))).toEqual(["first", "second"]);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(controls()[1].getAttribute("aria-pressed")).toBe("true");
    const first = host.querySelector<HTMLButtonElement>('[aria-label="Agent details: first"]')!;
    await act(async () => first.click());
    expect(first.getAttribute("aria-expanded")).toBe("true");
    await act(async () => controls()[0].click());
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.querySelector('[aria-label="Agent details: first"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[aria-label="Agent details: second"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("folds accepted completed work while retaining unfinished review, selected, queued, blocked and needs-input tasks", async () => {
  const tasks = [
    { ...task("accepted", "completed"), accepted: true },
    { ...task("review", "completed"), accepted: false },
    task("queued", "queued"), task("blocked", "blocked"), task("selected", "cancelled"),
    { ...task("approval", "cancelled"), needsInput: true },
  ];
  const run = { leadId: "live-lead", status: "active", tasks: tasks.map((entry, index) => ({ ...entry, id: String(index) })), dispatches: [] } as unknown as OrchestrationRun;
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([run]);
  const summary: OrchestrationSummary = { status: "active", live: true, tasks };
  publishCardSessions([{ id: "review", title: "review", harness: "codex", busy: false, needsInput: false, liveState: { status: "idle" } }], noop);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(
      <OrchestrationWorkers.Provider value={{ selectedId: "selected", inspect: noop }}>
        <OrchestrationSidebarAgents leadId="live-lead" summary={summary} />
      </OrchestrationWorkers.Provider>,
    ));
    expect(host.querySelector('[aria-label="Agent details: accepted"]')).toBeNull();
    for (const id of ["review", "queued", "blocked", "selected", "approval"])
      expect(host.querySelector(`[aria-label="Agent details: ${id}"]`)).not.toBeNull();
    expect(host.querySelector('[aria-label="Agent details: review"]')?.textContent).toContain("Waiting review");
    expect(host.querySelector('[aria-label="Agent details: approval"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[aria-label="Task filter"] [aria-pressed="true"]')?.textContent).toBe("Active");
    expect(host.textContent).toContain("6 tasks · 2 completed · 2 cancelled · 2 unfinished");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("retains a focused row when its task finishes and folds it after focus leaves", async () => {
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([]);
  const entry = task("focused", "running");
  const summary: OrchestrationSummary = { status: "active", live: true, tasks: [entry] };
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  const outside = document.createElement("button");
  document.body.append(outside);
  const render = () => act(async () => root.render(<OrchestrationSidebarAgents leadId="focus-lead" summary={summary} />));
  try {
    await render();
    const row = host.querySelector<HTMLButtonElement>('[aria-label="Agent details: focused"]')!;
    await act(async () => row.focus());
    entry.status = "cancelled";
    await render();
    expect(document.activeElement).toBe(row);
    expect(host.querySelector('[aria-label="Agent details: focused"]')).toBe(row);
    await act(async () => outside.focus());
    expect(host.querySelector('[aria-label="Agent details: focused"]')).toBeNull();
    expect(host.querySelector('[aria-label="Task filter"] [aria-pressed="true"]')?.textContent).toBe("Active");
  } finally {
    await act(async () => root.unmount());
    host.remove(); outside.remove();
  }
});

it("keeps a saved completed task visible when its review acceptance is unknown", async () => {
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([]);
  const summary: OrchestrationSummary = { status: "finished", tasks: [task("unknown-review", "completed")] };
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<OrchestrationSidebarAgents leadId="saved-review" summary={summary} />));
    expect(host.querySelector('[aria-label="Agent details: unknown-review"]')?.textContent).toContain("Waiting review");
    expect(host.querySelector('button[aria-controls]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("retains accepted project tasks with open or unknown PRs and folds merged or accepted no-change work", async () => {
  const tasks = ["open", "unknown", "merged", "no-changes"].map((name, index) => ({
    ...task(name, "completed"), id: name, accepted: true,
    lastDispatchId: `dispatch-${index}`, acceptedDispatchId: `dispatch-${index}`,
    workspace: { checkoutCwd: `/${name}`, branch: name },
    ...(name === "no-changes" ? { completionOutcome: "no-changes" as const } : { prUrl: `https://example.test/pr/${index}` }),
  })) as OrchestrationTask[];
  for (const name of ["open", "merged"]) {
    const entry = tasks.find(candidate => candidate.id === name)!;
    prs.statuses.set(prStatusKey(entry.workspace!.checkoutCwd, entry.prUrl), { number: 1, title: name, url: entry.prUrl!, state: name });
  }
  const run = { leadId: "project-lead", projectManager: true, status: "finished", tasks, dispatches: [] } as unknown as OrchestrationRun;
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([run]);
  const summary: OrchestrationSummary = { status: "finished", live: true, tasks };
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<OrchestrationSidebarAgents leadId="project-lead" summary={summary} />));
    for (const name of ["open", "unknown"])
      expect(host.querySelector(`[aria-label="Agent details: ${name}"]`)).not.toBeNull();
    for (const name of ["merged", "no-changes"])
      expect(host.querySelector(`[aria-label="Agent details: ${name}"]`)).toBeNull();
    expect(host.querySelector('[aria-label="Task filter"] [aria-pressed="true"]')?.textContent).toBe("Active");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps canonical storage-held tasks visible and makes the reason available on keyboard focus", async () => {
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([]);
  publishCardSessions([{ id: "reviewer", title: "Reviewer", harness: "codex", busy: false, needsInput: false, liveState: { status: "blocked", reason: "storage", detail: "Repair AGENTS.md before dispatch" } }], noop);
  const summary: OrchestrationSummary = { status: "finished", tasks: [task("reviewer", "cancelled")] };
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<OrchestrationSidebarAgents leadId="blocked-lead" summary={summary} />));
    const row = host.querySelector<HTMLButtonElement>('[aria-label="Agent details: reviewer"]')!;
    expect(row.textContent).toContain("Blocked · storage");
    expect(row.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Blocked · storage");
    expect(host.querySelector('button[aria-controls]')).toBeNull();
    await act(async () => row.focus());
    const reason = document.getElementById(row.getAttribute("aria-describedby")!);
    expect(reason?.getAttribute("role")).toBe("tooltip");
    expect(reason?.textContent).toContain("Repair AGENTS.md before dispatch");
    expect(row.querySelector("button, [tabindex]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("pages terminal tasks while keeping selected and blocked tasks visible on every page", async () => {
  vi.spyOn(orchestrator, "snapshot").mockReturnValue([]);
  const summary: OrchestrationSummary = { status: "finished", tasks: [
    ...Array.from({ length: 12 }, (_, index) => task(`old-${index}`, "cancelled")),
    task("selected", "cancelled"), task("blocked", "blocked"),
  ] };
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<OrchestrationWorkers.Provider value={{ selectedId: "selected", inspect: noop }}>
      <OrchestrationSidebarAgents leadId="paged-lead" summary={summary} />
    </OrchestrationWorkers.Provider>));
    const rows = () => [...host.querySelectorAll('[data-orchestration-agent]')].map(row => row.getAttribute("data-orchestration-agent"));
    expect(rows()).toEqual(["selected", "blocked"]);
    const all = host.querySelectorAll<HTMLButtonElement>('[aria-label="Task filter"] button')[1];
    await act(async () => all.click());
    expect(rows()).toEqual(["old-0", "old-1", "old-2", "old-3", "old-4", "selected", "blocked"]);
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next task page"]')!;
    const previous = host.querySelector<HTMLButtonElement>('[aria-label="Previous task page"]')!;
    expect(previous.disabled).toBe(true);
    await act(async () => next.click());
    expect(rows()).toEqual(["old-5", "old-6", "old-7", "old-8", "old-9", "selected", "blocked"]);
    expect(host.querySelector('[aria-label="Task pages"]')?.textContent).toContain("2 / 3");
    await act(async () => next.click());
    expect(rows()).toEqual(["old-10", "old-11", "selected", "blocked"]);
    expect(next.disabled).toBe(true);
    await act(async () => previous.click());
    expect(rows()).toEqual(["old-5", "old-6", "old-7", "old-8", "old-9", "selected", "blocked"]);
    await act(async () => all.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(rows()).toEqual(["selected", "blocked"]);
    expect(document.activeElement?.textContent).toBe("Active");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
