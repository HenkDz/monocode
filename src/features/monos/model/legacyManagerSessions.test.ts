import { expect, it, vi } from "vitest";
import {
  archiveLegacyManagerSessions,
  isLegacyManagerSession,
} from "./legacyManagerSessions";
import type { Mono } from "./mono";

it("archives legacy and home Managers with their history and keeps the real Manager", async () => {
  const archive = vi.fn(async (_id: string) => {});
  const history = [{ role: "user", text: "Unique previous conversation" }];
  const rows = [
    { id: "project-manager-old", cwd: "/app", title: "Manager", history },
    { id: "stray", cwd: "~", title: "Manager", history },
    { id: "home", cwd: "C:/Users/me", title: "Manager", history },
    { id: "ordinary", cwd: "/app", title: "Chat", history },
  ];
  const migrated = await archiveLegacyManagerSessions(
    rows,
    archive,
    "C:/Users/me",
  );
  expect(migrated.slice(0, 3).every((row) => row.archived)).toBe(true);
  expect(migrated.map((row) => row.history)).toEqual(
    rows.map((row) => row.history),
  );
  expect(archive.mock.calls.map(([id]) => id)).toEqual([
    "project-manager-old",
    "stray",
    "home",
  ]);
  await archiveLegacyManagerSessions(migrated, archive, "C:/Users/me");
  expect(archive).toHaveBeenCalledTimes(3);
  const manager = {
    id: "manager",
    sessionId: "project-manager-real",
    role: "manager",
    projects: ["/app"],
    mascot: "cat",
    color: "#abc",
  } as Mono;
  expect(
    isLegacyManagerSession({ id: manager.sessionId!, cwd: "/app" }, [manager]),
  ).toBe(false);
});

it("does not claim migration succeeded when archive persistence fails", async () => {
  await expect(
    archiveLegacyManagerSessions(
      [{ id: "project-manager-old", cwd: "/app" }],
      async () => {
        throw Error("Disk unavailable");
      },
    ),
  ).rejects.toThrow("Disk unavailable");
});
