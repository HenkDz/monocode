// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mono } from "../monos/model/mono";
import { recordCrewMessage } from "../monos/model/monoCrewEvents";
import { monoManagerGoals, type ManagerGoalHost } from "../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import { newSession } from "../sessions/model/session";
import { TeamMap } from "./TeamMap";

vi.mock("@tauri-apps/api/core", async original => ({
  ...await original<object>(), invoke: vi.fn(async () => null),
}));

const roster: Mono[] = [
  { id: "boss", name: "Orchestrator", role: "orchestrator", projects: ["/app", "/site"], mascot: "cat", color: "#abcdef" },
  { id: "manager", name: "App Manager", role: "manager", reportsTo: "boss", managerEngineId: "mono-engine-app", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#abcdef" },
  { id: "backend", name: "Backend", role: "member", reportsTo: "manager", projects: ["/app"], specialty: "Backend", mascot: "cat", color: "#abcdef" },
  { id: "site-manager", name: "Site Manager", role: "manager", reportsTo: "boss", projects: ["/site"], managerProject: "/site", mascot: "cat", color: "#abcdef" },
  { id: "designer", name: "Designer", role: "member", reportsTo: "site-manager", projects: ["/site"], mascot: "cat", color: "#abcdef" },
];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const open = vi.fn(), close = vi.fn();
let reducedMotion = false;
let narrow = false;
let viewportWidth = 1100;
let viewportHeight = 1250;
let resize: () => void;
const renders = (runs: OrchestrationRun[] = [], scope?: string) => act(async () => root.render(
  <TeamMap sessions={[]} runs={runs} statuses={new Map()} scope={scope} onOpenMono={open} onClose={close} />,
));
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>(".team-map-node-open")];
const nodeButton = (name: string) => buttons().find(button => button.getAttribute("aria-label")?.startsWith(`${name},`))!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false;
  narrow = false;
  viewportWidth = 1100;
  viewportHeight = 1250;
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : narrow,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as unknown as MediaQueryList);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => viewportWidth);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => viewportHeight);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
  Object.defineProperty(SVGElement.prototype, "beginElementAt", { configurable: true, value: vi.fn() });
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  open.mockReset(); close.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(SVGElement.prototype, "beginElementAt");
});

it("opens Mono chat and moves arrow focus to the nearest card in that direction", async () => {
  await renders();
  expect(host.querySelector('section')?.getAttribute("aria-labelledby")).toBe("team-map-title");
  expect(host.querySelector('dialog')).toBeNull();
  await act(async () => nodeButton("Orchestrator").focus());
  await act(async () => nodeButton("Orchestrator").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(nodeButton("Site Manager"));
  expect(nodeButton("Site Manager").tabIndex).toBe(0);
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("Permissions");
  await act(async () => nodeButton("Backend").click());
  expect(close).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledExactlyOnceWith("backend");
});

it("shows team activity separately from the Orchestrator ring and locates attention", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster.map(mono => mono.id === "manager" ? { ...mono, sessionId: "manager-chat" } : mono)));
  const session = { ...newSession("codex", "/app"), id: "manager-chat", busy: true };
  const render = () => act(async () => root.render(<TeamMap sessions={[session]} runs={[]} statuses={new Map()} onOpenMono={open} onClose={close} />));
  await render();
  expect(nodeButton("Orchestrator").closest(".team-map-node")?.getAttribute("data-status")).toBe("idle");
  expect(nodeButton("Orchestrator").textContent).toContain("1 working below");
  expect(nodeButton("App Manager").closest(".team-map-node")?.getAttribute("data-status")).toBe("working");
  session.pendingQuestion = { requestId: 1, title: "Choose", questions: [] };
  await render();
  expect(nodeButton("Orchestrator").textContent).toContain("Needs you · in app");
});

it("dims the Needs you filter, filters projects and expands collapsed teammates", async () => {
  const runs = [{ leadId: "engine", ownerMonoId: "manager", cwd: "/app", tasks: [
    { id: "blocked", memberId: "backend", sessionId: "worker", title: "Routing", prompt: "Routing", result: "", status: "blocked" },
  ], dispatches: [] }] as unknown as OrchestrationRun[];
  await renders(runs);
  const needs = [...host.querySelectorAll("button")].find(button => button.textContent === "Needs you")!;
  await act(async () => needs.click());
  expect(needs.getAttribute("aria-pressed")).toBe("true");
  expect(nodeButton("Backend").closest(".team-map-node")?.getAttribute("data-dimmed")).toBe("false");
  expect(nodeButton("Designer").closest(".team-map-node")?.getAttribute("data-dimmed")).toBe("true");
  const collapse = host.querySelector<HTMLButtonElement>('[aria-label^="Collapse App Manager"]')!;
  await act(async () => collapse.click());
  expect(nodeButton("Backend")).toBeUndefined();
  expect(host.querySelector('[aria-label^="Expand App Manager"]')?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="Expand App Manager"]')!.click());
  expect(nodeButton("Backend")).toBeDefined();
  const project = host.querySelector<HTMLSelectElement>('[aria-label="Project"]')!;
  await act(async () => nodeButton("Backend").focus());
  await act(async () => { project.value = "/site"; project.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(buttons()).toHaveLength(3); expect(nodeButton("Backend")).toBeUndefined(); expect(nodeButton("Designer")).toBeDefined();
  expect(buttons().filter(button => button.tabIndex === 0)).toHaveLength(1);
});

it("reacts to crew events with static reduced-motion indicators and timeline focus", async () => {
  reducedMotion = true;
  await renders();
  expect(host.querySelector(".team-map-pulse")).toBeNull();
  await act(async () => recordCrewMessage({ id: "report", managerId: "manager", senderId: "backend", recipientId: "manager", topic: "Report", text: "Routing verified", at: Date.now() }));
  expect(host.querySelector('[data-event-id="report"]')).not.toBeNull();
  expect(host.querySelector("animateMotion")).toBeNull();
  const event = [...host.querySelectorAll<HTMLButtonElement>('.team-map-timeline button')].find(button => button.textContent?.includes("Routing verified"))!;
  await act(async () => event.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(nodeButton("Backend").closest(".team-map-node")?.getAttribute("data-highlighted")).toBe("true");
  await act(async () => event.click());
  expect(document.activeElement).toBe(nodeButton("App Manager"));
});

it("opens a Manager's own team and zooms by controls and wheel", async () => {
  await renders([], "manager");
  expect(buttons().map(button => button.getAttribute("aria-label")?.split(",")[0]).sort()).toEqual(["App Manager", "Backend"].sort());
  expect(host.textContent).toContain("App Manager’s team");
  const project = host.querySelector<HTMLSelectElement>('[aria-label="Project"]')!;
  expect(project.value).toBe("/app");
  expect(project.disabled).toBe(true);
  const canvas = host.querySelector<HTMLDivElement>(".team-map-canvas")!;
  const initial = canvas.style.transform;
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
  expect(canvas.style.transform).not.toBe(initial);
  const zoomed = canvas.style.transform;
  await act(async () => host.querySelector(".team-map-viewport")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })));
  expect(canvas.style.transform).not.toBe(zoomed);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Whole org")!.click());
  expect(project.value).toBe("");
  expect(project.disabled).toBe(false);
  expect(buttons()).toHaveLength(5);
  expect(host.textContent).toContain("Your team, working together");
});

it("focuses Managers and project labels, restores the org on Escape, and keeps Manager chat available", async () => {
  await renders();
  const canvas = host.querySelector<HTMLDivElement>(".team-map-canvas")!;
  const original = canvas.style.transform;
  await act(async () => nodeButton("App Manager").click());
  expect(canvas.style.transform).not.toBe(original);
  const focused = canvas.style.transform;
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click());
  expect(canvas.style.transform).not.toBe(focused);
  await act(async () => nodeButton("App Manager").click());
  expect(canvas.style.transform).toBe(focused);
  expect(close).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".team-map-node-open")).toHaveLength(5);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => window.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
  expect(canvas.style.transform).toBe(original);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Focus app team"]')!.click());
  expect(canvas.style.transform).not.toBe(original);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open chat with App Manager"]')!.click());
  expect(close).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledExactlyOnceWith("manager");
});

it("starts scoped maps focused and Escape returns to the full org before closing", async () => {
  await renders([], "manager");
  expect(buttons()).toHaveLength(2);
  const escape = () => act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await escape();
  expect(close).not.toHaveBeenCalled();
  expect(buttons()).toHaveLength(5);
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Project"]')!.disabled).toBe(false);
  await escape();
  expect(close).toHaveBeenCalledOnce();
});

it("switches to compact cards below 70% and restores full detail above it", async () => {
  await renders();
  const canvas = host.querySelector<HTMLDivElement>(".team-map-canvas")!;
  expect(canvas.getAttribute("data-compact")).toBe("false");
  const out = host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!;
  await act(async () => out.click());
  expect(canvas.getAttribute("data-compact")).toBe("false");
  await act(async () => out.click());
  expect(canvas.getAttribute("data-compact")).toBe("true");
  expect(host.querySelectorAll(".team-map-status-chip")).toHaveLength(5);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
  expect(canvas.getAttribute("data-compact")).toBe("false");
});

it("refits the focused team when its viewport resizes", async () => {
  await renders();
  await act(async () => nodeButton("App Manager").click());
  const canvas = host.querySelector<HTMLDivElement>(".team-map-canvas")!;
  const before = canvas.style.transform;
  await act(async () => { viewportWidth = 1800; viewportHeight = 650; resize(); });
  expect(canvas.style.transform).not.toBe(before);
  expect(close).not.toHaveBeenCalled();
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Whole org")).toBe(true);
});

it("preserves manual zoom through status-only updates", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster.map(mono => mono.id === "manager" ? { ...mono, sessionId: "manager-chat" } : mono)));
  const session = { ...newSession("codex", "/app"), id: "manager-chat", busy: true };
  const render = () => act(async () => root.render(<TeamMap sessions={[session]} runs={[]} statuses={new Map()} onOpenMono={open} onClose={close} />));
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click());
  const canvas = host.querySelector<HTMLDivElement>(".team-map-canvas")!;
  const zoomed = canvas.style.transform;
  session.busy = false;
  await render();
  expect(nodeButton("App Manager").closest(".team-map-node")?.getAttribute("data-status")).toBe("idle");
  expect(canvas.style.transform).toBe(zoomed);
});

it("closes the full view on Escape without leaving the event unclaimed", async () => {
  await renders();
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

it("starts a subscribed goal pulse after SVG mount and restarts only when its path changes", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const raf = vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  const cancel = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const begin = vi.fn();
  Object.defineProperty(SVGElement.prototype, "beginElementAt", { configurable: true, value: begin });
  const flushFrames = () => act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())); });
  await renders();
  const goalHost: ManagerGoalHost = {
    mayDelegate: () => true,
    projects: async () => [{ id: "/app", folder: "/app", name: "App", managerId: "mono-engine-app", managerExists: true,
      running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] }],
    status: async () => ({}), ready: async () => [], deliver: async () => {},
  };
  await act(async () => monoManagerGoals.handle("boss", { kind: "user", messageId: "user-goal" }, "assign-goal", "goals.assign",
    { projectId: "/app", goal: "Verify the Team map" }, goalHost));
  const goal = monoManagerGoals.goals("boss")[0];
  expect(goal.managerId).toBe("mono-engine-app");
  const motion = host.querySelector<SVGElement>(`[data-event-id="goal:${goal.id}:start"] animateMotion`)!;
  expect(motion).not.toBeNull();
  const visibility = motion.parentElement?.querySelector("set");
  expect(visibility).not.toBeNull();
  expect(visibility?.getAttribute("begin")).toBe("indefinite");
  expect(begin).not.toHaveBeenCalled();
  await flushFrames();
  expect(begin.mock.calls).toEqual([[0], [0]]);
  expect(begin.mock.contexts).toEqual([motion, visibility]);
  expect(host.querySelector(".team-map-timeline")?.textContent).toContain("Verify the Team map");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Needs you")!.click());
  expect(motion.closest(".team-map-pulse")?.getAttribute("data-dimmed")).toBe("true");
  const starts = raf.mock.calls.length;
  const path = motion.getAttribute("path");
  await renders();
  expect(raf.mock.calls).toHaveLength(starts);
  expect(begin).toHaveBeenCalledTimes(2);
  const project = host.querySelector<HTMLSelectElement>('[aria-label="Project"]')!;
  await act(async () => { project.value = "/app"; project.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(motion.getAttribute("path")).not.toBe(path);
  expect(cancel).toHaveBeenCalled();
  expect(begin).toHaveBeenCalledTimes(2);
  await flushFrames();
  expect(begin.mock.calls).toEqual([[0], [0], [0], [0]]);
  expect(begin.mock.contexts).toEqual([motion, visibility, motion, visibility]);
});

it("uses tree order and adjacent arrow navigation at narrow widths without consuming scroll", async () => {
  narrow = true;
  await renders();
  expect(buttons().map(button => button.getAttribute("aria-label")?.split(",")[0])).toEqual([
    "Orchestrator", "App Manager", "Backend", "Site Manager", "Designer",
  ]);
  expect(host.querySelector(".team-map-canvas")?.getAttribute("data-compact")).toBe("false");
  expect(nodeButton("Orchestrator").closest<HTMLElement>(".team-map-node")!.style.getPropertyValue("--node-depth")).toBe("0");
  expect(nodeButton("App Manager").closest<HTMLElement>(".team-map-node")!.style.getPropertyValue("--node-depth")).toBe("1");
  expect(nodeButton("Backend").closest<HTMLElement>(".team-map-node")!.style.getPropertyValue("--node-depth")).toBe("2");
  await act(async () => nodeButton("App Manager").focus());
  await act(async () => nodeButton("App Manager").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(nodeButton("Backend"));
  const wheel = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
  await act(async () => host.querySelector(".team-map-viewport")!.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(false);
});

it("keeps both reporting edges marked while working and removes flow on finish, with reduced-motion indicators", async () => {
  reducedMotion = true;
  const running = { leadId: "engine", ownerMonoId: "manager", cwd: "/app", tasks: [
    { id: "work", memberId: "backend", sessionId: "worker", title: "Current task", prompt: "Please verify the current task", result: "", status: "running" },
  ], dispatches: [] } as unknown as OrchestrationRun;
  await renders([running]);
  const flows = [...host.querySelectorAll('.team-map-edge[data-flow="up"]')];
  expect(flows).toHaveLength(2);
  expect(flows.every(edge => edge.getAttribute("data-reduced-motion") === "true")).toBe(true);
  expect(flows.every(edge => edge.querySelector("path"))).toBe(true);
  expect(host.textContent).toContain("↓ assigned · ↑ reporting back · ↔ review");
  expect(flows.every(edge => edge.querySelector("title")?.textContent?.includes("Current task"))).toBe(true);
  expect(flows.every(edge => edge.getAttribute("aria-label")?.includes("progress reports up"))).toBe(true);
  expect(flows.every(edge => edge.querySelector(".team-map-edge-hit"))).toBe(true);
  expect(host.querySelector("animateMotion")).toBeNull();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Needs you")!.click());
  expect(flows.every(edge => edge.getAttribute("data-dimmed") === "true")).toBe(true);
  expect(host.querySelectorAll('.team-map-edge[data-flow="up"]')).toHaveLength(2);
  await renders([{ ...running, tasks: [{ ...running.tasks[0], status: "completed", accepted: true,
    completionOutcome: "no-changes", lastDispatchId: "dispatch", acceptedDispatchId: "dispatch" }] }]);
  expect(host.querySelectorAll(".team-map-edge[data-flow]")).toHaveLength(0);
  expect(host.querySelectorAll(".team-map-edge")).toHaveLength(4);
});
