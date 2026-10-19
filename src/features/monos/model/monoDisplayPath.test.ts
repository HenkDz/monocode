import { expect, it } from "vitest";
import { monoDisplayPath } from "./monoDisplayPath";

it.each([
  ["//?/C:/Users/synthetic/.codex", "~/.codex"],
  ["\\\\?\\C:\\Users\\synthetic\\.codex", "~/.codex"],
  ["\\\\?\\UNC\\server\\share\\context", "//server/share/context"],
  ["//?/UNC/server/share/context", "//server/share/context"],
  ["C:/synthetic/account", "C:/synthetic/account"],
  ["/home/synthetic/.codex", "~/.codex"],
  ["/synthetic/repo", "/synthetic/repo"],
])("displays %s without changing the supplied path", (path, expected) => {
  expect(monoDisplayPath(path)).toBe(expected);
});

it("middle-shortens a long display while preserving the recognizable root and leaf", () => {
  const path = "C:/synthetic/" + "long-folder/".repeat(12) + "project";
  const display = monoDisplayPath(path);
  expect(display.length).toBeLessThanOrEqual(64);
  expect(display).toMatch(/^C:\/synthetic\/.+….+\/project$/);
  expect(path).not.toContain("…");
});
