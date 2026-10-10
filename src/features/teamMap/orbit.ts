import { monoLook } from "../monos/model/mono";
import { projectName } from "../../shared/lib/paths";
import type { TeamMapNode } from "./model";

export const ORBIT_PAGE_SIZE = 8;
export const ORBIT_PREFERENCES_KEY = "monocode:team-map-orbit";
export type OrbitPreferences = {
  order: string[];
  focus?: string;
  view: "orbit" | "tree";
};
export type OrbitProject = {
  manager: TeamMapNode;
  members: TeamMapNode[];
  project: string;
  name: string;
  counts: Record<TeamMapNode["status"], number>;
};

const memberRank = { "needs-you": 0, working: 1, "pr-ready": 2, idle: 3 };

export function orbitMembers(nodes: readonly TeamMapNode[]) {
  return [...nodes].sort(
    (a, b) =>
      memberRank[a.status] - memberRank[b.status] ||
      monoLook(a.mono).name.localeCompare(monoLook(b.mono).name) ||
      a.id.localeCompare(b.id),
  );
}

export function orbitProjects(
  nodes: readonly TeamMapNode[],
  savedOrder: readonly string[] = [],
): OrbitProject[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const managerFor = (node: TeamMapNode) => {
    const seen = new Set<string>();
    let parent = node.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (ancestor?.mono.role === "manager") return ancestor.id;
      parent = ancestor?.parentId;
    }
    return undefined;
  };
  const projects = nodes
    .filter((node) => node.mono.role === "manager")
    .map((manager) => {
      const members = orbitMembers(
        nodes.filter(
          (node) => node.id !== manager.id && managerFor(node) === manager.id,
        ),
      );
      const counts = { "needs-you": 0, working: 0, "pr-ready": 0, idle: 0 };
      for (const node of members) counts[node.status]++;
      if (manager.status !== "pr-ready" && !manager.state.attentionLocation)
        counts[manager.status]++;
      else if (counts[manager.status] === 0) counts[manager.status]++;
      const project =
        manager.project ??
        manager.mono.managerProject ??
        manager.mono.projects[0] ??
        "";
      return {
        manager,
        members,
        counts,
        project,
        name: project ? projectName(project) : monoLook(manager.mono).name,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.manager.id.localeCompare(b.manager.id),
    );
  const order = [...new Set(savedOrder)];
  return [
    ...order.flatMap((id) =>
      projects.filter((project) => project.manager.id === id),
    ),
    ...projects.filter((project) => !order.includes(project.manager.id)),
  ];
}

export function orbitDefaultFocus(
  projects: readonly OrbitProject[],
  scope?: string,
  savedFocus?: string,
) {
  const scoped = projects.find(
    (project) =>
      project.manager.id === scope ||
      project.members.some((node) => node.id === scope),
  );
  if (scoped) return scoped.manager.id;
  const saved = projects.find((project) => project.manager.id === savedFocus);
  const priority = (project: OrbitProject) =>
    project.counts["needs-you"]
      ? 3
      : project.counts["pr-ready"]
        ? 2
        : project.counts.working
          ? 1
          : 0;
  const urgentCount = (project: OrbitProject) =>
    project.counts["needs-you"] ||
    project.counts["pr-ready"] ||
    project.counts.working;
  const ranked = [...projects].sort(
    (a, b) =>
      priority(b) - priority(a) ||
      urgentCount(b) - urgentCount(a) ||
      Number(b === saved) - Number(a === saved),
  );
  return (ranked[0] && priority(ranked[0]) ? ranked[0] : (saved ?? projects[0]))
    ?.manager.id;
}

export function orbitPage(
  projects: readonly OrbitProject[],
  focus?: string,
  requestedPage?: number,
) {
  const pages = Math.max(1, Math.ceil(projects.length / ORBIT_PAGE_SIZE));
  const focusIndex = projects.findIndex(
    (project) => project.manager.id === focus,
  );
  const page = Math.max(
    0,
    Math.min(
      pages - 1,
      Math.trunc(
        requestedPage ?? (focusIndex < 0 ? 0 : focusIndex / ORBIT_PAGE_SIZE),
      ),
    ),
  );
  return {
    projects: projects.slice(
      page * ORBIT_PAGE_SIZE,
      (page + 1) * ORBIT_PAGE_SIZE,
    ),
    page,
    pages,
  };
}

/** Keep the accumulated angle so repeated focus changes never take a full turn. */
export function orbitRotation(current: number, index: number, count: number) {
  if (count <= 0 || index < 0) return current;
  const target = (-index * 360) / count;
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + (delta === -180 ? 180 : delta);
}

export function orbitLayout(
  count: number,
  availableWidth: number,
  rotation = 0,
) {
  const width = Math.max(280, Math.min(1000, availableWidth));
  const scale = Math.min(
    1,
    width / (count > 6 ? 1000 : count > 4 ? 880 : count > 1 ? 780 : 480),
  );
  const radius =
    (count > 6 ? 340 : count > 4 ? 300 : count > 1 ? 270 : 170) * scale;
  const center = { x: width / 2, y: radius + 64 * scale };
  const height = radius * 2 + 128 * scale;
  const positions = Array.from({ length: count }, (_, index) => {
    const angle = 90 + (index * 360) / count + rotation;
    return {
      x: center.x + Math.cos((angle * Math.PI) / 180) * radius,
      y: center.y + Math.sin((angle * Math.PI) / 180) * radius,
      angle,
    };
  });
  return {
    width,
    height,
    center,
    radiusX: radius,
    radiusY: radius,
    radius,
    scale,
    positions,
  };
}

export function orbitKeyboardProject(
  projects: readonly OrbitProject[],
  currentId: string | undefined,
  key: string,
) {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return currentId;
  if (!projects.length) return undefined;
  const index = projects.findIndex(
    (project) => project.manager.id === currentId,
  );
  return projects[
    (Math.max(0, index) + (key === "ArrowLeft" ? -1 : 1) + projects.length) %
      projects.length
  ].manager.id;
}

export function loadOrbitPreferences(
  storage?: Pick<Storage, "getItem">,
): OrbitPreferences {
  try {
    const value = JSON.parse(
      (storage ?? window.localStorage).getItem(ORBIT_PREFERENCES_KEY) ?? "null",
    );
    return {
      order: Array.isArray(value?.order)
        ? ([
            ...new Set(
              value.order.filter(
                (id: unknown): id is string => typeof id === "string",
              ),
            ),
          ] as string[])
        : [],
      focus: typeof value?.focus === "string" ? value.focus : undefined,
      view: value?.view === "tree" ? "tree" : "orbit",
    };
  } catch {
    return { order: [], view: "orbit" };
  }
}

export function saveOrbitPreferences(
  value: OrbitPreferences,
  storage?: Pick<Storage, "setItem">,
) {
  try {
    (storage ?? window.localStorage).setItem(
      ORBIT_PREFERENCES_KEY,
      JSON.stringify(value),
    );
  } catch {
    /* A blocked storage backend must not prevent map navigation. */
  }
}
