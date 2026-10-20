import { expect, it, vi } from "vitest";
import { readTextFile } from "../../../platform/tauri/fs";
import { packageScripts } from "./packageScripts";
vi.mock("../../../platform/tauri/fs", () => ({ readTextFile: vi.fn() }));
it("reads existing scripts unchanged and constructs safe npm run names without persisting config", async () => {
  vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ scripts: { dev: "vite --host", test: "vitest run", "test:unit": "a && b", "bad;injected": "bad", empty: " ", number: 4 } }));
  expect(await packageScripts("C:\\project")).toEqual([
    { name: "dev", command: "vite --host", run: "npm run dev" }, { name: "test", command: "vitest run", run: "npm run test" }, { name: "test:unit", command: "a && b", run: "npm run test:unit" },
  ]);
  expect(readTextFile).toHaveBeenCalledWith("C:\\project/package.json");
});
it("returns no invented scripts and reports malformed or unavailable config", async () => {
  vi.mocked(readTextFile).mockResolvedValue("{}"); expect(await packageScripts("/project")).toEqual([]);
  vi.mocked(readTextFile).mockResolvedValue("invalid"); await expect(packageScripts("/project")).rejects.toThrow();
  vi.mocked(readTextFile).mockRejectedValue(new Error("missing")); await expect(packageScripts("/project")).rejects.toThrow("missing");
});
