// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  adoptManagerMono,
  dedicatedMono,
  listMonos,
  railMonos,
  createMono,
} from "./mono";
import { monoEngineId } from "./monoEngines";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("adopts a Manager once without replacing its conversation or engine key", async () => {
  const original = adoptManagerMono(
    "project-manager-existing",
    "C:/code/app",
    100,
  );
  expect(adoptManagerMono(original.sessionId!, "C:/code/app", 200)).toEqual(
    original,
  );
  expect(listMonos()).toHaveLength(4);
  expect(await monoEngineId(original, "c:/code/app/")).toBe(original.sessionId);
  expect(original.role).toBe("manager");
});

it("keeps a Manager inside its project and plain Monos on the rail regardless of project count", () => {
  const first = adoptManagerMono("project-manager-first", "C:/code/app", 100);
  const second = createMono(["C:/code/app"]);
  expect(dedicatedMono("C:/code/app")?.id).toBe(first.id);
  expect(railMonos().map((mono) => mono.id)).toEqual([second.id]);
});

it("isolates new engine identity by Mono and folder while ignoring name changes", async () => {
  const a = createMono(["C:/code/app", "C:/code/site"]);
  const b = createMono(a.projects);
  const id = await monoEngineId(a, a.projects[0]);
  expect(await monoEngineId({ ...a, name: "Renamed" }, "c:/code/app/")).toBe(
    id,
  );
  expect(await monoEngineId(a, a.projects[1])).not.toBe(id);
  expect(await monoEngineId(b, b.projects[0])).not.toBe(id);
});

it("does not claim migration succeeded when roster storage fails", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw Error("disk full");
  });
  expect(() =>
    adoptManagerMono("project-manager-existing", "C:/code/app"),
  ).toThrow("disk full");
});
