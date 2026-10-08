import { expect, it } from "vitest";
import { fitTeamMap } from "./camera";

it("keeps small teams readable and places overflow within reach by panning", () => {
  const camera = fitTeamMap(800, 450, 720, 660, 5);
  expect(camera.zoom).toBe(0.88);
  expect(camera.x).toBeCloseTo(83.2);
  expect(camera.y).toBe(16);
  expect(fitTeamMap(800, 450, 320, 240, 2).zoom).toBe(1);
});

it("fits large teams below the small-team minimum with a bounded zoom", () => {
  expect(fitTeamMap(800, 450, 1600, 660, 12).zoom).toBe(0.47);
  expect(fitTeamMap(400, 200, 4000, 2000, 30).zoom).toBe(0.2);
});
