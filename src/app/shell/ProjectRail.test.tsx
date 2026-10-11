// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadProjectRailWidth, PROJECT_RAIL_WIDTH_MIN } from "../../features/settings/model/appearance";
import { loadProjectRailOrder, saveProjectRailOrder } from "../../features/projects/model/recents";
import { ProjectRail } from "./ProjectRail";
import { ProjectManagerRow } from "../../features/orchestration/ui/ProjectManagerRow";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: { worktrees: [{ path: "/work/personal", main: true, branch: "nour" }] } }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1000);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(visible = true) {
  await act(async () => root.render(<ProjectRail
    visible={visible}
    cwd="/work/personal"
    recents={[{ path: "/work/client", openedAt: 1 }, { path: "/work/personal", openedAt: 2 }]}
    onSelectProject={vi.fn()}
    onOpenProject={vi.fn()}
    renderProjectWorktrees={() => <><button data-sidebar-row>Session</button><div hidden><button data-sidebar-row>Hidden History</button></div></>}
  />));
}
function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...options });
  act(() => target.dispatchEvent(event));
  return event;
}
const handle = () => host.querySelector<HTMLElement>('[role="separator"]')!;
const rows = () => [...host.querySelectorAll<HTMLButtonElement>("button[data-sidebar-row]")].filter(row => !row.closest("[hidden], [inert]"));

it("resizes by keyboard, clamps to the real maximum, resets and persists across mounts", async () => {
  await render();
  handle().focus();
  expect(document.activeElement).toBe(handle());
  expect(handle().tabIndex).toBe(0);
  key(handle(), "ArrowRight");
  expect(loadProjectRailWidth()).toBe(210);
  expect(host.querySelector("nav")?.style.width).toBe("210px");
  expect(handle().getAttribute("aria-valuetext")).toBe("210 pixels");
  key(handle(), "ArrowLeft", { shiftKey: true });
  expect(loadProjectRailWidth()).toBe(PROJECT_RAIL_WIDTH_MIN);
  key(handle(), "End");
  expect(loadProjectRailWidth()).toBe(350);
  expect(handle().getAttribute("aria-valuemax")).toBe("350");
  key(handle(), "ArrowRight");
  expect(loadProjectRailWidth()).toBe(350);
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(handle().getAttribute("aria-valuenow")).toBe("350");
  key(handle(), "Home");
  expect(loadProjectRailWidth()).toBe(180);
  key(handle(), "Enter");
  expect(loadProjectRailWidth()).toBe(200);
});

it("keeps keyboard and subsequent pointer resizing on the same width", async () => {
  await render();
  key(handle(), "ArrowRight", { shiftKey: true });
  handle().setPointerCapture = vi.fn();
  handle().releasePointerCapture = vi.fn();
  act(() => handle().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 240 })));
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 260 })));
  act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 260 })));
  expect(loadProjectRailWidth()).toBe(260);
  expect(handle().getAttribute("aria-valuenow")).toBe("260");
});

it("keeps valid resize bounds on narrow windows and leaves modified shortcuts alone", async () => {
  vi.stubGlobal("innerWidth", 390);
  await render();
  expect(handle().getAttribute("aria-valuenow")).toBe("180");
  expect(handle().getAttribute("aria-valuemax")).toBe("180");
  expect(key(handle(), "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(key(handle(), "Escape").defaultPrevented).toBe(false);
  key(handle(), "End");
  expect(loadProjectRailWidth()).toBe(180);
});

it("navigates visible rows, expands disclosures and keeps ordinary button selection", async () => {
  await render();
  const select = host.querySelector<HTMLButtonElement>('button[aria-label="personal"]')!;
  select.focus();
  key(select, "ArrowDown");
  expect(document.activeElement).toBe(rows()[rows().indexOf(select) + 1]);
  key(document.activeElement as HTMLElement, "Home");
  expect(document.activeElement).toBe(rows()[0]);
  key(document.activeElement as HTMLElement, "ArrowRight");
  expect(rows()[0].getAttribute("aria-expanded")).toBe("true");
  key(rows()[0], "ArrowLeft");
  expect(rows()[0].getAttribute("aria-expanded")).toBe("false");
  key(rows()[0], "End");
  expect(document.activeElement).toBe(rows()[rows().length - 1]);
  key(document.activeElement as HTMLElement, "ArrowDown");
  expect(document.activeElement).toBe(rows()[rows().length - 1]);
  expect(key(select, "ArrowDown", { altKey: true }).defaultPrevented).toBe(false);
});

it("preserves saved project order and disclosure expansion across remounts", async () => {
  saveProjectRailOrder(["/work/client", "/work/personal"]);
  await render();
  const disclosure = host.querySelector<HTMLButtonElement>('button[aria-label="Expand worktrees in client"]')!;
  key(disclosure, "ArrowRight");
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(loadProjectRailOrder()).toEqual(["/work/client", "/work/personal"]);
  expect(host.querySelector('button[aria-label="Collapse worktrees in client"]')).not.toBeNull();
  expect(rows().filter(row => ["client", "personal"].includes(row.getAttribute("aria-label") ?? "")).map(row => row.getAttribute("aria-label"))).toEqual(["client", "personal"]);
});

it("retains the existing hidden rail without making it a tab destination", async () => {
  await render(false);
  expect(host.querySelector("nav")?.classList.contains("hidden")).toBe(true);
});

it("passes the existing Mono unread counts to manager members without extra App wiring", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "manager", role: "manager", managerProject: "/work/personal", projects: ["/work/personal"], mascot: "cat", color: "#aaaaaa" },
    { id: "unread", role: "member", reportsTo: "manager", name: "Unread member", projects: ["/work/personal"], mascot: "cat", color: "#aaaaaa" },
  ]));
  const show = async (unread: number) => act(async () => root.render(<ProjectRail
    cwd="/work/personal"
    recents={[{ path: "/work/personal", openedAt: 1 }]}
    onSelectProject={vi.fn()}
    onOpenProject={vi.fn()}
    monos={{ states: new Map(), unseenCounts: new Map([["unread", unread]]), onOpen: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn() }}
    renderProjectWorktrees={() => <ProjectManagerRow project="/work/personal" onOpen={vi.fn()} />}
  />));
  await show(1);
  expect(host.querySelector('[aria-label="Open Unread member"]')).not.toBeNull();
  await show(0);
  expect(host.querySelector('[aria-label="Open Unread member"]')).toBeNull();
  expect(host.textContent).toContain("1 idle member");
});
