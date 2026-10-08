// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { TeamMapNode } from "./model";
import {
  orbitProjects,
  orbitDefaultFocus,
  orbitMembers,
  orbitPage,
  orbitRotation,
  orbitLayout,
  orbitKeyboardProject,
  loadOrbitPreferences,
  saveOrbitPreferences,
  ORBIT_PREFERENCES_KEY,
} from "./orbit";

const node = (
  id: string,
  role: TeamMapNode["mono"]["role"] = "member",
  parentId?: string,
  status: TeamMapNode["status"] = "idle",
  project = `/${id}`,
): TeamMapNode => ({
  id,
  mono: {
    id,
    name: id,
    role,
    reportsTo: parentId,
    projects: [project],
    mascot: "cat",
    color: "#aaaaaa",
  },
  parentId,
  status,
  state: { status: status === "pr-ready" ? "idle" : status },
  project,
  title: "Task",
  model: "codex:gpt-6.1-sol",
  permissions: "Read only",
  lastReport: "",
  x: 0,
  y: 0,
  hiddenCount: 0,
});
const nodes = [
  node("z", "manager"),
  node("a", "manager"),
  node("c", "manager"),
  node("idle", "member", "a"),
  node("work", "member", "a", "working"),
  node("pr", "member", "c", "pr-ready"),
  node("need", "member", "z", "needs-you"),
];

it("starts alphabetically and reconciles persisted order without duplicates or removed projects", () => {
  expect(orbitProjects(nodes).map((project) => project.manager.id)).toEqual([
    "a",
    "c",
    "z",
  ]);
  expect(
    orbitProjects(nodes, ["z", "removed", "z", "a"]).map(
      (project) => project.manager.id,
    ),
  ).toEqual(["z", "a", "c"]);
  const renamed = nodes.map((value) =>
    value.id === "z" ? { ...value, project: "/aa" } : value,
  );
  expect(
    orbitProjects(renamed, ["z", "a", "c"]).map(
      (project) => project.manager.id,
    ),
  ).toEqual(["z", "a", "c"]);
});

it("sorts rows by needs-you, working, PR ready, idle without changing their model or specialty text", () => {
  const rows = [
    node("Idle"),
    node("Ready", "member", undefined, "pr-ready"),
    node("Zeta", "member", undefined, "working"),
    node("Alpha", "member", undefined, "working"),
    {
      ...node("Need", "member", undefined, "needs-you"),
      mono: { ...node("Need").mono, specialty: "API and iOS" },
    },
  ];
  const sorted = orbitMembers(rows);
  expect(sorted.map((value) => value.id)).toEqual([
    "Need",
    "Alpha",
    "Zeta",
    "Ready",
    "Idle",
  ]);
  expect(sorted[0].model).toBe("codex:gpt-6.1-sol");
  expect(sorted[0].mono.specialty).toBe("API and iOS");
  expect(rows[0].id).toBe("Idle");
});

it("groups descendants under their nearest manager and stops broken parent cycles", () => {
  const projects = orbitProjects([
    node("manager", "manager"),
    node("parent", "member", "manager"),
    node("child", "member", "parent"),
    node("bad", "member", "bad"),
  ]);
  expect(projects[0].members.map((member) => member.id)).toEqual([
    "child",
    "parent",
  ]);
  expect(projects[0].counts.idle).toBe(3);
});

it("counts ready members and mirrored attention once while retaining a Manager's own work", () => {
  const ready = orbitProjects([
    node("manager", "manager", undefined, "pr-ready"),
    node("ready", "member", "manager", "pr-ready"),
  ])[0];
  expect(ready.counts["pr-ready"]).toBe(1);
  expect(ready.counts.idle).toBe(0);
  expect(
    orbitProjects([node("manager", "manager", undefined, "pr-ready")])[0]
      .counts["pr-ready"],
  ).toBe(1);
  const manager = node("manager", "manager", undefined, "needs-you");
  const attention = orbitProjects([
    {
      ...manager,
      state: { status: "needs-you", attentionLocation: "Reviewer" },
    },
    node("reviewer", "member", "manager", "needs-you"),
  ])[0];
  expect(attention.counts["needs-you"]).toBe(1);
  const working = orbitProjects([
    node("manager", "manager", undefined, "working"),
    node("worker", "member", "manager", "working"),
  ])[0];
  expect(working.counts.working).toBe(2);
});

it("focuses explicit scope before attention, PR readiness, activity, and saved idle focus", () => {
  const projects = orbitProjects(nodes);
  expect(orbitDefaultFocus(projects, "a", "c")).toBe("a");
  expect(orbitDefaultFocus(projects, "work")).toBe("a");
  expect(orbitDefaultFocus(projects, undefined, "c")).toBe("z");
  expect(
    orbitDefaultFocus(
      projects.filter((project) => project.manager.id !== "z"),
      undefined,
      "a",
    ),
  ).toBe("c");
  expect(
    orbitDefaultFocus(projects.filter((project) => project.manager.id === "a")),
  ).toBe("a");
  const idle = orbitProjects(
    nodes.filter((value) => value.mono.role === "manager"),
  );
  expect(orbitDefaultFocus(idle, "removed", "z")).toBe("z");
  expect(orbitDefaultFocus(idle, undefined, "removed")).toBe("a");
  expect(orbitDefaultFocus([])).toBeUndefined();
});

it("chooses the most urgent project by count and retains saved focus when equally urgent", () => {
  const projects = orbitProjects([
    node("a", "manager", undefined, "needs-you"),
    node("b", "manager", undefined, "needs-you"),
    node("need", "member", "b", "needs-you"),
  ]);
  expect(orbitDefaultFocus(projects, undefined, "a")).toBe("b");
  expect(
    orbitDefaultFocus(
      orbitProjects(
        nodes
          .filter((value) => value.mono.role === "manager")
          .map((value) => ({ ...value, status: "working" })),
      ),
      undefined,
      "z",
    ),
  ).toBe("z");
});

it("rotates through the shortest direction and places the focused capsule at six o'clock", () => {
  expect(orbitRotation(0, 1, 4)).toBe(-90);
  expect(orbitRotation(0, 3, 4)).toBe(90);
  expect(orbitRotation(170, 1, 4)).toBe(270);
  expect(orbitRotation(0, 2, 4)).toBe(180);
  expect(orbitRotation(720, 0, 4)).toBe(720);
  expect(orbitRotation(90, 0, 1)).toBe(0);
  for (const count of [1, 2, 4, 8])
    for (let index = 0; index < count; index++) {
      const rotation = orbitRotation(153, index, count);
      expect(Math.abs(rotation - 153)).toBeLessThanOrEqual(180);
      const layout = orbitLayout(count, 1000, rotation);
      expect(layout.positions[index].x).toBeCloseTo(layout.center.x);
      expect(layout.positions[index].y).toBeCloseTo(
        layout.center.y + layout.radius,
      );
    }
});

it("keeps ring angles and neighbours fixed across viewport widths while scaling its radius", () => {
  const large = orbitLayout(8, 1000),
    small = orbitLayout(8, 480);
  expect(small.positions.map((point) => point.angle)).toEqual(
    large.positions.map((point) => point.angle),
  );
  expect(small.radius).toBeLessThan(large.radius);
  expect(small.scale).toBeLessThan(large.scale);
  expect(small.radiusX).toBe(small.radiusY);
  expect(orbitLayout(1, 1000).positions[0].x).toBeCloseTo(500);
  expect(orbitLayout(0, 1000).positions).toEqual([]);
  for (const layout of [large, small])
    for (const point of layout.positions) {
      expect(point.x - 110 * layout.scale).toBeGreaterThanOrEqual(0);
      expect(point.x + 110 * layout.scale).toBeLessThanOrEqual(layout.width);
      expect(point.y - 56 * layout.scale).toBeGreaterThanOrEqual(0);
      expect(point.y + 56 * layout.scale).toBeLessThanOrEqual(layout.height);
    }
});

it("pages more than eight projects while retaining global order and locating focused projects", () => {
  const projects = orbitProjects(
    Array.from({ length: 19 }, (_, index) =>
      node(String(index).padStart(2, "0"), "manager"),
    ),
  );
  expect(orbitPage(projects, "12")).toMatchObject({ page: 1, pages: 3 });
  expect(
    orbitPage(projects, "12").projects.map((project) => project.manager.id),
  ).toEqual(["08", "09", "10", "11", "12", "13", "14", "15"]);
  expect(orbitPage(projects, undefined, 99)).toMatchObject({
    page: 2,
    pages: 3,
  });
  expect(orbitPage(projects, undefined, -1).projects).toHaveLength(8);
  expect(orbitPage([], "missing")).toMatchObject({
    page: 0,
    pages: 1,
    projects: [],
  });
});

it("wraps horizontal project navigation", () => {
  const projects = orbitProjects(nodes);
  expect(orbitKeyboardProject(projects, "a", "ArrowLeft")).toBe("z");
  expect(orbitKeyboardProject(projects, "z", "ArrowRight")).toBe("a");
  expect(orbitKeyboardProject(projects, "a", "Enter")).toBe("a");
  expect(orbitKeyboardProject([], undefined, "ArrowLeft")).toBeUndefined();
});

it("keeps the Orchestrator and focused or unfocused capsules apart throughout rotations", () => {
  for (const width of [280, 320, 480, 680, 880, 1000])
    for (let count = 1; count <= 8; count++)
      for (
        let rotation = 0;
        rotation < (count === 1 ? 1 : 360);
        rotation += 5
      ) {
        const layout = orbitLayout(count, width, rotation);
        for (let index = 0; index < count; index++) {
          const point = layout.positions[index];
          const capsuleScale = layout.scale * 1.06;
          expect(
            Math.abs(point.x - layout.center.x) >=
              120 * layout.scale + 110 * capsuleScale ||
              Math.abs(point.y - layout.center.y) >=
                64 * layout.scale + 56 * capsuleScale,
          ).toBe(true);
        }
      }
});

it("keeps eight upright capsules apart at settled focus angles", () => {
  for (const width of [480, 880, 1000])
    for (let focus = 0; focus < 8; focus++) {
      const layout = orbitLayout(8, width, orbitRotation(0, focus, 8));
      for (let a = 0; a < 8; a++)
        for (let b = a + 1; b < 8; b++) {
          expect(
            Math.abs(layout.positions[a].x - layout.positions[b].x) >=
              220 * layout.scale ||
              Math.abs(layout.positions[a].y - layout.positions[b].y) >=
                112 * layout.scale,
          ).toBe(true);
        }
    }
});

it("persists focus, order and view and tolerates invalid or unavailable storage", () => {
  const preferences = { order: ["z", "a"], focus: "z", view: "tree" as const };
  saveOrbitPreferences(preferences);
  expect(loadOrbitPreferences()).toEqual(preferences);
  window.localStorage.setItem(
    ORBIT_PREFERENCES_KEY,
    JSON.stringify({ order: ["a", null, 7, "a"], focus: 42, view: "invalid" }),
  );
  expect(loadOrbitPreferences()).toEqual({
    order: ["a"],
    focus: undefined,
    view: "orbit",
  });
  window.localStorage.setItem(ORBIT_PREFERENCES_KEY, "invalid");
  expect(loadOrbitPreferences()).toEqual({ order: [], view: "orbit" });
  expect(
    loadOrbitPreferences({
      getItem() {
        throw new Error("blocked");
      },
    }),
  ).toEqual({ order: [], view: "orbit" });
  expect(() =>
    saveOrbitPreferences(preferences, {
      setItem() {
        throw new Error("blocked");
      },
    }),
  ).not.toThrow();
  window.localStorage.removeItem(ORBIT_PREFERENCES_KEY);
});
