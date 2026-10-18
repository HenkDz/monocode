// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../inbox/model/githubTasks", async (original) => ({
  ...(await original<typeof import("../../inbox/model/githubTasks")>()),
  githubPrAction: vi.fn(),
}));

import {
  githubPrAction,
  type GithubWorkItem,
  type InboxItem,
} from "../../inbox/model/githubTasks";
import { GithubPrActions } from "../../inbox/ui/InboxView";

let container: HTMLDivElement;
let root: Root;

function pr(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: "pr",
    title: "Ship the new inbox",
    url: "https://github.com/acme/web/pull/42",
    state: "open",
    updatedAt: "2026-09-16T08:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    number: 42,
    projectPath: "/tmp/web",
    provider: "github",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(githubPrAction).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body
    .querySelectorAll("[data-popover-side]")
    .forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

describe("GitHub pull request actions", () => {
  it("freezes the shared callback confirmation target while live props change", async () => {
    const onAction = vi.fn(async () => ({ state: "merged" }));
    const item = pr();
    const render = (headOid: string, baseRef: string, headRef: string) =>
      act(() =>
        root.render(
          createElement(GithubPrActions, {
            item,
            headOid,
            baseRef,
            headRef,
            onAction,
          }),
        ),
      );
    render("old-head", "main", "feature/old");
    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Merge pull request")!
        .click(),
    );
    expect(onAction).not.toHaveBeenCalled();
    render("new-head", "staging", "feature/new");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("feature/old");
    expect(dialog.textContent).not.toContain("feature/new");
    await act(async () =>
      [...dialog.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Merge pull request")!
        .click(),
    );
    expect(onAction).toHaveBeenCalledWith("merge", {
      projectPath: "/tmp/web",
      repo: "acme/web",
      number: 42,
      headOid: "old-head",
      baseRef: "main",
      headRef: "feature/old",
    });
    expect(githubPrAction).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "shared", change: { number: 43 } },
    { mode: "shared", change: { repo: "other/repository" } },
    { mode: "shared", change: { projectPath: "/tmp/another" } },
    { mode: "legacy", change: { number: 43 } },
    { mode: "legacy", change: { repo: "other/repository" } },
    { mode: "legacy", change: { projectPath: "/tmp/another" } },
    { mode: "shared", change: { number: 43 }, merge: true },
    { mode: "shared", change: { repo: "other/repository" }, merge: true },
    { mode: "shared", change: { projectPath: "/tmp/another" }, merge: true },
  ])(
    "refuses a changed PR identity in $mode confirmation: $change",
    async ({ mode, change, merge }) => {
      const label = merge ? "Merge pull request" : "Close pull request";
      const onAction = vi.fn(async () => ({ state: "closed" }));
      const initial = pr();
      const render = (item: InboxItem) =>
        act(() =>
          root.render(
            createElement(GithubPrActions, {
              item,
              headOid: "same-head",
              baseRef: "main",
              headRef: "same-branch",
              ...(mode === "shared" ? { onAction } : {}),
            }),
          ),
        );
      render(initial);
      act(() =>
        [...container.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.trim() === label)!
          .click(),
      );
      render({ ...initial, ...change });
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      if (mode === "shared") {
        expect(dialog.textContent).toContain("PR #42");
        expect(dialog.textContent).toContain("acme/web");
        expect(dialog.textContent).not.toContain("PR #43");
        expect(dialog.textContent).not.toContain("other/repository");
      }
      await act(async () =>
        [...dialog.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.trim() === label)!
          .click(),
      );
      expect(onAction).not.toHaveBeenCalled();
      expect(githubPrAction).not.toHaveBeenCalled();
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
        "selected pull request changed",
      );
      const cancel = [
        ...dialog.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent?.trim() === "Cancel")!;
      expect(cancel.disabled).toBe(false);
      act(() => cancel.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it.each([
    { mode: "shared", draft: false },
    { mode: "shared", draft: true },
    { mode: "legacy", draft: false },
    { mode: "legacy", draft: true },
  ])(
    "retains draft/review controls only in legacy mode: $mode draft=$draft",
    ({ mode, draft }) => {
      act(() =>
        root.render(
          createElement(GithubPrActions, {
            item: pr({ draft }),
            baseRef: "main",
            headRef: "feature",
            ...(mode === "shared"
              ? { onAction: vi.fn(async () => ({ state: "open" })) }
              : {}),
          }),
        ),
      );
      expect(container.textContent?.includes("Ready for review")).toBe(
        mode === "legacy" && draft,
      );
      expect(container.textContent?.includes("Convert to draft")).toBe(
        mode === "legacy" && !draft,
      );
      expect(githubPrAction).not.toHaveBeenCalled();
    },
  );

  it("selects a merge method, confirms it, and publishes the fresh state", async () => {
    const item = pr();
    const merged: GithubWorkItem = {
      kind: "pr",
      title: item.title,
      url: item.url,
      state: "merged",
      updatedAt: "2026-09-16T08:05:00Z",
      labels: [],
      assignees: [],
      draft: false,
      repo: item.repo,
      number: item.number,
    };
    vi.mocked(githubPrAction).mockResolvedValue(merged);
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(GithubPrActions, {
          item,
          baseRef: "main",
          headRef: "feature/inbox",
          onChange,
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Merge options"]')!
        .click(),
    );
    const squash = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes("Squash and merge"))!;
    act(() => squash.click());

    const primary = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Squash and merge",
    )!;
    act(() => primary.click());
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Squash and merge?"]',
    )!;
    expect(dialog.textContent).toContain(
      "from “feature/inbox” will be combined into one commit on “main”",
    );

    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Squash and merge")!
        .click();
      await Promise.resolve();
    });

    expect(githubPrAction).toHaveBeenCalledWith(
      "/tmp/web",
      "acme/web",
      42,
      "squash",
    );
    expect(onChange).toHaveBeenCalledWith({
      ...item,
      ...merged,
      projectPath: "/tmp/web",
      provider: "github",
    });
  });

  it("keeps a failed close action open with GitHub's error", async () => {
    vi.mocked(githubPrAction).mockRejectedValue(
      new Error("You do not have permission to close this pull request"),
    );
    act(() =>
      root.render(
        createElement(GithubPrActions, {
          item: pr(),
          baseRef: "main",
          headRef: "feature/inbox",
        }),
      ),
    );

    const close = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Close pull request",
    )!;
    act(() => close.click());
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Close this pull request?"]',
    )!;
    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Close pull request")!
        .click();
      await Promise.resolve();
    });

    expect(dialog.textContent).toContain(
      "You do not have permission to close this pull request",
    );
    expect(dialog.querySelector('[role="alert"]')).toBeTruthy();
  });
});
