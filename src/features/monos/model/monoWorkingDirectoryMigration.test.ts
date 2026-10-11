// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { acceptMonoWorkingDirectoryMigration, monoWorkingDirectoryMigrationPending, monoWorkingDirectoryNeedsResume, rememberMonoWorkingDirectoryMigration } from "./monoWorkingDirectoryMigration";

beforeEach(() => localStorage.clear());

it("retains the old native identity across a restart until an actual turn accepts it", async () => {
  rememberMonoWorkingDirectoryMigration("chat", "old-native");
  vi.resetModules();
  const restarted = await import("./monoWorkingDirectoryMigration");
  expect(restarted.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(true);
  expect(restarted.monoWorkingDirectoryNeedsResume("other-chat", "old-native")).toBe(false);
  expect(restarted.monoWorkingDirectoryNeedsResume("chat", "new-native")).toBe(false);
  expect(restarted.monoWorkingDirectoryMigrationPending("chat")).toBe(true);
  restarted.acceptMonoWorkingDirectoryMigration("chat");
  expect(restarted.monoWorkingDirectoryNeedsResume("chat", "old-native")).toBe(false);
  expect(restarted.monoWorkingDirectoryMigrationPending("chat")).toBe(false);
});

it("keeps other pending conversations and never records a new conversation", () => {
  rememberMonoWorkingDirectoryMigration("other", "other-native");
  rememberMonoWorkingDirectoryMigration("new");
  rememberMonoWorkingDirectoryMigration("chat", "old-native");
  acceptMonoWorkingDirectoryMigration("chat");
  expect(monoWorkingDirectoryNeedsResume("other", "other-native")).toBe(true);
  expect(monoWorkingDirectoryNeedsResume("new")).toBe(false);
  expect(monoWorkingDirectoryMigrationPending("new")).toBe(false);
  expect(monoWorkingDirectoryMigrationPending("other")).toBe(true);
  expect(localStorage.getItem("monocode:mono-working-directory-migration:other")).toBe("other-native");
  expect(localStorage.getItem("monocode:mono-working-directory-migration:chat")).toBeNull();
});

it("does not treat another native identity as a pending migration", () => {
  for (const value of ["invalid", "null", "[]", '{"chat":false}', '{"chat":{}}']) {
    localStorage.setItem("monocode:mono-working-directory-migration:chat", value);
    expect(monoWorkingDirectoryNeedsResume("chat", "native")).toBe(false);
  }
});

it("refuses a folder transaction when its durable marker cannot be written", () => {
  const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("Storage full"); });
  try { expect(() => rememberMonoWorkingDirectoryMigration("chat", "native")).toThrow("Storage full"); }
  finally { set.mockRestore(); }
});
