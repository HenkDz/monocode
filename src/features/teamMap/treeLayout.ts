import type { buildTeamMap, TeamMapNode, TeamMapPoint, TeamMapPod } from "./model";

export const TREE_NODE_WIDTH = 256;
export const TREE_NODE_HEIGHT = 104;
/** Below this zoom the tree stops being readable, so the map switches to the ordered list. */
export const TREE_MIN_READABLE_ZOOM = 0.8;
const columnGap = 32;
const rowGap = 32;

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
  type Branch = { width: number; height: number; positions: Map<string, TeamMapPoint>; pods: TeamMapPod[] };
  const measure = (node: TeamMapNode): Branch => {
    const branches = children(node.id).map(measure);
    const positions = new Map<string, TeamMapPoint>();
    const pods: TeamMapPod[] = [];
    let childWidth = 0, childHeight = 0;
    for (let offset = 0; offset < branches.length; offset += 2) {
      const row = branches.slice(offset, offset + 2);
      let x = 0;
      for (const branch of row) {
        for (const [id, point] of branch.positions) positions.set(id, { x: x + point.x, y: childHeight + point.y });
        pods.push(...branch.pods.map(pod => ({ ...pod, x: x + pod.x, y: childHeight + pod.y })));
        x += branch.width + columnGap;
      }
      childWidth = Math.max(childWidth, x - columnGap);
      childHeight += Math.max(...row.map(branch => branch.height)) + rowGap;
    }
    childHeight = Math.max(0, childHeight - rowGap);
    const manager = node.mono.role === "manager";
    const width = Math.max(TREE_NODE_WIDTH, childWidth) + 32;
    const nodeY = manager ? 48 : 0;
    const childY = nodeY + TREE_NODE_HEIGHT + rowGap;
    const childX = (width - childWidth) / 2;
    for (const [id, point] of positions) positions.set(id, { x: point.x + childX, y: point.y + childY });
    for (const pod of pods) { pod.x += childX; pod.y += childY; }
    const memberIds = [...positions.keys()];
    positions.set(node.id, { x: (width - TREE_NODE_WIDTH) / 2, y: nodeY });
    const height = nodeY + TREE_NODE_HEIGHT + (branches.length ? rowGap + childHeight : 0) + 16;
    if (manager) pods.unshift({ id: node.id, x: 0, y: 0, width, height, memberIds });
    return { width, height, positions, pods };
  };
  const branches = columns.map(measure);
  const width = Math.max(TREE_NODE_WIDTH + 32, branches.reduce((total, branch) => total + branch.width + columnGap, -columnGap)) + 48;
  if (root) { root.x = (width - TREE_NODE_WIDTH) / 2; root.y = 24; }
  const top = root ? 184 : 16;
  const pods: TeamMapPod[] = [];
  const ordered = root ? [root] : [];
  let x = 24;
  for (const [index, branch] of branches.entries()) {
    const visit = (node: TeamMapNode) => {
      const point = branch.positions.get(node.id)!;
      node.x = x + point.x; node.y = top + point.y;
      ordered.push(node);
      for (const child of children(node.id)) visit(child);
    };
    visit(columns[index]);
    pods.push(...branch.pods.map(pod => ({ ...pod, x: pod.x + x, y: pod.y + top })));
    x += branch.width + columnGap;
  }
  const edges = map.edges.map(edge => {
    const parent = byId.get(edge.source)!, target = byId.get(edge.target)!;
    const start = { x: parent.x + TREE_NODE_WIDTH / 2, y: parent.y + TREE_NODE_HEIGHT };
    let points: TeamMapPoint[];
    if (parent === root) {
      points = [start, { x: start.x, y: 168 }, { x: target.x + TREE_NODE_WIDTH / 2, y: 168 }, { x: target.x + TREE_NODE_WIDTH / 2, y: target.y - 48 }];
    } else {
      const descendants = (node: TeamMapNode): TeamMapNode[] => [node, ...children(node.id).flatMap(descendants)];
      const spine = Math.min(...descendants(parent).map(node => node.x)) - 8;
      const end = { x: target.x + TREE_NODE_WIDTH / 2, y: target.mono.role === "manager" ? target.y - 48 : target.y };
      points = [start, { x: start.x, y: start.y + 12 }, { x: spine, y: start.y + 12 }, { x: spine, y: end.y - 12 }, { x: end.x, y: end.y - 12 }, end];
    }
    return { ...edge, points: points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y) };
  });
  return { ...map, nodes: ordered, edges, pods, orientation: "top-down" as const, width, height: Math.max(200, ...nodes.map(node => node.y + TREE_NODE_HEIGHT + 48)) };
}
