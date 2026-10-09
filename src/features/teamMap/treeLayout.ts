import type { buildTeamMap, TeamMapNode, TeamMapPoint, TeamMapPod } from "./model";

export const TREE_NODE_WIDTH = 256;
export const TREE_NODE_HEIGHT = 128;
const columnWidth = 320;
const columnGap = 24;
const rowGap = 24;

export function treeLayout(map: ReturnType<typeof buildTeamMap>, order: readonly string[]) {
  const nodes = map.nodes.map(node => ({ ...node }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const root = nodes.find(node => node.mono.role === "orchestrator" && !node.parentId);
  const children = (id: string) => nodes.filter(node => node.parentId === id);
  const columns = nodes.filter(node => node.id !== root?.id && (!node.parentId || node.parentId === root?.id));
  columns.sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
  });
  const width = Math.max(columnWidth, columns.length * (columnWidth + columnGap) - columnGap) + 48;
  if (root) { root.x = (width - TREE_NODE_WIDTH) / 2; root.y = 24; }
  const top = root ? 232 : 64;
  const pods: TeamMapPod[] = [];
  const ordered = root ? [root] : [];
  for (const [index, column] of columns.entries()) {
    const x = 24 + index * (columnWidth + columnGap);
    let y = top;
    const visit = (node: TeamMapNode) => {
      node.x = x + 32;
      node.y = y;
      y += TREE_NODE_HEIGHT + rowGap;
      ordered.push(node);
      const first = ordered.length;
      for (const child of children(node.id)) visit(child);
      if (node.mono.role === "manager") pods.push({
        id: node.id, x, y: node.y - 48, width: columnWidth,
        height: y - node.y + 48, memberIds: ordered.slice(first).map(child => child.id),
      });
    };
    visit(column);
  }
  const edges = map.edges.map(edge => {
    const parent = byId.get(edge.source)!, target = byId.get(edge.target)!;
    const start = { x: parent.x + TREE_NODE_WIDTH / 2, y: parent.y + TREE_NODE_HEIGHT };
    let points: TeamMapPoint[];
    if (parent === root) {
      points = [start, { x: start.x, y: 168 }, { x: target.x + TREE_NODE_WIDTH / 2, y: 168 }, { x: target.x + TREE_NODE_WIDTH / 2, y: target.y - 48 }];
    } else {
      const spine = parent.x - 16;
      const mid = target.y + TREE_NODE_HEIGHT / 2;
      points = [start, { x: start.x, y: start.y + 12 }, { x: spine, y: start.y + 12 }, { x: spine, y: mid }, { x: target.x, y: mid }];
    }
    return { ...edge, points: points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y) };
  });
  return { ...map, nodes: ordered, edges, pods, orientation: "top-down" as const, width, height: Math.max(200, ...nodes.map(node => node.y + TREE_NODE_HEIGHT + 48)) };
}
