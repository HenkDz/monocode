// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ChatWorktreePicker } from "./ChatWorktreePicker";

const tree = { path: "/repo-worker", branch: "feature", head: "abc", isMain: false, locked: false, prunable: false, missing: false, dirty: false, unpushed: 0, sessionIds: [] };
vi.mock("../hooks/useProjectWorktrees", () => ({ useProjectWorktrees: () => ({ data: { worktrees: [tree] } }) }));
vi.mock("../hooks/useProjectBranches", () => ({ useProjectBranchesState: () => ({ settled: true, branches: {
  current: "main", branches: [{ name: "main" }, ...Array.from({ length: 1354 }, (_, index) => ({ name: `feature-${index}` }))],
} }) }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("keeps a fixed started checkout and rejects stale open picker callbacks after locking", async () => {
  const select = vi.fn(async () => {});
  const render = (draft: boolean) => act(() => root.render(<ChatWorktreePicker project="/repo" path={tree.path} branch="feature" draft={draft} onSelect={select} />));
  render(true);
  await act(async () => container.querySelector("button")!.click());
  const stale = document.querySelector<HTMLButtonElement>('[role="option"]')!;
  render(false);
  await act(async () => stale.click());
  expect(select).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Working in");
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(document.querySelector('[aria-label="Starts in worktree or branch"]')).toBeNull();
});

it("searches all 1354 branches with bounded mounted rows and supports keyboard selection and main creation", async () => {
  const create = vi.fn();
  act(() => root.render(<ChatWorktreePicker project="/repo" path={tree.path} draft onCreate={create} />));
  await act(async () => container.querySelector("button")!.click());
  expect(document.querySelectorAll('[role="option"]').length).toBe(60);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search worktrees or branches"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "feature-1353"); input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelectorAll('[role="option"]').length).toBe(1);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(create).toHaveBeenCalledWith("feature-1353");
  await act(async () => container.querySelector("button")!.click());
  const button = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("New worktree from main"))!;
  await act(async () => button.click());
  expect(create).toHaveBeenLastCalledWith("main");
});

it("restores focus with Escape and shows an async refusal without changing ownership", async () => {
  const select = vi.fn(async () => { throw new Error("Session already started"); });
  act(() => root.render(<ChatWorktreePicker project="/repo" path={tree.path} draft onSelect={select} />));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Session already started");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[aria-label="Starts in worktree or branch"]')).toBeNull();
});
