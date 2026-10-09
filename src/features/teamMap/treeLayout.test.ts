// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { Mono } from "../monos/model/mono";
import { buildTeamMap } from "./model";
import { treeLayout, TREE_NODE_WIDTH, TREE_NODE_HEIGHT } from "./treeLayout";

const roster: Mono[] = [
  { id: "boss", name: "Boss", role: "orchestrator", projects: [], mascot: "cat", color: "#aaa" },
  ...["app", "site", "tools"].flatMap(id => [
    { id, name: id, role: "manager" as const, reportsTo: "boss", projects: [`/${id}`], mascot: "cat", color: "#aaa" },
    ...["engineer", "reviewer", "qa"].map(role => ({ id: `${id}-${role}`, name: role, role: "member" as const, reportsTo: id, projects: [`/${id}`], mascot: "cat", color: "#aaa" })),
  ]),
];
const input = { roster, runs: [], sessions: [] };
it("keeps ordered projects in one row and each team's workers in one stack across viewport changes", () => {
  const source = buildTeamMap(input);
  const before = JSON.stringify(source);
  const order = ["tools", "app", "site"];
  const map = treeLayout(source, order);
  expect(map.pods.map(pod => pod.id)).toEqual(order);
  expect(new Set(map.pods.map(pod => pod.y)).size).toBe(1);
  for (const pod of map.pods) {
    const members = map.nodes.filter(node => pod.memberIds.includes(node.id));
    expect(new Set(members.map(node => node.x)).size).toBe(1);
    expect(new Set(members.map(node => node.y)).size).toBe(3);
  }
  expect(treeLayout(buildTeamMap({ ...input, viewport: { width: 800, height: 600 } }), order).nodes.map(node => [node.id, node.x, node.y])).toEqual(map.nodes.map(node => [node.id, node.x, node.y]));
  expect(JSON.stringify(source)).toBe(before);
});
it("keeps every relationship and routes its segments outside all card interiors", () => {
  const source = buildTeamMap(input), map = treeLayout(source, []);
  expect(map.edges.map(edge => [edge.id, edge.source, edge.target, edge.flow, edge.tooltip])).toEqual(source.edges.map(edge => [edge.id, edge.source, edge.target, edge.flow, edge.tooltip]));
  for (const edge of map.edges) for (let index = 1; index < edge.points.length; index++) {
    const a = edge.points[index - 1], b = edge.points[index];
    expect(a.x === b.x || a.y === b.y).toBe(true);
    for (const node of map.nodes) {
      const crosses = a.x === b.x
        ? a.x > node.x && a.x < node.x + TREE_NODE_WIDTH && Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + TREE_NODE_HEIGHT
        : a.y > node.y && a.y < node.y + TREE_NODE_HEIGHT && Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + TREE_NODE_WIDTH;
      expect(crosses, `${edge.id} crosses ${node.id}`).toBe(false);
    }
  }
});
it("retains scoped, collapsed, orphan and empty organizations without dropping agents", () => {
  for (const extra of [{ scope: "app" }, { collapsed: new Set(["app"]) }, { roster: [...roster, { id: "solo", name: "Solo", projects: [], mascot: "cat", color: "#aaa" }] }, { roster: [] }]) {
    const source = buildTeamMap({ ...input, ...extra });
    const map = treeLayout(source, ["missing", "site"]);
    expect(map.nodes.map(node => node.id).sort()).toEqual(source.nodes.map(node => node.id).sort());
    for (const node of map.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + TREE_NODE_WIDTH).toBeLessThanOrEqual(map.width);
      expect(node.y + TREE_NODE_HEIGHT).toBeLessThanOrEqual(map.height);
    }
  }
});
