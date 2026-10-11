// @vitest-environment happy-dom
import { act, StrictMode, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { WorktreeRemovalTasks } from "./WorktreeRemovalTasks";
import { finishWorktreeRemovalTask, startWorktreeRemovalTask } from "../model/worktreeRemovalTasks";
import type { Worktree } from "../model/worktrees";
import { gitDiffIndex, type GitChangedFile, type GitDiffIndex } from "../../../platform/tauri/fs";

vi.mock("../../../platform/tauri/fs", () => ({ gitDiffIndex: vi.fn() }));

const file = (relative: string, status = "modified", staged = false, unstaged = true): GitChangedFile => ({
  path: `/tree/${relative}`, relative, status, staged, unstaged, additions: 0, deletions: 0,
});
const index = (files: GitChangedFile[] = [file("edit.ts")], upstream: string | null = "origin/feature"): GitDiffIndex => ({
  files, upstream, ahead: 2, behind: 0, branch: "feature", head: "ce76191abcd",
  additions: 0, deletions: 0, remote: "origin", defaultBranch: "main", aheadOfDefault: 2, headPushed: false,
});
beforeEach(() => { vi.mocked(gitDiffIndex).mockReset().mockResolvedValue(index()); });
afterEach(() => act(() => { for (const path of ["/tree", "/a", "/b"]) finishWorktreeRemovalTask(path); }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Dialog(props: ComponentProps<typeof DeleteWorktreeDialog>) {
  const [open, setOpen] = useState(true);
  return <>
    <WorktreeRemovalTasks />
    {open && <DeleteWorktreeDialog {...props} onClose={() => { setOpen(false); props.onClose(); }} />}
  </>;
}

it("lets pending deletion minimize and restore without restarting its job", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let resolve!: () => void;
  const remove = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  const close = vi.fn(), deleted = vi.fn();
  try {
    await act(async () => root.render(<StrictMode><Dialog cwd="/repo"
      tree={{ path: "/tree", branch: "feature", head: "abc" } as Worktree}
      onRemove={remove} onClose={close} onDeleted={deleted} /></StrictMode>));
    await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("false");
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Minimize"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Deleting worktree");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Show progress")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Deletion in progress");
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Minimize"]')!.click());
    act(() => { expect(startWorktreeRemovalTask("/tree", () => null)).toBe(false); });
    expect(deleted).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(deleted).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("allows separate worktree deletions to finish independently", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const finishes = new Map<string, () => void>();
  const remove = vi.fn((_cwd: string, path: string) => new Promise<void>(resolve => finishes.set(path, resolve)));
  const deleted = vi.fn();
  function App() {
    const [path, setPath] = useState<string>();
    return <><WorktreeRemovalTasks />
      <button onClick={() => setPath("/a")}>Delete A</button><button onClick={() => setPath("/b")}>Delete B</button>
      {path && <DeleteWorktreeDialog key={path} cwd="/repo" tree={{ path, branch: "feature", head: "abc" } as Worktree}
        onRemove={remove} onClose={() => setPath(undefined)} onDeleted={() => deleted(path)} />}
    </>;
  }
  try {
    await act(async () => root.render(<App />));
    for (const label of ["Delete A", "Delete B"]) {
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click());
      await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Minimize"]')!.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(remove).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(2);
    await act(async () => finishes.get("/b")!());
    expect(deleted).toHaveBeenCalledWith("/b");
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    await act(async () => finishes.get("/a")!());
    expect(deleted.mock.calls).toEqual([["/b"], ["/a"]]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("retains sessions and does not repeat worktree deletion after branch cleanup fails", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const remove = vi.fn(async () => {});
  const branch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unmerged branch retained"))
    .mockResolvedValue(undefined);
  const deleted = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Dialog
          cwd="/repo"
          tree={
            {
              path: "/tree",
              branch: "feature",
              head: "ce76191abcd",
              dirty: true,
              unpushed: 2,
            } as Worktree
          }
          sessionCount={1}
          allowDeleteSessions={false}
          onRemove={remove}
          onDeleteBranch={branch}
          onClose={() => {}}
          onDeleted={deleted}
        />,
      ),
    );
    expect(document.body.textContent).toContain("uncommitted and untracked");
    expect(document.body.textContent).toContain("2 commits not pushed");
    expect(document.querySelector('[role="switch"]')).toBeNull();
    await act(async () =>
      (
        document.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click(),
    );
    const submit = () =>
      act(async () =>
        document
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
    await submit();
    expect(remove).toHaveBeenCalledWith("/repo", "/tree", true, false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unmerged branch retained");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Review")!.click());
    expect(document.body.textContent).toContain(
      "Worktree removed; branch cleanup failed",
    );
    expect(deleted).not.toHaveBeenCalled();
    expect(branch).toHaveBeenLastCalledWith(false);
    const force = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][1];
    expect(force.checked).toBe(false);
    await act(async () => force.click());
    expect(document.body.textContent).toContain("Commits not saved elsewhere may be lost");
    expect(document.querySelector('button[type="submit"]')?.textContent).toContain("Force delete branch");
    await submit();
    expect(branch).toHaveBeenLastCalledWith(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(branch).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function withDialog(check: (host: HTMLElement) => Promise<void> | void, tree: Partial<Worktree> = {}, onOpenChanges = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Dialog
      cwd="/repo" tree={{ path: "/tree", branch: "feature", head: "ce76191abcd", dirty: true, ...tree } as Worktree}
      onRemove={vi.fn()} onDeleteBranch={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} onOpenChanges={onOpenChanges}
    />));
    await check(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

it("loads exact discard counts, bounds the file list, and opens this worktree's changes", async () => {
  vi.mocked(gitDiffIndex).mockResolvedValue(index([
    file("both.ts", "modified", true), file("edit.ts"),
    file("new-a.ts", "untracked"), file("new-b.ts", "untracked"), file("new-c.ts", "untracked"),
    file("staged.ts", "added", true, false),
  ]));
  const open = vi.fn();
  await withDialog(async () => {
    expect(gitDiffIndex).toHaveBeenCalledWith("/tree", true);
    expect(document.body.textContent).toContain("2 modified · 3 untracked · 2 staged");
    expect(document.body.textContent).toContain("both.ts");
    expect(document.body.textContent).not.toContain("staged.ts");
    expect(document.body.textContent).toContain("+1 more");
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Open changes")!;
    await act(async () => button.click());
    expect(open).toHaveBeenCalledWith("/tree");
  }, { dirty: false }, open);
});

it("shows a checked clean state without treating ahead of default as unpushed", async () => {
  vi.mocked(gitDiffIndex).mockResolvedValue(index([], null));
  await withDialog(() => {
    expect(document.body.textContent).toContain("No uncommitted or untracked changes.");
    expect(document.body.textContent).not.toContain("not pushed");
  });
});

it("shows the detached commit and omits branch deletion controls", async () => {
  await withDialog(() => {
    expect(document.body.textContent).toContain("Detached commit ce76191");
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.body.textContent).toContain("1 modified");
  }, { branch: null });
});

it("disables removal during loading and falls back when Git cannot be checked", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(gitDiffIndex).mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
  await withDialog(async () => {
    expect(document.body.textContent).toContain("Checking changes and unpushed commits");
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => reject(new Error("Git unavailable")));
    expect(document.body.textContent).toContain("Changes could not be checked");
    expect(document.body.textContent).not.toContain("No uncommitted");
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
});
