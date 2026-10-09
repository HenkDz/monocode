// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mono } from "../monos/model/mono";
import { recordCrewMessage } from "../monos/model/monoCrewEvents";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import { newSession } from "../sessions/model/session";
import { TeamMap } from "./TeamMap";
import { ORBIT_PREFERENCES_KEY } from "./orbit";

vi.mock("@tauri-apps/api/core", async original => ({
  ...await original<object>(), invoke: vi.fn(async () => null),
}));

const roster: Mono[] = [
  { id: "boss", name: "Orchestrator", role: "orchestrator", projects: ["/app", "/site"], mascot: "cat", color: "#abcdef" },
  { id: "manager", name: "App Manager", role: "manager", reportsTo: "boss", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#abcdef" },
  { id: "backend", name: "Backend", role: "member", reportsTo: "manager", projects: ["/app"], specialty: "API and UI implementation", workerProfile: { harness: "codex", model: "codex:gpt-6.1-sol" }, mascot: "cat", color: "#abcdef" },
  { id: "frontend", name: "Frontend", role: "member", reportsTo: "manager", projects: ["/app"], mascot: "cat", color: "#abcdef" },
  { id: "site-manager", name: "Site Manager", role: "manager", reportsTo: "boss", projects: ["/site"], managerProject: "/site", mascot: "cat", color: "#abcdef" },
  { id: "designer", name: "Designer", role: "member", reportsTo: "site-manager", projects: ["/site"], mascot: "cat", color: "#abcdef" },
];
const runs = [{ leadId: "engine", ownerMonoId: "manager", cwd: "/app", tasks: [
  { id: "blocked", memberId: "backend", sessionId: "worker", title: "Choose API contract", prompt: "Choose API contract", result: "", status: "blocked" },
  { id: "working", memberId: "frontend", sessionId: "ui-worker", title: "Build Orbit rows", prompt: "Implement and verify the Orbit rows", result: "", status: "running" },
], dispatches: [] }] as unknown as OrchestrationRun[];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let reducedMotion = false;
const open = vi.fn(), close = vi.fn();
const renderMap = (activeRuns: OrchestrationRun[] = runs, scope?: string) => act(async () => root.render(
  <TeamMap sessions={[]} runs={activeRuns} statuses={new Map()} scope={scope} onOpenMono={open} onClose={close} />,
));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const focusProject = (name: string) => button(`Focus ${name} team`);
const members = () => [...host.querySelectorAll<HTMLButtonElement>(".orbit-member-row > button:first-child")];
let frames: FrameRequestCallback[];
let resize: () => void;
let viewportWidth = 1100;
const key = async (element: EventTarget, value: string) => {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
  await act(async () => { const pending = frames.splice(0); pending.forEach(callback => callback(performance.now())); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false;
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
  viewportWidth = 1100;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => viewportWidth);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(SVGElement.prototype, "beginElementAt", { configurable: true, value: vi.fn() });
  localStorage.clear();
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  open.mockReset(); close.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(SVGElement.prototype, "beginElementAt");
});

it("defaults to Orbit and persists the Tree choice while keeping both views available", async () => {
  await renderMap();
  expect(host.querySelector(".orbit-capsule")).not.toBeNull();
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Tree")!.click());
  expect(JSON.parse(localStorage.getItem(ORBIT_PREFERENCES_KEY)!).view).toBe("tree");
  expect(host.querySelector(".team-map-canvas")).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(host);
  await renderMap();
  expect(host.querySelector(".team-map-canvas")).not.toBeNull();
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Orbit")!.click());
  expect(JSON.parse(localStorage.getItem(ORBIT_PREFERENCES_KEY)!).view).toBe("orbit");
  expect(host.querySelector(".orbit-capsule")).not.toBeNull();
});

it("starts with the attention project, sorts its team and retains model and specialty text", async () => {
  await renderMap();
  expect(members().map(node => node.getAttribute("aria-label")?.split(",")[0])).toEqual(["Backend", "Frontend"]);
  expect(host.textContent).toContain("Now: Build Orbit rows");
  expect(host.textContent).toContain("codex:gpt-6.1-sol");
  const specialty = host.querySelector<HTMLElement>('[title="API and UI implementation"]')!;
  expect(specialty.textContent).toBe("API and UI implementation");
  expect(specialty.parentElement?.className).toBe("orbit-member-name");
  expect(host.querySelector(".orbit-center")?.getAttribute("data-status")).toBe("idle");
  expect(host.querySelector(".orbit-center")?.textContent).toContain("Needs you");
});

it("shows the Orchestrator's own busy status separately from team attention", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster.map(mono => mono.id === "boss" ? { ...mono, sessionId: "boss-chat" } : mono)));
  const session = { ...newSession("codex", "/app"), id: "boss-chat", busy: true };
  await act(async () => root.render(<TeamMap sessions={[session]} runs={runs} statuses={new Map()} onOpenMono={open} onClose={close} />));
  expect(host.querySelector(".orbit-center")?.getAttribute("data-status")).toBe("working");
  expect(host.querySelector(".orbit-center")?.textContent).toContain("Needs you");
});

it("keeps live reporting lines, queued assignments and blocked branches consistent with Tree", async () => {
  await renderMap();
  expect(host.querySelector('.orbit-spoke[data-flow="up"]')).not.toBeNull();
  const branches = () => [...host.querySelectorAll('.orbit-member-edge')].map(edge => edge.getAttribute('data-flow'));
  expect(branches()).toEqual([null, "up"]);

  const queued = runs.map(run => ({ ...run, tasks: run.tasks.map(task => ({ ...task, status: "queued" as const })) }));
  await renderMap(queued);
  expect(host.querySelectorAll('.orbit-spoke[data-flow="down"]')).toHaveLength(1);
  expect(branches()).toEqual(["down", "down"]);

  await renderMap([]);
  expect(host.querySelectorAll('.orbit-spoke[data-flow], .orbit-member-edge[data-flow]')).toHaveLength(0);
  expect(host.querySelectorAll('.orbit-capsule')).toHaveLength(2);
});

it("rotates with left and right, moves through the team, opens Enter and collapses Escape", async () => {
  await renderMap();
  await act(async () => focusProject("app").focus());
  await key(focusProject("app"), "ArrowRight");
  expect(document.activeElement).toBe(focusProject("site"));
  await key(focusProject("site"), "ArrowDown");
  expect(document.activeElement?.getAttribute("aria-label")).toContain("Designer,");
  await key(document.activeElement!, "ArrowLeft");
  expect(document.activeElement).toBe(focusProject("app"));
  await key(focusProject("app"), "ArrowDown");
  expect(document.activeElement).toBe(members()[0]);
  await key(document.activeElement!, "ArrowDown");
  expect(document.activeElement).toBe(members()[1]);
  await key(document.activeElement!, "ArrowUp");
  expect(document.activeElement).toBe(members()[0]);
  await key(document.activeElement!, "Escape");
  expect(members()).toHaveLength(0);
  expect(close).not.toHaveBeenCalled();
  await act(async () => focusProject("app").click());
  await key(focusProject("app"), "ArrowDown");
  await key(document.activeElement!, "Enter");
  expect(open).toHaveBeenCalledExactlyOnceWith("backend");
  expect(close).toHaveBeenCalledOnce();
});

it("dims project and Needs you filters without removing ring neighbors or team rows", async () => {
  await renderMap();
  const order = [...host.querySelectorAll(".orbit-capsule")];
  const project = host.querySelector<HTMLSelectElement>('[aria-label="Project"]')!;
  await act(async () => { project.value = "/site"; project.dispatchEvent(new Event("change", { bubbles: true })); });
  expect([...host.querySelectorAll(".orbit-capsule")]).toEqual(order);
  expect(focusProject("app").closest(".orbit-capsule")?.getAttribute("data-dimmed")).toBe("true");
  await act(async () => { project.value = ""; project.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => focusProject("app").click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Needs you")!.click());
  expect(members()).toHaveLength(2);
  expect(members()[0].closest(".orbit-member-row")?.getAttribute("data-dimmed")).toBe("false");
  expect(members()[1].closest(".orbit-member-row")?.getAttribute("data-dimmed")).toBe("true");
});

it("restores the last idle focus but gives scoped Manager opens precedence", async () => {
  await renderMap([]);
  await act(async () => focusProject("site").click());
  expect(JSON.parse(localStorage.getItem(ORBIT_PREFERENCES_KEY)!).focus).toBe("site-manager");
  await act(async () => root.unmount()); root = createRoot(host);
  await renderMap([]);
  expect(members()[0].getAttribute("aria-label")).toContain("Designer,");
  await act(async () => root.unmount()); root = createRoot(host);
  await renderMap([], "manager");
  expect(members()[0].getAttribute("aria-label")).toContain("Backend,");
  expect(host.querySelectorAll(".orbit-capsule")).toHaveLength(2);
});

it("keeps consistent center and Manager chat affordances", async () => {
  await renderMap();
  await act(async () => button("Open chat with App Manager").click());
  expect(open).toHaveBeenCalledExactlyOnceWith("manager");
  open.mockReset(); close.mockReset();
  await act(async () => button("Open chat with Orchestrator").click());
  expect(open).toHaveBeenCalledExactlyOnceWith("boss");
});

it("opens the focused Manager with Enter", async () => {
  await renderMap();
  await act(async () => focusProject("site").click());
  await key(focusProject("site"), "Enter");
  expect(open).toHaveBeenCalledExactlyOnceWith("site-manager");
  expect(close).toHaveBeenCalledOnce();
});

it("persists dragged ring order and keeps it across resize and remount", async () => {
  await renderMap([]);
  const source = focusProject("site").closest(".orbit-capsule")!;
  const destination = focusProject("app").closest(".orbit-capsule")!;
  const start = new Event("dragstart", { bubbles: true });
  Object.defineProperty(start, "dataTransfer", { value: { setData: vi.fn() } });
  await act(async () => source.dispatchEvent(start));
  await act(async () => destination.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true })));
  const ids = () => [...host.querySelectorAll<HTMLElement>(".orbit-capsule")].map(node => node.dataset.id);
  expect(ids()).toEqual(["site-manager", "manager"]);
  expect(JSON.parse(localStorage.getItem(ORBIT_PREFERENCES_KEY)!).order).toEqual(["site-manager", "manager"]);
  await act(async () => { viewportWidth = 650; resize(); });
  expect(ids()).toEqual(["site-manager", "manager"]);
  await act(async () => root.unmount()); root = createRoot(host);
  await renderMap([]);
  expect(ids()).toEqual(["site-manager", "manager"]);
});

it("pages larger orgs while arrows can cross the page boundary", async () => {
  const managers = Array.from({ length: 10 }, (_, index) => ({ ...roster[1], id: `project-${index}`, name: `Project ${index}`, managerProject: `/project-${index}`, projects: [`/project-${index}`] }));
  localStorage.setItem("monocode:mono-roster", JSON.stringify([roster[0], ...managers]));
  await renderMap([]);
  expect(host.querySelectorAll(".orbit-capsule")).toHaveLength(8);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Next projects")!.click());
  expect(host.querySelectorAll(".orbit-capsule")).toHaveLength(2);
  expect(focusProject("project-8").getAttribute("aria-pressed")).toBe("true");
  await key(focusProject("project-8"), "ArrowLeft");
  expect(host.querySelectorAll(".orbit-capsule")).toHaveLength(8);
  expect(document.activeElement).toBe(focusProject("project-7"));
});

it("subscribes to reports using static reduced-motion indicators and preserves the feed", async () => {
  reducedMotion = true;
  await renderMap();
  expect(host.querySelector('[data-reduced-motion="true"]')).not.toBeNull();
  await act(async () => recordCrewMessage({ id: "orbit-report", managerId: "manager", senderId: "backend", recipientId: "manager", topic: "Report", text: "API verified", at: Date.now() }));
  expect(host.querySelector('[data-event-id="orbit-report"]')).not.toBeNull();
  expect(host.querySelector("animateMotion")).toBeNull();
  expect(host.querySelector(".team-map-timeline")?.textContent).toContain("API verified");
});
