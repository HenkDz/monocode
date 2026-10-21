// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { monoManagerGoals } from "../monos/model/monoManagerGoals";
import { orchestrationWorkspace, type OrchestrationRun } from "../orchestration/model/orchestrationState";
import { newSession } from "../sessions/model/session";
import { TeamMap, type TeamMapProps } from "./TeamMap";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deferUnhandledEscape, focusedBusyAgentSessionId, shouldStopFocusedTurnOnEscape } from "../workspace/model/tabKeys";

function registerAppEscape(onStop: (id: string) => void) {
  const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect" && node.getText(ast).includes('window.addEventListener("keydown", onEscape)')) effects.push(node.expression.arguments[0].getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast); expect(effects).toHaveLength(1);
  const ports = { monoViewIdRef: { current: "busy" }, sessionsRef: { current: [{ id: "busy", busy: true }] }, activeTabIdRef: { current: "tab" }, tabsRef: { current: [] }, projectTerminalFocusedRef: { current: false }, focusedBusyAgentSessionId, shouldStopFocusedTurnOnEscape, deferUnhandledEscape, onStop };
  return new Function(...Object.keys(ports), ts.transpile(`return (${effects[0]})();`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(ports)) as () => void;
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("./ProjectDrawer", () => ({ WorkTrace: ({ session }: { session: { id: string } }) => <p data-trace-session={session.id}>Recorded work {session.id}</p>, ProjectDrawer: () => null }));
const roster = [
  { id: "boss", role: "orchestrator", name: "Boss", projects: ["/app"], mascot: "cat", color: "#aaa" },
  { id: "manager", role: "manager", name: "Mira", reportsTo: "boss", managerEngineId: "engine", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#aaa" },
  { id: "worker", role: "member", name: "Vale", reportsTo: "manager", projects: ["/app"], mascot: "cat", color: "#aaa" },
];
const runs = [{ leadId: "engine", ownerMonoId: "manager", cwd: "/app", status: "active", tasks: [
  { id: "one", monoGoalId: "goal", memberId: "worker", memberName: "Vale", sessionId: "stale", activeDispatchId: "new", title: "Review the feature", prompt: "Exact instructions", result: "", status: "running", dependsOn: [], workspace: { id: "feature", projectCwd: "/app", checkoutCwd: "/app-wt", kind: "worktree", branch: "feature" } },
  { id: "two", monoGoalId: "goal", memberId: "worker", memberName: "Vale", sessionId: "second", title: "Review another worktree", prompt: "Other instructions", result: "", status: "queued", dependsOn: [] },
  { id: "failed", monoGoalId: "goal", memberId: "worker", sessionId: "bad", title: "Failed work", prompt: "Failure instructions", result: "", status: "failed", dependsOn: [], error: "Build did not pass" },
], dispatches: [{ id: "old", taskId: "one", sessionId: "old", startedAt: 1, state: "completed", result: "Historical result" }, { id: "new", taskId: "one", sessionId: "current", startedAt: 3, state: "running" }] }] as unknown as OrchestrationRun[];
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const open = vi.fn(), close = vi.fn(), send = vi.fn(async () => true);
const decisions: NonNullable<TeamMapProps["decisions"]> = { needYou: 1, handledToday: 4, incomplete: false, rail: <p>Global decisions</p>,
  project: () => ({ pending: 1, teamPending: 0, incomplete: false, autonomy: <p>Ask me for</p>, cards: <p>Project decisions</p>, goalAction: () => <button>Guarded goal action</button> }) };
const render = (props: Partial<TeamMapProps> = {}) => act(async () => root.render(<TeamMap sessions={[{ ...newSession("codex", "/app"), id: "current", busy: true }, { ...newSession("codex", "/app"), id: "old" }]} runs={runs} statuses={new Map()} onOpenMono={open} onClose={close} decisions={decisions} onSendManager={send} {...props} />));
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const escape = () => act(async () => host.querySelector('.zoom-map')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
const field = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
const input = (text: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), text); field().dispatchEvent(new Event("input", { bubbles: true })); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1220);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(740);
  vi.spyOn(monoManagerGoals, "goals").mockReturnValue([{ id: "goal", managerId: "engine", projectId: "/app", title: "Deliver the feature", state: "running", updatedAt: 1 }] as ReturnType<typeof monoManagerGoals.goals>);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("zooms in place and uses one project-filtered rail, with real multiplicity and ordered columns", async () => {
  await render(); const world = host.querySelector<HTMLElement>(".zoom-map-world")!, before = world.style.transform;
  expect(host.querySelectorAll(".zoom-map-rail")).toHaveLength(1);
  await click('[aria-label="Open app project"]');
  expect(world.style.transform).not.toBe(before); expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".zoom-map-multiplicity")).toBeNull();
  expect(host.querySelector(".zoom-map-columns")?.textContent).toBe("GoalPlannedWorkingIn reviewReady to merge");
  expect(host.querySelectorAll(".zoom-map-task")).toHaveLength(3);
  expect(host.querySelector(".zoom-map-finished")?.textContent).toContain("Failed");
  expect(host.querySelector(".zoom-map-rail")?.textContent).toContain("Project decisions");
  expect(field().getAttribute("aria-label")).toBe("Tell the Mira what you want");
  expect(open).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});

it("keeps selected task outline and exact current/history evidence, then clears before leaving on Escape", async () => {
  await render(); await click('[aria-label="Open app project"]'); await click('[data-task="one"]');
  expect(host.querySelector('[data-task="one"]')?.getAttribute("data-selected")).toBe("true");
  expect(host.querySelector('.zoom-map-detail')?.textContent).toContain("Review the feature");
  expect(host.querySelector('[data-trace-session="current"]')).not.toBeNull();
  const attempt = host.querySelector<HTMLSelectElement>('[aria-label="Work attempt"]')!;
  await act(async () => { attempt.value = "old"; attempt.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('[data-trace-session="old"]')).not.toBeNull();
  expect(host.querySelector('.zoom-map-detail')?.textContent).toContain("Historical result");
  await escape(); expect(host.querySelector('.zoom-map-detail')).toBeNull(); expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("manager");
  await escape(); expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("");
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Open app project"]')); expect(close).not.toHaveBeenCalled();
});

it("clears task selection for goal details and renders its guarded action exactly once", async () => {
  await render(); await click('[aria-label="Open app project"]'); await click('[data-task="one"]');
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open goal →")!.click());
  expect(host.querySelector('[data-task="one"]')?.getAttribute("data-selected")).toBe("false");
  expect([...host.querySelectorAll("button")].filter(button => button.textContent === "Guarded goal action")).toHaveLength(1);
  expect(host.querySelector('.zoom-map-detail')?.textContent).toContain("Ask me for");
});

it("highlights the canonical needs-you card instead of duplicating task details", async () => {
  const card = <article tabIndex={-1} data-task-id="one">Original approval</article>;
  await render({ decisions: { ...decisions, project: () => ({ ...decisions.project("/app", "manager"), cards: card }) } });
  await click('[aria-label="Open app project"]'); await click('[data-task="one"]');
  expect(host.querySelector('.zoom-map-detail')).toBeNull(); expect(host.querySelectorAll('[data-task-id="one"]')).toHaveLength(1);
  expect(host.querySelector('[data-task="one"]')?.getAttribute("data-selected")).toBe("true");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.zoom-map-mono')].find(button => button.querySelector('strong')?.textContent?.startsWith("Vale"))!.click());
  expect(host.querySelector('.zoom-map-detail')?.textContent).toContain("Vale");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.zoom-map-detail button')].find(button => button.textContent?.startsWith("Review the feature"))!.click());
  expect(host.querySelector('.zoom-map-detail')).toBeNull();
  expect(host.querySelectorAll('[data-task-id="one"]')).toHaveLength(1);
  const other = host.querySelector<HTMLElement>('.zoom-map-lane .zoom-map-segments > span[title^="Review another"]')!;
  await act(async () => { other.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  await act(async () => { other.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
  expect(host.querySelector('[data-task="one"]')?.getAttribute("data-selected")).toBe("true");
  await escape(); expect(host.querySelector('[data-task="one"]')?.getAttribute("data-selected")).toBe("false");
  expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("manager");
});

it("consumes field and body Escape before the actual App Stop effect, and removes its fallback on unmount", async () => {
  const stop = vi.fn(), cleanup = registerAppEscape(stop);
  try {
    await render({ decisions: { ...decisions, project: () => ({ ...decisions.project("/app", "manager"), cards: <input aria-label="Rail answer" /> }) } });
    await click('[aria-label="Open app project"]');
    for (const target of [field(), host.querySelector<HTMLInputElement>('[aria-label="Rail answer"]')!]) {
      await act(async () => { target.focus(); target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(stop).not.toHaveBeenCalled(); expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("manager");
    }
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); handled.preventDefault();
    await act(async () => { window.dispatchEvent(handled); });
    expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("manager");
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(stop).not.toHaveBeenCalled(); expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("");
    await act(async () => root.render(null));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 10));
    expect(stop).toHaveBeenCalledExactlyOnceWith("busy");
  } finally { cleanup(); }
});

it("keeps terminal goal history out of lanes and summaries while preserving terminal task truth", async () => {
  const goal = monoManagerGoals.goals()[0];
  vi.mocked(monoManagerGoals.goals).mockReturnValue([goal, { ...goal, id: "done-history", title: "Completed historical goal", state: "done" }, { ...goal, id: "cancelled-history", title: "Cancelled historical goal", state: "cancelled" }]);
  const done = { ...runs[0].tasks[0], id: "done", status: "completed" as const, activeDispatchId: undefined, lastDispatchId: "accepted", accepted: true, acceptedDispatchId: "accepted", completionOutcome: "no-changes" as const };
  await render({ runs: [{ ...runs[0], tasks: [...runs[0].tasks, done, { ...done, id: "cancelled", status: "cancelled" }] }] });
  expect(host.querySelector('.zoom-map-summary')?.textContent).not.toContain("historical goal");
  await click('[aria-label="Open app project"]');
  expect(host.querySelectorAll('.zoom-map-lane')).toHaveLength(1);
  expect(host.querySelector('.zoom-map-finished')?.textContent).toContain("Done"); expect(host.querySelector('.zoom-map-finished')?.textContent).toContain("Cancelled");
  expect(monoManagerGoals.goals()).toHaveLength(3);
  vi.mocked(monoManagerGoals.goals).mockReturnValue([{ ...goal, state: "done" }]);
  await act(async () => root.render(null));
  await render({ runs: [{ ...runs[0], tasks: [done] }] });
  await click('[aria-label="Open app project"]');
  expect(host.querySelectorAll('.zoom-map-lane')).toHaveLength(0);
  expect(host.querySelector('.zoom-map-empty')?.textContent).toContain("No active goal");
  expect(host.querySelector('.zoom-map-finished')?.textContent).toContain("Done");
});

it("counts current working and unfinished review tasks, excluding planned and accepted/cancelled history", async () => {
  const tasks = runs[0].tasks;
  await render({ runs: [{ ...runs[0], tasks: [tasks[0], { ...tasks[1], status: "running" }] }] }); await click('[aria-label="Open app project"]');
  expect(host.querySelector('.zoom-map-multiplicity')?.textContent).toBe("×2");
  const reviewing = { ...tasks[1], status: "completed" as const, lastDispatchId: "review-current" };
  await render({ runs: [{ ...runs[0], tasks: [tasks[0], reviewing], dispatches: [...runs[0].dispatches!, { id: "review-current", taskId: reviewing.id, sessionId: reviewing.sessionId, workspace: orchestrationWorkspace(runs[0]), state: "completed", stage: "settled", startedAt: 4, updatedAt: 4 }] }] });
  expect(host.querySelector('.zoom-map-multiplicity')?.textContent).toBe("×2");
  await render({ runs: [{ ...runs[0], tasks: [tasks[0], { ...reviewing, accepted: true, acceptedDispatchId: "review-current", completionOutcome: "no-changes" }, { ...tasks[1], id: "cancelled", status: "cancelled" }] }] });
  expect(host.querySelector('.zoom-map-multiplicity')).toBeNull();
});

it("keeps partial zoom-out after wheel lock expires and exits only past the relative threshold", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  await render(); await click('[aria-label="Open app project"]');
  const world = host.querySelector<HTMLElement>(".zoom-map-world")!, initial = world.style.transform;
  const wheel = (deltaY: number) => act(async () => host.querySelector('.zoom-map-viewport')!.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: 600, clientY: 400, bubbles: true, cancelable: true })));
  await wheel(100); expect(world.style.transform).toBe(initial);
  vi.mocked(Date.now).mockReturnValue(2000); await wheel(80); expect(world.style.transform).not.toBe(initial);
  expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("manager");
  const partial = world.style.transform; await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
  expect(world.style.transform).toBe(partial);
  await wheel(400); expect(host.querySelector('.zoom-map-viewport')?.getAttribute("data-focused")).toBe("");
});

it("uses ordinary exact-text Manager send, preserves per-recipient drafts and refusal", async () => {
  send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render({ bossGoal: { context: { ownerId: "boss", projects: [] }, submit: vi.fn(async () => true) } });
  await input("Boss draft"); await click('[aria-label="Open app project"]'); expect(field().value).toBe("");
  await input("  Exact manager request\nsecond line  ");
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(send).toHaveBeenCalledWith("manager", "/app", "  Exact manager request\nsecond line  ");
  expect(field().value).toContain("Exact manager request");
  await click('[aria-label="Show whole map"]'); expect(field().value).toBe("Boss draft");
  await click('[aria-label="Open app project"]'); expect(field().value).toContain("Exact manager request");
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(field().value).toBe("");
});
