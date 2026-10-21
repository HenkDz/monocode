// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mono } from "../monos/model/mono";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import { newSession } from "../sessions/model/session";
import { monoManagerGoals } from "../monos/model/monoManagerGoals";
import { getMonoTranscriptPage, type MonoTranscriptPage } from "../sessions/data/sessionStore";
import { TeamMap, type TeamMapProps } from "./TeamMap";
import { OrbitMap } from "./OrbitMap";
import { ORBIT_PREFERENCES_KEY } from "./orbit";

vi.mock("@tauri-apps/api/core", async original => ({ ...await original<object>(), invoke: vi.fn(async () => null) }));
vi.mock("../sessions/ui/AgentTranscript", () => ({ MonoActivityTrail: ({ blocks }: { blocks: { id: string; text: string }[] }) => <ol aria-label="Activity in chronological order">{blocks.map(block => <li key={block.id}>{block.text}</li>)}</ol> }));
vi.mock("../sessions/data/sessionStore", async original => ({ ...await original<object>(), getMonoTranscriptPage: vi.fn() }));

const roster: Mono[] = [
  { id: "boss", name: "Orchestrator", role: "orchestrator", projects: ["/app", "/site"], mascot: "cat", color: "#abcdef" },
  { id: "manager", name: "App Manager", role: "manager", reportsTo: "boss", managerEngineId: "engine", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#abcdef" },
  { id: "backend", name: "Backend", role: "member", reportsTo: "manager", projects: ["/app"], mascot: "cat", color: "#abcdef" },
  { id: "frontend", name: "Frontend", role: "member", reportsTo: "manager", projects: ["/app"], mascot: "cat", color: "#abcdef" },
  { id: "site-manager", name: "Site Manager", role: "manager", reportsTo: "boss", projects: ["/site"], managerProject: "/site", mascot: "cat", color: "#abcdef" },
];
const runs = [{ leadId: "engine", ownerMonoId: "manager", cwd: "/app", status: "active", tasks: [
  { id: "blocked", memberId: "backend", sessionId: "worker", title: "Choose API contract", prompt: "Choose API contract", result: "", status: "blocked", dependsOn: [] },
  { id: "working", memberId: "frontend", sessionId: "ui-worker", title: "Build project drawer", prompt: "Implement and verify the drawer", result: "", status: "running", dependsOn: [] },
], dispatches: [] }] as unknown as OrchestrationRun[];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let reducedMotion = false;
let width = 1100;
let resize: () => void;
const open = vi.fn(), close = vi.fn();
const renderMap = (props: Partial<TeamMapProps> = {}) => act(async () => root.render(<OrbitMap sessions={[]} runs={runs} statuses={new Map()} onOpenMono={open} onClose={close} onToggleView={() => {}} {...props} />));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (label: string) => act(async () => button(label).click());
const key = (element: EventTarget, value: string, shiftKey = false) => act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
const decisions: NonNullable<TeamMapProps["decisions"]> = {
  needYou: 2, handledToday: 6, incomplete: false,
  rail: <div data-decision-ui><h2>Decisions</h2><p>Shared decision rail</p></div>,
  project: path => ({ pending: path === "/app" ? 2 : 0, teamPending: 1, incomplete: false,
    autonomy: <div>Shared autonomy control</div>, cards: <div>Shared decision cards</div> }),
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false; width = 1100;
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(performance.now()); return 1; });
  localStorage.clear(); localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  open.mockReset(); close.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("defaults to the Command map and keeps the saved Tree view available", async () => {
  await act(async () => root.render(<TeamMap sessions={[]} runs={runs} statuses={new Map()} onOpenMono={open} onClose={close} />));
  expect(host.querySelector("h1")?.textContent).toBe("Command map");
  expect(host.querySelectorAll(".zoom-map-project")).toHaveLength(2);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Tree")!.click());
  expect(JSON.parse(localStorage.getItem(ORBIT_PREFERENCES_KEY)!).view).toBe("tree");
  expect(host.querySelector(".team-map-canvas")).not.toBeNull();
});

it("places Boss above projects and derives whole-line working activity", async () => {
  await renderMap({ decisions });
  const boss = host.querySelector<HTMLElement>(".command-map-boss")!;
  const project = button("Open app project");
  expect(boss.style.left).toBe("550px");
  expect(parseFloat(project.style.top)).toBeGreaterThan(164);
  expect(host.querySelectorAll('.command-map-links path[data-working="true"]')).toHaveLength(1);
  expect(host.querySelectorAll("animateMotion")).toHaveLength(0);
  expect(boss.textContent).toContain("2");
  expect(host.querySelector('.command-map-team[aria-label="2 members"]')?.children).toHaveLength(2);
});

it("uses explicit unavailable metrics and never promotes generic attention into a decision count", async () => {
  await renderMap();
  expect(host.querySelector(".command-map-vitals")?.textContent).toContain("— decided by team today");
  expect(host.querySelector(".command-map-vitals")?.textContent).toContain("— need you");
  expect(host.textContent).toContain("Decision history unavailable");
  expect(button("Open app project").querySelector(".command-map-badge")).toBeNull();
});

it("opens and switches project drawers through real map selections, returns focus on Escape", async () => {
  await renderMap({ decisions });
  await click("Open app project");
  expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe("app");
  expect(document.activeElement).toBe(button("Close project"));
  expect(host.querySelector('[role="dialog"] [data-decision-ui]')?.textContent).toContain("Shared autonomy control");
  await key(button("Close project"), "Escape");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button("Open app project"));
  expect(close).not.toHaveBeenCalled();
  await click("Open site project");
  expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe("site");
});

it("traps drawer Tab focus and makes surrounding map, header and decisions inert", async () => {
  await renderMap({ decisions }); await click("Open app project");
  const dialog = host.querySelector('[role="dialog"]')!;
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
  await key(controls[0], "Tab", true);
  expect(document.activeElement).toBe(controls[controls.length - 1]);
  expect(host.querySelector(".team-map-toolbar")?.hasAttribute("inert")).toBe(true);
  expect(host.querySelector(".command-map-main")?.hasAttribute("inert")).toBe(true);
  expect(host.querySelector(".command-map-rail")?.hasAttribute("inert")).toBe(true);
});

it("shows exact goal source as a bounded preview with recorded accepted progress", async () => {
  const title = "Full saved goal\n" + "source ".repeat(150);
  vi.spyOn(monoManagerGoals, "goals").mockReturnValue([{ id: "goal", managerId: "engine", title, state: "running", updatedAt: 1 } as ReturnType<typeof monoManagerGoals.goals>[number]]);
  const tasks = runs[0].tasks.map((task, index) => ({ ...task, monoGoalId: "goal", accepted: index === 0 }));
  await renderMap({ runs: [{ ...runs[0], tasks }] }); await click("Open app project");
  expect(host.querySelector('.command-map-goal progress')?.getAttribute("value")).toBe("1");
  expect(host.textContent).toContain("1 of 2 tasks accepted · 50%");
  expect(monoManagerGoals.goals()[0].title).toBe(title);
  expect(host.querySelector('.command-map-goal > p')!.textContent!.length).toBeLessThanOrEqual(600);
});

it("preserves paused parent state and opens CC-TX work only through its custom fold", async () => {
  const session = { ...newSession("codex", "/app"), id: "worker", blocks: [{ id: "saved", role: "assistant", text: "Saved work evidence" }] } as ReturnType<typeof newSession>;
  const paused = { ...runs[0], status: "paused", lastPauseReason: "Owner held execution", tasks: [{ ...runs[0].tasks[0], status: "queued" }] } as OrchestrationRun;
  await renderMap({ runs: [paused], sessions: [session] }); await click("Open app project");
  expect(host.textContent).toContain("Owner held execution");
  expect(host.querySelector('[aria-label="Activity in chronological order"]')).toBeNull();
  const fold = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes("Show work · 1 steps"))!;
  await act(async () => fold.click());
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  expect(host.textContent).toContain("Saved work evidence");
  await click("Close project");
  expect(host.querySelector('[aria-label="Activity in chronological order"]')).toBeNull();
});

it("keeps a prompt copied into a task title, full reports and artifacts inside Show work", async () => {
  const prompt = "RAW TASK INSTRUCTIONS\n" + "scope and constraints ".repeat(30);
  const task = { ...runs[0].tasks[0], title: prompt, prompt, result: "REPORT BODY", reportArtifactId: "artifact-source" };
  await renderMap({ runs: [{ ...runs[0], tasks: [task] }] }); await click("Open app project");
  expect(host.querySelector(".command-map-task-summary")?.textContent).toBe("Untitled task");
  expect(host.textContent).not.toContain("RAW TASK INSTRUCTIONS");
  expect(host.textContent).not.toContain("REPORT BODY");
  expect(host.textContent).not.toContain("artifact-source");
  const fold = host.querySelector<HTMLButtonElement>(".command-map-fold")!;
  await act(async () => fold.click());
  expect(host.querySelector(".command-map-brief")?.textContent).toBe(prompt);
  expect(host.textContent).toContain("REPORT BODY");
  expect(host.querySelector('[data-org-artifact="artifact-source"]')).not.toBeNull();
  expect(host.querySelector("details")).toBeNull();
});

it("renders the supplied guarded goal action once in the goal panel", async () => {
  vi.spyOn(monoManagerGoals, "goals").mockReturnValue([{ id: "goal", managerId: "engine", title: "Next step", state: "running", updatedAt: 1 } as ReturnType<typeof monoManagerGoals.goals>[number]]);
  const action = vi.fn();
  await renderMap({ decisions: { ...decisions, project: path => ({ ...decisions.project(path, "manager"), goalAction: id => <button type="button" onClick={() => action(id)}>Manager paused — Continue</button> }) } });
  await click("Open app project");
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent === "Manager paused — Continue");
  expect(buttons).toHaveLength(1);
  expect(host.querySelector('.command-map-goal button')).toBe(buttons[0]);
  expect(host.querySelector('.command-map-manager-chat')?.textContent).not.toContain("Manager paused — Continue");
  await act(async () => buttons[0].click());
  expect(action.mock.calls).toEqual([["goal"]]);
});

it("uses existing Manager/member/Boss navigation and closes the surface", async () => {
  await renderMap(); await click("Open app project");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Message App Manager")!.click());
  expect(open).toHaveBeenCalledWith("manager", null); expect(close).toHaveBeenCalledOnce();
  open.mockClear(); close.mockClear();
  await click("Open chat with Orchestrator");
  expect(open).toHaveBeenCalledExactlyOnceWith("boss", undefined); expect(close).toHaveBeenCalledOnce();
});

it("keeps every project available at narrow widths and gives arrow keys real focus targets", async () => {
  width = 320;
  await renderMap();
  expect(button("Open app project").style.left).toBe("160px");
  expect(button("Open site project").style.top).toBe("580px");
  await act(async () => button("Open app project").focus());
  await key(button("Open app project"), "ArrowDown");
  expect(document.activeElement).toBe(button("Open site project"));
  width = 800; await act(async () => resize());
  expect(host.querySelectorAll(".command-map-project")).toHaveLength(2);
});

it("marks partial retained decision history and reduced motion without changing routing", async () => {
  reducedMotion = true;
  await renderMap({ decisions: { ...decisions, incomplete: true } });
  expect(host.querySelector('[data-reduced-motion="true"]')).not.toBeNull();
  expect(host.querySelector(".command-map-vitals")?.textContent).toContain("≥6");
  expect(host.textContent).toContain("Decision history incomplete · retained records");
  expect(host.querySelector('textarea')?.disabled).toBe(true);
});

it("keeps saved dispatch report and saved turn model separate from the retried assignment", async () => {
  const retainedRun = { ...runs[0], tasks: [{ ...runs[0].tasks[0], status: "running", sessionId: "new-worker", activeDispatchId: "new", lastDispatchId: "new", result: "CURRENT report" }], dispatches: [
    { id: "old", taskId: "blocked", sessionId: "old-worker", state: "completed", startedAt: 1, updatedAt: 2, result: "OLD saved dispatch report" },
    { id: "new", taskId: "blocked", sessionId: "new-worker", state: "running", startedAt: 3, updatedAt: 4 },
  ] } as OrchestrationRun;
  const oldSession = { ...newSession("codex", "/app"), id: "old-worker", model: "CURRENT DEFAULT MUST NOT LABEL HISTORY", blocks: [
    { id: "old-turn", role: "user", text: "Saved original request", turnModel: { harness: "codex", id: "saved-model", name: "Saved model provenance" } },
  ] } as ReturnType<typeof newSession>;
  await renderMap({ runs: [retainedRun], sessions: [oldSession] }); await click("Open app project");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes("Show work"))!.click());
  const attempts = host.querySelector<HTMLSelectElement>('[aria-label="Backend work attempt"]')!;
  await act(async () => { attempts.value = "old"; attempts.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("OLD saved dispatch report");
  expect(host.textContent).toContain("Saved model provenance");
  expect(host.textContent).not.toContain("CURRENT DEFAULT MUST NOT LABEL HISTORY");
  expect(host.textContent).toContain("History · Task blocked · dispatch old · completed");
  expect(host.querySelector('.command-map-fold')?.textContent).toContain("1 steps");
});

it("drops an older transcript page when its project drawer is closed before load resolves", async () => {
  let finish!: (page: MonoTranscriptPage) => void;
  vi.mocked(getMonoTranscriptPage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const session = { ...newSession("codex", "/app"), id: "worker", monoTranscript: { before: 20, firstBlockId: "tail" }, blocks: [{ id: "tail", role: "assistant", text: "Current tail" }] } as ReturnType<typeof newSession>;
  await renderMap({ sessions: [session] }); await click("Open app project");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes("Show work"))!.click());
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Load earlier work")!.click());
  expect(getMonoTranscriptPage).toHaveBeenLastCalledWith("worker", { before: 20 });
  await click("Close project"); await click("Open site project");
  await act(async () => finish({ blocks: [{ id: "late", role: "assistant", text: "OLD late page must not cross projects" }], before: null, hasNewer: false }));
  expect(host.textContent).not.toContain("OLD late page must not cross projects");
  expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe("site");
});
