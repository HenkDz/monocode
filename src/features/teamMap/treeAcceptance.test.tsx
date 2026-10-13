// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Mono } from "../monos/model/mono";
import { newSession } from "../sessions/model/session";
import { buildTeamMap } from "./model";
import { treeLayout, TREE_NODE_WIDTH, TREE_NODE_HEIGHT } from "./treeLayout";
import { TreeMap } from "./TeamMap";

vi.mock("@tauri-apps/api/core", async original => ({ ...await original<object>(), invoke: vi.fn(async () => null) }));
const roster = (count: number): Mono[] => [
  { id: "grand", role: "orchestrator", name: "Grand Orch", projects: [], mascot: "cat", color: "#abc" },
  { id: "manager", role: "manager", reportsTo: "grand", name: "Manager", projects: ["/fixture"], mascot: "cat", color: "#abc" },
  ...Array.from({ length: count }, (_, index) => ({ id: `worker-${index}`, role: "member" as const, reportsTo: "manager", sessionId: `chat-${index}`, name: `Worker ${index}`, projects: ["/fixture"], mascot: "cat", color: "#abc" })),
];
function assertGeometry(map: ReturnType<typeof treeLayout>) {
  for (const node of map.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(0); expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.x + TREE_NODE_WIDTH).toBeLessThanOrEqual(map.width);
    expect(node.y + TREE_NODE_HEIGHT).toBeLessThanOrEqual(map.height);
    for (const other of map.nodes.filter(other => other.id !== node.id))
      expect(node.x < other.x + TREE_NODE_WIDTH && node.x + TREE_NODE_WIDTH > other.x && node.y < other.y + TREE_NODE_HEIGHT && node.y + TREE_NODE_HEIGHT > other.y, `${node.id} overlaps ${other.id}`).toBe(false);
  }
  for (const edge of map.edges) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i-1], b = edge.points[i];
    expect(a.x === b.x || a.y === b.y).toBe(true);
    for (const node of map.nodes) {
      const crosses = a.x === b.x
        ? a.x > node.x && a.x < node.x + TREE_NODE_WIDTH && Math.max(a.y,b.y) > node.y && Math.min(a.y,b.y) < node.y + TREE_NODE_HEIGHT
        : a.y > node.y && a.y < node.y + TREE_NODE_HEIGHT && Math.max(a.x,b.x) > node.x && Math.min(a.x,b.x) < node.x + TREE_NODE_WIDTH;
      expect(crosses, `${edge.id} crosses ${node.id}`).toBe(false);
    }
  }
}
it.each([0,1,4,6,10])("packs %i workers into two-card rows under their centered Manager, without overlap or crossed interiors", count => {
  const source = buildTeamMap({ roster: roster(count), runs: [], sessions: [] });
  const before = JSON.stringify(source), map = treeLayout(source, []);
  assertGeometry(map);
  const manager = map.nodes.find(node => node.id === "manager")!;
  const workers = map.nodes.filter(node => node.parentId === manager.id);
  expect(new Set(workers.map(node => node.y)).size).toBe(Math.ceil(count / 2));
  expect(new Set(workers.map(node => node.x)).size).toBe(Math.min(count,2));
  for (const node of workers) expect(node.y).toBeGreaterThan(manager.y + TREE_NODE_HEIGHT);
  if (count >= 2) expect(manager.x + TREE_NODE_WIDTH / 2).toBe((Math.min(...workers.map(node => node.x)) + Math.max(...workers.map(node => node.x)) + TREE_NODE_WIDTH) / 2);
  expect(map.edges.map(edge => [edge.id,edge.flow,edge.tooltip])).toEqual(source.edges.map(edge => [edge.id,edge.flow,edge.tooltip]));
  expect(JSON.stringify(source)).toBe(before);
});
it("retains nested teams, orphans, project order, collapse, scope and stable geometry", () => {
  const nested = [...roster(4), { ...roster(0)[1], id: "nested", reportsTo: "manager", projects: ["/nested"] },
    { ...roster(1)[2], id: "nested-worker", reportsTo: "nested" },
    { ...roster(0)[1], id: "other", reportsTo: "grand", projects: ["/other"] },
    { ...roster(1)[2], id: "orphan", reportsTo: "missing" }];
  for (const extra of [{}, { collapsed: new Set(["manager"]) }, { scope: "manager" }, { project: "/fixture" }]) {
    const source = buildTeamMap({ roster: nested, runs: [], sessions: [], ...extra });
    const map = treeLayout(source, ["other","manager"]);
    expect(map.nodes.map(node => node.id).sort()).toEqual(source.nodes.map(node => node.id).sort());
    assertGeometry(map);
    expect(treeLayout(buildTeamMap({ roster: nested, runs: [], sessions: [], ...extra, viewport: { width: 390, height: 600 } }), ["other","manager"]).nodes.map(node => [node.id,node.x,node.y])).toEqual(map.nodes.map(node => [node.id,node.x,node.y]));
  }
});
let root: ReturnType<typeof createRoot> | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("draws flow on every full working branch and removes drag affordances and handlers while preserving bounded order", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window,"matchMedia").mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const people = [...roster(4), { ...roster(0)[1], id: "other", reportsTo: "grand", projects: ["/other"] }];
  localStorage.setItem("monocode:mono-roster", JSON.stringify(people));
  const sessions = people.filter(mono => mono.role === "member").map(mono => ({ ...newSession("codex", "/fixture"), id: mono.sessionId!, busy: true }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<TreeMap sessions={sessions} runs={[]} statuses={new Map()} onOpenMono={() => {}} onClose={() => {}} />));
  const working = [...host.querySelectorAll('.team-map-edge[data-flow="up"]')];
  expect(working).toHaveLength(5);
  for (const edge of working) expect(edge.querySelector(".team-map-edge-flow")?.getAttribute("d")).toBe(edge.querySelector(".team-map-edge-route")?.getAttribute("d"));
  expect(host.querySelector('[draggable="true"], .tree-project-grip')).toBeNull();
  const header = host.querySelector<HTMLButtonElement>(".tree-project-header")!;
  const initial = localStorage.getItem("monocode:team-map-orbit");
  await act(async () => header.dispatchEvent(new Event("dragstart", { bubbles: true })));
  await act(async () => header.dispatchEvent(new Event("drop", { bubbles: true })));
  expect(localStorage.getItem("monocode:team-map-orbit")).toBe(initial);
  await act(async () => host!.querySelector<HTMLButtonElement>('[aria-label="Move project right"]')!.click());
  expect(JSON.parse(localStorage.getItem("monocode:team-map-orbit")!).order).toEqual(["other","manager"]);
  expect(JSON.parse(localStorage.getItem("monocode:mono-roster")!).find((mono: Mono) => mono.id === "worker-0").reportsTo).toBe("manager");
});
