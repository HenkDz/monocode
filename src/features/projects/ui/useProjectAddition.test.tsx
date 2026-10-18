// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectAddition } from "./useProjectAddition";
import {
  setWorktreeFocus,
  worktreeFocus,
} from "../../source-control/model/worktreeFocus";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let root: Root;
let container: HTMLElement;
let choose: ReturnType<typeof useProjectAddition>["chooseProjectAddition"];
function Harness() {
  const hook = useProjectAddition();
  choose = hook.chooseProjectAddition;
  return hook.projectAdditionDialog;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorktreeFocus("/repo", undefined);
  invoke.mockResolvedValue({
    path: "/trees/v4",
    project: "/repo",
    branch: "v4",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function pick(label: string) {
  let result!: ReturnType<typeof choose>;
  await act(async () => {
    result = choose("/trees/v4", ["/repo"]);
  });
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  return result;
}
it("offers parent grouping and selects the linked checkout", async () => {
  expect((await pick("Add under project"))?.project).toBe("/repo");
  expect(worktreeFocus("/repo")?.path).toBe("/trees/v4");
});
it("offers an explicit separate project action", async () => {
  expect((await pick("Add as separate project"))?.project).toBe("/trees/v4");
  expect(worktreeFocus("/repo")).toBeUndefined();
});
it("cancelling does not change the selected worktree", async () => {
  expect(await pick("Cancel")).toBeNull();
  expect(worktreeFocus("/repo")).toBeUndefined();
});
it("a superseded native resolution cannot change focus or open a choice dialog", async () => {
  let result;
  await act(async () => {
    result = await choose("/trees/v4", ["/repo"], false, true, () => false);
  });
  expect(result).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(worktreeFocus("/repo")).toBeUndefined();
});
