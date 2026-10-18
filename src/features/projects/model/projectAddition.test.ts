import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import {
  setWorktreeFocus,
  worktreeFocus,
} from "../../source-control/model/worktreeFocus";
import {
  applyProjectAddition,
  resolveProjectAddition,
  sessionForProjectAddition,
} from "./projectAddition";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("project additions", () => {
  beforeEach(() => {
    invoke.mockReset();
    setWorktreeFocus("C:/repo", undefined);
  });
  it("uses native canonical checkout ownership and selects the worktree under its parent", async () => {
    invoke.mockResolvedValue({
      path: "C:/worktrees/v4",
      project: "C:/repo",
      branch: "v4",
    });
    const addition = await resolveProjectAddition("c:\\WORKTR~1\\v4", [
      "C:/repo",
    ]);
    expect(invoke).toHaveBeenCalledWith("resolve_project_add", {
      path: "c:/WORKTR~1/v4",
      projects: ["C:/repo"],
      separateProjects: [],
    });
    expect(applyProjectAddition(addition)).toBe("C:/repo");
    expect(worktreeFocus("c:/REPO")).toEqual({
      path: "C:/worktrees/v4",
      branch: "v4",
    });
    const session = sessionForProjectAddition(
      newSession("codex", addition.path),
      addition,
    );
    expect(session.cwd).toBe("C:/repo");
    expect(session.worktreeCwd).toBe(addition.path);
  });
  it("adds a linked checkout separately only when explicitly requested", () => {
    expect(
      applyProjectAddition(
        { path: "C:/worktrees/v4", project: "C:/repo", branch: "v4" },
        true,
      ),
    ).toBe("C:/worktrees/v4");
    expect(worktreeFocus("C:/repo")).toBeUndefined();
  });
  it("keeps ordinary folders and separately registered worktrees unchanged", async () => {
    const addition = { path: "C:/folder", project: "C:/folder", branch: null };
    invoke.mockResolvedValue(addition);
    expect(
      applyProjectAddition(
        await resolveProjectAddition(addition.path, [addition.path]),
      ),
    ).toBe(addition.path);
    const session = newSession("codex", addition.path);
    expect(sessionForProjectAddition(session, addition)).toBe(session);
  });
  it("does not send remote paths to local canonicalization", async () => {
    expect(await resolveProjectAddition("remote://host/repo", [])).toEqual({
      path: "remote://host/repo",
      project: "remote://host/repo",
      branch: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("does not silently register a separate project when native resolution fails", async () => {
    invoke.mockRejectedValue(new Error("Checkout is missing"));
    await expect(
      resolveProjectAddition("C:/missing", ["C:/repo"]),
    ).rejects.toThrow("Checkout is missing");
    expect(worktreeFocus("C:/repo")).toBeUndefined();
  });
});
