import { expect, it } from "vitest";
import { fitTeamMap, focusTeamMap, teamMapCompact, TEAM_MAP_COMPACT_ZOOM } from "./camera";

it("fits all cards inside padded viewport bounds without a readability floor clipping them", () => {
  const camera = fitTeamMap(800, 450, 720, 660, 5);
  expect(camera.zoom).toBeCloseTo(402 / 660);
  expect(camera.y).toBe(24);
  expect(camera.x).toBeGreaterThanOrEqual(24);
  expect(camera.x + 720 * camera.zoom).toBeLessThanOrEqual(776);
  expect(camera.y + 660 * camera.zoom).toBeLessThanOrEqual(426);
  expect(fitTeamMap(800, 450, 320, 240, 2).zoom).toBe(1);
});

it("allows large teams to fit in compact mode instead of clipping at a zoom floor", () => {
  const camera = fitTeamMap(400, 200, 4000, 2000, 30);
  expect(camera.zoom).toBe(0.076);
  expect(teamMapCompact(camera.zoom)).toBe(true);
  expect(camera.x + 4000 * camera.zoom).toBeLessThanOrEqual(376);
  expect(camera.y + 2000 * camera.zoom).toBeLessThanOrEqual(176);
});

it("keeps full cards at the semantic boundary and hides detail below it", () => {
  expect(TEAM_MAP_COMPACT_ZOOM).toBe(0.7);
  expect(teamMapCompact(0.699)).toBe(true);
  expect(teamMapCompact(0.7)).toBe(false);
  expect(teamMapCompact(0.9)).toBe(false);
});

it("keeps a compact org at or above the 90% target without enlarging cards", () => {
  const camera = fitTeamMap(1100, 1250, 1080, 1100, 25);
  expect(camera.zoom).toBeGreaterThanOrEqual(0.9);
  expect(camera.zoom).toBeLessThanOrEqual(1);
  expect(camera.x).toBeGreaterThanOrEqual(24);
  expect(camera.x + 1080 * camera.zoom).toBeLessThanOrEqual(1076);
});

it("zooms onto a pod and centers its own bounds", () => {
  const wholeOrg = fitTeamMap(1100, 1250, 1080, 1100);
  const bounds = { x: 448, y: 360, width: 416, height: 408 };
  const focused = focusTeamMap(1100, 1250, bounds);
  expect(focused.zoom).toBe(1.5);
  expect(focused.zoom).toBeGreaterThan(wholeOrg.zoom);
  expect(focused.x + bounds.x * focused.zoom).toBe((1100 - bounds.width * focused.zoom) / 2);
  expect(focused.y + bounds.y * focused.zoom).toBe((1250 - bounds.height * focused.zoom) / 2);
  expect(focused).not.toEqual(wholeOrg);
});

it("fits a large focused pod within bounds at a reduced zoom", () => {
  const bounds = { x: 600, y: 800, width: 1200, height: 600 };
  const camera = focusTeamMap(800, 450, bounds);
  expect(camera.zoom).toBeCloseTo(752 / 1200);
  expect(camera.x + bounds.x * camera.zoom).toBeCloseTo(24);
  expect(camera.x + (bounds.x + bounds.width) * camera.zoom).toBeCloseTo(776);
});
