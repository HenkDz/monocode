import { expect, it } from "vitest";
import { monoDisplayPath } from "./monoDisplayPath";

it.each([
  ["//?/C:/Users/synthetic/.codex", "C:/Users/synthetic/.codex"],
  ["\\\\?\\C:\\Users\\synthetic\\.codex", "C:/Users/synthetic/.codex"],
  ["\\\\?\\UNC\\server\\share\\context", "//server/share/context"],
  ["//?/UNC/server/share/context", "//server/share/context"],
  ["C:/synthetic/account", "C:/synthetic/account"],
  ["/home/synthetic/.codex", "/home/synthetic/.codex"],
  ["/synthetic/repo", "/synthetic/repo"],
  ["//?/UNC/Users/share/context", "//Users/share/context"],
  ["\\\\?\\UNC\\Users\\share\\context", "//Users/share/context"],
  ["//Users/share/context", "//Users/share/context"],
  ["\\\\Users\\share\\context", "//Users/share/context"],
  ["C:/Users/Other/.codex", "C:/Users/Other/.codex"],
  ["/home/Other/.codex", "/home/Other/.codex"],
  ["C:/Users/synthetic-backup/.codex", "C:/Users/synthetic-backup/.codex"],
  ["/home/synthetic-backup/.codex", "/home/synthetic-backup/.codex"],
  ["//?/UNC/home/share/context", "//home/share/context"],
  ["//home/share/context", "//home/share/context"],
  ["//?/C:/Users/A/.codex", "C:/Users/A/.codex"],
  ["C:/Users/AB/.codex", "C:/Users/AB/.codex"],
  ["Users/Other/context", "Users/Other/context"],
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
