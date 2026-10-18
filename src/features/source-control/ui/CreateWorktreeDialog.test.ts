// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { createWorktree, type Worktree } from "../model/worktrees";
import {
  githubRepo,
  githubWorkItem,
  listGithubWorkItems,
  type GithubWorkItem,
} from "../../inbox/model/githubTasks";

vi.mock("../model/worktrees", async (original) => ({
  ...(await original<typeof import("../model/worktrees")>()),
  createWorktree: vi.fn(),
}));
vi.mock("../hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: {
      current: "main",
      detached: false,
      branches: [
        { name: "main", remote: null, current: true },
        { name: "Feature/Case", remote: null, current: false },
      ],
    },
    settled: true,
  }),
}));
vi.mock("../../inbox/model/githubTasks", async (original) => ({
  ...(await original<typeof import("../../inbox/model/githubTasks")>()),
  githubRepo: vi.fn(),
  githubWorkItem: vi.fn(),
  listGithubWorkItems: vi.fn(),
}));
vi.mock("../../sessions/ui/ModelPicker", () => ({
  ModelControlPills: () => null,
  ModelPicker: ({
    onChange,
    hideSettings,
  }: {
    onChange: (harness: string, model: string) => void;
    hideSettings?: boolean;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-direct-model-list": hideSettings,
        onClick: () => onChange("codex", "gpt-5.4"),
      },
      "Choose Codex",
    ),
}));
const tree: Worktree = {
  path: "/trees/sidebar-worktree",
  branch: "sidebar-worktree",
  head: "abc",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
};
let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof CreateWorktreeDialog>;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
const input = (label = "Worktree name") =>
  document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const type = async (value: string, label?: string) =>
  act(async () => {
    const node = input(label);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = async () =>
  act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const render = async () =>
  act(async () => root.render(createElement(CreateWorktreeDialog, props)));
const search = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
const githubItem = (
  number: number,
  kind: "issue" | "pr" = "issue",
): GithubWorkItem => ({
  kind,
  number,
  title: `Sidebar fix ${number}`,
  repo: "owner/repo",
  url: `https://github.com/owner/repo/${kind === "pr" ? "pull" : "issues"}/${number}`,
  state: "OPEN",
  updatedAt: "2026-01-01T00:00:00Z",
  labels: [],
  assignees: [],
  draft: false,
});
const selectBranch = async (name: string) => {
  await act(async () => button("Existing branch").click());
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label^="Existing branch:"]')!
      .click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((node) => node.textContent?.includes(name))!
      .click(),
  );
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  vi.mocked(createWorktree).mockResolvedValue(tree);
  vi.mocked(githubRepo).mockResolvedValue("owner/repo");
  vi.mocked(listGithubWorkItems).mockResolvedValue([]);
  vi.mocked(githubWorkItem).mockResolvedValue({
    title: "Fix sidebar switching",
  } as Awaited<ReturnType<typeof githubWorkItem>>);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    cwd: "/repo",
    baseCwd: "/trees/current",
    defaultRoot: "/trees",
    onCreated: vi.fn(),
    onCancel: vi.fn(),
  };
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("previews and creates a normalized human name in the selected checkout", async () => {
  await type("Sidebar worktree");
  expect(document.body.textContent).toContain("sidebar-worktree");
  await submit();
  expect(createWorktree).toHaveBeenCalledExactlyOnceWith(
    "/trees/current",
    "sidebar-worktree",
    "HEAD",
    false,
  );
  expect(props.onCreated).toHaveBeenCalledWith(tree, {
    keepOpen: false,
    session: undefined,
  });
});
it("uses stable automatic naming for a blank name and rejects punctuation-only input", async () => {
  const initial = document.body.textContent!.match(/mc\/[a-z0-9]+/)![0];
  await render();
  expect(document.body.textContent).toContain(initial);
  await type("???");
  await submit();
  expect(createWorktree).not.toHaveBeenCalled();
  await type("");
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    initial,
    "HEAD",
    false,
  );
});
it("retains exact existing branch casing and blocks branches already checked out", async () => {
  await selectBranch("Feature/Case");
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "Feature/Case",
    "HEAD",
    true,
  );
  vi.mocked(createWorktree).mockClear();
  props = { ...props, worktrees: [{ ...tree, branch: "Feature/Case" }] };
  await render();
  await submit();
  expect(createWorktree).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("already has a working copy");
});
it("catches local branch collisions and allows an explicit normalized override", async () => {
  await type("main");
  await submit();
  expect(createWorktree).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("branch already exists");
  await type("Feature/New thing", "Branch name override");
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "feature/new-thing",
    "HEAD",
    false,
  );
});
it("opens a fresh session with chosen model, GitHub context and unsent starter prompt", async () => {
  props = { ...props, sessionOptions: true };
  await render();
  expect(button("Choose Codex").getAttribute("data-direct-model-list")).toBe(
    "true",
  );
  await act(async () => button("Choose Codex").click());
  await type("#123");
  expect(button("Create worktree").disabled).toBe(true);
  await search();
  expect(githubWorkItem).toHaveBeenCalledWith(
    "/trees/current",
    "owner/repo",
    "issue",
    123,
  );
  const prompt = document.querySelector<HTMLTextAreaElement>(
    '[aria-label="Starter prompt"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(prompt, "Please fix this");
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "issue-123-fix-sidebar-switching",
    "HEAD",
    false,
  );
  expect(props.onCreated).toHaveBeenCalledWith(
    tree,
    expect.objectContaining({
      session: expect.objectContaining({
        harness: "codex",
        model: "gpt-5.4",
        linkedWorkItem: expect.objectContaining({ kind: "issue", number: 123 }),
        composerSeed:
          "Fix sidebar switching\nhttps://github.com/owner/repo/issues/123\n\nPlease fix this",
      }),
    }),
  );
});
it("links PR URLs without silently changing the checkout base", async () => {
  await act(async () => button("GitHub").click());
  await type(
    "https://github.com/owner/repo/pull/42",
    "GitHub issue or pull request",
  );
  await search();
  await submit();
  expect(githubWorkItem).toHaveBeenCalledWith(
    "/trees/current",
    "owner/repo",
    "pr",
    42,
  );
  expect(githubRepo).not.toHaveBeenCalled();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "pr-42-fix-sidebar-switching",
    "HEAD",
    false,
  );
});
it("ignores a stale lookup after the source input changes", async () => {
  let resolve!: (item: Awaited<ReturnType<typeof githubWorkItem>>) => void;
  vi.mocked(githubWorkItem).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await type("#1");
  await search();
  await type("Other task");
  await act(async () =>
    resolve({ title: "Stale title" } as Awaited<
      ReturnType<typeof githubWorkItem>
    >),
  );
  expect(document.body.textContent).not.toContain("Stale title");
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "other-task",
    "HEAD",
    false,
  );
});
it("shows lookup and Git errors without closing or invoking success", async () => {
  vi.mocked(githubWorkItem).mockRejectedValueOnce(
    new Error("GitHub unavailable"),
  );
  await type("#1");
  await search();
  expect(document.body.textContent).toContain("GitHub unavailable");
  expect(button("Create worktree").disabled).toBe(true);
  await type("Retry task");
  vi.mocked(createWorktree).mockRejectedValueOnce(new Error("disk full"));
  await submit();
  expect(document.body.textContent).toContain("disk full");
  expect(props.onCreated).not.toHaveBeenCalled();
});
it("debounces title searches and selects issues or PRs directly from the results", async () => {
  vi.mocked(listGithubWorkItems).mockImplementation(
    async (_cwd, _repo, query) => [
      githubItem(query.kind === "issue" ? 1 : 2, query.kind),
    ],
  );
  await act(async () => button("GitHub").click());
  await type("s", "GitHub issue or pull request");
  await type("side", "GitHub issue or pull request");
  expect(listGithubWorkItems).not.toHaveBeenCalled();
  expect(button("Smart").disabled).toBe(false);
  expect(button("Look up")).toBeUndefined();
  await search();
  expect(listGithubWorkItems).toHaveBeenCalledTimes(2);
  expect(listGithubWorkItems).toHaveBeenCalledWith(
    "/trees/current",
    "owner/repo",
    {
      kind: "issue",
      state: "open",
      assignedToMe: false,
      search: "side",
    },
  );
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(
    input("GitHub issue or pull request").getAttribute("aria-expanded"),
  ).toBe("true");
  const node = input("GitHub issue or pull request");
  await act(async () =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await act(async () =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(input("GitHub issue or pull request").value).toContain("/pull/2");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "pr-2-sidebar-fix-2",
    "HEAD",
    false,
  );
  expect(githubWorkItem).not.toHaveBeenCalled();
});
it.each(["issue", "pr"] as const)(
  "keeps successful matches selectable when the %s lookup fails",
  async (failedKind) => {
    const item = githubItem(9, failedKind === "issue" ? "pr" : "issue");
    const warning =
      failedKind === "issue"
        ? "This repository has disabled issues"
        : "Pull request lookup unavailable";
    vi.mocked(listGithubWorkItems).mockImplementation(
      async (_cwd, _repo, query) => {
        if (query.kind === failedKind) throw new Error(warning);
        return [item];
      },
    );
    await act(async () => button("GitHub").click());
    await search();
    const list = document.querySelector('[role="listbox"]')!;
    const alert = list.querySelector('[role="alert"]')!;
    const option = list.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(alert.textContent).toContain(warning);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(option.textContent).toContain(
      `${item.kind === "pr" ? "PR" : "Issue"} #9`,
    );
    expect(
      alert.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(list.textContent).not.toContain("No matching");
    await act(async () => option.click());
    expect(button("Create worktree").disabled).toBe(false);
    await submit();
    expect(createWorktree).toHaveBeenCalledWith(
      "/trees/current",
      `${item.kind}-9-sidebar-fix-9`,
      "HEAD",
      false,
    );
  },
);
it("shows both lookup failures without offering invalid matches", async () => {
  vi.mocked(listGithubWorkItems).mockImplementation(
    async (_cwd, _repo, query) => {
      throw new Error(`${query.kind} unavailable`);
    },
  );
  await act(async () => button("GitHub").click());
  await search();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "issue unavailable",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "pr unavailable",
  );
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  expect(document.body.textContent).not.toContain("No matching");
  expect(button("Create worktree").disabled).toBe(true);
  await submit();
  expect(createWorktree).not.toHaveBeenCalled();
});
it("discards obsolete title results and errors while a newer search is active", async () => {
  let reject!: (err: Error) => void;
  vi.mocked(listGithubWorkItems).mockImplementationOnce(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  await act(async () => button("GitHub").click());
  await type("old", "GitHub issue or pull request");
  await search();
  await type("new", "GitHub issue or pull request");
  await search();
  await act(async () => reject(new Error("Obsolete error")));
  expect(document.body.textContent).not.toContain("Obsolete error");
  expect(document.body.textContent).toContain(
    "No matching issues or pull requests",
  );
  expect(button("Create worktree").disabled).toBe(true);
});
it("supports mouse selection and Escape without closing the creation dialog", async () => {
  vi.mocked(listGithubWorkItems).mockImplementation(
    async (_cwd, _repo, query) =>
      query.kind === "issue" ? [githubItem(9)] : [],
  );
  await act(async () => button("GitHub").click());
  await type("sidebar", "GitHub issue or pull request");
  await search();
  await act(async () =>
    input("GitHub issue or pull request").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(props.onCancel).not.toHaveBeenCalled();
  await type("sidebar fix", "GitHub issue or pull request");
  await search();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="option"]')!.click(),
  );
  expect(button("Create worktree").disabled).toBe(false);
  expect(input("GitHub issue or pull request").value).toContain("/issues/9");
});
it("cancels queued search when switching back to a plain name", async () => {
  await act(async () => button("GitHub").click());
  await type("side", "GitHub issue or pull request");
  await act(async () => button("Smart").click());
  await type("My task");
  await search();
  expect(listGithubWorkItems).not.toHaveBeenCalled();
  await submit();
  expect(createWorktree).toHaveBeenCalledWith(
    "/trees/current",
    "my-task",
    "HEAD",
    false,
  );
});
it("keeps the dialog for repeated creation and generates a fresh next name", async () => {
  await type("First task");
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await submit();
  expect(props.onCreated).toHaveBeenCalledWith(tree, {
    keepOpen: true,
    session: undefined,
  });
  expect(input().value).toBe("");
  expect(document.body.textContent).toContain("Created sidebar-worktree");
  await type("Second task");
  await submit();
  expect(createWorktree).toHaveBeenCalledTimes(2);
  expect(createWorktree).toHaveBeenLastCalledWith(
    "/trees/current",
    "second-task",
    "HEAD",
    false,
  );
});
it("does not repeat Git creation after an opening failure", async () => {
  props = {
    ...props,
    onCreated: vi.fn().mockRejectedValue(new Error("Navigation failed")),
  };
  await render();
  await type("First task");
  await submit();
  expect(createWorktree).toHaveBeenCalledTimes(1);
  expect(input().value).toBe("");
  expect(document.body.textContent).toContain(
    "Worktree created, but could not open it",
  );
});
