// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

vi.mock("../model/projectData", () => ({ projectSessionCount: async () => 2 }));
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])(
  "describes the actual project removal when archiveTeam=%s",
  async (archiveTeam) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onConfirm = vi.fn();
    const action = archiveTeam ? "Archive" : "Delete";
    try {
      await act(async () =>
        root.render(
          createElement(RemoveProjectDialog, {
            name: "App",
            path: "/app",
            archiveTeam,
            onConfirm,
            onCancel: vi.fn(),
          }),
        ),
      );
      const dialog = document.querySelector(
        `[role=dialog][aria-label="${action} App"]`,
      )!;
      expect(dialog).not.toBeNull();
      expect(dialog.querySelector("h2")?.textContent).toBe(`${action} “App”?`);
      if (archiveTeam) {
        expect(dialog.textContent).toContain("their runs stopped");
        expect(dialog.textContent).toContain(
          "Conversations, worktrees and branches are kept",
        );
        expect(dialog.textContent).toContain(
          "2 saved conversations will be kept",
        );
        expect(dialog.textContent).not.toContain("will be deleted");
      } else {
        expect(dialog.textContent).toContain(
          "All conversations for this project will be deleted",
        );
        expect(dialog.textContent).toContain(
          "2 saved conversations will be removed",
        );
        expect(dialog.textContent).toContain("back empty");
      }
      const confirm = [
        ...dialog.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent === action)!;
      await act(async () => confirm.click());
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
